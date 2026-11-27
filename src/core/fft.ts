/**
 * 自寫 Radix-2 迭代式複數 FFT（Float64Array），供 YIN 計算線性互相關使用。
 */

/** 檢查 n 是否為 2 的冪次 */
function assertPowerOfTwo(n: number): void {
  if (n < 1 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT 長度必須為 2 的冪次，收到 ${n}`);
  }
}

/**
 * 原地（in-place）執行 Radix-2 迭代式複數 FFT 或 IFFT。
 * @param re 實部陣列（長度須為 2 的冪次）
 * @param im 虛部陣列（與 re 等長）
 * @param inverse 是否為反變換（IFFT）
 */
function transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (im.length !== n) {
    throw new Error(`實部與虛部陣列長度不一致：${n} vs ${im.length}`);
  }
  assertPowerOfTwo(n);
  if (n === 1) return;

  // 位元反轉排列（bit-reversal permutation）
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  // 迭代蝶形運算（Cooley-Tukey）
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (sign * 2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uIdx = i + j;
        const vIdx = uIdx + half;
        const vRe = re[vIdx]!;
        const vIm = im[vIdx]!;

        const tRe = vRe * wRe - vIm * wIm;
        const tIm = vRe * wIm + vIm * wRe;

        const uRe = re[uIdx]!;
        const uIm = im[uIdx]!;

        re[uIdx] = uRe + tRe;
        im[uIdx] = uIm + tIm;
        re[vIdx] = uRe - tRe;
        im[vIdx] = uIm - tIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }

  if (inverse) {
    const invN = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! * invN;
      im[i] = im[i]! * invN;
    }
  }
}

/** 原地執行正向 FFT */
export function fft(re: Float64Array, im: Float64Array): void {
  transform(re, im, false);
}

/** 原地執行反向 FFT（結果已除以 N） */
export function ifft(re: Float64Array, im: Float64Array): void {
  transform(re, im, true);
}

/**
 * 實數序列的 FFT（對應 numpy.fft.rfft(x, size)）。
 * 會將輸入零補（或截斷）至 size，並回傳前 size/2 + 1 個複數頻率分量。
 */
export function rfft(
  real: Float64Array,
  size: number,
): { re: Float64Array; im: Float64Array } {
  assertPowerOfTwo(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const copyLen = Math.min(real.length, size);
  for (let i = 0; i < copyLen; i++) {
    re[i] = real[i]!;
  }
  fft(re, im);
  const bins = (size >> 1) + 1;
  return {
    re: re.subarray(0, bins),
    im: im.subarray(0, bins),
  };
}

/**
 * 實數序列的反向 FFT（對應 numpy.fft.irfft(X, size)）。
 * 由前 size/2 + 1 個頻率分量重建共軛對稱頻譜後執行 IFFT，回傳長度為 size 的實數陣列。
 */
export function irfft(
  specRe: Float64Array,
  specIm: Float64Array,
  size: number,
): Float64Array {
  assertPowerOfTwo(size);
  const half = size >> 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);

  const bins = Math.min(specRe.length, half + 1);
  for (let k = 0; k < bins; k++) {
    re[k] = specRe[k]!;
    im[k] = specIm[k]!;
  }
  // 確保 DC 與 Nyquist 虛部為 0（共軛對稱性）
  im[0] = 0;
  if (half < bins) {
    im[half] = 0;
  }
  for (let k = 1; k < half; k++) {
    re[size - k] = re[k]!;
    im[size - k] = -im[k]!;
  }

  ifft(re, im);
  return re;
}
