import { chordName, chordPitchClasses, parseRoman } from './chords';
import type { Key, KeyMode } from './key';
import { parseJianpu, type PatternDef } from './patterns';

export type CadenceMode = 'off' | 'double' | 'single';

export interface ExerciseOptions {
  startTonic: number;
  low: number;
  high: number;
  bpm: number;
  /** 每個簡譜拍的實際拍數，預設 1 */
  noteBeats?: number;
  /** 每個調唱幾遍，預設 1 */
  repeats?: number;
  articulation?: 'legato' | 'staccato';
  transpose?: 'fixed' | 'up' | 'up-down';
  /** 換調前提示和弦模式：'off' / false 關閉；'double' / true 為 I → V/7 雙和弦；'single' 為 1 拍 I 級單和弦快切（不斷拍） */
  cadence?: boolean | CadenceMode;
  /** 預備拍數（只在最前面），預設 4 */
  countInBeats?: number;
  /** 每個調之間休息拍數，預設 1 */
  restBeats?: number;
  mode?: 'follow' | 'listen-then-sing';
  keyMode?: KeyMode;
  /** 自訂主音 MIDI 清單；非空時忽略 transpose，依此清單順序建立 KeyBlock */
  tonicList?: number[];
  /** 顯示與示範音高的半音平移量（不影響音域檢查與換調範圍），預設 0 */
  displayTranspose?: number;
}

export interface KeyBlock {
  index: number;
  tonicMidi: number;
  key: Key;
  start: number;
  /** 該調第 1 遍音符／示範段開始時間（已跳過終止式提示和弦區段） */
  notesStart: number;
  end: number;
}

/** 取得無限循環（∞）在單調結束後應跳回的秒數（跳過 cadence 區段） */
export function infLoopSeekTarget(keyBlock: Pick<KeyBlock, 'start' | 'notesStart'>): number {
  return keyBlock.notesStart;
}

export interface NoteEvent {
  start: number;
  dur: number;
  midi: number;
  /** 滑音終點 MIDI 音高 */
  endMidi?: number;
  keyIndex: number;
  /** 第幾遍（0 起） */
  pass: number;
  phase: 'listen' | 'sing';
}

export interface ChordEvent {
  start: number;
  dur: number;
  roman: string;
  name: string;
  pcs: number[];
  role: 'pad' | 'cadence';
  keyIndex: number;
}

export interface ClickEvent {
  t: number;
  accent: boolean;
}

export interface Exercise {
  keys: KeyBlock[];
  notes: NoteEvent[];
  chords: ChordEvent[];
  clicks: ClickEvent[];
  /** 總時長（秒） */
  total: number;
}

/** 依簡譜圖案與練習設定建立完整練習時間表 */
export function buildExercise(
  pattern: PatternDef | { jianpu: string; chords: string },
  opts: ExerciseOptions,
): Exercise {
  const {
    startTonic,
    low,
    high,
    bpm,
    noteBeats = 1,
    repeats = 1,
    articulation = 'legato',
    transpose = 'fixed',
    cadence = false,
    countInBeats = 4,
    restBeats = 1,
    mode = 'follow',
  } = opts;

  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) {
    throw new Error('速度（BPM）必須介於 30 至 300 之間');
  }

  const parsed = parseJianpu(pattern.jianpu);
  const semitones = parsed.events
    .map((e) => e.semitone)
    .filter((s): s is number => s !== null);
  const minSemi = semitones.length > 0 ? Math.min(...semitones) : 0;
  const maxSemi = semitones.length > 0 ? Math.max(...semitones) : 0;

  const hasTonicList = Array.isArray(opts.tonicList) && opts.tonicList.length > 0;
  if (!hasTonicList) {
    if (startTonic + minSemi < low || startTonic + maxSemi > high) {
      throw new Error('此練習超出音域；請降低起始音，或擴大音域');
    }
  } else {
    for (const t of opts.tonicList!) {
      if (t + minSemi < low || t + maxSemi > high) {
        throw new Error('此練習超出音域；請降低起始音，或擴大音域');
      }
    }
  }

  const chordRomans = pattern.chords
    .trim()
    .split(/[\s\u3000]+/)
    .filter(Boolean);
  const firstRoman = chordRomans[0];
  const resolvedKeyMode: KeyMode =
    opts.keyMode ??
    (firstRoman && parseRoman(firstRoman).isMinor ? 'minor' : 'major');

  // 計算換調主音序列
  const tonicMidis: number[] = [];
  if (hasTonicList) {
    tonicMidis.push(...opts.tonicList!);
  } else if (transpose === 'fixed') {
    tonicMidis.push(startTonic);
  } else {
    for (let t = startTonic; t + maxSemi <= high; t += 1) {
      tonicMidis.push(t);
    }
    if (transpose === 'up-down' && tonicMidis.length > 1) {
      const down = tonicMidis.slice(0, -1).reverse();
      tonicMidis.push(...down);
    }
  }

  const beatSec = 60 / bpm;
  const keys: KeyBlock[] = [];
  const notes: NoteEvent[] = [];
  const chords: ChordEvent[] = [];
  const clicks: ClickEvent[] = [];

  let tCursor = 0;

  // 預備拍
  for (let i = 0; i < countInBeats; i++) {
    clicks.push({ t: tCursor + i * beatSec, accent: i === 0 });
  }
  tCursor += countInBeats * beatSec;

  const totalPatternBeats = parsed.events.reduce((sum, e) => sum + e.beats, 0);
  const passDur = totalPatternBeats * noteBeats * beatSec;
  const isStaccato = articulation === 'staccato' || parsed.staccato;
  const displayTranspose =
    typeof opts.displayTranspose === 'number' &&
    Number.isFinite(opts.displayTranspose)
      ? Math.round(opts.displayTranspose)
      : 0;

  for (let keyIndex = 0; keyIndex < tonicMidis.length; keyIndex++) {
    const tonicMidi = tonicMidis[keyIndex]! + displayTranspose;
    const key: Key = {
      tonicPc: ((tonicMidi % 12) + 12) % 12,
      mode: resolvedKeyMode,
    };
    const keyStart = tCursor;

    const cadenceMode: CadenceMode =
      cadence === true
        ? 'double'
        : cadence === 'double' || cadence === 'single'
          ? cadence
          : 'off';

    if (cadenceMode === 'double') {
      const cadenceSteps: ReadonlyArray<{ roman: string; beats: number }> =
        resolvedKeyMode === 'minor'
          ? [
              { roman: 'i', beats: 2 },
              { roman: 'V/7', beats: 1 },
            ]
          : [
              { roman: 'I', beats: 2 },
              { roman: 'V/7', beats: 1 },
            ];
      for (const step of cadenceSteps) {
        const dur = step.beats * beatSec;
        chords.push({
          start: tCursor,
          dur,
          roman: step.roman,
          name: chordName(step.roman, key),
          pcs: chordPitchClasses(step.roman, key),
          role: 'cadence',
          keyIndex,
        });
        tCursor += dur;
      }
      tCursor += beatSec; // 1 拍空（吸氣預備拍）
    } else if (cadenceMode === 'single') {
      // 1 拍極速不斷拍：只彈 1 拍新調一級和弦，下一拍直接開唱
      const roman = resolvedKeyMode === 'minor' ? 'i' : 'I';
      chords.push({
        start: tCursor,
        dur: beatSec,
        roman,
        name: chordName(roman, key),
        pcs: chordPitchClasses(roman, key),
        role: 'cadence',
        keyIndex,
      });
      tCursor += beatSec;
    }

    const notesStart = tCursor;

    const emitPass = (pass: number, phase: 'listen' | 'sing') => {
      if (chordRomans.length > 0) {
        const chordDur = passDur / chordRomans.length;
        for (let ci = 0; ci < chordRomans.length; ci++) {
          const roman = chordRomans[ci]!;
          chords.push({
            start: tCursor + ci * chordDur,
            dur: chordDur,
            roman,
            name: chordName(roman, key),
            pcs: chordPitchClasses(roman, key),
            role: 'pad',
            keyIndex,
          });
        }
      }

      let noteCursor = tCursor;
      for (let ei = 0; ei < parsed.events.length; ei++) {
        const ev = parsed.events[ei]!;
        const evDur = ev.beats * noteBeats * beatSec;
        if (ev.semitone !== null) {
          const midi = tonicMidi + ev.semitone;
          const dur = isStaccato ? evDur * 0.5 : evDur;
          const nextEv = ev.glideToNext ? parsed.events[ei + 1] : undefined;
          const endMidi =
            nextEv && nextEv.semitone !== null
              ? tonicMidi + nextEv.semitone
              : undefined;
          notes.push({
            start: noteCursor,
            dur,
            midi,
            ...(endMidi !== undefined ? { endMidi } : {}),
            keyIndex,
            pass,
            phase,
          });
        }
        noteCursor += evDur;
      }

      tCursor += passDur;
    };

    if (mode === 'listen-then-sing') {
      emitPass(0, 'listen');
    }
    for (let p = 0; p < repeats; p++) {
      emitPass(p, 'sing');
    }

    if (cadenceMode === 'single') {
      // 每個調結束時彈 1 拍當前調一級和弦收尾，緊接下一調開頭引導（不斷拍）
      const roman = resolvedKeyMode === 'minor' ? 'i' : 'I';
      chords.push({
        start: tCursor,
        dur: beatSec,
        roman,
        name: chordName(roman, key),
        pcs: chordPitchClasses(roman, key),
        role: 'cadence',
        keyIndex,
      });
      tCursor += beatSec;
    }

    keys.push({
      index: keyIndex,
      tonicMidi,
      key,
      start: keyStart,
      notesStart,
      end: tCursor,
    });

    if (
      cadenceMode !== 'single' &&
      keyIndex < tonicMidis.length - 1 &&
      restBeats > 0
    ) {
      tCursor += restBeats * beatSec;
    }
  }

  return {
    keys,
    notes,
    chords,
    clicks,
    total: tCursor,
  };
}
