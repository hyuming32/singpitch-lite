import type { LyricLine } from './lyrics';
import type { MidiScoreBar } from './midiScore';

/** 依單遍相對秒數找出目前所屬的小節資訊 */
export function findBarAtPassSec(
  scoreBars: readonly MidiScoreBar[],
  passSec: number,
): MidiScoreBar | null {
  if (scoreBars.length === 0) return null;
  if (passSec <= scoreBars[0]!.startSec) {
    return scoreBars[0]!;
  }
  for (let i = 0; i < scoreBars.length; i++) {
    const bar = scoreBars[i]!;
    if (passSec < bar.endSec - 1e-6) {
      return bar;
    }
  }
  return scoreBars[scoreBars.length - 1]!;
}

/** 將目標單遍秒數對齊到距離最近的一拍起點 */
export function snapPassSecToNearestBeat(
  scoreBars: readonly MidiScoreBar[],
  targetPassSec: number,
): number {
  if (scoreBars.length === 0) {
    return Math.max(0, targetPassSec);
  }

  let bestBeat = scoreBars[0]!.beatStartSecs[0] ?? scoreBars[0]!.startSec;
  let bestDist = Infinity;

  for (const bar of scoreBars) {
    const beats =
      bar.beatStartSecs.length > 0 ? bar.beatStartSecs : [bar.startSec];
    for (const bt of beats) {
      const dist = Math.abs(bt - targetPassSec);
      if (dist < bestDist) {
        bestDist = dist;
        bestBeat = bt;
      }
    }
  }

  return Math.max(0, bestBeat);
}

/** 將進度拉桿比例（0..1）換算為單遍秒數 */
export function seekRatioToPassSec(
  ratio: number,
  totalPassDur: number,
): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(totalPassDur) || totalPassDur <= 0) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  return clamped * totalPassDur;
}

/** 將單遍秒數換算為進度拉桿比例（0..1） */
export function passSecToSeekRatio(
  passSec: number,
  totalPassDur: number,
): number {
  if (!Number.isFinite(passSec) || !Number.isFinite(totalPassDur) || totalPassDur <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, passSec / totalPassDur));
}

/** 格式化進度時間字串 M:SS */
export function formatSeekTime(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

/** 依單遍相對秒數取得拖動預覽要顯示的該行歌詞開頭幾個字 */
export function findLyricPreviewAtPassSec(
  lines: readonly LyricLine[],
  passSec: number,
  maxChars = 10,
): string {
  if (lines.length === 0) return '';

  let chosen = lines[0]!;
  if (passSec >= lines[0]!.time) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.time <= passSec + 0.05) {
        chosen = line;
      } else {
        break;
      }
    }
  }

  const trimmed = chosen.text.trim();
  if (!trimmed) return '';
  const chars = [...trimmed];
  if (chars.length <= maxChars) {
    return trimmed;
  }
  return `${chars.slice(0, maxChars).join('')}…`;
}

export interface VocalStartSeekInfo {
  /** 第一個主唱音所在的小節編號（1 起算） */
  barNumber: number;
  /** 該小節開頭相對於單遍起點的秒數 */
  barStartPassSec: number;
  /** 第一個主唱音相對於單遍起點的秒數 */
  firstNotePassSec: number;
  /** 第一個主唱音在進度拉桿上的正規化位置（0..1） */
  ratio: number;
}

/** 計算單遍區間內第一個主唱音的位置與對應跳轉小節起點 */
export function computeVocalStartSeekInfo(
  scoreBars: readonly MidiScoreBar[],
  totalPassDur: number,
): VocalStartSeekInfo | null {
  if (
    scoreBars.length === 0 ||
    !Number.isFinite(totalPassDur) ||
    totalPassDur <= 0
  ) {
    return null;
  }
  for (const bar of scoreBars) {
    for (const ev of bar.events) {
      if (ev.kind === 'note') {
        return {
          barNumber: bar.barNumber,
          barStartPassSec: bar.startSec,
          firstNotePassSec: ev.startSec,
          ratio: passSecToSeekRatio(ev.startSec, totalPassDur),
        };
      }
    }
  }
  return null;
}

/** 計算每行歌詞起點在進度拉桿上的正規化位置（0..1） */
export function computeSeekLyricTicks(
  lines: readonly LyricLine[],
  totalPassDur: number,
): number[] {
  if (lines.length === 0 || !Number.isFinite(totalPassDur) || totalPassDur <= 0) {
    return [];
  }
  const ticks: number[] = [];
  for (const line of lines) {
    const ratio = passSecToSeekRatio(line.time, totalPassDur);
    if (ticks.length === 0 || Math.abs(ratio - ticks[ticks.length - 1]!) > 0.002) {
      ticks.push(ratio);
    }
  }
  return ticks;
}

/** 將練習時間軸的絕對秒數對齊至所在遍內距離最近的一拍起點 */
export function snapAbsSecToNearestBeat(params: {
  targetAbsSec: number;
  totalSec: number;
  scoreBars: readonly MidiScoreBar[];
  passWindows: readonly { start: number; end: number }[];
}): number {
  const { targetAbsSec, totalSec, scoreBars, passWindows } = params;
  const safeTotal = Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0;
  const clamped = Math.max(
    0,
    Math.min(safeTotal, Number.isFinite(targetAbsSec) ? targetAbsSec : 0),
  );
  if (passWindows.length === 0) {
    return Math.max(
      0,
      Math.min(safeTotal, snapPassSecToNearestBeat(scoreBars, clamped)),
    );
  }

  const firstWin = passWindows[0]!;
  if (clamped < firstWin.start) {
    return clamped < firstWin.start * 0.5 ? 0 : firstWin.start;
  }

  let activeWin = passWindows[passWindows.length - 1]!;
  for (const w of passWindows) {
    if (clamped >= w.start && clamped < w.end) {
      activeWin = w;
      break;
    }
  }

  const snappedPass = snapPassSecToNearestBeat(
    scoreBars,
    clamped - activeWin.start,
  );
  return Math.max(0, Math.min(safeTotal, activeWin.start + snappedPass));
}

export interface MidiLoopBars {
  loopStartBar?: number;
  loopEndBar?: number;
}

export interface MidiLoopRangeSec {
  /** A 點小節號（1 起算） */
  startBar: number;
  /** B 點小節號（1 起算，必 >= startBar） */
  endBar: number;
  /** A 點起點相對於單遍開頭的秒數 */
  startPassSec: number;
  /** B 點結束相對於單遍開頭的秒數 */
  endPassSec: number;
}

/** 正規化 A–B 小節號：捨棄非整數與超出範圍者，若 B < A 則自動對調 */
export function normalizeMidiLoopBars(
  loopStartBar: number | undefined,
  loopEndBar: number | undefined,
  minBar: number,
  maxBar: number,
): MidiLoopBars {
  const safeMin = Math.max(1, Math.round(minBar));
  const safeMax = Math.max(safeMin, Math.round(maxBar));
  const valid = (v: number | undefined): number | undefined =>
    typeof v === 'number' &&
    Number.isFinite(v) &&
    Number.isInteger(v) &&
    v >= safeMin &&
    v <= safeMax
      ? v
      : undefined;

  let a = valid(loopStartBar);
  let b = valid(loopEndBar);
  if (a !== undefined && b !== undefined && b < a) {
    [a, b] = [b, a];
  }
  return {
    ...(a !== undefined ? { loopStartBar: a } : {}),
    ...(b !== undefined ? { loopEndBar: b } : {}),
  };
}

/** 播放列 A／B 按鈕切換邏輯：未設時設為目前小節（若 B < A 自動對調），已設時再按一次清除 */
export function toggleMidiLoopPoint(
  current: MidiLoopBars,
  point: 'A' | 'B',
  currentBar: number,
  minBar: number,
  maxBar: number,
): MidiLoopBars {
  const norm = normalizeMidiLoopBars(
    current.loopStartBar,
    current.loopEndBar,
    minBar,
    maxBar,
  );
  const safeMin = Math.max(1, Math.round(minBar));
  const safeMax = Math.max(safeMin, Math.round(maxBar));
  const clampedBar = Math.max(
    safeMin,
    Math.min(safeMax, Math.round(currentBar)),
  );

  if (point === 'A') {
    if (norm.loopStartBar !== undefined) {
      return normalizeMidiLoopBars(undefined, norm.loopEndBar, minBar, maxBar);
    }
    return normalizeMidiLoopBars(clampedBar, norm.loopEndBar, minBar, maxBar);
  }

  if (norm.loopEndBar !== undefined) {
    return normalizeMidiLoopBars(norm.loopStartBar, undefined, minBar, maxBar);
  }
  return normalizeMidiLoopBars(norm.loopStartBar, clampedBar, minBar, maxBar);
}

/** 譜面長按小節設定 A–B：無 A→設 A；有 A 無 B→設 B（自動對調）；兩者都有→重設 A 並清 B */
export function applyScoreBarLongPressLoop(
  current: MidiLoopBars,
  barNumber: number,
  minBar: number,
  maxBar: number,
): MidiLoopBars {
  const norm = normalizeMidiLoopBars(
    current.loopStartBar,
    current.loopEndBar,
    minBar,
    maxBar,
  );
  const safeMin = Math.max(1, Math.round(minBar));
  const safeMax = Math.max(safeMin, Math.round(maxBar));
  const clampedBar = Math.max(
    safeMin,
    Math.min(safeMax, Math.round(barNumber)),
  );

  if (norm.loopStartBar !== undefined && norm.loopEndBar !== undefined) {
    return { loopStartBar: clampedBar };
  }
  if (norm.loopStartBar === undefined && norm.loopEndBar === undefined) {
    return { loopStartBar: clampedBar };
  }
  if (norm.loopStartBar !== undefined) {
    return normalizeMidiLoopBars(norm.loopStartBar, clampedBar, minBar, maxBar);
  }
  return normalizeMidiLoopBars(clampedBar, norm.loopEndBar, minBar, maxBar);
}

/** 將 A–B 小節號對照 scoreBars 解析為單遍相對起訖秒數（僅 A、B 皆有效時回傳） */
export function resolveMidiLoopRangeSec(
  scoreBars: readonly MidiScoreBar[],
  loopStartBar?: number,
  loopEndBar?: number,
): MidiLoopRangeSec | null {
  if (
    scoreBars.length === 0 ||
    loopStartBar === undefined ||
    loopEndBar === undefined
  ) {
    return null;
  }
  const minBar = scoreBars[0]!.barNumber;
  const maxBar = scoreBars[scoreBars.length - 1]!.barNumber;
  const norm = normalizeMidiLoopBars(loopStartBar, loopEndBar, minBar, maxBar);
  if (norm.loopStartBar === undefined || norm.loopEndBar === undefined) {
    return null;
  }
  const startBarObj = scoreBars.find((b) => b.barNumber === norm.loopStartBar);
  const endBarObj = scoreBars.find((b) => b.barNumber === norm.loopEndBar);
  if (!startBarObj || !endBarObj) {
    return null;
  }
  const startPassSec = startBarObj.startSec;
  const endPassSec = endBarObj.endSec;
  if (endPassSec <= startPassSec) {
    return null;
  }
  return {
    startBar: startBarObj.barNumber,
    endBar: endBarObj.barNumber,
    startPassSec,
    endPassSec,
  };
}

/** 決定 A–B 檢查應歸屬哪一個 pass（優先使用 prevSec 所在 pass，避免跨過最後一小節時漏判） */
export function findPassWindowForLoopCheck<
  T extends { start: number; end: number },
>(passWindows: readonly T[], prevSec: number, sec: number): T | null {
  if (passWindows.length === 0) return null;
  for (const w of passWindows) {
    if (prevSec >= w.start && prevSec < w.end) {
      return w;
    }
  }
  for (const w of passWindows) {
    if (sec >= w.start && sec < w.end) {
      return w;
    }
  }
  if (sec < passWindows[0]!.start) {
    return passWindows[0]!;
  }
  return passWindows[passWindows.length - 1]!;
}

export interface LoopBackCheckParams {
  /** 目前播放絕對秒數 */
  sec: number;
  /** 上一次位置或手動 seek 設定的絕對秒數 */
  prevSec: number;
  /** A–B 單遍秒數範圍 */
  loopRange: MidiLoopRangeSec;
  /** 目前所在遍的起始絕對秒數 */
  passStartSec: number;
  /** 提前觸發秒數（預設 0.03s ≈ 30ms，避免聽到 B 之後的音） */
  leadSec?: number;
}

export interface LoopBackDecision {
  shouldLoop: boolean;
  targetAbsSec: number;
}

/**
 * 判斷播放位置是否抵達 B 結束點而應跳回 A 起點：
 * - 從 A 之前開始播時，正常播進 A–B 並在跨越 B 結束前（提前 leadSec）跳回 A
 * - 手動 seek 到 B 之後時，prevSec >= triggerSec，不強制拉回，直到進入下一遍或手動回到範圍
 */
export function shouldLoopBack(params: LoopBackCheckParams): LoopBackDecision {
  const { sec, prevSec, loopRange, passStartSec, leadSec = 0.03 } = params;
  const absStart = passStartSec + loopRange.startPassSec;
  const absEnd = passStartSec + loopRange.endPassSec;
  if (
    !Number.isFinite(sec) ||
    !Number.isFinite(prevSec) ||
    !Number.isFinite(absStart) ||
    !Number.isFinite(absEnd) ||
    absEnd <= absStart
  ) {
    return { shouldLoop: false, targetAbsSec: absStart };
  }

  const effectiveLead = Math.min(
    Math.max(0, leadSec),
    (absEnd - absStart) * 0.25,
  );
  const triggerSec = absEnd - effectiveLead;
  const shouldLoop =
    prevSec < triggerSec &&
    sec >= triggerSec &&
    sec <= absEnd + 0.5;

  return {
    shouldLoop,
    targetAbsSec: absStart,
  };
}
