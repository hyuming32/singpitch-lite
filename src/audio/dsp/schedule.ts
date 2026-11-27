import type { Exercise } from '../../core/exercise';
import { midiToHz } from '../../core/notes';

export type SchedBus =
  | 'melody'
  | 'melodySing'
  | 'pad'
  | 'cadence'
  | 'click'
  | 'metro';

export type SchedEvent =
  | {
      frame: number;
      type: 'noteOn';
      id: string;
      hz: number;
      held: boolean;
      bus: 'melody' | 'melodySing' | 'pad' | 'cadence';
    }
  | {
      frame: number;
      type: 'noteOff';
      id: string;
      bus: 'melody' | 'melodySing' | 'pad' | 'cadence';
    }
  | {
      frame: number;
      type: 'glide';
      id: string;
      hzStart: number;
      hzEnd: number;
      dur: number;
      bus: 'melody' | 'melodySing';
    }
  | {
      frame: number;
      type: 'click';
      accent: boolean;
      bus: 'click' | 'metro';
    };

export interface CompileOptions {
  a4?: number;
  pianoDuringSing?: boolean;
  pad?: boolean;
  voiceForGlide?: boolean;
  click?: boolean;
  /** 是否在整段練習中每拍產生節拍器事件（走 'metro' 匯流排） */
  beatClicks?: boolean;
  /** 練習速度（BPM），供 beatClicks 計算拍長；未提供時由 ex.clicks 推算 */
  bpm?: number;
}

export interface CompiledExercise {
  events: SchedEvent[];
  totalFrames: number;
}

/** 將和弦組成音配置於 C3–B4（MIDI 48–71）之間，根音在最下方 */
function voiceChord(pcs: readonly number[]): number[] {
  if (pcs.length === 0) {
    return [];
  }
  const rootMidi = 48 + (pcs[0]! % 12);
  const midis: number[] = [rootMidi];
  let prev = rootMidi;
  for (let i = 1; i < pcs.length; i++) {
    let m = 48 + (pcs[i]! % 12);
    while (m <= prev) {
      m += 12;
    }
    if (m > 71) {
      m -= 12;
    }
    midis.push(m);
    prev = m;
  }
  return midis;
}

/**
 * 為引導和弦（cadence）配置就近聲部連接（例如 I → V/7 的 1 3 5 → 7(低) 2 5）：
 * 首個和弦置於舒適中音區（F3–E4），後續和弦低音取距離前一低音最近的位置並向上疊置。
 */
function voiceCadenceChord(
  pcs: readonly number[],
  prevBassMidi: number | null,
): number[] {
  if (pcs.length === 0) {
    return [];
  }
  const bassPc = ((pcs[0]! % 12) + 12) % 12;
  let bassMidi: number;
  if (prevBassMidi === null) {
    bassMidi = bassPc <= 4 ? 60 + bassPc : 48 + bassPc;
  } else {
    bassMidi = 48 + bassPc;
    while (bassMidi - prevBassMidi > 6) {
      bassMidi -= 12;
    }
    while (prevBassMidi - bassMidi > 6) {
      bassMidi += 12;
    }
    // 維持在舒適鋼琴中音區（E3–F#4），避免連續上行／下行超出範圍
    if (bassMidi > 66) {
      bassMidi -= 12;
    } else if (bassMidi < 52) {
      bassMidi += 12;
    }
  }

  const midis: number[] = [bassMidi];
  let prev = bassMidi;
  for (let i = 1; i < pcs.length; i++) {
    let m = 48 + (((pcs[i]! % 12) + 12) % 12);
    while (m <= prev) {
      m += 12;
    }
    midis.push(m);
    prev = m;
  }
  return midis;
}

/** 將 Exercise 編譯為以樣本幀排序的排程事件表 */
export function compileExercise(
  ex: Exercise,
  rate: number,
  opts: CompileOptions = {},
): CompiledExercise {
  const {
    a4 = 440,
    pianoDuringSing = true,
    pad = true,
    voiceForGlide = true,
    click = true,
    beatClicks = false,
    bpm,
  } = opts;

  const events: SchedEvent[] = [];

  // 練習音符與滑音
  for (let i = 0; i < ex.notes.length; i++) {
    const note = ex.notes[i]!;
    const shouldPlay = note.phase === 'listen' || pianoDuringSing;
    if (!shouldPlay) {
      continue;
    }

    const startFrame = Math.round(note.start * rate);
    const endFrame = Math.round((note.start + note.dur) * rate);
    const id = `ex:${i}`;
    const melodyBus = note.phase === 'sing' ? 'melodySing' : 'melody';

    if (note.endMidi !== undefined && voiceForGlide) {
      events.push({
        frame: startFrame,
        type: 'glide',
        id,
        hzStart: midiToHz(note.midi, a4),
        hzEnd: midiToHz(note.endMidi, a4),
        dur: note.dur,
        bus: melodyBus,
      });
    } else {
      events.push({
        frame: startFrame,
        type: 'noteOn',
        id,
        hz: midiToHz(note.midi, a4),
        held: false,
        bus: melodyBus,
      });
    }

    events.push({
      frame: endFrame,
      type: 'noteOff',
      id,
      bus: melodyBus,
    });
  }

  // 和弦（pad 與 cadence）
  let prevCadenceBass: number | null = null;
  for (let ci = 0; ci < ex.chords.length; ci++) {
    const chord = ex.chords[ci]!;
    if (chord.role === 'pad' && !pad) {
      continue;
    }

    const startFrame = Math.round(chord.start * rate);
    const endFrame = Math.round((chord.start + chord.dur) * rate);
    const isPad = chord.role === 'pad';
    let midis: number[];
    if (isPad) {
      midis = voiceChord(chord.pcs);
    } else if (chord.midis && chord.midis.length > 0) {
      midis = chord.midis;
    } else {
      midis = voiceCadenceChord(chord.pcs, prevCadenceBass);
      if (midis.length > 0) {
        prevCadenceBass = midis[0]!;
      }
    }
    const bus = isPad ? 'pad' : 'cadence';

    for (let mi = 0; mi < midis.length; mi++) {
      const midi = midis[mi]!;
      const id = isPad ? `pad:${ci}:${midi}` : `cadence:${ci}:${midi}`;
      events.push({
        frame: startFrame,
        type: 'noteOn',
        id,
        hz: midiToHz(midi, a4),
        held: isPad,
        bus,
      });
      events.push({
        frame: endFrame,
        type: 'noteOff',
        id,
        bus,
      });
    }
  }

  // 節拍器（beatClicks 啟用時涵蓋預備拍至練習結束，統一走 'metro' 避免重複）
  if (beatClicks) {
    const firstBeat = ex.clicks[0]?.t ?? 0;
    const beatSec =
      bpm !== undefined && bpm > 0
        ? 60 / bpm
        : ex.clicks.length >= 2
          ? ex.clicks[1]!.t - ex.clicks[0]!.t
          : 0;
    if (beatSec > 0 && ex.total > firstBeat) {
      let lastFrame = -1;
      for (let i = 0; ; i++) {
        const t = firstBeat + i * beatSec;
        if (t >= ex.total - 1e-6) {
          break;
        }
        const frame = Math.round(t * rate);
        if (frame === lastFrame) {
          continue;
        }
        lastFrame = frame;
        events.push({
          frame,
          type: 'click',
          accent: i % 4 === 0,
          bus: 'metro',
        });
      }
    }
  } else if (click) {
    for (const c of ex.clicks) {
      events.push({
        frame: Math.round(c.t * rate),
        type: 'click',
        accent: c.accent,
        bus: 'click',
      });
    }
  }

  // 依 frame 排序，同 frame 時 noteOff 排在前面
  events.sort((a, b) => {
    if (a.frame !== b.frame) {
      return a.frame - b.frame;
    }
    const aOff = a.type === 'noteOff' ? 0 : 1;
    const bOff = b.type === 'noteOff' ? 0 : 1;
    return aOff - bOff;
  });

  const totalFrames = Math.round(ex.total * rate);
  return { events, totalFrames };
}
