import { describe, expect, it } from 'vitest';
import { buildExercise } from '../../core/exercise';
import { toJianpu, formatJianpu } from '../../core/jianpu';
import type { Key } from '../../core/key';
import { RANGES } from '../../core/notes';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { clefForRange } from '../../core/staff';
import {
  computePatternTitleFontSize,
  currentNoteIndex,
  keyboardRange,
  noteGlyphs,
  passWindow,
  pianoNeedlePercent,
  rescaleTime,
  scoreLines,
  staffLeftPad,
} from '../practice/layout';
import { metronomeAngle, weightY } from '../practice/MetronomeIcon';
import { formatTransposeOffset } from '../practice/TransportBar';

describe('practice layout', () => {
  it('大三和弦分解 D 大調於第 2.1 秒的視窗、目前音與五線譜位置正確', () => {
    const majorArpeggio = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const ex = buildExercise(majorArpeggio, {
      startTonic: 62, // D4
      low: 48,
      high: 84,
      bpm: 120,
      noteBeats: 1,
      repeats: 1,
      transpose: 'fixed',
      countInBeats: 4,
      mode: 'follow',
    });

    const win = passWindow(ex, 2.1);
    expect(win).not.toBeNull();
    expect(win!.keyIndex).toBe(0);
    expect(win!.pass).toBe(0);
    expect(win!.phase).toBe('sing');

    const key: Key = ex.keys[0]!.key;
    const width = 700;
    const left = staffLeftPad(key, 'treble');
    const glyphs = noteGlyphs(ex, win!, key, 'treble', width, left);

    expect(currentNoteIndex(glyphs, 2.1)).toBe(0);
    expect(glyphs.map((g) => g.position)).toEqual([-1, 1, 3, 6, 3, 1, -1]);

    for (let i = 0; i < glyphs.length; i++) {
      expect(glyphs[i]!.x).toBeGreaterThanOrEqual(left);
      expect(glyphs[i]!.x).toBeLessThanOrEqual(width);
      if (i > 0) {
        expect(glyphs[i]!.x).toBeGreaterThan(glyphs[i - 1]!.x);
      }
    }

    const [bassLow, bassHigh] = RANGES['男低音']!;
    expect(clefForRange(bassLow, bassHigh)).toBe('bass');
  });

  it('7 個升記號的調（C♯ 大調）時，noteGlyphs 最小 x ≥ staffLeftPad', () => {
    const majorArpeggio = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const ex = buildExercise(majorArpeggio, {
      startTonic: 61, // C♯4
      low: 48,
      high: 84,
      bpm: 120,
      noteBeats: 1,
      repeats: 1,
      transpose: 'fixed',
      countInBeats: 4,
      mode: 'follow',
    });

    const win = passWindow(ex, 0)!;
    const key = ex.keys[0]!.key;
    const lineSpacing = 12;
    const minLeftPad = staffLeftPad(key, 'treble', lineSpacing);
    const glyphs = noteGlyphs(
      ex,
      win,
      key,
      'treble',
      700,
      minLeftPad,
      18,
      lineSpacing,
    );

    expect(glyphs.length).toBeGreaterThan(0);
    const minX = Math.min(...glyphs.map((g) => g.x));
    expect(minX).toBeGreaterThanOrEqual(minLeftPad);
  });

  it('keyboardRange 符合手機至少 2 八度、平板至少 3 八度且兩端為 C', () => {
    expect(keyboardRange(62, 74, 'phone')).toEqual({ low: 60, high: 84 });

    const tablet = keyboardRange(40, 64, 'tablet');
    expect(tablet.low % 12).toBe(0);
    expect(tablet.high % 12).toBe(0);
    expect(tablet.high - tablet.low).toBeGreaterThanOrEqual(36);
  });

  it('簡譜帶固定調與首調在 D 大調大三和弦分解的轉換正確', () => {
    const dMajor: Key = { tonicPc: 2, mode: 'major' };
    const midis = [62, 66, 69, 74];

    const fixed = midis.map((m) => toJianpu(m, dMajor, 'fixed', 62));
    expect(fixed.map(formatJianpu)).toEqual(['2', '♯4', '6', '2']);
    expect(fixed[3]!.octave).toBe(1);

    const movable = midis.map((m) => toJianpu(m, dMajor, 'movable', 62));
    expect(movable.map(formatJianpu)).toEqual(['1', '3', '5', '1']);
    expect(movable[3]!.octave).toBe(1);
  });

  it('鋼琴黃色指針 x 內插於 74.06 時介於 D5 與 D♯5 中心之間', () => {
    const low = 60;
    const high = 84;
    const d5 = pianoNeedlePercent(74, low, high)!;
    const ds5 = pianoNeedlePercent(75, low, high)!;
    const sung = pianoNeedlePercent(74.06, low, high)!;

    expect(sung).toBeGreaterThan(d5);
    expect(sung).toBeLessThan(ds5);
  });

  it('節拍器擺動角度在每拍整數點為 ±26°、半拍為 0°，砝碼高度端點正確', () => {
    const firstBeat = 0.5;
    const bpm = 120; // 每拍 0.5 秒
    expect(metronomeAngle(0.5, firstBeat, bpm)).toBeCloseTo(26, 6);
    expect(metronomeAngle(0.75, firstBeat, bpm)).toBeCloseTo(0, 6);
    expect(metronomeAngle(1.0, firstBeat, bpm)).toBeCloseTo(-26, 6);
    expect(metronomeAngle(1.25, firstBeat, bpm)).toBeCloseTo(0, 6);
    expect(metronomeAngle(1.5, firstBeat, bpm)).toBeCloseTo(26, 6);

    expect(weightY(40)).toBe(6);
    expect(weightY(208)).toBe(16);
    expect(weightY(200)).toBeCloseTo(6 + (160 / 168) * 10, 6);
  });

  it('調速時間換算與移調顯示格式正確', () => {
    expect(rescaleTime(10, 120, 60)).toBe(20);
    expect(rescaleTime(10, 80, 160)).toBe(5);
    expect(rescaleTime(0, 96, 120)).toBe(0);

    expect(formatTransposeOffset(0)).toBe('0');
    expect(formatTransposeOffset(2)).toBe('+2');
    expect(formatTransposeOffset(-1)).toBe('−1');
  });
});

describe('scoreLines 兩行樂譜規劃', () => {
  const majorArpeggio = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
  const chromatic = BUILTIN_PATTERNS.find((p) => p.id === 'chromatic')!;

  it('短圖案兩行時第二行是下一遍；跨到下一調時 label 顯示下一調名稱', () => {
    // 2 次重複、同調，第二行應為「第 2 遍」
    const exRepeat = buildExercise(majorArpeggio, {
      startTonic: 62, // D4
      low: 48,
      high: 84,
      bpm: 120,
      noteBeats: 1,
      repeats: 2,
      transpose: 'fixed',
      countInBeats: 0,
      mode: 'follow',
    });
    const linesRepeat = scoreLines(exRepeat, 0.1, 2);
    expect(linesRepeat).toHaveLength(2);
    expect(linesRepeat[0]!.isCurrent).toBe(true);
    expect(linesRepeat[0]!.pass).toBe(0);
    expect(linesRepeat[1]!.isCurrent).toBe(false);
    expect(linesRepeat[1]!.pass).toBe(1);
    expect(linesRepeat[1]!.label).toBe('第 2 遍');

    // 跨調：D4 -> E♭4，第二行應顯示「下一調 E♭」
    const exTranspose = buildExercise(majorArpeggio, {
      startTonic: 62, // D4
      low: 48,
      high: 84,
      bpm: 120,
      noteBeats: 1,
      repeats: 1,
      transpose: 'up',
      countInBeats: 0,
      mode: 'follow',
    });
    const linesTranspose = scoreLines(exTranspose, 0.1, 2);
    expect(linesTranspose).toHaveLength(2);
    expect(linesTranspose[0]!.keyIndex).toBe(0);
    expect(linesTranspose[0]!.isCurrent).toBe(true);
    expect(linesTranspose[1]!.keyIndex).toBe(1);
    expect(linesTranspose[1]!.isCurrent).toBe(false);
    expect(linesTranspose[1]!.label).toBe('下一調 E♭');
  });

  it('長圖案（半音階 25 音）拆成兩行，且唱完第一行後翻頁交替', () => {
    const ex = buildExercise(chromatic, {
      startTonic: 60, // C4
      low: 48,
      high: 84,
      bpm: 120,
      noteBeats: 1,
      repeats: 1,
      transpose: 'up',
      countInBeats: 0,
      mode: 'follow',
    });

    // 第一段（前半 13 音）：第一行目前、第二行後半段
    const firstHalf = scoreLines(ex, 0.1, 2);
    expect(firstHalf).toHaveLength(2);
    expect(firstHalf[0]!.isCurrent).toBe(true);
    expect(firstHalf[0]!.noteRange).toEqual([0, 13]);
    expect(firstHalf[1]!.isCurrent).toBe(false);
    expect(firstHalf[1]!.noteRange).toEqual([13, 25]);

    // 進到後半段：第二行變成目前行，第一行翻頁換成下一調 C♯ 預讀
    const secondHalfStart = firstHalf[1]!.start + 0.05;
    const secondHalf = scoreLines(ex, secondHalfStart, 2);
    expect(secondHalf).toHaveLength(2);
    expect(secondHalf[0]!.isCurrent).toBe(false);
    expect(secondHalf[0]!.keyIndex).toBe(1);
    expect(secondHalf[0]!.label).toBe('下一調 D♭');
    expect(secondHalf[1]!.isCurrent).toBe(true);
    expect(secondHalf[1]!.keyIndex).toBe(0);
    expect(secondHalf[1]!.noteRange).toEqual([13, 25]);
  });

  it('只有一行空間時只回傳目前這一遍', () => {
    const ex = buildExercise(majorArpeggio, {
      startTonic: 62,
      low: 48,
      high: 84,
      bpm: 120,
      noteBeats: 1,
      repeats: 2,
      transpose: 'up',
      countInBeats: 0,
      mode: 'follow',
    });

    const lines = scoreLines(ex, 0.1, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.isCurrent).toBe(true);
    expect(lines[0]!.keyIndex).toBe(0);
    expect(lines[0]!.pass).toBe(0);
  });
});

describe('computePatternTitleFontSize 播放列音型名稱字級', () => {
  it('依可用寬、字數與播放列高度計算字級並套用上下限', () => {
    // iPhone 播放列高 30 → 最大 21px、最小 9.45px
    expect(computePatternTitleFontSize(300, 6, 30)).toBeCloseTo(21, 5);
    expect(computePatternTitleFontSize(80, 6, 30)).toBeCloseTo(
      80 / (6 * 1.08),
      5,
    );
    expect(computePatternTitleFontSize(20, 10, 30)).toBeCloseTo(21 * 0.45, 5);
    expect(computePatternTitleFontSize(0, 6, 30)).toBeCloseTo(21 * 0.45, 5);

    // iPad 播放列高 64 → 最大 44.8px、最小 20.16px
    expect(computePatternTitleFontSize(500, 6, 64)).toBeCloseTo(64 * 0.7, 5);
    expect(computePatternTitleFontSize(10, 12, 64)).toBeCloseTo(
      64 * 0.7 * 0.45,
      5,
    );
  });
});
