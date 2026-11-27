import { describe, expect, it } from 'vitest';
import { createMixerState, renderBlock } from '../dsp/mixer';

describe('mixer renderBlock', () => {
  const rate = 48000;

  it('outputs 0 before event frame and non-zero after event frame', () => {
    const state = createMixerState(rate, 256);
    state.events = [
      { frame: 512, type: 'noteOn', id: 'n1', hz: 440, held: false, bus: 'melody' },
    ];
    state.totalFrames = 2048;
    state.playing = true;

    const out1 = new Float32Array(256);
    renderBlock(state, out1, 256); // frames 0..256
    expect(out1.every((v) => v === 0)).toBe(true);

    const out2 = new Float32Array(256);
    renderBlock(state, out2, 256); // frames 256..512
    expect(out2.every((v) => v === 0)).toBe(true);

    const out3 = new Float32Array(256);
    renderBlock(state, out3, 256); // frames 512..768
    const maxAbs = out3.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(maxAbs).toBeGreaterThan(0.01);
  });

  it('outputs 0 when paused (playing=false)', () => {
    const state = createMixerState(rate, 256);
    state.events = [
      { frame: 0, type: 'noteOn', id: 'n1', hz: 440, held: false, bus: 'melody' },
    ];
    state.playing = false;

    const out = new Float32Array(256);
    renderBlock(state, out, 256);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('outputs 0 when master gain is 0', () => {
    const state = createMixerState(rate, 256);
    state.events = [
      { frame: 0, type: 'noteOn', id: 'n1', hz: 440, held: false, bus: 'melody' },
    ];
    state.playing = true;
    state.gains.master = 0;

    const out = new Float32Array(256);
    renderBlock(state, out, 256);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('soft-limits output absolute value to <= 0.98', () => {
    const state = createMixerState(rate, 512);
    state.playing = true;
    state.gains.master = 10;
    state.events = [];
    for (let i = 0; i < 10; i++) {
      state.events.push({
        frame: 0,
        type: 'noteOn',
        id: `loud:${i}`,
        hz: 220 + i * 20,
        held: true,
        bus: 'melody',
      });
    }

    const out = new Float32Array(512);
    renderBlock(state, out, 512);
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i]!)).toBeLessThanOrEqual(0.98);
    }
  });

  it('supports independent metro bus gain', () => {
    const state = createMixerState(rate, 256);
    state.playing = true;
    state.totalFrames = 512;
    state.events = [{ frame: 0, type: 'click', accent: true, bus: 'metro' }];

    state.gains.metro = 0;
    const muted = new Float32Array(256);
    renderBlock(state, muted, 256);
    expect(muted.every((v) => v === 0)).toBe(true);

    // 重新觸發並開啟 metro 音量
    state.frame = 0;
    state.cursor = 0;
    state.gains.metro = 1;
    const audible = new Float32Array(256);
    renderBlock(state, audible, 256);
    const maxAbs = audible.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(maxAbs).toBeGreaterThan(0.01);
  });

  it('supports independent melodySing bus gain without affecting listen melody bus', () => {
    const state = createMixerState(rate, 256);
    state.playing = true;
    state.totalFrames = 512;
    state.events = [
      { frame: 0, type: 'noteOn', id: 's1', hz: 440, held: false, bus: 'melodySing' },
    ];

    state.gains.melody = 1;
    state.gains.melodySing = 0;
    const muted = new Float32Array(256);
    renderBlock(state, muted, 256);
    expect(muted.every((v) => v === 0)).toBe(true);

    state.frame = 0;
    state.cursor = 0;
    state.gains.melodySing = 0.7;
    const audible = new Float32Array(256);
    renderBlock(state, audible, 256);
    const maxAbs = audible.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(maxAbs).toBeGreaterThan(0.01);
  });
});
