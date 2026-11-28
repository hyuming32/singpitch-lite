import { describe, expect, it } from 'vitest';
import { YIN } from '../../core/yin';
import { DrumSynth, MAX_DRUM_POLYPHONY } from '../dsp/drums';
import { AccompSynth, MAX_ACCOMP_POLYPHONY } from '../dsp/instruments';
import { createMixerState, renderBlock } from '../dsp/mixer';
import { SCHED_CHUNK_SIZE, takeNextEventBatch, type SchedEvent } from '../dsp/schedule';

describe('AccompSynth（內建伴奏音色與 48 聲上限）', () => {
  const rate = 48000;

  it('五種音色皆可正常發聲且 Karplus-Strong 吉他音準正確', () => {
    const timbres = ['piano', 'organ', 'strings', 'bass', 'guitar'] as const;
    for (const timbre of timbres) {
      const synth = new AccompSynth(rate);
      const out = new Float32Array(rate * 0.5);
      const hz = timbre === 'bass' ? 110 : 220;
      synth.on('n1', hz, timbre, 0.9, false);
      synth.render(out, 0, out.length);

      const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(0.01);
      expect(peak).toBeLessThan(1.0);
    }

    // 驗證吉他 Karplus-Strong 音準（A3 = 220 Hz）
    const guitar = new AccompSynth(rate);
    const out = new Float32Array(rate);
    guitar.on('g1', 220, 'guitar', 1, false);
    guitar.render(out, 0, out.length);

    const yin = new YIN();
    let detected = 0;
    for (let pos = 2048; pos + 2048 <= rate; pos += 512) {
      const [hz] = yin.detect(out.subarray(pos, pos + 2048), rate);
      if (hz > 0) detected = hz;
    }
    expect(detected).toBeGreaterThan(0);
    const cents = Math.abs(1200 * Math.log2(detected / 220));
    expect(cents).toBeLessThan(15);
  });

  it('弦樂慢起音：前 20ms 振幅明顯小於穩定後', () => {
    const synth = new AccompSynth(rate);
    synth.on('s1', 440, 'strings', 1, true);
    const early = new Float32Array(Math.round(0.02 * rate));
    const later = new Float32Array(Math.round(0.2 * rate));
    synth.render(early, 0, early.length);
    synth.render(later, 0, later.length);

    const earlyRms = Math.sqrt(
      early.reduce((acc, v) => acc + v * v, 0) / early.length,
    );
    const lateSlice = later.subarray(Math.round(0.12 * rate));
    const lateRms = Math.sqrt(
      lateSlice.reduce((acc, v) => acc + v * v, 0) / lateSlice.length,
    );
    expect(earlyRms).toBeLessThan(lateRms * 0.35);
  });

  it('超過 48 聲同時發聲上限時偷走最早觸發的音', () => {
    const synth = new AccompSynth(rate);
    expect(MAX_ACCOMP_POLYPHONY).toBe(48);

    for (let i = 0; i < MAX_ACCOMP_POLYPHONY + 5; i++) {
      synth.on(`v${i}`, 220 + i * 2, i % 2 === 0 ? 'guitar' : 'piano', 0.8);
    }
    expect(synth.voiceCount).toBe(MAX_ACCOMP_POLYPHONY);

    // 最早的 v0..v4 已被偷走；off('v0') 不會讓任何聲音進入 release
    synth.off('v0');
    expect(synth.voiceCount).toBe(MAX_ACCOMP_POLYPHONY);
  });

  it('velocity 影響輸出振幅', () => {
    const soft = new AccompSynth(rate);
    const loud = new AccompSynth(rate);
    soft.on('n', 440, 'piano', 0.25);
    loud.on('n', 440, 'piano', 1.0);
    const bufSoft = new Float32Array(2048);
    const bufLoud = new Float32Array(2048);
    soft.render(bufSoft, 0, 2048);
    loud.render(bufLoud, 0, 2048);
    const peakSoft = bufSoft.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const peakLoud = bufLoud.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peakLoud).toBeGreaterThan(peakSoft * 3);
  });
});

describe('DrumSynth（合成鼓組與發聲上限）', () => {
  const rate = 48000;

  it('支援六類鼓聲並遵守上限與閉合 hi-hat 截斷開放 hi-hat', () => {
    const drums = new DrumSynth(rate);
    const types = [
      'kick',
      'snare',
      'closedHat',
      'openHat',
      'cymbal',
      'tom',
    ] as const;
    for (const d of types) {
      const ds = new DrumSynth(rate);
      ds.trigger(d, 0.9, 45);
      const out = new Float32Array(Math.round(0.05 * rate));
      ds.render(out, 0, out.length);
      const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(0.01);
    }

    // openHat 被 closedHat 截斷
    drums.trigger('openHat', 1);
    expect(drums.voiceCount).toBe(1);
    drums.trigger('closedHat', 1);
    expect(drums.voiceCount).toBe(1);

    // 超過上限時偷走最舊鼓聲
    for (let i = 0; i < MAX_DRUM_POLYPHONY + 5; i++) {
      drums.trigger('snare', 0.8);
    }
    expect(drums.voiceCount).toBe(MAX_DRUM_POLYPHONY);
  });
});

describe('Mixer 伴奏與節奏組匯流排及排程分批', () => {
  const rate = 48000;

  it('伴奏與節奏組匯流排增益為 0 時完全靜音，開啟後正常輸出', () => {
    const state = createMixerState(rate, 256);
    state.playing = true;
    state.totalFrames = 2048;
    state.events = [
      {
        frame: 0,
        type: 'noteOn',
        id: 'acc:1:0',
        hz: 440,
        held: false,
        bus: 'accomp',
        timbre: 'organ',
        velocity: 0.8,
      },
      {
        frame: 0,
        type: 'drum',
        drum: 'kick',
        midi: 36,
        velocity: 1,
        bus: 'rhythm',
      },
    ];

    state.gains.accomp = 0;
    state.gains.rhythm = 0;
    const muted = new Float32Array(256);
    renderBlock(state, muted, 256);
    expect(muted.every((v) => v === 0)).toBe(true);

    state.frame = 0;
    state.cursor = 0;
    state.accompSynth.allOff();
    state.drumSynth.allOff();
    state.gains.accomp = 0.6;
    state.gains.rhythm = 0.5;
    const audible = new Float32Array(256);
    renderBlock(state, audible, 256);
    const peak = audible.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.02);
  });

  it('takeNextEventBatch 正確分批切出排程事件（不一次塞整首）', () => {
    const total = SCHED_CHUNK_SIZE * 2 + 123;
    const events: SchedEvent[] = Array.from({ length: total }, (_, i) => ({
      frame: i * 100,
      type: 'drum',
      drum: 'closedHat',
      midi: 42,
      velocity: 0.7,
      bus: 'rhythm',
    }));

    const b1 = takeNextEventBatch(events, 0);
    expect(b1.batch).toHaveLength(SCHED_CHUNK_SIZE);
    expect(b1.nextCursor).toBe(SCHED_CHUNK_SIZE);

    const b2 = takeNextEventBatch(events, b1.nextCursor);
    expect(b2.batch).toHaveLength(SCHED_CHUNK_SIZE);
    expect(b2.nextCursor).toBe(SCHED_CHUNK_SIZE * 2);

    const b3 = takeNextEventBatch(events, b2.nextCursor);
    expect(b3.batch).toHaveLength(123);
    expect(b3.nextCursor).toBe(total);

    const b4 = takeNextEventBatch(events, b3.nextCursor);
    expect(b4.batch).toHaveLength(0);
  });
});
