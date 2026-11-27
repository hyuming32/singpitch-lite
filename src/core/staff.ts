import {
  LETTERS,
  MAJOR_SEMITONES,
  MINOR_SEMITONES,
  accidentalSymbol,
  keySignature,
  spell,
  type Key,
  type Letter,
  type SpelledNote,
} from './key';
import type { JianpuAccidental } from './jianpu';

export type Clef = 'treble' | 'bass';

export interface StaffPositionResult {
  /** 五線譜位置：最下線為 0，每 +1 為半格（線→間） */
  position: number;
  /** 僅在與調號不同時標示臨時升降記號 */
  accidental: JianpuAccidental;
  /** 需要加線的位置陣列 */
  ledgerLines: number[];
}

export interface KeySigPosition {
  accidental: '♯' | '♭';
  position: number;
}

const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const TREBLE_SHARP_POSITIONS = [8, 5, 9, 6, 3, 7, 4] as const;
const BASS_SHARP_POSITIONS = [6, 3, 7, 4, 1, 5, 2] as const;

const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const TREBLE_FLAT_POSITIONS = [4, 7, 3, 6, 2, 5, 1] as const;
const BASS_FLAT_POSITIONS = [2, 5, 1, 4, 0, 3, -1] as const;

/** 依音域中點決定譜號（中點 < A3(57) 用低音譜號，否則高音譜號） */
export function clefForRange(low: number, high: number): Clef {
  return (low + high) / 2 < 57 ? 'bass' : 'treble';
}

/** 計算拼寫音符的字母級數（C4 = 28） */
export function diatonicStep(spelled: SpelledNote): number {
  return LETTERS.indexOf(spelled.letter) + 7 * spelled.octave;
}

function keySigAccidentalForLetter(key: Key, letter: Letter): number {
  const sig = keySignature(key);
  if (sig.type === 'sharp') {
    const idx = SHARP_ORDER.indexOf(letter);
    return idx !== -1 && idx < sig.count ? 1 : 0;
  }
  if (sig.type === 'flat') {
    const idx = FLAT_ORDER.indexOf(letter);
    return idx !== -1 && idx < sig.count ? -1 : 0;
  }
  return 0;
}

/** 計算 MIDI 音符在五線譜上的位置、臨時記號與加線 */
export function staffPosition(
  midi: number,
  key: Key,
  clef: Clef,
): StaffPositionResult {
  const baseStep = clef === 'treble' ? 30 : 18; // 高音 E4=30，低音 G2=18
  const spelled = spell(midi, key);
  const position = diatonicStep(spelled) - baseStep;

  const ledgerLines: number[] = [];
  if (position <= -2) {
    for (let p = -2; p >= position; p -= 2) {
      ledgerLines.push(p);
    }
  } else if (position >= 10) {
    for (let p = 10; p <= position; p += 2) {
      ledgerLines.push(p);
    }
  }

  const sigAcc = keySigAccidentalForLetter(key, spelled.letter);
  const accidental: JianpuAccidental =
    spelled.accidental === sigAcc ? '' : accidentalSymbol(spelled.accidental);

  return { position, accidental, ledgerLines };
}

/** 在自然音階各音之間線性內插，計算連續演唱音高的五線譜浮點位置 */
export function sungStaffPosition(
  midiFloat: number,
  key: Key,
  clef: Clef,
): number {
  const baseStep = clef === 'treble' ? 30 : 18;
  const tonicPc = ((Math.round(key.tonicPc) % 12) + 12) % 12;
  const intervals = key.mode === 'major' ? MAJOR_SEMITONES : MINOR_SEMITONES;

  const oct = Math.floor((midiFloat - tonicPc) / 12);
  const baseTonicMidi = oct * 12 + tonicPc;
  const baseTonicStep = diatonicStep(spell(baseTonicMidi, key));

  for (let i = 0; i < 7; i++) {
    const m0 = baseTonicMidi + (intervals[i] ?? 0);
    const m1 =
      i < 6 ? baseTonicMidi + (intervals[i + 1] ?? 12) : baseTonicMidi + 12;
    if (midiFloat >= m0 && midiFloat <= m1) {
      const p0 = baseTonicStep + i - baseStep;
      const ratio = (midiFloat - m0) / (m1 - m0);
      return p0 + ratio;
    }
  }

  return baseTonicStep - baseStep;
}

/** 取得調號在五線譜上的升降記號位置列表 */
export function keySignaturePositions(
  key: Key,
  clef: Clef,
): KeySigPosition[] {
  const sig = keySignature(key);
  if (sig.type === 'none' || sig.count === 0) {
    return [];
  }
  const positions =
    sig.type === 'sharp'
      ? clef === 'treble'
        ? TREBLE_SHARP_POSITIONS
        : BASS_SHARP_POSITIONS
      : clef === 'treble'
        ? TREBLE_FLAT_POSITIONS
        : BASS_FLAT_POSITIONS;
  const symbol: '♯' | '♭' = sig.type === 'sharp' ? '♯' : '♭';
  const result: KeySigPosition[] = [];
  for (let i = 0; i < sig.count && i < positions.length; i++) {
    result.push({ accidental: symbol, position: positions[i]! });
  }
  return result;
}
