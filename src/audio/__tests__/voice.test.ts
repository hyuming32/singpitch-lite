import { describe, expect, it } from 'vitest';
import { YIN } from '../../core/yin';
import { GlideVoice } from '../dsp/voice';

describe('GlideVoice', () => {
  const rate = 48000;

  it('glides log-linearly from 220 Hz to 330 Hz over 1 second', () => {
    const voice = new GlideVoice(rate);
    const out = new Float32Array(rate);
    voice.start('g1', 220, 330, 1.0);
    voice.render(out, 0, rate);

    const yin = new YIN();
    const win = 2048;
    const hop = 256;

    let hzAt01 = 0;
    let hzAt095 = 0;
    const target01Frame = Math.round(0.1 * rate);
    const target095Frame = Math.round(0.95 * rate);

    for (let pos = 0; pos + win <= rate; pos += hop) {
      const [hz] = yin.detect(out.subarray(pos, pos + win), rate);
      const center = pos + win / 2;
      if (hz > 0 && Math.abs(center - target01Frame) <= hop) {
        hzAt01 = hz;
      }
      if (hz > 0 && Math.abs(center - target095Frame) <= hop) {
        hzAt095 = hz;
      }
    }

    const expected01 = 220 * Math.pow(330 / 220, 0.1);
    const expected095 = 220 * Math.pow(330 / 220, 0.95);

    expect(hzAt01).toBeGreaterThan(0);
    expect(hzAt095).toBeGreaterThan(0);

    const cents01 = Math.abs(1200 * Math.log2(hzAt01 / expected01));
    const cents095 = Math.abs(1200 * Math.log2(hzAt095 / expected095));

    expect(cents01).toBeLessThan(30);
    expect(cents095).toBeLessThan(30);
  });
});
