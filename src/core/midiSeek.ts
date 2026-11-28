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
