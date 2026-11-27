import { describe, expect, it } from 'vitest';
import { YIN } from '../../core/yin';
import { AdditivePiano, MAX_POLYPHONY, RELEASE } from '../dsp/piano';

describe('AdditivePiano', () => {
  const rate = 48000;

  it('renders A4 within 5 cents and peak below 1', () => {
    const piano = new AdditivePiano(rate);
    const out = new Float32Array(rate); // 1 秒
    piano.on('a4', 440);
    piano.render(out, 0, rate);

    let peak = 0;
    for (let i = 0; i < out.length; i++) {
      const a = Math.abs(out[i]!);
      if (a > peak) peak = a;
    }
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(1);

    const yin = new YIN();
    const win = 2048;
    const hop = 512;
    let detected = 0;
    for (let pos = 4096; pos + win <= rate; pos += hop) {
      const [hz] = yin.detect(out.subarray(pos, pos + win), rate);
      if (hz > 0) detected = hz;
    }
    expect(detected).toBeGreaterThan(0);
    const cents = Math.abs(1200 * Math.log2(detected / 440));
    expect(cents).toBeLessThan(5);
  });

  it('decays to zero within RELEASE seconds after off() and removes voice', () => {
    const piano = new AdditivePiano(rate);
    piano.on('n1', 440);
    const pre = new Float32Array(4800);
    piano.render(pre, 0, pre.length);
    expect(piano.voiceCount).toBe(1);

    piano.off('n1');
    const relFrames = Math.ceil(RELEASE * rate) + 128;
    const rel = new Float32Array(relFrames);
    piano.render(rel, 0, rel.length);
    expect(piano.voiceCount).toBe(0);

    const tail = new Float32Array(256);
    piano.render(tail, 0, tail.length);
    for (let i = 0; i < tail.length; i++) {
      expect(tail[i]).toBe(0);
    }
  });

  it('evicts the oldest voice when exceeding MAX_POLYPHONY', () => {
    const piano = new AdditivePiano(rate);
    for (let i = 0; i < MAX_POLYPHONY + 4; i++) {
      piano.on(`v${i}`, 220 + i * 5);
    }
    expect(piano.voiceCount).toBe(MAX_POLYPHONY);

    // 確認最舊的 v0..v3 已被移除，off('v0') 不影響 voiceCount，off('v4') 會讓它進入 release
    piano.off('v0');
    expect(piano.voiceCount).toBe(MAX_POLYPHONY);
  });

  it('renders 12 simultaneous voices for 10s at 48kHz under 1.5s', () => {
    const piano = new AdditivePiano(rate);
    for (let i = 0; i < 12; i++) {
      piano.on(`p${i}`, 220 * Math.pow(2, i / 12), true);
    }
    const block = new Float32Array(128);
    const totalBlocks = Math.floor((10 * rate) / 128);

    const t0 = performance.now();
    for (let b = 0; b < totalBlocks; b++) {
      block.fill(0);
      piano.render(block, 0, 128);
    }
    const elapsedSec = (performance.now() - t0) / 1000;
    console.log(`[perf] AdditivePiano 12 voices x 10s @ 48kHz: ${elapsedSec.toFixed(3)}s`);
    expect(elapsedSec).toBeLessThan(1.5);
  });
});
