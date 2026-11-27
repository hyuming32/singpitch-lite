import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/yin_fixtures.json';
import { YIN } from '../yin.ts';

type SineSpec = { kind: 'sine'; f: number; a: number; frames: number };
type HarmSpec = {
  kind: 'harm';
  f: number;
  amps: number[];
  a: number;
  frames: number;
};
type GlideSpec = {
  kind: 'glide';
  f0: number;
  f1: number;
  N: number;
  a: number;
  frames: number;
};
type SeqPart = {
  kind: 'sine';
  f: number;
  a: number;
  from_: number;
  to: number;
};
type SeqSpec = { kind: 'seq'; parts: SeqPart[] };
type OnsetSpec = {
  kind: 'onset';
  f: number;
  a: number;
  zeros: number;
  frames: number;
};
type YinSpec = SineSpec | HarmSpec | GlideSpec | SeqSpec | OnsetSpec;

/** 依照 fixture 規格產生第 k 幀測試音訊 */
function synthesizeFrame(
  spec: YinSpec,
  k: number,
  frameSize: number,
  hop: number,
  rate: number,
): Float64Array {
  const buf = new Float64Array(frameSize);
  const twoPiOverRate = (2 * Math.PI) / rate;

  if (spec.kind === 'sine') {
    for (let i = 0; i < frameSize; i++) {
      const n = k * hop + i;
      buf[i] = spec.a * Math.sin(twoPiOverRate * spec.f * n);
    }
  } else if (spec.kind === 'harm') {
    const ampSum = spec.amps.reduce((acc, v) => acc + v, 0);
    for (let i = 0; i < frameSize; i++) {
      const n = k * hop + i;
      let val = 0;
      for (let h = 0; h < spec.amps.length; h++) {
        val +=
          spec.amps[h]! * Math.sin(twoPiOverRate * spec.f * (h + 1) * n);
      }
      buf[i] = (spec.a * val) / ampSum;
    }
  } else if (spec.kind === 'glide') {
    const slope = (spec.f1 - spec.f0) / (2 * spec.N);
    for (let i = 0; i < frameSize; i++) {
      const n = k * hop + i;
      buf[i] = spec.a * Math.sin(twoPiOverRate * (spec.f0 * n + slope * n * n));
    }
  } else if (spec.kind === 'seq') {
    const part = spec.parts.find((p) => k >= p.from_ && k < p.to);
    if (part) {
      for (let i = 0; i < frameSize; i++) {
        const n = k * hop + i;
        buf[i] = part.a * Math.sin(twoPiOverRate * part.f * n);
      }
    }
  } else if (spec.kind === 'onset') {
    for (let i = spec.zeros; i < frameSize; i++) {
      const n = k * hop + i;
      buf[i] = spec.a * Math.sin(twoPiOverRate * spec.f * n);
    }
  }
  return buf;
}

describe('YIN 音高偵測器', () => {
  const { rate, frame, hop, yin: cases } = fixtures;

  it.each(cases)('fixture: $name', (c) => {
    const detector = new YIN();
    const spec = c.spec as YinSpec;
    const expected = c.expected as [number, number][];

    for (let k = 0; k < expected.length; k++) {
      const samples = synthesizeFrame(spec, k, frame, hop, rate);
      const [hz, db] = detector.detect(samples, rate);
      const [expHz, expDb] = expected[k]!;

      if (expHz === 0) {
        expect(hz).toBe(0);
      } else {
        expect(hz).toBeGreaterThan(0);
        const centsDiff = Math.abs(1200 * Math.log2(hz / expHz));
        expect(centsDiff).toBeLessThan(0.5);
      }
      expect(Math.abs(db - expDb)).toBeLessThan(0.01);
    }
  });
});
