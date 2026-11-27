import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/yin_fixtures.json';
import { singingCurve } from '../curve.ts';

/** 將 JSON 中的 null 轉為 NaN */
function nullsToNaN(arr: (number | null)[]): number[] {
  return arr.map((v) => (v === null ? NaN : v));
}

/** 比對兩組數值陣列：長度相同、NaN 位置相同、非 NaN 值誤差 < 1e-9 */
function expectCurveMatch(
  actual: number[],
  expected: (number | null)[],
): void {
  const exp = nullsToNaN(expected);
  expect(actual.length).toBe(exp.length);
  for (let i = 0; i < exp.length; i++) {
    const a = actual[i]!;
    const b = exp[i]!;
    if (Number.isNaN(b)) {
      expect(Number.isNaN(a)).toBe(true);
    } else {
      expect(Number.isNaN(a)).toBe(false);
      expect(Math.abs(a - b)).toBeLessThan(1e-9);
    }
  }
}

describe('singingCurve 演唱曲線', () => {
  const { curve } = fixtures;
  const times = curve.times as number[];
  const pitches = nullsToNaN(curve.pitches as (number | null)[]);
  const voiced = curve.voiced as boolean[];

  it('不提供 voiced 時與 Python 輸出完全一致', () => {
    const res = singingCurve(times, pitches);
    expectCurveMatch(res.x, curve.out_x as (number | null)[]);
    expectCurveMatch(res.y, curve.out_y as (number | null)[]);
  });

  it('提供 voiced 時與 Python 輸出完全一致', () => {
    const res = singingCurve(times, pitches, voiced);
    expectCurveMatch(res.x, curve.out_vx as (number | null)[]);
    expectCurveMatch(res.y, curve.out_vy as (number | null)[]);
  });

  it('空陣列輸入回傳空陣列', () => {
    const res = singingCurve([], []);
    expect(res.x).toEqual([]);
    expect(res.y).toEqual([]);
  });
});
