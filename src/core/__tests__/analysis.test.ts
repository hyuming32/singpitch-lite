import { describe, expect, it } from 'vitest';
import {
  analyzeNotes,
  analyzeShadowNotes,
  summarize,
  summarizeShadowPass,
  type PitchFrame,
  type ShadowNoteResult,
} from '../analysis';
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

describe('analyzeShadowNotes 與 summarizeShadowPass', () => {
  it('判斷 準（±25 cents）／偏高／偏低／未唱，並略過 120 ms 起音', () => {
    const targets = [
      { start: 0, dur: 1.0, midi: 60 },
      { start: 1.0, dur: 1.0, midi: 60 },
      { start: 2.0, dur: 1.0, midi: 60 },
      { start: 3.0, dur: 1.0, midi: 60 },
    ];
    const frames: PitchFrame[] = [
      // 第 1 音前 100ms 故意嚴重走音，應被 120ms skipHead 略過，後面準確
      ...makeFrames(0, 0.1, 0.02, () => ({ hz: midiToHz(65), db: -20 })),
      ...makeFrames(0.14, 1.0, 0.02, () => ({ hz: midiToHz(60.15), db: -20 })),
      // 第 2 音偏高 +38 cents
      ...makeFrames(1.15, 2.0, 0.02, () => ({ hz: midiToHz(60.38), db: -20 })),
      // 第 3 音偏低 -42 cents
      ...makeFrames(2.15, 3.0, 0.02, () => ({ hz: midiToHz(59.58), db: -20 })),
      // 第 4 音只有 2 幀有聲（< 3）→ 未唱
      ...makeFrames(3.2, 3.24, 0.02, () => ({ hz: midiToHz(60), db: -20 })),
    ];

    const res = analyzeShadowNotes(targets, frames);
    expect(res[0]).toEqual({
      status: 'ok',
      medianCents: 15,
      isOctaveError: false,
      badgeText: '✓',
    });
    expect(res[1]).toEqual({
      status: 'high',
      medianCents: 38,
      isOctaveError: false,
      badgeText: '↑+38',
    });
    expect(res[2]).toEqual({
      status: 'low',
      medianCents: -42,
      isOctaveError: false,
      badgeText: '↓−42',
    });
    expect(res[3]).toEqual({
      status: 'unsung',
      medianCents: null,
      isOctaveError: false,
      badgeText: '—',
    });
  });

  it('八度唱錯不判準、8va 顯示位移不影響判斷、排除節拍器 60ms 與延遲補償', () => {
    // 實際目標音高 C3 (48)，8va 顯示為 C4 (60)，displayTranspose = 12
    const targets = [
      { start: 0, dur: 1.0, midi: 60 },
      { start: 1.0, dur: 1.0, midi: 60 },
    ];
    const latency = 0.05;
    const frames: PitchFrame[] = [
      // 第 1 音：實際唱 C3 (48)，應判準；在節拍器點 t=0.50 後 0~50ms 內塞入干擾音高，應被排除
      ...makeFrames(0.15 + latency, 0.5 + latency, 0.02, () => ({
        hz: midiToHz(48),
        db: -20,
      })),
      ...makeFrames(0.5 + latency, 0.55 + latency, 0.01, () => ({
        hz: midiToHz(55),
        db: -20,
      })),
      ...makeFrames(0.57 + latency, 1.0 + latency, 0.02, () => ({
        hz: midiToHz(48),
        db: -20,
      })),
      // 第 2 音：低八度唱成 C2 (36)（比實際目標 C3 低 1200 cents）→ 不可判準
      ...makeFrames(1.15 + latency, 2.0 + latency, 0.02, () => ({
        hz: midiToHz(36),
        db: -20,
      })),
    ];

    const res = analyzeShadowNotes(targets, frames, {
      displayTranspose: 12,
      latency,
      clickTimes: [0.5],
      metroExcludeSec: 0.06,
    });

    expect(res[0]!.status).toBe('ok');
    expect(res[0]!.medianCents).toBe(0);
    expect(res[1]!.status).toBe('low');
    expect(res[1]!.medianCents).toBe(-1200);
    expect(res[1]!.isOctaveError).toBe(true);
    expect(res[1]!.badgeText).toBe('低八度');
  });

  it('summarizeShadowPass 彙整文字數字正確且無分數／等第', () => {
    const items: ShadowNoteResult[] = [
      ...Array.from({ length: 8 }, () => ({
        status: 'ok' as const,
        medianCents: 5,
        isOctaveError: false,
        badgeText: '✓',
      })),
      { status: 'high', medianCents: 40, isOctaveError: false, badgeText: '↑+40' },
      { status: 'high', medianCents: 40, isOctaveError: false, badgeText: '↑+40' },
    ];
    const summary = summarizeShadowPass(items);
    expect(summary.okCount).toBe(8);
    expect(summary.totalCount).toBe(10);
    expect(summary.highCount).toBe(2);
    expect(summary.meanCents).toBe(12);
    expect(summary.text).toBe('本遍 8／10 音準 · 平均偏差 +12 cents · 2 個偏高');
  });
});
