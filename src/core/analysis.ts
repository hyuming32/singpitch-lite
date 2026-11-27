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
