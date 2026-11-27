import { GATE_DB } from '../core/pitchConfig.ts';
import { YIN } from '../core/yin.ts';

export interface PitchFeatures {
  rms: number;
  pitchStd: number | null;
  dbRise150ms: number;
}

export interface PitchResult {
  /** 分析視窗中心在 AudioContext 時間軸上的秒數 */
  t: number;
  /** 偵測基頻（Hz），0 代表無穩定音高 */
  hz: number;
  /** 音量（dBFS） */
  db: number;
  features: PitchFeatures;
}

/** 依取樣率計算 YIN 視窗長度（48 kHz 下為 2048 樣本，約 43 ms） */
export function computeWindowSize(rate: number): number {
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 48000;
  return Math.max(512, Math.round(2048 * (safeRate / 48000)));
}

/** 計算最近一段音高序列（Hz）的音分標準差 */
export function computePitchStdCents(hzValues: readonly number[]): number | null {
  const valid: number[] = [];
  for (const hz of hzValues) {
    if (hz > 0 && Number.isFinite(hz)) {
      valid.push(hz);
    }
  }
  if (valid.length < 2) {
    return null;
  }
  let logSum = 0;
  for (const hz of valid) {
    logSum += Math.log2(hz);
  }
  const meanLog = logSum / valid.length;
  let sqSum = 0;
  for (const hz of valid) {
    const cents = 1200 * (Math.log2(hz) - meanLog);
    sqSum += cents * cents;
  }
  return Math.sqrt(sqSum / valid.length);
}

/**
 * 環形緩衝 + YIN 音高追蹤器（純 TS，供 Web Worker 與測試共用）
 */
export class PitchTracker {
  readonly rate: number;
  readonly windowSize: number;
  private gateDb: number;
  private readonly yin = new YIN();
  private readonly ring: Float32Array;
  private readonly linearBuf: Float32Array;
  private writePos = 0;
  private filled = 0;
  private readonly recentFrames: { t: number; hz: number; db: number }[] = [];

  constructor(rate: number, gateDb: number = GATE_DB) {
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 48000;
    this.windowSize = computeWindowSize(this.rate);
    this.gateDb = gateDb;
    this.ring = new Float32Array(this.windowSize);
    this.linearBuf = new Float32Array(this.windowSize);
  }

  setGateDb(gateDb: number): void {
    this.gateDb = gateDb;
  }

  reset(): void {
    this.yin.reset();
    this.ring.fill(0);
    this.writePos = 0;
    this.filled = 0;
    this.recentFrames.length = 0;
  }

  /**
   * 寫入一塊擷取樣本並執行 YIN 偵測；若緩衝尚未滿一個視窗則回傳 null
   */
  pushChunk(samples: Float32Array, chunkStartFrame: number): PitchResult | null {
    const len = samples.length;
    if (len === 0) {
      return null;
    }

    if (len >= this.windowSize) {
      this.ring.set(samples.subarray(len - this.windowSize), 0);
      this.writePos = 0;
      this.filled = this.windowSize;
    } else {
      const firstPart = Math.min(len, this.windowSize - this.writePos);
      this.ring.set(samples.subarray(0, firstPart), this.writePos);
      if (firstPart < len) {
        this.ring.set(samples.subarray(firstPart), 0);
      }
      this.writePos = (this.writePos + len) % this.windowSize;
      this.filled = Math.min(this.windowSize, this.filled + len);
    }

    if (this.filled < this.windowSize) {
      return null;
    }

    // 依環形順序複製到線性緩衝區
    const tailLen = this.windowSize - this.writePos;
    this.linearBuf.set(this.ring.subarray(this.writePos), 0);
    if (this.writePos > 0) {
      this.linearBuf.set(this.ring.subarray(0, this.writePos), tailLen);
    }

    let sumSq = 0;
    for (let i = 0; i < this.windowSize; i++) {
      const v = this.linearBuf[i]!;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.windowSize);

    const [hz, db] = this.yin.detect(this.linearBuf, this.rate, this.gateDb);
    const endFrame = chunkStartFrame + len;
    const centerFrame = endFrame - this.windowSize * 0.5;
    const t = centerFrame / this.rate;

    this.recentFrames.push({ t, hz, db });
    const cutoff = t - 0.15;
    while (this.recentFrames.length > 0 && this.recentFrames[0]!.t < cutoff) {
      this.recentFrames.shift();
    }

    const pitchStd = computePitchStdCents(
      this.recentFrames.map((f) => f.hz),
    );
    let minDb = db;
    for (const f of this.recentFrames) {
      if (f.db < minDb) minDb = f.db;
    }

    return {
      t,
      hz,
      db,
      features: {
        rms,
        pitchStd,
        dbRise150ms: db - minDb,
      },
    };
  }
}
