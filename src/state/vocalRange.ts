import { RANGES } from '../core/notes';
import type { PatternDef } from '../core/patterns';
import {
  MIN_MY_RANGE_SEMITONES,
  findLowestFeasibleTonic,
  getPatternSpan,
  type MyRangeData,
  type VoiceOption,
} from './settings';

export interface VocalRangePartMeta {
  name: string;
  group: VoiceOption;
  color: string;
  darkText: boolean;
}

/** 音域圖顯示的六個標準聲部（男低音至女高音） */
export const VOCAL_RANGE_PARTS: readonly VocalRangePartMeta[] = [
  { name: '男低音', group: 'male', color: '#5b7186', darkText: false },
  { name: '男中音', group: 'male', color: '#8aa1b5', darkText: true },
  { name: '男高音', group: 'male', color: '#6b7787', darkText: false },
  { name: '女低音', group: 'normal', color: '#a5553d', darkText: false },
  { name: '女中音', group: 'normal', color: '#c9b37a', darkText: true },
  { name: '女高音', group: 'normal', color: '#a8892f', darkText: true },
];

export interface RecommendedVoiceResult {
  rangeName: string;
  voice: VoiceOption;
  score: number;
}

/**
 * 依重疊比例推薦最接近的聲部：
 * overlap(我的, 該音域) / 該音域長度，取最高者；同分取中心距最近者。
 */
export function recommendVoiceRange(
  low: number,
  high: number,
): RecommendedVoiceResult {
  const myLo = Math.min(low, high);
  const myHi = Math.max(low, high);
  const myCenter = (myLo + myHi) / 2;

  let bestName = '女中音';
  let bestGroup: VoiceOption = 'normal';
  let bestScore = -1;
  let bestCenterDist = Infinity;

  for (const part of VOCAL_RANGE_PARTS) {
    const bounds = RANGES[part.name];
    if (!bounds) continue;
    const [pLo, pHi] = bounds;
    const len = pHi - pLo;
    if (len <= 0) continue;

    const overlap = Math.max(0, Math.min(myHi, pHi) - Math.max(myLo, pLo));
    const score = overlap / len;
    const centerDist = Math.abs(myCenter - (pLo + pHi) / 2);

    if (
      score > bestScore + 1e-9 ||
      (Math.abs(score - bestScore) <= 1e-9 && centerDist < bestCenterDist - 1e-9)
    ) {
      bestScore = score;
      bestCenterDist = centerDist;
      bestName = part.name;
      bestGroup = part.group;
    }
  }

  return {
    rangeName: bestName,
    voice: bestGroup,
    score: bestScore,
  };
}

export type MeasuredRangeOutcome =
  | {
      ok: false;
      error: string;
      raw: [number, number];
      semitones: number;
    }
  | {
      ok: true;
      raw: [number, number];
      semitones: number;
      myRange: MyRangeData;
      recommended: RecommendedVoiceResult;
    };

/**
 * 將試唱測得的最低／最高 MIDI 轉為結果與「我的音域」（上下各內縮 1 半音舒適區）。
 * 若跨度少於 8 個半音，拒絕儲存並回傳「範圍太窄，請重測」。
 */
export function buildMeasuredRangeResult(
  rawA: number,
  rawB: number,
  method: 'twoNotes' | 'glide',
  measuredAt: string = new Date().toISOString(),
): MeasuredRangeOutcome {
  const lo = Math.round(Math.min(rawA, rawB));
  const hi = Math.round(Math.max(rawA, rawB));
  const semitones = hi - lo;

  if (!Number.isFinite(semitones) || semitones < MIN_MY_RANGE_SEMITONES) {
    return {
      ok: false,
      error: '範圍太窄，請重測',
      raw: [lo, hi],
      semitones: Number.isFinite(semitones) ? semitones : 0,
    };
  }

  const recommended = recommendVoiceRange(lo, hi);
  const myRange: MyRangeData = {
    low: lo + 1,
    high: hi - 1,
    raw: [lo, hi],
    method,
    voice: recommended.voice,
    measuredAt,
  };

  return {
    ok: true,
    raw: [lo, hi],
    semitones,
    myRange,
    recommended,
  };
}

export type RangeBoundsInput =
  | readonly [number, number]
  | { low: number; high: number };

export interface PatternFitResult {
  keys: number;
  lowestTonic: number | null;
  highestTonic: number | null;
  fits: boolean;
}

function unwrapRangeBounds(range: RangeBoundsInput): readonly [number, number] {
  return Array.isArray(range)
    ? [range[0], range[1]]
    : [(range as { low: number; high: number }).low, (range as { low: number; high: number }).high];
}

/** 計算音型在指定音域內可練的調數、可行主音上下限與是否適配 */
export function patternFit(
  pattern: Pick<PatternDef, 'jianpu'>,
  range: RangeBoundsInput,
): PatternFitResult {
  const [low, high] = unwrapRangeBounds(range);
  const { maxSemi } = getPatternSpan(pattern);
  const lowestTonic = findLowestFeasibleTonic(pattern, low, high);
  if (lowestTonic === null) {
    return {
      keys: 0,
      lowestTonic: null,
      highestTonic: null,
      fits: false,
    };
  }
  const highestTonic = high - maxSemi;
  const keys = Math.max(0, highestTonic - lowestTonic + 1);
  return {
    keys,
    lowestTonic,
    highestTonic,
    fits: keys > 0,
  };
}

export interface RankedPatternItem {
  pattern: PatternDef;
  fit: PatternFitResult;
}

/** 依可練調數由高到低列出最適合指定音域的前 N 個音型 */
export function rankPatternsForRange(
  patterns: readonly PatternDef[],
  range: RangeBoundsInput,
  limit = 5,
): RankedPatternItem[] {
  return patterns
    .map((pattern) => ({ pattern, fit: patternFit(pattern, range) }))
    .filter((item) => item.fit.fits)
    .sort((a, b) => b.fit.keys - a.fit.keys)
    .slice(0, limit);
}

/** 若起始音超出新音域允許範圍，自動以 findLowestFeasibleTonic 修正 */
export function resolveStartTonicForRange(
  pattern: Pick<PatternDef, 'jianpu'>,
  currentStartTonic: number,
  low: number,
  high: number,
): number {
  const { minSemi, maxSemi } = getPatternSpan(pattern);
  if (
    currentStartTonic + minSemi >= low &&
    currentStartTonic + maxSemi <= high
  ) {
    return currentStartTonic;
  }
  return findLowestFeasibleTonic(pattern, low, high) ?? currentStartTonic;
}
