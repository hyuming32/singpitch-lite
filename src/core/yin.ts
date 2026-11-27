/** FFT 加速 YIN 音高偵測器；逐行移植自桌面版 pitch_detector.py。 */

import { irfft, rfft } from './fft.ts';
import {
  GATE_DB,
  JUMP_FRAMES,
  JUMP_NEAR,
  JUMP_SEMITONES,
  MEDIAN_FRAMES,
  OCTAVE_TOLERANCE,
  ONSET_FRAMES,
  PITCH_MAX_HZ,
  PITCH_MIN_HZ,
  YIN_MAX_ERROR,
  YIN_THRESHOLD,
} from './pitchConfig.ts';

/** Python 風格四捨六入五成雙（banker's rounding） */
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** 計算數值陣列的中位數（偶數個時取中間兩數平均，同 numpy.median） */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  if ((n & 1) === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

/** FFT 加速 YIN 音高偵測器（含八度修正、跳音確認與起音確認） */
export class YIN {
  private history: number[] = [];
  private octaveCandidate: number | null = null;
  private octaveCount = 0;
  private pending: number | null = null;
  private pendingCount = 0;

  /** 重設偵測器內部狀態 */
  reset(): void {
    this.history.length = 0;
    this.octaveCandidate = null;
    this.octaveCount = 0;
    this.pending = null;
    this.pendingCount = 0;
  }

  /** 同一個陌生音高需連續出現 need 幀才算數；起音/收音的亂跳湊不齊。 */
  private confirm(pitch: number, need: number): boolean {
    const near =
      this.pending !== null && Math.abs(pitch - this.pending) < JUMP_NEAR;
    this.pendingCount = near ? this.pendingCount + 1 : 1;
    this.pending = pitch;
    return this.pendingCount >= need;
  }

  /**
   * 偵測單一音訊幀的基頻（Hz）與音量（dBFS）。
   * @param samples 輸入音訊樣本
   * @param rate 取樣率（Hz）
   * @param gateDb 噪音門檻（dB）
   * @returns [hz, db]，未偵測到穩定音高時 hz 為 0
   */
  detect(
    samples: Float32Array | Float64Array,
    rate: number,
    gateDb: number = GATE_DB,
  ): [hz: number, db: number] {
    const len = samples.length;
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      const v = samples[i]!;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / len);
    const db = 20 * Math.log10(Math.max(rms, 1e-12));
    if (db < gateDb) {
      this.reset();
      return [0.0, db];
    }

    // 起音落在分析窗尾端時，前半窗仍是靜音；此時 YIN 的
    // 差分會出現假的低谷，不能把它當作週期或帶入中值歷史。
    const half = len >> 1;
    let firstPower = 0.0;
    if (half > 0) {
      let firstSumSq = 0;
      for (let i = 0; i < half; i++) {
        const v = samples[i]!;
        firstSumSq += v * v;
      }
      firstPower = firstSumSq / half;
    }
    if (firstPower < Math.pow(10, gateDb / 10) || firstPower < rms * rms * 0.05) {
      this.reset();
      return [0.0, db];
    }

    // 方塊平均降採樣至約 24 kHz，兼顧成本與高音插值精度。
    const factor = Math.max(1, pyRound(rate / 24000));
    const nDown = Math.floor(len / factor);
    const x = new Float64Array(nDown);
    if (factor === 1) {
      for (let i = 0; i < nDown; i++) {
        x[i] = samples[i]!;
      }
    } else {
      const invFactor = 1 / factor;
      for (let i = 0; i < nDown; i++) {
        let acc = 0;
        const base = i * factor;
        for (let k = 0; k < factor; k++) {
          acc += samples[base + k]!;
        }
        x[i] = acc * invFactor;
      }
    }
    const effRate = rate / factor;

    let mean = 0;
    for (let i = 0; i < nDown; i++) {
      mean += x[i]!;
    }
    mean /= nDown;
    for (let i = 0; i < nDown; i++) {
      x[i] = x[i]! - mean;
    }

    const width = nDown >> 1;
    const maxTau = Math.min(width - 1, Math.trunc(effRate / PITCH_MIN_HZ) + 1);
    const minTau = Math.max(2, Math.trunc(effRate / PITCH_MAX_HZ));
    if (maxTau <= minTau) {
      return [0.0, db];
    }

    // 固定比較窗的差分函數，利用線性互相關與平方和求得。
    const convLen = nDown + width - 1;
    const bitLen = 32 - Math.clz32(convLen);
    const size = 1 << bitLen;

    const specX = rfft(x, size);
    const specW = rfft(x.subarray(0, width), size);
    const bins = specX.re.length;
    const prodRe = new Float64Array(bins);
    const prodIm = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const xRe = specX.re[k]!;
      const xIm = specX.im[k]!;
      const wRe = specW.re[k]!;
      const wIm = specW.im[k]!;
      // specX * conj(specW)
      prodRe[k] = xRe * wRe + xIm * wIm;
      prodIm[k] = xIm * wRe - xRe * wIm;
    }
    const corr = irfft(prodRe, prodIm, size);

    const sums = new Float64Array(nDown + 1);
    for (let i = 0; i < nDown; i++) {
      const v = x[i]!;
      sums[i + 1] = sums[i]! + v * v;
    }

    const diff = new Float64Array(maxTau + 1);
    const sumsWidth = sums[width]!;
    for (let lag = 0; lag <= maxTau; lag++) {
      const d = sumsWidth + sums[width + lag]! - sums[lag]! - 2 * corr[lag]!;
      diff[lag] = d > 0 ? d : 0;
    }

    const cmnd = new Float64Array(maxTau + 1);
    cmnd[0] = 1;
    let cumDiff = 0;
    for (let lag = 1; lag <= maxTau; lag++) {
      cumDiff += diff[lag]!;
      cmnd[lag] = (diff[lag]! * lag) / Math.max(cumDiff, 1e-20);
    }

    let tau: number | null = null;
    for (let j = minTau; j < maxTau; j++) {
      if (cmnd[j]! < YIN_THRESHOLD) {
        while (j + 1 <= maxTau && cmnd[j + 1]! < cmnd[j]!) {
          j++;
        }
        tau = j;
        break;
      }
    }
    if (tau === null) {
      let bestIdx = minTau;
      let bestVal = cmnd[minTau]!;
      for (let j = minTau + 1; j <= maxTau; j++) {
        if (cmnd[j]! < bestVal) {
          bestVal = cmnd[j]!;
          bestIdx = j;
        }
      }
      tau = bestIdx;
      if (cmnd[tau]! > YIN_MAX_ERROR) {
        this.reset();
        return [0.0, db];
      }
    }

    // 搜尋範圍的端點不是已找到的週期低谷。攻擊音／殘響常
    // 使差分一路下降至端點，先留白而非畫出跨音域的尖線。
    if (
      tau <= minTau ||
      tau >= maxTau ||
      !(cmnd[tau]! <= cmnd[tau - 1]! && cmnd[tau]! <= cmnd[tau + 1]!)
    ) {
      this.reset();
      return [0.0, db];
    }

    let refined = tau;
    if (tau > 0 && tau < maxTau) {
      const left = cmnd[tau - 1]!;
      const middle = cmnd[tau]!;
      const right = cmnd[tau + 1]!;
      const denom = left - 2 * middle + right;
      if (Math.abs(denom) > 1e-12) {
        const shift = (0.5 * (left - right)) / denom;
        refined += Math.max(-0.5, Math.min(0.5, shift));
      }
    }

    const hz = effRate / refined;
    if (!(hz >= PITCH_MIN_HZ && hz <= PITCH_MAX_HZ)) {
      this.reset();
      return [0.0, db];
    }

    let pitch = 12 * Math.log2(hz);

    // 只修正短暫的八度跳動；連續三幀支持新八度時接受真實跳音。
    if (this.history.length > 0) {
      const center = median(this.history);
      const delta = pitch - center;
      if (Math.abs(Math.abs(delta) - 12) < OCTAVE_TOLERANCE) {
        const candidate = pyRound(pitch);
        this.octaveCount =
          candidate === this.octaveCandidate ? this.octaveCount + 1 : 1;
        this.octaveCandidate = candidate;
        if (this.octaveCount < 3) {
          pitch -= Math.sign(delta) * 12;
        } else {
          this.history.length = 0;
        }
      } else {
        this.octaveCount = 0;
      }
    }

    // 非八度的大幅跳動、或起音第一幀：必須連續確認才採用，否則留白。
    if (this.history.length > 0) {
      if (Math.abs(pitch - median(this.history)) > JUMP_SEMITONES) {
        if (!this.confirm(pitch, JUMP_FRAMES)) {
          return [0.0, db];
        }
        this.history.length = 0;
      } else {
        this.pending = null;
        this.pendingCount = 0;
      }
    } else if (!this.confirm(pitch, ONSET_FRAMES)) {
      return [0.0, db];
    }

    this.history.push(pitch);
    if (this.history.length > MEDIAN_FRAMES) {
      this.history.shift();
    }

    return [Math.pow(2, median(this.history) / 12), db];
  }
}
