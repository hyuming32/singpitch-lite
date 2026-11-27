import { describe, expect, it, vi } from 'vitest';
import { AdditivePiano } from '../../audio/dsp/piano';
import type { SchedEvent } from '../../audio/dsp/schedule';
import { hzToMidi, midiToHz } from '../../core/notes';
import { PitchTracker } from '../pitchTracker';
import { outputAt } from '../outputAt';
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

describe('VoiceGate 必須收到原始 Hz（位移前）整合測試', () => {
  it('男聲＋高音譜 8va（+12）：喇叭彈 C4(261.6 Hz)，男聲唱 C3(130.8 Hz) 時，VoiceGate 仍收到原始 Hz 並正確區分漏音與人聲', () => {
    const durSec = 1.5;
    const totalSamples = Math.round(RATE * durSec);
    const c3Hz = midiToHz(48, 440); // 130.81 Hz（實際唱音高）
    const c4Hz = midiToHz(60, 440); // 261.63 Hz（+12 後譜面音高／喇叭鋼琴音）

    // 情境 1：喇叭播 +12 的 C4 鋼琴音，麥克風收到純鋼琴漏音（約 C4）
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
      expect(Math.abs(hzToMidi(call[0].hz, 440) - 60)).toBeLessThan(0.5);
    }
    expect(leakCount).toBeGreaterThan(80);

    // 情境 2：男聲帶顫音唱 C3 (130.8 Hz) 疊在 C4 鋼琴上
    // VoiceGate 收到原始 130.8 Hz（與 C4 差一八度，判為 voice），隨後顯示端套用 +12 → MIDI 60
    const voiceBuf = renderVibratoVoice(totalSamples, RATE, c3Hz, 0.28);
    const mixBuf = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      mixBuf[i] = leakBuf[i]! * 0.4 + voiceBuf[i]!;
    }

    const tracker2 = new PitchTracker(RATE, -45);
    const gate2 = new VoiceGate();
    const processSpy2 = vi.spyOn(gate2, 'processFrame');
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
        shiftedMidis.push(rawMidi + 12);
      }
    }

    expect(processSpy2).toHaveBeenCalled();
    const voiceInputMidis = processSpy2.mock.calls
      .map((c) => hzToMidi(c[0].hz, 440))
      .filter((m) => Number.isFinite(m));
    expect(voiceInputMidis.some((m) => Math.abs(m - 48) < 0.6)).toBe(true);
    expect(voiceInputMidis.every((m) => m < 55)).toBe(true);

    expect(shiftedMidis.length).toBeGreaterThan(80);
    const avgShifted =
      shiftedMidis.reduce((a, b) => a + b, 0) / shiftedMidis.length;
    expect(Math.abs(avgShifted - 60)).toBeLessThan(0.5);
  });
});
