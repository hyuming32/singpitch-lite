import type { Exercise, NoteEvent } from '../../core/exercise';
import type { JianpuAccidental } from '../../core/jianpu';
import { keyName, type Key } from '../../core/key';
import {
  keySignaturePositions,
  staffPosition,
  type Clef,
} from '../../core/staff';
import { glyphScale } from '../Glyph';
import { fClef, gClef } from '../musicGlyphs';

export interface PassWindow {
  keyIndex: number;
  pass: number;
  phase: 'listen' | 'sing';
  start: number;
  end: number;
}

export interface ScoreLine {
  keyIndex: number;
  pass: number;
  phase: 'listen' | 'sing';
  /** 該遍音符陣列中的半開區間 [startIdx, endIdx) */
  noteRange: readonly [number, number];
  start: number;
  end: number;
  isCurrent: boolean;
  /** 預讀行首小字（例如「下一調 E♭」、「第 2 遍」）；目前行或無需標示時為 null */
  label: string | null;
  /** 是否為同一遍的後半段（長圖案拆兩行） */
  isSamePassContinuation: boolean;
}

export interface NoteGlyph {
  x: number;
  position: number;
  accidental: JianpuAccidental;
  ledgerLines: number[];
  stemUp: boolean;
  endPosition?: number;
  midi: number;
  start: number;
  dur: number;
  endMidi?: number;
}

export interface StaffVerticalMetrics {
  stepY: number;
  lineSpacing: number;
  baseY: number;
  chordY: number;
}

/** 依練習時間表整理出所有（調性 × 遍數 × 階段）的顯示視窗 */
export function listPassWindows(ex: Exercise): PassWindow[] {
  if (ex.notes.length === 0) {
    return [];
  }

  const groups: {
    keyIndex: number;
    pass: number;
    phase: 'listen' | 'sing';
    notes: NoteEvent[];
  }[] = [];

  for (const n of ex.notes) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.keyIndex === n.keyIndex &&
      last.pass === n.pass &&
      last.phase === n.phase
    ) {
      last.notes.push(n);
    } else {
      groups.push({
        keyIndex: n.keyIndex,
        pass: n.pass,
        phase: n.phase,
        notes: [n],
      });
    }
  }

  return groups.map((g, idx) => {
    const start = g.notes[0]!.start;
    const next = groups[idx + 1];
    const keyBlock = ex.keys[g.keyIndex];
    let end: number;
    if (next && next.keyIndex === g.keyIndex) {
      end = next.notes[0]!.start;
    } else if (keyBlock) {
      end = keyBlock.end;
    } else {
      const lastNote = g.notes[g.notes.length - 1]!;
      end = lastNote.start + lastNote.dur;
    }
    return {
      keyIndex: g.keyIndex,
      pass: g.pass,
      phase: g.phase,
      start,
      end: Math.max(end, start + 0.01),
    };
  });
}

/** 取得指定秒數所在的練唱視窗；若在預備拍或換調空檔則回傳最接近的目標視窗 */
export function passWindow(ex: Exercise, sec: number): PassWindow | null {
  const windows = listPassWindows(ex);
  if (windows.length === 0) {
    return null;
  }

  if (sec < windows[0]!.start) {
    return windows[0]!;
  }

  for (const w of windows) {
    if (sec >= w.start && sec < w.end) {
      return w;
    }
  }

  for (let i = 0; i < windows.length - 1; i++) {
    const curr = windows[i]!;
    const next = windows[i + 1]!;
    if (sec >= curr.end && sec < next.start) {
      return next;
    }
  }

  return windows[windows.length - 1]!;
}

/** 將時間秒數線性對應至水平像素座標 [left, right] */
export function timeToX(
  t: number,
  windowStart: number,
  windowEnd: number,
  left: number,
  right: number,
): number {
  if (windowEnd <= windowStart || right <= left) {
    return left;
  }
  const ratio = (t - windowStart) / (windowEnd - windowStart);
  return left + ratio * (right - left);
}

/** 依線距與譜號字形 bbox 計算譜號與調號的水平起點 */
export function staffHeaderLayout(lineSpacing: number, clef: Clef = 'treble') {
  const clefGlyph = clef === 'bass' ? fClef : gClef;
  const scale = glyphScale(lineSpacing, clefGlyph.unitsPerEm);
  const clefLeft = Math.max(8, 0.75 * lineSpacing);
  const clefX = clefLeft - clefGlyph.bbox.x1 * scale;
  const clefWidth = (clefGlyph.bbox.x2 - clefGlyph.bbox.x1) * scale;
  const keySigStart = clefLeft + clefWidth + 0.4 * lineSpacing;
  const keySigStep = 1.05 * lineSpacing;
  return { clefLeft, clefX, clefWidth, keySigStart, keySigStep };
}

/** 依譜號、調號數量與線距計算五線譜左側保留寬度（含半個符頭寬） */
export function staffLeftPad(
  key: Key,
  clef: Clef,
  lineSpacing = 12,
): number {
  const sigCount = keySignaturePositions(key, clef).length;
  const { keySigStart, keySigStep } = staffHeaderLayout(lineSpacing, clef);
  const halfNoteWidth = 0.65 * lineSpacing;
  const gapAfterSig = sigCount > 0 ? 0.65 * lineSpacing : 0.35 * lineSpacing;
  return Math.ceil(
    keySigStart + sigCount * keySigStep + gapAfterSig + halfNoteWidth,
  );
}

/** 計算五線譜垂直比例與基準線位置，確保譜號、加線、符桿與和弦標記皆不裁切 */
export function computeStaffMetrics(
  positions: readonly { position: number; endPosition?: number }[],
  height: number,
  isTablet: boolean,
): StaffVerticalMetrics {
  // 基準範圍至少涵蓋上下加線各 2 條（pos = -4 音符下緣 -5 至 pos = +12 音符上緣 +13）與高音譜號完整 bbox
  let minPos = -5;
  let maxPos = 13;

  for (const p of positions) {
    const pos = p.position;
    const stemTip = pos < 4 ? pos + 7 : pos - 7;
    minPos = Math.min(minPos, pos - 1, stemTip);
    maxPos = Math.max(maxPos, pos + 1, stemTip);
    if (p.endPosition !== undefined) {
      minPos = Math.min(minPos, p.endPosition - 1);
      maxPos = Math.max(maxPos, p.endPosition + 1);
    }
  }

  // 和弦標記專用上方空間（位於 SVG 頂部，第五線與高音符桿上方）
  const chordLane = isTablet ? 24 : 16;
  const bottomMargin = isTablet ? 10 : 6;
  const usable = Math.max(18, height - chordLane - bottomMargin);
  const defaultStep = isTablet ? 9 : 7;
  const span = Math.max(18, maxPos - minPos);
  const stepY = Math.min(defaultStep, usable / span);

  const centerPos = (minPos + maxPos) / 2;
  const centerY = chordLane + usable / 2;
  const baseY = centerY + centerPos * stepY;

  return {
    stepY,
    lineSpacing: stepY * 2,
    baseY,
    chordY: isTablet ? 15 : 11,
  };
}

/** 計算目前視窗內每個音符的五線譜繪製資料 */
export function noteGlyphs(
  ex: Exercise,
  win: Pick<PassWindow, 'keyIndex' | 'pass' | 'phase' | 'start' | 'end'>,
  key: Key,
  clef: Clef,
  width: number,
  leftPad?: number,
  rightPad = 18,
  lineSpacing = 12,
  noteRange?: readonly [number, number],
): NoteGlyph[] {
  const left = leftPad ?? staffLeftPad(key, clef, lineSpacing);
  const right = Math.max(left + 1, width - rightPad);

  const allWinNotes = ex.notes.filter(
    (n) =>
      n.keyIndex === win.keyIndex &&
      n.pass === win.pass &&
      n.phase === win.phase,
  );
  const winNotes = noteRange
    ? allWinNotes.slice(noteRange[0], noteRange[1])
    : allWinNotes;

  return winNotes.map((n) => {
    const x = timeToX(n.start, win.start, win.end, left, right);
    const sp = staffPosition(n.midi, key, clef);
    const endPosition =
      n.endMidi !== undefined
        ? staffPosition(n.endMidi, key, clef).position
        : undefined;

    return {
      x,
      position: sp.position,
      accidental: sp.accidental,
      ledgerLines: sp.ledgerLines,
      stemUp: sp.position < 4,
      ...(endPosition !== undefined ? { endPosition } : {}),
      midi: n.midi,
      start: n.start,
      dur: n.dur,
      ...(n.endMidi !== undefined ? { endMidi: n.endMidi } : {}),
    };
  });
}

/** 找出目前秒數正在播放／演唱的音符索引；若不在任何音符區間內回傳 -1 */
export function currentNoteIndex(
  notes: readonly { start: number; dur: number }[],
  sec: number,
): number {
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    if (sec >= n.start && sec < n.start + n.dur) {
      return i;
    }
  }
  return -1;
}

/** 計算預備拍倒數點狀態（進入第一個調性前顯示） */
export function countInDotStates(
  ex: Exercise,
  sec: number,
): { active: boolean; dots: boolean[] } {
  if (ex.clicks.length === 0 || ex.keys.length === 0) {
    return { active: false, dots: [] };
  }
  const firstKeyStart = ex.keys[0]!.start;
  if (sec >= firstKeyStart - 0.001) {
    return { active: false, dots: [] };
  }
  const dots = ex.clicks.map((c) => sec >= c.t - 0.001);
  return { active: true, dots };
}

/** 計算對音鋼琴的鍵盤範圍（兩端皆對齊 C，手機至少 2 個八度、平板至少 3 個八度） */
export function keyboardRange(
  exerciseLow: number,
  exerciseHigh: number,
  device: 'phone' | 'tablet',
): { low: number; high: number } {
  let low = Math.floor((exerciseLow - 2) / 12) * 12;
  let high = Math.ceil((exerciseHigh + 2) / 12) * 12;

  const minSemitones = (device === 'tablet' ? 3 : 2) * 12;
  let expandDown = true;

  while (high - low < minSemitones) {
    if (expandDown && low - 12 >= 24) {
      low -= 12;
    } else if (high + 12 <= 108) {
      high += 12;
    } else if (low - 12 >= 24) {
      low -= 12;
    } else {
      break;
    }
    expandDown = !expandDown;
  }

  return { low, high };
}

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

/** 判斷 MIDI 音高是否為鋼琴黑鍵 */
export function isBlackKey(midi: number): boolean {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return BLACK_PCS.has(pc);
}

/** 計算單一整數 MIDI 音鍵中心在鍵盤寬度中的正規化位置（0..1） */
function integerKeyCenterNorm(midi: number, low: number, high: number): number {
  const whiteMidis: number[] = [];
  for (let m = low; m <= high; m++) {
    if (!isBlackKey(m)) {
      whiteMidis.push(m);
    }
  }
  const whiteCount = whiteMidis.length;
  if (whiteCount === 0) {
    return 0.5;
  }

  if (!isBlackKey(midi)) {
    const idx = whiteMidis.indexOf(midi);
    if (idx !== -1) {
      return (idx + 0.5) / whiteCount;
    }
  } else {
    const leftWhiteIdx = whiteMidis.indexOf(midi - 1);
    if (leftWhiteIdx !== -1) {
      return (leftWhiteIdx + 1) / whiteCount;
    }
  }

  return midi <= low ? 0 : 1;
}

/** 依浮點 MIDI 音高內插計算鋼琴黃色指針的水平百分比（0..100） */
export function pianoNeedlePercent(
  midiFloat: number,
  low: number,
  high: number,
): number | null {
  if (!Number.isFinite(midiFloat)) {
    return null;
  }
  if (midiFloat < low - 0.5 || midiFloat > high + 0.5) {
    return null;
  }

  const clamped = Math.max(low, Math.min(high, midiFloat));
  const m0 = Math.floor(clamped);
  const m1 = Math.ceil(clamped);

  const c0 = integerKeyCenterNorm(m0, low, high);
  if (m0 === m1) {
    return c0 * 100;
  }
  const c1 = integerKeyCenterNorm(m1, low, high);
  const frac = clamped - m0;
  return (c0 * (1 - frac) + c1 * frac) * 100;
}

/** 取得首調簡譜標記用的主音名稱（例："D"、"B♭"） */
export function tonicLabel(key: Key): string {
  return keyName(key).split(' ')[0] ?? 'C';
}

const LONG_PASS_NOTE_THRESHOLD = 12;

interface InternalSegment {
  keyIndex: number;
  pass: number;
  phase: 'listen' | 'sing';
  noteRange: readonly [number, number];
  start: number;
  end: number;
  isSamePassContinuation: boolean;
}

function buildPreviewLabel(
  ex: Exercise,
  curr: InternalSegment,
  next: InternalSegment,
): string | null {
  if (next.keyIndex !== curr.keyIndex) {
    const nextKey = ex.keys[next.keyIndex]?.key;
    return nextKey ? `下一調 ${tonicLabel(nextKey)}` : '下一調';
  }
  if (next.pass !== curr.pass || next.phase !== curr.phase) {
    return next.phase === 'listen' ? '示範' : `第 ${next.pass + 1} 遍`;
  }
  return null;
}

/**
 * 規劃樂譜要顯示的 1 或 2 行內容（翻頁式交替，不整片滾動）：
 * - 單行空間：只回傳目前這一遍
 * - 雙行空間：
 *   - 音數 ≤ 12：目前遍 + 下一遍（或下一調）預讀
 *   - 音數 > 12：拆成前半與後半兩行，唱完第一行接到第二行並翻頁更新第一行
 */
export function scoreLines(
  ex: Exercise,
  sec: number,
  maxLines: number,
): ScoreLine[] {
  const windows = listPassWindows(ex);
  if (windows.length === 0) {
    return [];
  }

  const activeWin = passWindow(ex, sec);
  if (!activeWin) {
    return [];
  }

  if (maxLines <= 1) {
    const count = ex.notes.filter(
      (n) =>
        n.keyIndex === activeWin.keyIndex &&
        n.pass === activeWin.pass &&
        n.phase === activeWin.phase,
    ).length;
    return [
      {
        keyIndex: activeWin.keyIndex,
        pass: activeWin.pass,
        phase: activeWin.phase,
        noteRange: [0, count],
        start: activeWin.start,
        end: activeWin.end,
        isCurrent: true,
        label: null,
        isSamePassContinuation: false,
      },
    ];
  }

  const segments: InternalSegment[] = [];
  for (const w of windows) {
    const winNotes = ex.notes.filter(
      (n) =>
        n.keyIndex === w.keyIndex && n.pass === w.pass && n.phase === w.phase,
    );
    if (winNotes.length > LONG_PASS_NOTE_THRESHOLD) {
      const mid = Math.ceil(winNotes.length / 2);
      const splitTime = Math.max(w.start + 0.005, winNotes[mid]!.start);
      segments.push({
        keyIndex: w.keyIndex,
        pass: w.pass,
        phase: w.phase,
        noteRange: [0, mid],
        start: w.start,
        end: splitTime,
        isSamePassContinuation: false,
      });
      segments.push({
        keyIndex: w.keyIndex,
        pass: w.pass,
        phase: w.phase,
        noteRange: [mid, winNotes.length],
        start: splitTime,
        end: Math.max(w.end, splitTime + 0.01),
        isSamePassContinuation: true,
      });
    } else {
      segments.push({
        keyIndex: w.keyIndex,
        pass: w.pass,
        phase: w.phase,
        noteRange: [0, winNotes.length],
        start: w.start,
        end: w.end,
        isSamePassContinuation: false,
      });
    }
  }

  let activeSegIdx = segments.findIndex(
    (s) =>
      s.keyIndex === activeWin.keyIndex &&
      s.pass === activeWin.pass &&
      s.phase === activeWin.phase &&
      sec >= s.start &&
      sec < s.end,
  );

  if (activeSegIdx === -1) {
    activeSegIdx = segments.findIndex(
      (s) =>
        s.keyIndex === activeWin.keyIndex &&
        s.pass === activeWin.pass &&
        s.phase === activeWin.phase,
    );
    if (activeSegIdx === -1) {
      activeSegIdx = 0;
    } else if (
      segments[activeSegIdx + 1]?.isSamePassContinuation &&
      sec >= segments[activeSegIdx + 1]!.start
    ) {
      activeSegIdx += 1;
    }
  }

  const curr = segments[activeSegIdx]!;
  const next = segments[activeSegIdx + 1] ?? null;

  const currLine: ScoreLine = {
    ...curr,
    isCurrent: true,
    label: null,
  };

  if (!next) {
    return [currLine];
  }

  const nextLine: ScoreLine = {
    ...next,
    isCurrent: false,
    label: buildPreviewLabel(ex, curr, next),
  };

  // 翻頁式交替：偶數段在第一行唱、第二行預讀；奇數段在第二行唱、第一行更新為再下一段預讀
  if (activeSegIdx % 2 === 0) {
    return [currLine, nextLine];
  }
  return [nextLine, currLine];
}

/** 依新舊 BPM 等比換算播放秒數（以拍為單位維持相同位置） */
export function rescaleTime(
  sec: number,
  oldBpm: number,
  newBpm: number,
): number {
  if (
    !Number.isFinite(sec) ||
    !Number.isFinite(oldBpm) ||
    !Number.isFinite(newBpm) ||
    oldBpm <= 0 ||
    newBpm <= 0
  ) {
    return Math.max(0, sec || 0);
  }
  return Math.max(0, (sec * oldBpm) / newBpm);
}

/**
 * 計算播放列中間音型名稱的自動字級（px）：
 * - 最大字高 = barHeight × 0.70
 * - 實際字級 = min(最大, availableWidth / (charCount × 1.08))
 * - 最小字高 = 最大 × 0.45
 */
export function computePatternTitleFontSize(
  availableWidth: number,
  charCount: number,
  barHeight: number,
): number {
  const safeBarH = Number.isFinite(barHeight) && barHeight > 0 ? barHeight : 30;
  const maxFont = safeBarH * 0.7;
  const minFont = maxFont * 0.45;
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return maxFont;
  }
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return minFont;
  }
  const fitted = availableWidth / (charCount * 1.08);
  return Math.max(minFont, Math.min(maxFont, fitted));
}
