import { describe, expect, it } from 'vitest';
import { MetronomeClick } from '../dsp/click';

function estimateFreqZeroCrossings(buf: Float32Array, rate: number): number {
  let crossings = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1]! <= 0 && buf[i]! > 0) {
      if (firstIdx < 0) firstIdx = i;
      lastIdx = i;
      crossings++;
    }
  }
  const cycles = crossings - 1;
  return (cycles * rate) / (lastIdx - firstIdx);
}

describe('MetronomeClick', () => {
  const rate = 48000;

  it('has 35ms length and correct accent (1700Hz) / normal (1100Hz) frequencies', () => {
    const click = new MetronomeClick(rate);
    const expectedLen = Math.round(0.035 * rate);

    const accentBuf = new Float32Array(rate * 0.1);
    click.trigger(true);
    click.render(accentBuf, 0, accentBuf.length);

    expect(accentBuf[expectedLen - 1]).not.toBe(0);
    expect(accentBuf[expectedLen]).toBe(0);
    const accentHz = estimateFreqZeroCrossings(
      accentBuf.subarray(0, expectedLen),
      rate,
    );
    expect(Math.abs(accentHz - 1700)).toBeLessThan(30);

    const normalBuf = new Float32Array(rate * 0.1);
    click.trigger(false);
    click.render(normalBuf, 0, normalBuf.length);

    expect(normalBuf[expectedLen - 1]).not.toBe(0);
    expect(normalBuf[expectedLen]).toBe(0);
    const normalHz = estimateFreqZeroCrossings(
      normalBuf.subarray(0, expectedLen),
      rate,
    );
    expect(Math.abs(normalHz - 1100)).toBeLessThan(30);
  });
});
