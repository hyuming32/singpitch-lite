import { describe, expect, it, vi } from 'vitest';
import {
  NOISE_CALIBRATION_WAIT_MS,
  computeNoiseGate,
  NoiseCalibrationRun,
} from '../practice/useNoiseCalibration';

describe('computeNoiseGate 環境噪音門檻計算', () => {
  it('沒有收到樣本時回傳 empty', () => {
    expect(computeNoiseGate([])).toEqual({ ok: false, reason: 'empty' });
  });

  it('第 95 百分位 + 6 dB 超過 −30 dB 時回傳 too-noisy', () => {
    // 20 個樣本，p95 落在 −34 dB，+6 = −28 > −30
    const samples = Array.from({ length: 20 }, (_, i) => -50 + i * 0.85);
    samples[19] = -34;
    expect(computeNoiseGate(samples)).toEqual({ ok: false, reason: 'too-noisy' });
  });

  it('正常安靜環境：回傳第 95 百分位 + 6 dB 並限制在 −80～−30', () => {
    const samples = [-60, -58, -55, -52, -50, -49, -48, -47, -46, -45];
    const res = computeNoiseGate(samples);
    expect(res).toEqual({ ok: true, gateDb: -39 });

    // 極安靜環境夾在 −80 dB
    expect(computeNoiseGate([-95, -92, -90])).toEqual({ ok: true, gateDb: -80 });
    // 剛好等於 −30 dB 允許通過
    expect(computeNoiseGate([-36])).toEqual({ ok: true, gateDb: -30 });
  });
});

describe('NoiseCalibrationRun 計時', () => {
  it('從第一筆音量資料才開始計時（麥克風晚開好也不會失敗）', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const run = new NoiseCalibrationRun(2000, NOISE_CALIBRATION_WAIT_MS, onComplete);
    vi.advanceTimersByTime(3000); // 麥克風 3 秒後才有資料
    expect(onComplete).not.toHaveBeenCalled();
    run.push(-60);
    vi.advanceTimersByTime(1000);
    run.push(-58);
    vi.advanceTimersByTime(999);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onComplete).toHaveBeenCalledWith({ ok: true, gateDb: -52 });
    expect(run.active).toBe(false);
    vi.useRealTimers();
  });

  it('等太久都沒有資料時回報 empty', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    new NoiseCalibrationRun(2000, NOISE_CALIBRATION_WAIT_MS, onComplete);
    vi.advanceTimersByTime(NOISE_CALIBRATION_WAIT_MS + 1);
    expect(onComplete).toHaveBeenCalledWith({ ok: false, reason: 'empty' });
    vi.useRealTimers();
  });

  it('取消後不再回報', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const run = new NoiseCalibrationRun(2000, 5000, onComplete);
    run.push(-60);
    run.cancel();
    vi.advanceTimersByTime(10000);
    expect(onComplete).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
