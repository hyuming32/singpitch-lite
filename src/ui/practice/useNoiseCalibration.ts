import { useCallback, useEffect, useRef, useState } from 'react';

export const NOISE_CALIBRATION_MS = 2000;
/** 麥克風開好、第一筆音量進來前最多等多久（手機第一次開麥克風較慢） */
export const NOISE_CALIBRATION_WAIT_MS = 5000;

export type NoiseGateResult =
  | { ok: true; gateDb: number }
  | { ok: false; reason: 'empty' | 'too-noisy' };

/**
 * 依 2 秒安靜環境的音量樣本計算噪音門檻（dB）：
 * 取第 95 百分位 + 6 dB；超過 −30 dB 視為太吵；結果限制在 −80 ～ −30 dB。
 */
export function computeNoiseGate(samples: readonly number[]): NoiseGateResult {
  if (samples.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95 = sorted[idx]!;
  const nextGate = Math.round(p95 + 6);
  if (nextGate > -30) {
    return { ok: false, reason: 'too-noisy' };
  }
  return { ok: true, gateDb: Math.max(-80, Math.min(-30, nextGate)) };
}

/**
 * 一次噪音校正的計時（不依賴 React，可單獨測試）：
 * 計時從收到第一筆音量資料才開始（麥克風真的開好才算），
 * 等不到資料時最多等 waitMs 再回報 empty。
 */
export class NoiseCalibrationRun {
  private samples: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private measuring = false;
  private done = false;
  private readonly durationMs: number;
  private readonly onComplete: (result: NoiseGateResult) => void;

  constructor(
    durationMs: number,
    waitMs: number,
    onComplete: (result: NoiseGateResult) => void,
  ) {
    this.durationMs = durationMs;
    this.onComplete = onComplete;
    this.timer = setTimeout(() => this.finish(), waitMs);
  }

  get active(): boolean {
    return !this.done;
  }

  push(db: number): void {
    if (this.done || !Number.isFinite(db)) return;
    this.samples.push(db);
    if (!this.measuring) {
      this.measuring = true;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.finish(), this.durationMs);
    }
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.done = true;
    this.samples = [];
  }

  private finish(): void {
    if (this.done) return;
    this.timer = null;
    this.done = true;
    const result = computeNoiseGate(this.samples);
    this.samples = [];
    this.onComplete(result);
  }
}

interface UseNoiseCalibrationOptions {
  liveDb: number | null;
  durationMs?: number;
  /** 等待第一筆音量資料的上限；超過仍沒資料就回報 empty */
  waitMs?: number;
  onComplete: (result: NoiseGateResult) => void;
}

/** 共用環境噪音校正 hook：收集 liveDb，計時規則見 NoiseCalibrationRun */
export function useNoiseCalibration({
  liveDb,
  durationMs = NOISE_CALIBRATION_MS,
  waitMs = NOISE_CALIBRATION_WAIT_MS,
  onComplete,
}: UseNoiseCalibrationOptions) {
  const [calibrating, setCalibrating] = useState(false);
  const runRef = useRef<NoiseCalibrationRun | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (runRef.current?.active && liveDb !== null) {
      runRef.current.push(liveDb);
    }
  }, [liveDb]);

  const cancelCalibration = useCallback(() => {
    runRef.current?.cancel();
    runRef.current = null;
    setCalibrating(false);
  }, []);

  useEffect(() => cancelCalibration, [cancelCalibration]);

  const startCalibration = useCallback(() => {
    if (runRef.current?.active) return;
    setCalibrating(true);
    runRef.current = new NoiseCalibrationRun(durationMs, waitMs, (result) => {
      runRef.current = null;
      setCalibrating(false);
      onCompleteRef.current(result);
    });
  }, [durationMs, waitMs]);

  return { calibrating, startCalibration, cancelCalibration };
}
