import type { Key } from './key';

/** Krumhansl-Kessler 大調音高類別輪廓 */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
] as const;

/** Krumhansl-Kessler 小調音高類別輪廓 */
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
] as const;

export interface KeyCandidate {
  key: Key;
  score: number;
}

export type KeyConfidence = 'high' | 'medium' | 'low';

function pearsonCorrelation(
  x: readonly number[],
  y: readonly number[],
  yOffset: number,
): number {
  const n = 12;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]!;
    sumY += y[(i - yOffset + 12) % 12]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - meanX;
    const dy = y[(i - yOffset + 12) % 12]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den > 0 ? num / den : 0;
}

/** 依音符時長加權的音高類別直方圖，使用 Krumhansl-Kessler 輪廓判斷 24 個調性 */
export function detectKey(
  notes: readonly { start: number; end: number; midi: number }[],
): KeyCandidate[] {
  if (notes.length === 0) {
    return [];
  }

  const hist = new Array<number>(12).fill(0);
  let totalWeight = 0;
  for (const n of notes) {
    const dur = Math.max(0, n.end - n.start);
    if (dur <= 0) continue;
    const pc = ((Math.round(n.midi) % 12) + 12) % 12;
    hist[pc] = hist[pc]! + dur;
    totalWeight += dur;
  }

  if (totalWeight <= 0) {
    return [];
  }

  const results: KeyCandidate[] = [];
  for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
    results.push({
      key: { tonicPc, mode: 'major' },
      score: pearsonCorrelation(hist, MAJOR_PROFILE, tonicPc),
    });
    results.push({
      key: { tonicPc, mode: 'minor' },
      score: pearsonCorrelation(hist, MINOR_PROFILE, tonicPc),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/** 依前兩名調性分數差距評估辨識信心度 */
export function keyConfidence(ranked: readonly KeyCandidate[]): KeyConfidence {
  if (ranked.length < 2) {
    return 'low';
  }
  const diff = ranked[0]!.score - ranked[1]!.score;
  if (diff >= 0.1) return 'high';
  if (diff >= 0.04) return 'medium';
  return 'low';
}
