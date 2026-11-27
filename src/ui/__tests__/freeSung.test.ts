import { describe, expect, it } from 'vitest';
import {
  FREE_MIN_SPAN_SEC,
  FREE_WINDOW_SEC,
  freeSpan,
  freeSungPoints,
  pruneFreeSamples,
} from '../practice/freeSung';

describe('沒播放時的即時演唱黃線', () => {
  it('停在行首：整行右側都可畫，寬度上限 3 秒', () => {
    expect(freeSpan(0, 8, 0)).toEqual({ from: 8 - FREE_WINDOW_SEC, to: 8 });
    expect(freeSpan(0, 2, 0)).toEqual({ from: 0, to: 2 });
  });

  it('暫停在行中：只畫在播放位置右側，不蓋到已唱過的部分', () => {
    expect(freeSpan(0, 8, 6)).toEqual({ from: 6, to: 8 });
  });

  it('暫停在接近行尾：至少保留 1.5 秒寬', () => {
    const span = freeSpan(0, 8, 7.8)!;
    expect(span.to).toBe(8);
    expect(span.to - span.from).toBeCloseTo(FREE_MIN_SPAN_SEC);
  });

  it('行長為 0 時不畫', () => {
    expect(freeSpan(3, 3, 3)).toBeNull();
  });

  it('最新的點在行尾，越舊越往左，超出範圍的丟掉', () => {
    const now = 100;
    const samples = [
      { wall: 96, midi: 60 },   // 4 秒前：超出 3 秒範圍
      { wall: 98, midi: 61 },
      { wall: 99.5, midi: NaN },
      { wall: 100, midi: 62 },
    ];
    const pts = freeSungPoints(samples, now, { from: 5, to: 8 });
    expect(pts.map((p) => p.t)).toEqual([6, 7.5, 8]);
    expect(pts[0]!.midi).toBe(61);
    expect(Number.isNaN(pts[1]!.midi)).toBe(true);
  });

  it('斷線標記（NaN 時間）保留成斷點，開頭的斷點略過', () => {
    const pts = freeSungPoints(
      [{ wall: NaN, midi: NaN }, { wall: 99, midi: 60 }, { wall: NaN, midi: NaN }, { wall: 100, midi: 62 }],
      100,
      { from: 5, to: 8 },
    );
    expect(pts.length).toBe(3);
    expect(Number.isNaN(pts[1]!.midi)).toBe(true);
  });

  it('pruneFreeSamples 只保留視窗內的樣本', () => {
    const kept = pruneFreeSamples(
      [{ wall: 1, midi: 60 }, { wall: 5, midi: 61 }],
      6,
      3,
    );
    expect(kept).toEqual([{ wall: 5, midi: 61 }]);
  });
});
