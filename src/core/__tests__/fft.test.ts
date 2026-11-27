import { describe, expect, it } from 'vitest';
import { fft, ifft, irfft, rfft } from '../fft.ts';

/** 確定性偽亂數產生器，確保測試可重現 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

/** 直接計算 O(N^2) DFT 作為對照基準 */
function directDft(
  reIn: Float64Array,
  imIn: Float64Array,
): { re: Float64Array; im: Float64Array } {
  const n = reIn.length;
  const reOut = new Float64Array(n);
  const imOut = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const xRe = reIn[t]!;
      const xIm = imIn[t]!;
      sumRe += xRe * c - xIm * s;
      sumIm += xRe * s + xIm * c;
    }
    reOut[k] = sumRe;
    imOut[k] = sumIm;
  }
  return { re: reOut, im: imOut };
}

describe('fft', () => {
  it.each([8, 1024])('長度 %i 隨機訊號經 FFT→IFFT 還原誤差 < 1e-9', (n) => {
    const rng = makeRng(n * 31 + 7);
    const origRe = new Float64Array(n);
    const origIm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      origRe[i] = rng();
      origIm[i] = rng();
    }

    const re = new Float64Array(origRe);
    const im = new Float64Array(origIm);
    fft(re, im);
    ifft(re, im);

    for (let i = 0; i < n; i++) {
      expect(Math.abs(re[i]! - origRe[i]!)).toBeLessThan(1e-9);
      expect(Math.abs(im[i]! - origIm[i]!)).toBeLessThan(1e-9);
    }
  });

  it('長度 16 訊號的 FFT 結果與直接 DFT 一致（誤差 < 1e-9）', () => {
    const n = 16;
    const rng = makeRng(12345);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = rng();
      im[i] = rng();
    }

    const ref = directDft(re, im);
    fft(re, im);

    for (let k = 0; k < n; k++) {
      expect(Math.abs(re[k]! - ref.re[k]!)).toBeLessThan(1e-9);
      expect(Math.abs(im[k]! - ref.im[k]!)).toBeLessThan(1e-9);
    }
  });

  it('rfft → irfft 可精確還原實數訊號', () => {
    const n = 256;
    const rng = makeRng(99);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = rng();
    }
    const spec = rfft(x, n);
    const restored = irfft(spec.re, spec.im, n);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(restored[i]! - x[i]!)).toBeLessThan(1e-9);
    }
  });
});
