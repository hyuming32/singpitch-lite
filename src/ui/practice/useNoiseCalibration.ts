import { useCallback, useEffect, useRef, useState } from 'react';

export const NOISE_CALIBRATION_MS = 2000;

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

interface UseNoiseCalibrationOptions {
  liveDb: number | null;
  durationMs?: number;
  onComplete: (result: NoiseGateResult) => void;
}

/** 共用環境噪音校正 hook：收集一段時間內的 liveDb，時間到後計算噪音門檻 */
export function useNoiseCalibration({
  liveDb,
  durationMs = NOISE_CALIBRATION_MS,
  onComplete,
}: UseNoiseCalibrationOptions) {
  const [calibrating, setCalibrating] = useState(false);
  const calibratingRef = useRef(false);
  const samplesRef = useRef<number[]>([]);
  const timerRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (calibratingRef.current && liveDb !== null && Number.isFinite(liveDb)) {
      samplesRef.current.push(liveDb);
    }
  }, [liveDb]);

  const cancelCalibration = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    calibratingRef.current = false;
    samplesRef.current = [];
    setCalibrating(false);
  }, []);

  useEffect(() => cancelCalibration, [cancelCalibration]);

  const startCalibration = useCallback(() => {
    if (calibratingRef.current) return;
    samplesRef.current = [];
    calibratingRef.current = true;
    setCalibrating(true);

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      calibratingRef.current = false;
      setCalibrating(false);
      const result = computeNoiseGate(samplesRef.current);
      samplesRef.current = [];
      onCompleteRef.current(result);
    }, durationMs);
  }, [durationMs]);

  return { calibrating, startCalibration, cancelCalibration };
}
