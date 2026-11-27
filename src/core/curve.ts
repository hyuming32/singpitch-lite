/** 僅供顯示用的演唱曲線分段與補線；不改變實測音高或錄音音訊。 */

// ---- 可調參數（單位：半音 / 秒） ----
const MAX_STEP = 4.0; // 相鄰兩點最大跳躍
const MAX_SLOPE = 60.0; // 最大變化速率；真實滑音多在此以下，起音/收音的假爬升遠高於此
const MAX_GAP = 0.25; // 相鄰兩點時間間隔超過就斷線
const MIN_POINTS = 3; // 片段最少點數
const EDGE_SEC = 0.05; // 只檢查片段頭尾這段時間內的點
const EDGE_TOL = 2.5; // 頭尾點偏離片段中段中值超過此值就修掉
const MAX_SPAN = 18.0; // 單一片段高低差上限，超過視為假爬升
const BRIDGE_SEC = 0.18; // 兩段之間空檔不超過此秒數，且音高接近時，補線連起來（子音、換字）
const BRIDGE_ST = 2.0; // 補線時，兩端音高差上限（半音）
// 空檔期間聲音未中斷時（低於噪音門檻的連續時間不超過 VOICED_MAX_SILENCE），
// 是偵測器在換音處留白而非歌手停唱，可用較寬的條件補線。
const VOICED_BRIDGE_SEC = 0.36;
const VOICED_BRIDGE_ST = 3.5;
const VOICED_MAX_SILENCE = 0.10; // 換音咬字的短暫下沉；比偵測窗（約 93 ms）還短

/** 計算數值陣列的中位數 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  if ((n & 1) === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

/** 計算數值區間的極差（max - min，對應 numpy.ptp） */
function ptp(values: readonly number[], start: number, end: number): number {
  let minVal = values[start]!;
  let maxVal = minVal;
  for (let i = start + 1; i < end; i++) {
    const v = values[i]!;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  return maxVal - minVal;
}

/** 輸入索引 [lo, hi) 內，連續低於門檻的最長秒數（以幀距計）。 */
function longestSilence(
  t: readonly number[],
  voiced: readonly boolean[],
  lo: number,
  hi: number,
): number {
  let longest = 0;
  let run = 0;
  for (let i = lo; i < hi; i++) {
    if (!voiced[i]) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  if (longest === 0) return 0.0;
  if (t.length <= 1) return 0.0;

  const diffs: number[] = [];
  for (let i = 1; i < t.length; i++) {
    diffs.push(t[i]! - t[i - 1]!);
  }
  const hop = median(diffs);
  return longest * hop;
}

/** 修掉片段頭尾貼著穩定音的爬升尾巴；回傳保留的 [lo, hi]，無法保留回傳 null。 */
function trimEdges(
  t: readonly number[],
  y: readonly number[],
  start: number,
  end: number,
): [number, number] | null {
  const len = end - start;
  let lo = 0;
  let hi = len;
  const t0 = t[start]!;
  const tLast = t[end - 1]!;

  const core: number[] = [];
  for (let i = 0; i < len; i++) {
    const ti = t[start + i]!;
    const inEdge = ti - t0 < EDGE_SEC || tLast - ti < EDGE_SEC;
    if (!inEdge) {
      core.push(y[start + i]!);
    }
  }

  let ref: number;
  if (core.length >= MIN_POINTS) {
    ref = median(core);
  } else {
    // 整段都落在頭尾區間：只有夠穩定才保留
    return ptp(y, start, end) <= 2 * EDGE_TOL ? [lo, hi] : null;
  }

  while (
    lo < hi &&
    t[start + lo]! - t0 < EDGE_SEC &&
    Math.abs(y[start + lo]! - ref) > EDGE_TOL
  ) {
    lo++;
  }
  while (
    hi > lo &&
    tLast - t[start + hi - 1]! < EDGE_SEC &&
    Math.abs(y[start + hi - 1]! - ref) > EDGE_TOL
  ) {
    hi--;
  }
  return hi - lo >= MIN_POINTS ? [lo, hi] : null;
}

/**
 * 保留連續顫音／滑音；移除起音／收音爬升與零碎短點。
 * @param times 時間軸（秒）
 * @param pitches 音高序列（半音；NaN 代表無聲）
 * @param voiced 可省略，與 times 等長的布林陣列，表示該幀音量高於噪音門檻
 * @returns 分段後的 { x, y }，斷線處以單一 NaN 隔開
 */
export function singingCurve(
  times: number[],
  pitches: number[],
  voiced?: boolean[],
): { x: number[]; y: number[] } {
  const n = times.length;
  if (n === 0) {
    return { x: [], y: [] };
  }
  const hasVoiced = voiced !== undefined && voiced.length === n;

  const valid = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    valid[i] = Number.isFinite(times[i]) && Number.isFinite(pitches[i]);
  }

  const starts: number[] = [0];
  for (let i = 0; i < n - 1; i++) {
    const dx = times[i + 1]! - times[i]!;
    const dy = Math.abs(pitches[i + 1]! - pitches[i]!);
    const slope = dy / dx;
    const isBreak =
      !valid[i + 1] ||
      !valid[i] ||
      dx <= 0 ||
      dx > MAX_GAP ||
      dy > MAX_STEP ||
      slope > MAX_SLOPE;
    if (isBreak) {
      starts.push(i + 1);
    }
  }

  const outX: number[] = [];
  const outY: number[] = [];
  let prevEnd = 0;

  for (let k = 0; k < starts.length; k++) {
    const rawS = starts[k]!;
    const rawE = k + 1 < starts.length ? starts[k + 1]! : n;
    if (rawE - rawS < MIN_POINTS) continue;

    let allValid = true;
    for (let i = rawS; i < rawE; i++) {
      if (!valid[i]) {
        allValid = false;
        break;
      }
    }
    if (!allValid) continue;
    if (ptp(pitches, rawS, rawE) > MAX_SPAN) continue;

    const kept = trimEdges(times, pitches, rawS, rawE);
    if (kept === null) continue;

    const s = rawS + kept[0];
    const e = rawS + kept[1];

    if (outX.length > 0) {
      const gap = times[s]! - outX[outX.length - 1]!;
      const step = Math.abs(pitches[s]! - outY[outY.length - 1]!);
      const sounding =
        hasVoiced &&
        longestSilence(times, voiced, prevEnd, s) <= VOICED_MAX_SILENCE;
      const bridge = sounding
        ? gap > 0 && gap <= VOICED_BRIDGE_SEC && step <= VOICED_BRIDGE_ST
        : gap > 0 && gap <= BRIDGE_SEC && step <= BRIDGE_ST;
      if (!bridge) {
        outX.push(NaN);
        outY.push(NaN);
      }
    }

    for (let i = s; i < e; i++) {
      outX.push(times[i]!);
      outY.push(pitches[i]!);
    }
    prevEnd = e;
  }

  return { x: outX, y: outY };
}
