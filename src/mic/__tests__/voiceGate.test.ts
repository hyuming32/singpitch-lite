import { describe, expect, it } from 'vitest';
import { MetronomeClick } from '../../audio/dsp/click';
import { AdditivePiano } from '../../audio/dsp/piano';
import type { SchedEvent } from '../../audio/dsp/schedule';
import { outputAt } from '../outputAt';
import { PitchTracker } from '../pitchTracker';
import { ConfusionDetector, VoiceGate } from '../voiceGate';

const RATE = 48000;
const HOP = 512;

/** 決定性偽隨機數產生器（LCG），確保測試可重現 */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** 產生指定 dBFS 的白噪音緩衝區 */
function addWhiteNoise(buf: Float32Array, noiseDb: number, seed = 42): void {
  const rng = makeRng(seed);
  const rms = Math.pow(10, noiseDb / 20);
  // 均勻分布 [-1, 1] 的標準差為 1 / sqrt(3)
  const scale = rms * Math.sqrt(3);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i]! + (rng() * 2 - 1) * scale;
  }
}

/** 合成帶 5.5 Hz ±20 cents 顫音與 ±5 cents 隨機抖動的諧波人聲 */
function renderSyntheticVoice(
  length: number,
  rate: number,
  baseHz: number,
  amp: number,
  vibratoCents = 20,
  vibratoHz = 5.5,
  jitterCents = 5,
  seed = 123,
): Float32Array {
  const out = new Float32Array(length);
  const rng = makeRng(seed);
  const twoPi = Math.PI * 2;
  let phase = 0;
  const harmonicWeights = [1.0, 0.55, 0.32, 0.18, 0.1];
  let jitter = 0;

  for (let i = 0; i < length; i++) {
    const t = i / rate;
    // 平滑隨機抖動（逐樣本微調但以約 30 Hz 速率更新目標）
    if (i % 1600 === 0) {
      jitter = (rng() * 2 - 1) * jitterCents;
    }
    const vib = vibratoCents * Math.sin(twoPi * vibratoHz * t);
    const instHz = baseHz * Math.pow(2, (vib + jitter) / 1200);
    phase += instHz / rate;
    if (phase >= 1) phase -= 1;

    // 淡入 30 ms 避免起音爆音
    const env = Math.min(1, t / 0.03);
    let sample = 0;
    for (let h = 0; h < harmonicWeights.length; h++) {
      sample += harmonicWeights[h]! * Math.sin(twoPi * (h + 1) * phase);
    }
    out[i] = sample * amp * env * 0.6;
  }
  return out;
}

/** 跑過 PitchTracker（YIN）與 VoiceGate 並統計各標籤數量 */
function runPipeline(
  audio: Float32Array,
  events: readonly SchedEvent[],
  mode: 'speaker' | 'headphone' = 'speaker',
  gateDb = -45,
) {
  const tracker = new PitchTracker(RATE, gateDb);
  const gate = new VoiceGate();
  const labels: string[] = [];

  for (let pos = 0; pos + HOP <= audio.length; pos += HOP) {
    const chunk = audio.subarray(pos, pos + HOP);
    const res = tracker.pushChunk(chunk, pos);
    if (!res) continue;
    const outputs = outputAt(events, res.t, RATE);
    const g = gate.processFrame(
      { t: res.t, hz: res.hz, db: res.db },
      outputs,
      { mode, gateDb },
    );
    labels.push(g.label);
  }
  return labels;
}

describe('voiceGate（經 YIN 實際偵測）', () => {
  const durSec = 2.0;
  const totalSamples = RATE * durSec;
  const noteHz = 440; // A4

  const noteEvents: SchedEvent[] = [
    {
      frame: 0,
      type: 'noteOn',
      id: 'mel:0',
      hz: noteHz,
      held: false,
      bus: 'melody',
    },
    {
      frame: totalSamples,
      type: 'noteOff',
      id: 'mel:0',
      bus: 'melody',
    },
  ];

  it('(a) 純合成鋼琴 + −40 dB 雜訊 → 大部分判為 leak（≥ 80%）', () => {
    const piano = new AdditivePiano(RATE);
    piano.on('mel:0', noteHz, false);
    const buf = new Float32Array(totalSamples);
    piano.render(buf, 0, totalSamples);
    addWhiteNoise(buf, -40, 101);

    const labels = runPipeline(buf, noteEvents, 'speaker', -45);
    const active = labels.filter((l) => l !== 'silent');
    const leakCount = active.filter((l) => l === 'leak').length;
    const voiceCount = active.filter((l) => l === 'voice').length;
    const leakRatio = leakCount / active.length;
    console.info(
      `[voiceGate (a) 純鋼琴] total=${labels.length}, active=${active.length}, leak=${leakCount} (${(leakRatio * 100).toFixed(1)}%), voice=${voiceCount}`,
    );
    expect(active.length).toBeGreaterThan(50);
    expect(leakRatio).toBeGreaterThanOrEqual(0.8);
    expect(voiceCount / active.length).toBeLessThan(0.05);
  });

  it('(b) 同音高帶 5.5 Hz ±20 cents 顫音與 ±5 cents 抖動人聲疊在鋼琴上 → 大部分判為 voice（≥ 80%）', () => {
    const piano = new AdditivePiano(RATE);
    piano.on('mel:0', noteHz, false);
    const buf = new Float32Array(totalSamples);
    piano.render(buf, 0, totalSamples);

    const voice = renderSyntheticVoice(totalSamples, RATE, noteHz, 0.24, 20, 5.5, 5);
    for (let i = 0; i < totalSamples; i++) {
      buf[i] = buf[i]! + voice[i]!;
    }
    addWhiteNoise(buf, -40, 202);

    const labels = runPipeline(buf, noteEvents, 'speaker', -45);
    const active = labels.filter((l) => l !== 'silent');
    const voiceCount = active.filter((l) => l === 'voice').length;
    const voiceRatio = voiceCount / active.length;
    console.info(
      `[voiceGate (b) 同音高人聲+鋼琴] total=${labels.length}, active=${active.length}, voice=${voiceCount} (${(voiceRatio * 100).toFixed(1)}%)`,
    );
    expect(active.length).toBeGreaterThan(50);
    expect(voiceRatio).toBeGreaterThanOrEqual(0.8);
  });

  it('(c) 偏 60 cents 的人聲疊在鋼琴上 → 大部分判為 voice（≥ 90%）', () => {
    const piano = new AdditivePiano(RATE);
    piano.on('mel:0', noteHz, false);
    const buf = new Float32Array(totalSamples);
    piano.render(buf, 0, totalSamples);

    const offHz = noteHz * Math.pow(2, 60 / 1200);
    const voice = renderSyntheticVoice(totalSamples, RATE, offHz, 0.24, 0, 5.5, 3);
    for (let i = 0; i < totalSamples; i++) {
      buf[i] = buf[i]! + voice[i]!;
    }
    addWhiteNoise(buf, -40, 303);

    const labels = runPipeline(buf, noteEvents, 'speaker', -45);
    const active = labels.filter((l) => l !== 'silent');
    const voiceCount = active.filter((l) => l === 'voice').length;
    const voiceRatio = voiceCount / active.length;
    console.info(
      `[voiceGate (c) 偏 60 cents 人聲] total=${labels.length}, active=${active.length}, voice=${voiceCount} (${(voiceRatio * 100).toFixed(1)}%)`,
    );
    expect(voiceRatio).toBeGreaterThanOrEqual(0.9);
  });

  it('(d) 只有節拍聲 → 不產生 voice（0%）', () => {
    const click = new MetronomeClick(RATE);
    const buf = new Float32Array(totalSamples);
    const clickEvents: SchedEvent[] = [];
    for (let b = 0; b < 4; b++) {
      const startFrame = b * 24000; // 120 BPM 每 0.5 秒一拍
      clickEvents.push({
        frame: startFrame,
        type: 'click',
        accent: b === 0,
        bus: 'metro',
      });
      click.trigger(b === 0);
      click.render(buf, startFrame, 24000);
    }
    addWhiteNoise(buf, -45, 404);

    const labels = runPipeline(buf, clickEvents, 'speaker', -45);
    const voiceCount = labels.filter((l) => l === 'voice').length;
    console.info(
      `[voiceGate (d) 只有節拍聲] total=${labels.length}, voice=${voiceCount}`,
    );
    expect(voiceCount).toBe(0);
  });

  it('(e) 耳機模式：所有有音高的幀都判為 voice（100%）', () => {
    const piano = new AdditivePiano(RATE);
    piano.on('mel:0', noteHz, false);
    const buf = new Float32Array(totalSamples);
    piano.render(buf, 0, totalSamples);

    const tracker = new PitchTracker(RATE, -45);
    const gate = new VoiceGate();
    let pitchedFrames = 0;
    let voiceFrames = 0;

    for (let pos = 0; pos + HOP <= buf.length; pos += HOP) {
      const res = tracker.pushChunk(buf.subarray(pos, pos + HOP), pos);
      if (!res || res.hz <= 0) continue;
      pitchedFrames++;
      const outputs = outputAt(noteEvents, res.t, RATE);
      const g = gate.processFrame(
        { t: res.t, hz: res.hz, db: res.db },
        outputs,
        { mode: 'headphone', gateDb: -45 },
      );
      if (g.label === 'voice') voiceFrames++;
    }

    const ratio = pitchedFrames > 0 ? voiceFrames / pitchedFrames : 0;
    console.info(
      `[voiceGate (e) 耳機模式] pitched=${pitchedFrames}, voice=${voiceFrames} (${(ratio * 100).toFixed(1)}%)`,
    );
    expect(pitchedFrames).toBeGreaterThan(50);
    expect(ratio).toBe(1);
  });

  it('混亂偵測整合驗證：連續 leak 狀態可正確送入 ConfusionDetector', () => {
    const detector = new ConfusionDetector();
    let triggers = 0;
    for (let i = 0; i < 600; i++) {
      const status = detector.push({
        t: i * 0.01,
        label: 'leak',
        midi: 69,
        pitchStd: 0.4,
        hasOutput: true,
        isMetro: false,
      });
      if (status.justTriggered) triggers++;
    }
    expect(triggers).toBe(1);
  });
});
