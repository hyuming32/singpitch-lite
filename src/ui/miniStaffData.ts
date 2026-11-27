import type { Key } from '../core/key';
import { toJianpu, type JianpuAccidental, type JianpuMode, type JianpuNote } from '../core/jianpu';
import { parseJianpu, type PatternDef } from '../core/patterns';
import { staffPosition } from '../core/staff';

export interface MiniStaffNote {
  x: number;
  position: number;
  accidental: JianpuAccidental;
  ledgerLines: number[];
  glideToNext: boolean;
}

export interface MiniStaffOptions {
  width?: number;
  leftPad?: number;
  rightPad?: number;
  tonicMidi?: number;
}

const C_MAJOR_KEY: Key = { tonicPc: 0, mode: 'major' };

/** 將練習圖案轉為迷你五線譜音符座標與加線資料（C 大調、高音譜號） */
export function buildMiniStaffNotes(
  pattern: Pick<PatternDef, 'jianpu' | 'glide'>,
  options: MiniStaffOptions = {},
): MiniStaffNote[] {
  const {
    width = 210,
    leftPad = 38,
    rightPad = 14,
    tonicMidi = 60,
  } = options;

  const parsed = parseJianpu(pattern.jianpu);
  const noteEvents = parsed.events.filter(
    (ev): ev is { semitone: number; beats: number; glideToNext: boolean } =>
      ev.semitone !== null,
  );

  const count = noteEvents.length;
  if (count === 0) {
    return [];
  }

  const usableWidth = Math.max(1, width - leftPad - rightPad);

  return noteEvents.map((ev, index) => {
    const x =
      count === 1
        ? leftPad + usableWidth / 2
        : leftPad + (index / (count - 1)) * usableWidth;
    const pos = staffPosition(tonicMidi + ev.semitone, C_MAJOR_KEY, 'treble');
    return {
      x: Math.round(x * 100) / 100,
      position: pos.position,
      accidental: pos.accidental,
      ledgerLines: pos.ledgerLines,
      glideToNext: ev.glideToNext || (Boolean(pattern.glide) && index < count - 1 && ev.glideToNext),
    };
  });
}

export interface JianpuDisplayToken {
  note: JianpuNote;
  beats: number;
  glideToNext: boolean;
}

/** 將圖案轉為簡譜顯示記號陣列（含高低音點、延長與滑音資訊） */
export function buildJianpuTokens(
  pattern: Pick<PatternDef, 'jianpu'>,
  tonicMidi = 60,
  key: Key = C_MAJOR_KEY,
  mode: JianpuMode = 'fixed',
): JianpuDisplayToken[] {
  const parsed = parseJianpu(pattern.jianpu);
  return parsed.events.map((ev) => {
    if (ev.semitone === null) {
      return {
        note: { digit: '0', accidental: '', octave: 0 },
        beats: ev.beats,
        glideToNext: false,
      };
    }
    return {
      note: toJianpu(tonicMidi + ev.semitone, key, mode, tonicMidi),
      beats: ev.beats,
      glideToNext: ev.glideToNext,
    };
  });
}
