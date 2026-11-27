import { describe, expect, it } from 'vitest';
import { computeNoiseGate } from '../practice/useNoiseCalibration';

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
