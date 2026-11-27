import { describe, expect, it } from 'vitest';
import { resolveEffectiveSampleRate } from '../sampleRate';

describe('resolveEffectiveSampleRate（實測每秒樣本數修正 rate）', () => {
  it('實測接近宣稱取樣率（48000 vs 47950）時不修正', () => {
    const res = resolveEffectiveSampleRate(48000, 47950);
    expect(res.corrected).toBe(false);
    expect(res.effectiveRate).toBe(48000);
  });

  it('實測約為宣稱的一半（48000 vs 24000）時修正為實際值', () => {
    const res = resolveEffectiveSampleRate(48000, 24020);
    expect(res.corrected).toBe(true);
    expect(res.effectiveRate).toBe(24020);
    expect(res.ratio).toBeCloseTo(0.5, 2);
  });

  it('實測約為宣稱的兩倍（24000 vs 48000 或 48000 vs 96000）時修正為實際值', () => {
    const res1 = resolveEffectiveSampleRate(24000, 48000);
    expect(res1.corrected).toBe(true);
    expect(res1.effectiveRate).toBe(48000);

    const res2 = resolveEffectiveSampleRate(48000, 95900);
    expect(res2.corrected).toBe(true);
    expect(res2.effectiveRate).toBe(95900);
  });

  it('異常或 0 輸入時安全回退為宣稱取樣率且不拋錯', () => {
    expect(resolveEffectiveSampleRate(48000, 0)).toEqual({
      effectiveRate: 48000,
      ratio: 1,
      corrected: false,
    });
    expect(resolveEffectiveSampleRate(NaN, NaN)).toEqual({
      effectiveRate: 48000,
      ratio: 1,
      corrected: false,
    });
  });
});
