export interface SampleRateResolution {
  /** 實際提供給 YIN 計算的取樣率（Hz） */
  effectiveRate: number;
  /** 實測每秒樣本數除以宣稱取樣率的比值 */
  ratio: number;
  /** 是否因 0.5x 或 2x 偏差而套用修正 */
  corrected: boolean;
}

const HALF_RATIO_MIN = 0.42;
const HALF_RATIO_MAX = 0.58;
const DOUBLE_RATIO_MIN = 1.75;
const DOUBLE_RATIO_MAX = 2.25;

/**
 * 依據實測每秒樣本數與宣稱取樣率，判斷是否發生 0.5 倍或 2 倍取樣率不一致。
 * 若「實測每秒樣本數 ÷ 宣稱 rate」約為 0.5 或 2，改用實際量測值作為 YIN 取樣率。
 */
export function resolveEffectiveSampleRate(
  claimedRate: number,
  measuredSamplesPerSec: number,
): SampleRateResolution {
  const safeClaimed =
    Number.isFinite(claimedRate) && claimedRate > 0 ? claimedRate : 48000;
  if (!Number.isFinite(measuredSamplesPerSec) || measuredSamplesPerSec <= 0) {
    return {
      effectiveRate: safeClaimed,
      ratio: 1,
      corrected: false,
    };
  }

  const ratio = measuredSamplesPerSec / safeClaimed;
  const isHalf = ratio >= HALF_RATIO_MIN && ratio <= HALF_RATIO_MAX;
  const isDouble = ratio >= DOUBLE_RATIO_MIN && ratio <= DOUBLE_RATIO_MAX;

  if (isHalf || isDouble) {
    return {
      effectiveRate: Math.round(measuredSamplesPerSec),
      ratio,
      corrected: true,
    };
  }

  return {
    effectiveRate: safeClaimed,
    ratio,
    corrected: false,
  };
}
