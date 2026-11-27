import { describe, expect, it } from 'vitest';
import { hzToMidi } from '../../core/notes';
import { PitchTracker } from '../pitchTracker';

const RATE = 48000;
const HOP = 512;

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** 簡單二階帶通共振峰濾波器（Formant resonator） */
function createResonator(freq: number, bw: number, rate: number) {
  const r = Math.exp((-Math.PI * bw) / rate);
  const a1 = -2 * r * Math.cos((2 * Math.PI * freq) / rate);
  const a2 = r * r;
  const gain = 1 - r;
  let y1 = 0;
  let y2 = 0;
  return (x: number) => {
    const y = gain * x - a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/**
 * 合成接近真人的聲音：帶 5 cents 抖動的鋸齒波通過 3 個串聯/並聯共振峰（500 / 1500 / 2500 Hz）
 */
function renderFormantVoice(
  f0: number,
  rate: number,
  durSec: number,
  jitterCents = 5,
  mode: 'parallel' | 'cascade' = 'parallel',
): Float32Array {
  const len = Math.round(rate * durSec);
  const out = new Float32Array(len);
  const rng = makeRng(Math.round(f0 * 100));

  const f1 = createResonator(500, 80, rate);
  const f2 = createResonator(1500, 120, rate);
  const f3 = createResonator(2500, 160, rate);

  let phase = 0;
  let jitter = 0;
  const jitterStepSamples = Math.max(1, Math.round(rate / 30));

  for (let i = 0; i < len; i++) {
    if (i % jitterStepSamples === 0) {
      jitter = (rng() * 2 - 1) * jitterCents;
    }
    const instHz = f0 * Math.pow(2, jitter / 1200);
    phase += instHz / rate;
    if (phase >= 1) phase -= 1;

    // 鋸齒波：-1 .. +1
    const saw = 2 * phase - 1;
    const filtered =
      mode === 'cascade'
        ? f3(f2(f1(saw)))
        : f1(saw) * 1.0 + f2(saw) * 0.5 + f3(saw) * 0.25;

    const env = Math.min(1, i / (rate * 0.03));
    out[i] = filtered * 0.3 * env;
  }

  // 正規化至 -12 dBFS 左右
  let sumSq = 0;
  for (let i = 0; i < len; i++) sumSq += out[i]! * out[i]!;
  const rms = Math.sqrt(sumSq / len);
  const targetRms = Math.pow(10, -12 / 20);
  const scale = rms > 0 ? targetRms / rms : 1;
  for (let i = 0; i < len; i++) out[i] = out[i]! * scale;

  return out;
}

describe('PitchTracker 人聲共振峰管線測試 (B2)', () => {
  const freqs = [130.8, 196.0, 261.6, 392.0];

  it.each(freqs)(
    '並聯共振峰合成人聲 f0=%s Hz（5 cents 抖動）無八度錯誤且誤差 < 0.5 半音',
    (f0) => {
      const audio = renderFormantVoice(f0, RATE, 2.0, 5, 'parallel');
      const tracker = new PitchTracker(RATE, -45);
      const expectedMidi = hzToMidi(f0, 440);
      const midis: number[] = [];

      for (let pos = 0; pos + HOP <= audio.length; pos += HOP) {
        const res = tracker.pushChunk(audio.subarray(pos, pos + HOP), pos);
        if (res && res.hz > 0) {
          midis.push(hzToMidi(res.hz, 440));
        }
      }

      expect(midis.length).toBeGreaterThan(100);
      let octaveErr = 0;
      let maxDiff = 0;
      for (const m of midis) {
        const diff = Math.abs(m - expectedMidi);
        if (diff > maxDiff) maxDiff = diff;
        if (Math.abs(Math.abs(m - expectedMidi) - 12) < 1.5 || diff >= 0.5) {
          octaveErr++;
        }
      }
      const errRatio = octaveErr / midis.length;
      console.info(
        `[B2 parallel f0=${f0}] detected=${midis.length}, maxDiff=${maxDiff.toFixed(3)} semi, errRatio=${(errRatio * 100).toFixed(2)}%`,
      );
      expect(errRatio).toBeLessThan(0.02);
    },
  );

  it.each(freqs)(
    '串聯共振峰合成人聲 f0=%s Hz（5 cents 抖動）無八度錯誤且誤差 < 0.5 半音',
    (f0) => {
      const audio = renderFormantVoice(f0, RATE, 2.0, 5, 'cascade');
      const tracker = new PitchTracker(RATE, -45);
      const expectedMidi = hzToMidi(f0, 440);
      const midis: number[] = [];

      for (let pos = 0; pos + HOP <= audio.length; pos += HOP) {
        const res = tracker.pushChunk(audio.subarray(pos, pos + HOP), pos);
        if (res && res.hz > 0) {
          midis.push(hzToMidi(res.hz, 440));
        }
      }

      expect(midis.length).toBeGreaterThan(100);
      let octaveErr = 0;
      let maxDiff = 0;
      for (const m of midis) {
        const diff = Math.abs(m - expectedMidi);
        if (diff > maxDiff) maxDiff = diff;
        if (Math.abs(Math.abs(m - expectedMidi) - 12) < 1.5 || diff >= 0.5) {
          octaveErr++;
        }
      }
      const errRatio = octaveErr / midis.length;
      console.info(
        `[B2 cascade f0=${f0}] detected=${midis.length}, maxDiff=${maxDiff.toFixed(3)} semi, errRatio=${(errRatio * 100).toFixed(2)}%`,
      );
      expect(errRatio).toBeLessThan(0.02);
    },
  );
});
