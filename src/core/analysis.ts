import { A4_DEFAULT, centsBetween } from './notes';

export interface AnalysisTarget {
  start: number;
  dur: number;
  midi: number;
  /** 滑音終點 MIDI 音高 */
  endMidi?: number;
}

export interface PitchFrame {
  t: number;
  /** 偵測頻率（Hz），0 表示未量到 */
  hz: number;
  db: number;
}

export interface AnalysisOptions {
  a4?: number;
  gateDb?: number;
  /** 音訊延遲補償（秒），幀時間會先減去此值 */
  latency?: number;
  /** 每個音開頭略過秒數 */
  skipHead?: number;
  glideTolerance?: number;
  tolerance?: number;
}

export type PitchDirection = 'ok' | 'high' | 'low';

export interface NoteAnalysis {
  index: number;
  medianCents: number | null;
  direction: PitchDirection | null;
  coverage: number | null;
  sung: boolean;
  onset: number | null;
}

export interface AnalysisSummary {
  coverage: number | null;
  medianOnset: number | null;
  okRatio: number | null;
  sungRatio: number | null;
}

const ONSET_PRE_WINDOW = 0.3;
const ONSET_TOLERANCE_CENTS = 50;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function targetMidiAt(target: AnalysisTarget, t: number): number {
  if (target.endMidi === undefined || target.dur <= 0) {
    return target.midi;
  }
  const ratio = Math.max(0, Math.min(1, (t - target.start) / target.dur));
  return target.midi + (target.endMidi - target.midi) * ratio;
}

/** 逐音分析演唱音準偏差、涵蓋率與起音時間 */
export function analyzeNotes(
  targets: readonly AnalysisTarget[],
  frames: readonly PitchFrame[],
  opts: AnalysisOptions = {},
): NoteAnalysis[] {
  const {
    a4 = A4_DEFAULT,
    gateDb = -45,
    latency = 0,
    skipHead = 0.08,
    glideTolerance = 50,
    tolerance = 10,
  } = opts;

  const adjusted = frames
    .map((f) => ({ t: f.t - latency, hz: f.hz, db: f.db }))
    .sort((a, b) => a.t - b.t);

  return targets.map((target, index) => {
    const winStart = target.start + skipHead;
    const winEnd = target.start + target.dur;

    const centsList: number[] = [];
    let voicedCount = 0;
    let voicedPitchedCount = 0;

    for (const f of adjusted) {
      if (f.t < winStart) continue;
      if (f.t >= winEnd) break;
      if (f.db >= gateDb) {
        voicedCount += 1;
        if (f.hz > 0) {
          voicedPitchedCount += 1;
          const cents = centsBetween(f.hz, targetMidiAt(target, f.t), a4);
          if (Number.isFinite(cents)) {
            centsList.push(cents);
          }
        }
      }
    }

    const coverage =
      voicedCount > 0 ? voicedPitchedCount / voicedCount : null;
    const sung = voicedCount >= 3;
    const medianCents = median(centsList);
    const tol = target.endMidi !== undefined ? glideTolerance : tolerance;

    let direction: PitchDirection | null = null;
    if (medianCents !== null) {
      if (Math.abs(medianCents) <= tol) {
        direction = 'ok';
      } else if (medianCents > tol) {
        direction = 'high';
      } else {
        direction = 'low';
      }
    }

    let onset: number | null = null;
    const onsetStart = target.start - ONSET_PRE_WINDOW;
    for (const f of adjusted) {
      if (f.t < onsetStart) continue;
      if (f.t >= winEnd) break;
      if (f.db >= gateDb && f.hz > 0) {
        const cents = centsBetween(f.hz, targetMidiAt(target, f.t), a4);
        if (Number.isFinite(cents) && Math.abs(cents) <= ONSET_TOLERANCE_CENTS) {
          onset = f.t - target.start;
          break;
        }
      }
    }

    return {
      index,
      medianCents,
      direction,
      coverage,
      sung,
      onset,
    };
  });
}

/** 彙整逐音分析結果的平均涵蓋率、中位起音時間、音準達標率與演唱比例 */
export function summarize(results: readonly NoteAnalysis[]): AnalysisSummary {
  const coverages: number[] = [];
  const onsets: number[] = [];
  let dirTotal = 0;
  let dirOk = 0;
  let sungCount = 0;

  for (const r of results) {
    if (r.coverage !== null) coverages.push(r.coverage);
    if (r.onset !== null) onsets.push(r.onset);
    if (r.direction !== null) {
      dirTotal += 1;
      if (r.direction === 'ok') dirOk += 1;
    }
    if (r.sung) sungCount += 1;
  }

  const coverage =
    coverages.length > 0
      ? coverages.reduce((sum, v) => sum + v, 0) / coverages.length
      : null;
  const medianOnset = median(onsets);
  const okRatio = dirTotal > 0 ? dirOk / dirTotal : null;
  const sungRatio = results.length > 0 ? sungCount / results.length : null;

  return {
    coverage,
    medianOnset,
    okRatio,
    sungRatio,
  };
}

export const SHADOW_TOLERANCE_CENTS = 25;
export const SHADOW_SKIP_HEAD_SEC = 0.12;
export const SHADOW_METRO_EXCLUDE_SEC = 0.06;
export const SHADOW_MIN_VOICED_FRAMES = 3;

export type ShadowNoteStatus = 'ok' | 'high' | 'low' | 'unsung';

export interface ShadowAnalysisOptions extends AnalysisOptions {
  /** 畫面顯示位移半音數（男聲 8va 為 12），判斷時會從目標音高扣除，預設 0 */
  displayTranspose?: number;
  /** 節拍器發聲時間點（歌曲時間軸秒數），每個點後 metroExcludeSec 內的幀會被排除 */
  clickTimes?: readonly number[];
  /** 節拍器點後排除秒數，預設 0.06（60 ms） */
  metroExcludeSec?: number;
  /** 判定為有唱的最少有效幀數，預設 3 */
  minVoicedFrames?: number;
}

export interface ShadowNoteResult {
  status: ShadowNoteStatus;
  medianCents: number | null;
  isOctaveError: boolean;
  badgeText: string;
}

export interface ShadowPassSummary {
  totalCount: number;
  okCount: number;
  highCount: number;
  lowCount: number;
  unsungCount: number;
  meanCents: number | null;
  text: string;
}

function isExcludedByClick(
  t: number,
  sortedClicks: readonly number[],
  excludeSec: number,
): boolean {
  if (sortedClicks.length === 0 || excludeSec <= 0) return false;
  for (const c of sortedClicks) {
    if (c > t) break;
    if (t >= c && t < c + excludeSec) {
      return true;
    }
  }
  return false;
}

function formatShadowBadge(
  status: ShadowNoteStatus,
  roundedCents: number | null,
): { badgeText: string; isOctaveError: boolean } {
  if (status === 'ok') {
    return { badgeText: '✓', isOctaveError: false };
  }
  if (status === 'unsung' || roundedCents === null) {
    return { badgeText: '—', isOctaveError: false };
  }
  const absCents = Math.abs(roundedCents);
  const isOctaveError = absCents >= 1100;
  if (status === 'high') {
    if (Math.abs(roundedCents - 1200) <= 100) {
      return { badgeText: '高八度', isOctaveError: true };
    }
    return { badgeText: `↑+${roundedCents}`, isOctaveError };
  }
  if (Math.abs(roundedCents + 1200) <= 100) {
    return { badgeText: '低八度', isOctaveError: true };
  }
  return { badgeText: `↓−${absCents}`, isOctaveError };
}

/** 針對影子練習空拍進行即時音準判斷（不影響既有 analyzeNotes 行為） */
export function analyzeShadowNotes(
  targets: readonly AnalysisTarget[],
  frames: readonly PitchFrame[],
  opts: ShadowAnalysisOptions = {},
): ShadowNoteResult[] {
  const {
    a4 = A4_DEFAULT,
    gateDb = -45,
    latency = 0,
    skipHead = SHADOW_SKIP_HEAD_SEC,
    glideTolerance = 50,
    tolerance = SHADOW_TOLERANCE_CENTS,
    displayTranspose = 0,
    clickTimes = [],
    metroExcludeSec = SHADOW_METRO_EXCLUDE_SEC,
    minVoicedFrames = SHADOW_MIN_VOICED_FRAMES,
  } = opts;

  const sortedClicks =
    clickTimes.length > 0 ? [...clickTimes].sort((a, b) => a - b) : [];

  const adjusted = frames
    .map((f) => ({ t: f.t - latency, hz: f.hz, db: f.db }))
    .filter((f) => !isExcludedByClick(f.t, sortedClicks, metroExcludeSec))
    .sort((a, b) => a.t - b.t);

  return targets.map((target) => {
    const actualTarget: AnalysisTarget = {
      start: target.start,
      dur: target.dur,
      midi: target.midi - displayTranspose,
      ...(target.endMidi !== undefined
        ? { endMidi: target.endMidi - displayTranspose }
        : {}),
    };

    const winStart = actualTarget.start + skipHead;
    const winEnd = actualTarget.start + actualTarget.dur;
    const centsList: number[] = [];

    for (const f of adjusted) {
      if (f.t < winStart) continue;
      if (f.t >= winEnd) break;
      if (f.db >= gateDb && f.hz > 0) {
        const cents = centsBetween(f.hz, targetMidiAt(actualTarget, f.t), a4);
        if (Number.isFinite(cents)) {
          centsList.push(cents);
        }
      }
    }

    if (centsList.length < minVoicedFrames) {
      return {
        status: 'unsung',
        medianCents: null,
        isOctaveError: false,
        badgeText: '—',
      };
    }

    const rawMedian = median(centsList);
    if (rawMedian === null) {
      return {
        status: 'unsung',
        medianCents: null,
        isOctaveError: false,
        badgeText: '—',
      };
    }

    const rounded = Math.round(rawMedian);
    const tol =
      actualTarget.endMidi !== undefined ? glideTolerance : tolerance;
    const status: ShadowNoteStatus =
      Math.abs(rawMedian) <= tol ? 'ok' : rawMedian > tol ? 'high' : 'low';
    const { badgeText, isOctaveError } = formatShadowBadge(status, rounded);

    return {
      status,
      medianCents: rounded,
      isOctaveError,
      badgeText,
    };
  });
}

/** 彙整影子練習單遍結果並格式化為無分數、無等第的提示文字 */
export function summarizeShadowPass(
  results: readonly ShadowNoteResult[],
): ShadowPassSummary {
  const totalCount = results.length;
  let okCount = 0;
  let highCount = 0;
  let lowCount = 0;
  let unsungCount = 0;
  const sungCents: number[] = [];

  for (const r of results) {
    if (r.status === 'ok') {
      okCount += 1;
    } else if (r.status === 'high') {
      highCount += 1;
    } else if (r.status === 'low') {
      lowCount += 1;
    } else {
      unsungCount += 1;
    }
    if (r.status !== 'unsung' && r.medianCents !== null) {
      sungCents.push(r.medianCents);
    }
  }

  const meanCents =
    sungCents.length > 0
      ? Math.round(sungCents.reduce((s, v) => s + v, 0) / sungCents.length)
      : null;

  const parts: string[] = [`本遍 ${okCount}／${totalCount} 音準`];
  if (meanCents !== null) {
    const signStr =
      meanCents > 0
        ? `+${meanCents}`
        : meanCents < 0
          ? `−${Math.abs(meanCents)}`
          : '0';
    parts.push(`平均偏差 ${signStr} cents`);
  } else {
    parts.push('未偵測到演唱');
  }
  if (highCount > 0) parts.push(`${highCount} 個偏高`);
  if (lowCount > 0) parts.push(`${lowCount} 個偏低`);
  if (unsungCount > 0) parts.push(`${unsungCount} 個未唱`);

  return {
    totalCount,
    okCount,
    highCount,
    lowCount,
    unsungCount,
    meanCents,
    text: parts.join(' · '),
  };
}
