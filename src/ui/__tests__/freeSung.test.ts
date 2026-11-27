import { describe, expect, it } from 'vitest';
import {
  FREE_WINDOW_SEC,
  freeSpan,
  freeSungPoints,
  pruneFreeSamples,
} from '../practice/freeSung';

describe('沒播放時的即時演唱音高線', () => {
  it('使用整行寬度（from = line.start, to = line.end）', () => {
    expect(freeSpan(0, 8)).toEqual({ from: 0, to: 8 });
    expect(freeSpan(4.5, 12.5)).toEqual({ from: 4.5, to: 12.5 });
  });

  it('行長為 0 或負數時不畫', () => {
    expect(freeSpan(3, 3)).toBeNull();
    expect(freeSpan(5, 3)).toBeNull();
  });

  it('行長 8 秒、唱了 10 秒時，畫出的點覆蓋最後 8 秒（1 秒譜面 = 1 秒實際時間）', () => {
    const now = 110;
    // 牆上時間 100..110（共 10 秒，每秒 1 個樣本）
    const samples = Array.from({ length: 11 }, (_, i) => ({
      wall: 100 + i,
      midi: 60 + i,
    }));
    const span = freeSpan(0, 8)!;
    const pts = freeSungPoints(samples, now, span);

    // 100 和 101 超過 8 秒前被裁掉，留下 102..110（最後 8 秒）
    expect(pts).toHaveLength(9);
    expect(pts[0]).toEqual({ t: 0, midi: 62 });
    expect(pts[pts.length - 1]).toEqual({ t: 8, midi: 70 });
  });

  it('最新的點在行尾，越舊越往左，超出範圍的丟掉', () => {
    const now = 100;
    const samples = [
      { wall: 91, midi: 59 }, // 9 秒前：超出 8 秒範圍
      { wall: 98, midi: 61 },
      { wall: 99.5, midi: NaN },
      { wall: 100, midi: 62 },
    ];
    const pts = freeSungPoints(samples, now, { from: 0, to: 8 });
    expect(pts.map((p) => p.t)).toEqual([6, 7.5, 8]);
    expect(pts[0]!.midi).toBe(61);
    expect(Number.isNaN(pts[1]!.midi)).toBe(true);
  });

  it('斷線標記（NaN 時間）保留成斷點，開頭的斷點略過', () => {
    const pts = freeSungPoints(
      [
        { wall: NaN, midi: NaN },
        { wall: 99, midi: 60 },
        { wall: NaN, midi: NaN },
        { wall: 100, midi: NaN },
      ],
      100,
      { from: 0, to: 8 },
    );
    expect(pts.length).toBe(3);
    expect(Number.isNaN(pts[1]!.midi)).toBe(true);
  });

  it('pruneFreeSamples 只保留視窗內的樣本並受上限限制', () => {
    expect(FREE_WINDOW_SEC).toBeGreaterThanOrEqual(30);
    const kept = pruneFreeSamples(
      [
        { wall: 1, midi: 60 },
        { wall: 5, midi: 61 },
      ],
      6,
      3,
    );
    expect(kept).toEqual([{ wall: 5, midi: 61 }]);

    const capped = pruneFreeSamples(
      [
        { wall: 9.1, midi: 60 },
        { wall: 9.2, midi: 61 },
        { wall: 9.3, midi: 62 },
        { wall: 9.4, midi: 63 },
      ],
      10,
      30,
      2,
    );
    expect(capped).toEqual([
      { wall: 9.3, midi: 62 },
      { wall: 9.4, midi: 63 },
    ]);
  });
});
