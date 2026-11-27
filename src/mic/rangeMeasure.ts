import { A4_DEFAULT, hzToMidi } from '../core/notes';
import { computePitchStdCents } from './pitchTracker';

export const STEADY_DURATION_SEC = 1.5;
export const STEADY_MAX_STD_CENTS = 40;
export const STEADY_MIN_FRAMES = 5;
export const STEADY_SILENCE_GAP_SEC = 0.15;

export const GLIDE_MAX_DURATION_SEC = 10;
export const GLIDE_ISOLATED_MIN_SEC = 0.08; // 80 ms
export const GLIDE_GAP_BREAK_SEC = 0.12;

export interface PitchSampleFrame {
  t: number;
  hz: number;
}

export interface SteadyNoteProgress {
  locked: boolean;
  midi: number | null;
  midiFloat: number | null;
  medianHz: number | null;
  progress: number;
  stdCents: number | null;
  spanSec: number;
}

/** 計算數值陣列的中位數 */
export function computeMedian(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if ((sorted.length & 1) === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

/** 計算排序後陣列的百分位數（0..1，線性內插） */
export function percentileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const clampedP = Math.max(0, Math.min(1, p));
  const idx = clampedP * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/**
 * 穩定音偵測器：
 * 偵測到連續 1.5 秒音高穩定（標準差 < 40 cents）時鎖定並回傳中位數 MIDI／Hz。
 */
export class SteadyNoteDetector {
  private readonly a4: number;
  private frames: PitchSampleFrame[] = [];
  private lastPitchedT: number | null = null;

  constructor(a4: number = A4_DEFAULT) {
    this.a4 = a4;
  }

  reset(): void {
    this.frames = [];
    this.lastPitchedT = null;
  }

  push(frame: PitchSampleFrame): SteadyNoteProgress {
    const { t, hz } = frame;
    if (!Number.isFinite(t)) {
      return this.currentResult(false);
    }

    if (!(hz > 0) || !Number.isFinite(hz)) {
      if (
        this.lastPitchedT !== null &&
        t - this.lastPitchedT > STEADY_SILENCE_GAP_SEC
      ) {
        this.reset();
      }
      return this.currentResult(false);
    }

    if (
      this.lastPitchedT !== null &&
      t - this.lastPitchedT > STEADY_SILENCE_GAP_SEC
    ) {
      this.frames = [];
    }

    this.lastPitchedT = t;
    this.frames.push({ t, hz });

    // 保留至少涵蓋 STEADY_DURATION_SEC 的最小前緣窗口
    while (
      this.frames.length > 2 &&
      t - this.frames[1]!.t >= STEADY_DURATION_SEC - 1e-6
    ) {
      this.frames.shift();
    }

    return this.currentResult(true);
  }

  private currentResult(hasNewPitched: boolean): SteadyNoteProgress {
    if (this.frames.length === 0) {
      return {
        locked: false,
        midi: null,
        midiFloat: null,
        medianHz: null,
        progress: 0,
        stdCents: null,
        spanSec: 0,
      };
    }

    const spanSec = this.frames[this.frames.length - 1]!.t - this.frames[0]!.t;
    const hzs = this.frames.map((f) => f.hz);
    const stdCents = computePitchStdCents(hzs);

    const stable =
      this.frames.length >= 2 &&
      stdCents !== null &&
      stdCents < STEADY_MAX_STD_CENTS;

    if (
      hasNewPitched &&
      stable &&
      this.frames.length >= STEADY_MIN_FRAMES &&
      spanSec >= STEADY_DURATION_SEC - 1e-6
    ) {
      const medianHz = computeMedian(hzs);
      const midiFloat = hzToMidi(medianHz, this.a4);
      const midi = Math.round(midiFloat);
      return {
        locked: true,
        midi,
        midiFloat,
        medianHz,
        progress: 1,
        stdCents,
        spanSec,
      };
    }

    const progress =
      hasNewPitched &&
      (this.frames.length === 1 || (stdCents !== null && stdCents < STEADY_MAX_STD_CENTS))
        ? Math.min(0.99, Math.max(0, spanSec / STEADY_DURATION_SEC))
        : 0;

    return {
      locked: false,
      midi: null,
      midiFloat: null,
      medianHz: null,
      progress,
      stdCents,
      spanSec,
    };
  }
}

export interface GlideAnalysisResult {
  rawLow: number;
  rawHigh: number;
  p5Midi: number;
  p95Midi: number;
  validFrameCount: number;
  excludedFrameCount: number;
}

/**
 * 滑音分析：
 * 1. 將連續有聲幀分群（遇無聲幀或間隔 > 120 ms 切段）
 * 2. 排除持續時間 < 80 ms 的孤立片段
 * 3. 對保留的有聲幀計算第 5 與第 95 百分位 MIDI 音高
 */
export function analyzeGlideFrames(
  frames: readonly PitchSampleFrame[],
  a4: number = A4_DEFAULT,
): GlideAnalysisResult | null {
  const segments: PitchSampleFrame[][] = [];
  let current: PitchSampleFrame[] = [];

  for (const f of frames) {
    if (!Number.isFinite(f.t) || !(f.hz > 0) || !Number.isFinite(f.hz)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }

    if (
      current.length > 0 &&
      f.t - current[current.length - 1]!.t > GLIDE_GAP_BREAK_SEC
    ) {
      segments.push(current);
      current = [];
    }
    current.push(f);
  }
  if (current.length > 0) {
    segments.push(current);
  }

  const validMidis: number[] = [];
  let excludedFrameCount = 0;

  for (const seg of segments) {
    const dur = seg[seg.length - 1]!.t - seg[0]!.t;
    if (seg.length < 2 || dur < GLIDE_ISOLATED_MIN_SEC - 1e-6) {
      excludedFrameCount += seg.length;
      continue;
    }
    for (const f of seg) {
      const m = hzToMidi(f.hz, a4);
      if (Number.isFinite(m)) {
        validMidis.push(m);
      }
    }
  }

  if (validMidis.length < 2) {
    return null;
  }

  const sorted = [...validMidis].sort((a, b) => a - b);
  const p5Midi = percentileSorted(sorted, 0.05);
  const p95Midi = percentileSorted(sorted, 0.95);

  return {
    rawLow: Math.round(p5Midi),
    rawHigh: Math.round(p95Midi),
    p5Midi,
    p95Midi,
    validFrameCount: validMidis.length,
    excludedFrameCount,
  };
}
