import { describe, expect, it } from 'vitest';
import { analyzeNotes, summarize, type PitchFrame } from '../analysis';
import { midiToHz } from '../notes';

function makeFrames(
  start: number,
  end: number,
  step: number,
  fn: (t: number) => { hz: number; db: number },
): PitchFrame[] {
  const frames: PitchFrame[] = [];
  for (let t = start; t < end - 1e-9; t += step) {
    const { hz, db } = fn(t);
    frames.push({ t: Number(t.toFixed(4)), hz, db });
  }
  return frames;
}

describe('analyzeNotes', () => {
  it('判斷音準（ok）、偏高（+30 cents）、偏低（-25 cents）', () => {
    const targets = [
      { start: 0, dur: 0.5, midi: 69 },
      { start: 0.5, dur: 0.5, midi: 69 },
      { start: 1.0, dur: 0.5, midi: 69 },
    ];
    const frames = [
      ...makeFrames(0, 0.5, 0.01, () => ({ hz: midiToHz(69), db: -20 })),
      ...makeFrames(0.5, 1.0, 0.01, () => ({ hz: midiToHz(69.3), db: -20 })),
      ...makeFrames(1.0, 1.5, 0.01, () => ({ hz: midiToHz(68.75), db: -20 })),
    ];
    const res = analyzeNotes(targets, frames);
    expect(res[0]!.direction).toBe('ok');
    expect(res[0]!.medianCents).toBeCloseTo(0, 1);
    expect(res[0]!.coverage).toBeCloseTo(1, 5);

    expect(res[1]!.direction).toBe('high');
    expect(res[1]!.medianCents).toBeCloseTo(30, 1);

    expect(res[2]!.direction).toBe('low');
    expect(res[2]!.medianCents).toBeCloseTo(-25, 1);
  });

  it('偵測晚 0.1 秒起音、完全無聲與有聲但無音高', () => {
    const targets = [
      { start: 0, dur: 0.5, midi: 60 },
      { start: 0.5, dur: 0.5, midi: 62 },
      { start: 1.0, dur: 0.5, midi: 64 },
    ];
    const frames = [
      ...makeFrames(0, 0.1, 0.01, () => ({ hz: 0, db: -60 })),
      ...makeFrames(0.1, 0.5, 0.01, () => ({ hz: midiToHz(60), db: -20 })),
      ...makeFrames(0.5, 1.0, 0.01, () => ({ hz: 0, db: -70 })),
      ...makeFrames(1.0, 1.5, 0.01, () => ({ hz: 0, db: -20 })),
    ];
    const res = analyzeNotes(targets, frames);
    expect(res[0]!.onset).toBeCloseTo(0.1, 3);
    expect(res[0]!.direction).toBe('ok');
    expect(res[0]!.sung).toBe(true);

    // 完全無聲：coverage 為 null、sung 為 false
    expect(res[1]!.medianCents).toBeNull();
    expect(res[1]!.direction).toBeNull();
    expect(res[1]!.coverage).toBeNull();
    expect(res[1]!.sung).toBe(false);
    expect(res[1]!.onset).toBeNull();

    // 有聲但量不到音高（hz=0, db=-20）：coverage 為 0、sung 為 true
    expect(res[2]!.medianCents).toBeNull();
    expect(res[2]!.direction).toBeNull();
    expect(res[2]!.coverage).toBe(0);
    expect(res[2]!.sung).toBe(true);
    expect(res[2]!.onset).toBeNull();
  });

  it('滑音線性內插與延遲（latency）補償', () => {
    const targets = [{ start: 1.0, dur: 1.0, midi: 60, endMidi: 72 }];
    const latency = 0.05;
    // 幀時間故意延後 0.05 秒，補償後應完全對齊線性滑音
    const frames = makeFrames(1.0 + latency, 2.0 + latency, 0.01, (t) => {
      const tAdj = t - latency;
      const ratio = Math.max(0, Math.min(1, (tAdj - 1.0) / 1.0));
      return { hz: midiToHz(60 + 12 * ratio), db: -18 };
    });

    const res = analyzeNotes(targets, frames, { latency });
    expect(res[0]!.direction).toBe('ok');
    expect(res[0]!.medianCents!).toBeCloseTo(0, 1);
    expect(res[0]!.onset).toBeCloseTo(0, 2);
  });

  it('summarize 彙整並忽略 null', () => {
    const summary = summarize([
      { index: 0, medianCents: 2, direction: 'ok', coverage: 1, sung: true, onset: 0.02 },
      { index: 1, medianCents: -25, direction: 'low', coverage: 0.8, sung: true, onset: 0.06 },
      { index: 2, medianCents: null, direction: null, coverage: null, sung: false, onset: null },
    ]);
    expect(summary.coverage).toBeCloseTo(0.9, 5);
    expect(summary.medianOnset).toBeCloseTo(0.04, 5);
    expect(summary.okRatio).toBeCloseTo(0.5, 5);
    expect(summary.sungRatio).toBeCloseTo(2 / 3, 5);
  });
});
