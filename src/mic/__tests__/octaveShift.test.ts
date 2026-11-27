import { describe, expect, it, vi } from 'vitest';
import { AdditivePiano } from '../../audio/dsp/piano';
import type { SchedEvent } from '../../audio/dsp/schedule';
import { hzToMidi, midiToHz } from '../../core/notes';
import { sanitizeSettings } from '../../state/settings';
import {
  OctaveShiftTracker,
  formatOctaveShiftBadge,
  resolveOctaveShift,
} from '../octaveShift';
import { outputAt } from '../outputAt';
import { PitchTracker } from '../pitchTracker';
import { VoiceGate } from '../voiceGate';

const RATE = 48000;
const HOP = 512;

function renderVibratoVoice(
  length: number,
  rate: number,
  baseHz: number,
  amp = 0.25,
): Float32Array {
  const out = new Float32Array(length);
  const twoPi = Math.PI * 2;
  let phase = 0;
  const harmonicWeights = [1.0, 0.55, 0.32, 0.18, 0.1];
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const vibCents = 22 * Math.sin(twoPi * 5.5 * t);
    const instHz = baseHz * Math.pow(2, vibCents / 1200);
    phase += instHz / rate;
    if (phase >= 1) phase -= 1;
    const env = Math.min(1, t / 0.03);
    let sample = 0;
    for (let h = 0; h < harmonicWeights.length; h++) {
      sample += harmonicWeights[h]! * Math.sin(twoPi * (h + 1) * phase);
    }
    out[i] = sample * amp * env * 0.6;
  }
  return out;
}

describe('resolveOctaveShift 與 OctaveShiftTracker', () => {
  it('auto 模式：男聲 C3(48) 對目標 C4(60) → +1；女聲同八度 → 0', () => {
    expect(resolveOctaveShift('auto', [47.9, 48.1, 48.0], 60, 0)).toBe(1);
    expect(resolveOctaveShift('auto', [60.2, 59.9, 60.0], 60, 1)).toBe(0);
    expect(resolveOctaveShift('auto', [48.0, 48.2], 72, 0)).toBe(2);
    expect(resolveOctaveShift('auto', [60.0, 60.1], 48, 0)).toBe(-1);
  });

  it('none 與 up 模式各自固定回傳 0 與 +1', () => {
    expect(resolveOctaveShift('none', [48, 48.1], 60, 1)).toBe(0);
    expect(resolveOctaveShift('up', [60, 60.1], 60, 0)).toBe(1);
  });

  it('無目標音（休息／示範段）或無有效幀時沿用 prevK', () => {
    expect(resolveOctaveShift('auto', [48, 48], null, 1)).toBe(1);
    expect(resolveOctaveShift('auto', [], 60, 1)).toBe(1);
  });

  it('不同音穩定不亂跳：前 150 ms 決定後該音內鎖定，休息段沿用，新音才重算', () => {
    const tracker = new OctaveShiftTracker();

    // 目標音 1（C4=60），前 150 ms 男聲唱 C3(48) → k=+1 並在 150 ms 後鎖定
    expect(
      tracker.process({
        mode: 'auto',
        tSec: 0.0,
        rawMidi: 48.0,
        targetMidi: 60,
        noteKey: 'n1',
      }),
    ).toBe(1);
    expect(
      tracker.process({
        mode: 'auto',
        tSec: 0.16,
        rawMidi: 48.1,
        targetMidi: 60,
        noteKey: 'n1',
      }),
    ).toBe(1);

    // 該音尚未唱完，即使後續突然出現極端八度誤跳幀，仍維持鎖定的 k=+1
    expect(
      tracker.process({
        mode: 'auto',
        tSec: 0.35,
        rawMidi: 60.0,
        targetMidi: 60,
        noteKey: 'n1',
      }),
    ).toBe(1);

    // 休息／示範段無目標音 → 沿用上一個 k=+1
    expect(
      tracker.process({
        mode: 'auto',
        tSec: 0.6,
        rawMidi: 50,
        targetMidi: null,
        noteKey: null,
      }),
    ).toBe(1);

    // 切換到目標音 2（D4=62）→ 若換成同八度女聲 D4(62)，於新音前 150 ms 重新決定為 k=0
    expect(
      tracker.process({
        mode: 'auto',
        tSec: 1.0,
        rawMidi: 62.0,
        targetMidi: 62,
        noteKey: 'n2',
      }),
    ).toBe(0);
  });

  it('8va / 15ma / 8vb 標籤與舊設定相容性正確', () => {
    expect(formatOctaveShiftBadge(0)).toBeNull();
    expect(formatOctaveShiftBadge(1)).toBe('8va');
    expect(formatOctaveShiftBadge(2)).toBe('15ma');
    expect(formatOctaveShiftBadge(-1)).toBe('8vb');

    const migrated = sanitizeSettings({ pitchOctaveCorrection: 12 });
    expect(migrated.singOctaveMode).toBe('auto');
    expect('pitchOctaveCorrection' in migrated).toBe(false);
  });
});

describe('VoiceGate 必須收到原始 Hz（位移前）整合測試', () => {
  it('男聲唱 C3(130.8 Hz) 對目標 C5(523.25 Hz) 時，顯示位移為 +24 半音，但 VoiceGate 仍收到原始 Hz 並能正確攔截鋼琴漏音', () => {
    const durSec = 1.5;
    const totalSamples = Math.round(RATE * durSec);
    const c3Hz = midiToHz(48, 440); // 130.81 Hz
    const c4Hz = midiToHz(60, 440); // 261.63 Hz (喇叭發出 C4，或目標 C5=72)

    // 情境 1：喇叭播 C4 鋼琴音，麥克風收到純鋼琴漏音（約 C4）
    const piano = new AdditivePiano(RATE);
    piano.on('mel:0', c4Hz, false);
    const leakBuf = new Float32Array(totalSamples);
    piano.render(leakBuf, 0, totalSamples);
    const events: SchedEvent[] = [
      {
        frame: 0,
        type: 'noteOn',
        id: 'mel:0',
        hz: c4Hz,
        held: false,
        bus: 'melody',
      },
      { frame: totalSamples, type: 'noteOff', id: 'mel:0', bus: 'melody' },
    ];

    const tracker1 = new PitchTracker(RATE, -45);
    const gate1 = new VoiceGate();
    const processSpy1 = vi.spyOn(gate1, 'processFrame');
    let leakCount = 0;

    for (let pos = 0; pos + HOP <= leakBuf.length; pos += HOP) {
      const res = tracker1.pushChunk(leakBuf.subarray(pos, pos + HOP), pos);
      if (!res || res.hz <= 0) continue;
      const outputs = outputAt(events, res.t, RATE);
      // 必須送入未位移的原始 res.hz
      const g = gate1.processFrame(
        { t: res.t, hz: res.hz, db: res.db },
        outputs,
        { mode: 'speaker', gateDb: -45 },
      );
      if (g.label === 'leak') leakCount++;
    }

    expect(processSpy1).toHaveBeenCalled();
    for (const call of processSpy1.mock.calls) {
      // 驗證傳入 VoiceGate 的 hz 是原始偵測的 C4 (~261.6 Hz)，而非被移調的音高
      expect(Math.abs(hzToMidi(call[0].hz, 440) - 60)).toBeLessThan(0.5);
    }
    expect(leakCount).toBeGreaterThan(80);

    // 情境 2：男聲帶顫音唱 C3 (130.8 Hz) 疊在 C4 鋼琴上，目標為 C5 (72)
    // VoiceGate 收到原始 130.8 Hz（與 C4 差一八度，透過顫音判為 voice），隨後位移 k=+2 → MIDI 72
    const voiceBuf = renderVibratoVoice(totalSamples, RATE, c3Hz, 0.28);
    const mixBuf = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      mixBuf[i] = leakBuf[i]! * 0.4 + voiceBuf[i]!;
    }

    const tracker2 = new PitchTracker(RATE, -45);
    const gate2 = new VoiceGate();
    const processSpy2 = vi.spyOn(gate2, 'processFrame');
    const shiftTracker = new OctaveShiftTracker();
    const shiftedMidis: number[] = [];

    for (let pos = 0; pos + HOP <= mixBuf.length; pos += HOP) {
      const res = tracker2.pushChunk(mixBuf.subarray(pos, pos + HOP), pos);
      if (!res || res.hz <= 0) continue;
      const outputs = outputAt(events, res.t, RATE);
      const g = gate2.processFrame(
        { t: res.t, hz: res.hz, db: res.db },
        outputs,
        { mode: 'speaker', gateDb: -45 },
      );
      if (g.label === 'voice') {
        const rawMidi = hzToMidi(res.hz, 440);
        const k = shiftTracker.process({
          mode: 'auto',
          tSec: res.t,
          rawMidi,
          targetMidi: 72, // C5
          noteKey: 'c5-note',
        });
        shiftedMidis.push(rawMidi + 12 * k);
      }
    }

    expect(processSpy2).toHaveBeenCalled();
    // 確認傳給 VoiceGate 的幀保持原始 C3 (~48) 頻率，未被提前 +24
    const voiceInputMidis = processSpy2.mock.calls
      .map((c) => hzToMidi(c[0].hz, 440))
      .filter((m) => Number.isFinite(m));
    expect(voiceInputMidis.some((m) => Math.abs(m - 48) < 0.6)).toBe(true);
    expect(voiceInputMidis.every((m) => m < 55)).toBe(true);

    // 經過 OctaveShiftTracker 後，顯示用的 MIDI 對齊目標 C5 (72)
    expect(shiftedMidis.length).toBeGreaterThan(80);
    const avgShifted =
      shiftedMidis.reduce((a, b) => a + b, 0) / shiftedMidis.length;
    expect(Math.abs(avgShifted - 72)).toBeLessThan(0.5);
  });
});
