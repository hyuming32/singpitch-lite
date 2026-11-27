import { MetronomeClick } from './click';
import { AdditivePiano } from './piano';
import type { SchedEvent } from './schedule';
import { GlideVoice } from './voice';

export type GainBus =
  | 'master'
  | 'melody'
  | 'melodySing'
  | 'pad'
  | 'cadence'
  | 'click'
  | 'metro'
  | 'keys';

export interface MixerState {
  playing: boolean;
  frame: number;
  totalFrames: number;
  events: SchedEvent[];
  cursor: number;
  rate: number;
  gains: Record<GainBus, number>;
  muteKeys: boolean;
  melodyPiano: AdditivePiano;
  melodySingPiano: AdditivePiano;
  padPiano: AdditivePiano;
  cadencePiano: AdditivePiano;
  keysPiano: AdditivePiano;
  melodyVoice: GlideVoice;
  melodySingVoice: GlideVoice;
  clickSynth: MetronomeClick;
  metroSynth: MetronomeClick;
  bufMelody: Float32Array;
  bufMelodySing: Float32Array;
  bufPad: Float32Array;
  bufCadence: Float32Array;
  bufClick: Float32Array;
  bufMetro: Float32Array;
  bufKeys: Float32Array;
}

const DEFAULT_BUF_SIZE = 4096;
const LIMIT_CEIL = 0.98;
const INV_LIMIT_CEIL = 1 / LIMIT_CEIL;

/** 建立預先配置緩衝區的混音器狀態 */
export function createMixerState(
  rate: number,
  bufSize = DEFAULT_BUF_SIZE,
): MixerState {
  return {
    playing: false,
    frame: 0,
    totalFrames: 0,
    events: [],
    cursor: 0,
    rate,
    gains: {
      master: 1,
      melody: 1,
      melodySing: 1,
      pad: 0.45,
      cadence: 0.7,
      click: 0.8,
      metro: 1,
      keys: 1,
    },
    muteKeys: false,
    melodyPiano: new AdditivePiano(rate),
    melodySingPiano: new AdditivePiano(rate),
    padPiano: new AdditivePiano(rate),
    cadencePiano: new AdditivePiano(rate),
    keysPiano: new AdditivePiano(rate),
    melodyVoice: new GlideVoice(rate),
    melodySingVoice: new GlideVoice(rate),
    clickSynth: new MetronomeClick(rate),
    metroSynth: new MetronomeClick(rate),
    bufMelody: new Float32Array(bufSize),
    bufMelodySing: new Float32Array(bufSize),
    bufPad: new Float32Array(bufSize),
    bufCadence: new Float32Array(bufSize),
    bufClick: new Float32Array(bufSize),
    bufMetro: new Float32Array(bufSize),
    bufKeys: new Float32Array(bufSize),
  };
}

/** 停止所有練習音源（不影響對音鋼琴 keys） */
export function stopExerciseVoices(state: MixerState): void {
  state.melodyPiano.allOff();
  state.melodySingPiano.allOff();
  state.padPiano.allOff();
  state.cadencePiano.allOff();
  state.melodyVoice.allOff();
  state.melodySingVoice.allOff();
  state.clickSynth.allOff();
  state.metroSynth.allOff();
}

function dispatchEvent(state: MixerState, ev: SchedEvent): void {
  switch (ev.type) {
    case 'noteOn':
      if (ev.bus === 'melody') {
        state.melodyPiano.on(ev.id, ev.hz, ev.held);
      } else if (ev.bus === 'melodySing') {
        state.melodySingPiano.on(ev.id, ev.hz, ev.held);
      } else if (ev.bus === 'pad') {
        state.padPiano.on(ev.id, ev.hz, ev.held);
      } else {
        state.cadencePiano.on(ev.id, ev.hz, ev.held);
      }
      break;
    case 'noteOff':
      if (ev.bus === 'melody') {
        state.melodyPiano.off(ev.id);
        state.melodyVoice.stop(ev.id);
      } else if (ev.bus === 'melodySing') {
        state.melodySingPiano.off(ev.id);
        state.melodySingVoice.stop(ev.id);
      } else if (ev.bus === 'pad') {
        state.padPiano.off(ev.id);
      } else {
        state.cadencePiano.off(ev.id);
      }
      break;
    case 'glide':
      if (ev.bus === 'melodySing') {
        state.melodySingVoice.start(ev.id, ev.hzStart, ev.hzEnd, ev.dur);
      } else {
        state.melodyVoice.start(ev.id, ev.hzStart, ev.hzEnd, ev.dur);
      }
      break;
    case 'click':
      if (ev.bus === 'metro') {
        state.metroSynth.trigger(ev.accent);
      } else {
        state.clickSynth.trigger(ev.accent);
      }
      break;
  }
}

function ensureBufferCapacity(state: MixerState, frames: number): void {
  if (frames <= state.bufMelody.length) {
    return;
  }
  state.bufMelody = new Float32Array(frames);
  state.bufMelodySing = new Float32Array(frames);
  state.bufPad = new Float32Array(frames);
  state.bufCadence = new Float32Array(frames);
  state.bufClick = new Float32Array(frames);
  state.bufMetro = new Float32Array(frames);
  state.bufKeys = new Float32Array(frames);
}

/** 渲染一個音訊區塊至 out（單聲道），執行到期事件、分軌混音與軟限幅 */
export function renderBlock(
  state: MixerState,
  out: Float32Array,
  frames: number,
): void {
  if (frames <= 0) {
    return;
  }
  ensureBufferCapacity(state, frames);
  out.fill(0, 0, frames);

  if (state.playing) {
    const {
      bufMelody,
      bufMelodySing,
      bufPad,
      bufCadence,
      bufClick,
      bufMetro,
      events,
      gains,
    } = state;
    bufMelody.fill(0, 0, frames);
    bufMelodySing.fill(0, 0, frames);
    bufPad.fill(0, 0, frames);
    bufCadence.fill(0, 0, frames);
    bufClick.fill(0, 0, frames);
    bufMetro.fill(0, 0, frames);

    const blockEnd = state.frame + frames;
    let pos = 0;

    while (pos < frames) {
      while (
        state.cursor < events.length &&
        events[state.cursor]!.frame <= state.frame
      ) {
        dispatchEvent(state, events[state.cursor]!);
        state.cursor++;
      }

      const nextFrame =
        state.cursor < events.length
          ? Math.min(blockEnd, events[state.cursor]!.frame)
          : blockEnd;
      const chunk = nextFrame - state.frame;
      if (chunk <= 0) {
        break;
      }

      state.melodyPiano.render(bufMelody, pos, chunk);
      state.melodyVoice.render(bufMelody, pos, chunk);
      state.melodySingPiano.render(bufMelodySing, pos, chunk);
      state.melodySingVoice.render(bufMelodySing, pos, chunk);
      state.padPiano.render(bufPad, pos, chunk);
      state.cadencePiano.render(bufCadence, pos, chunk);
      state.clickSynth.render(bufClick, pos, chunk);
      state.metroSynth.render(bufMetro, pos, chunk);

      pos += chunk;
      state.frame += chunk;
    }

    const gMel = gains.melody;
    const gMelSing = gains.melodySing;
    const gPad = gains.pad;
    const gCad = gains.cadence;
    const gClk = gains.click;
    const gMet = gains.metro;

    for (let i = 0; i < frames; i++) {
      out[i] =
        bufMelody[i]! * gMel +
        bufMelodySing[i]! * gMelSing +
        bufPad[i]! * gPad +
        bufCadence[i]! * gCad +
        bufClick[i]! * gClk +
        bufMetro[i]! * gMet;
    }
  }

  // 對音鋼琴不受播放狀態影響
  if (state.keysPiano.voiceCount > 0) {
    const bufKeys = state.bufKeys;
    bufKeys.fill(0, 0, frames);
    state.keysPiano.render(bufKeys, 0, frames);
    if (!state.muteKeys && state.gains.keys !== 0) {
      const gKeys = state.gains.keys;
      for (let i = 0; i < frames; i++) {
        out[i] = out[i]! + bufKeys[i]! * gKeys;
      }
    }
  }

  // 主音量與 tanh 軟限幅（|x| <= 0.98）
  const master = state.gains.master;
  if (master === 0) {
    out.fill(0, 0, frames);
    return;
  }

  for (let i = 0; i < frames; i++) {
    const x = out[i]! * master;
    out[i] = LIMIT_CEIL * Math.tanh(x * INV_LIMIT_CEIL);
  }
}
