import { describe, expect, it } from 'vitest';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import {
  VOCAL_RANGE_PARTS,
  buildMeasuredRangeResult,
  patternFit,
  rankPatternsForRange,
  recommendVoiceRange,
  resolveStartTonicForRange,
  selectVocalRangePatch,
} from '../vocalRange';

describe('recommendVoiceRange 推薦聲部演算法', () => {
  it('測得 G2–G4（MIDI 43–67）推薦男中音（male）', () => {
    const rec = recommendVoiceRange(43, 67);
    expect(rec.rangeName).toBe('男中音');
    expect(rec.voice).toBe('male');
  });

  it('測得 C4–C6（MIDI 60–84）推薦女高音（normal）', () => {
    const rec = recommendVoiceRange(60, 84);
    expect(rec.rangeName).toBe('女高音');
    expect(rec.voice).toBe('normal');
  });

  it('重疊比例同分時以中心距最近者勝出', () => {
    // 60–72 (中心 66)：與男高音 [48,72]、女低音 [53,77]、女中音 [57,81]、女高音 [60,84] 重疊皆為 12/24
    // 中心距分別為 |66-60|=6、|66-65|=1、|66-69|=3、|66-72|=6 → 應選女低音
    const rec = recommendVoiceRange(60, 72);
    expect(rec.rangeName).toBe('女低音');
    expect(rec.voice).toBe('normal');
  });

  it('六個標準音域皆具備英文名稱欄位且選擇音域時自動更新聲部', () => {
    expect(VOCAL_RANGE_PARTS.map((p) => p.englishName)).toEqual([
      'BASS',
      'BARITONE',
      'TENOR',
      'CONTRALTO',
      'MEZZO SOPRANO',
      'SOPRANO',
    ]);

    const majorArp = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const malePatch = selectVocalRangePatch(
      { startTonic: 65, myRange: null },
      '男中音',
      majorArp,
    );
    expect(malePatch.rangeName).toBe('男中音');
    expect(malePatch.voice).toBe('male');
    expect(malePatch.startTonic).toBe(45);

    const femalePatch = selectVocalRangePatch(
      { startTonic: 45, myRange: null },
      '女低音',
      majorArp,
    );
    expect(femalePatch.rangeName).toBe('女低音');
    expect(femalePatch.voice).toBe('normal');
    expect(femalePatch.startTonic).toBe(53);
  });
});

describe('buildMeasuredRangeResult 舒適區內縮與窄音域拒絕', () => {
  it('將測得音域上下各內縮 1 個半音存為我的音域', () => {
    const res = buildMeasuredRangeResult(43, 67, 'twoNotes', '2026-11-27T00:00:00Z');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.raw).toEqual([43, 67]);
    expect(res.semitones).toBe(24);
    expect(res.myRange).toEqual({
      low: 44,
      high: 66,
      raw: [43, 67],
      method: 'twoNotes',
      voice: 'male',
      measuredAt: '2026-11-27T00:00:00Z',
    });
    expect(res.recommended.rangeName).toBe('男中音');
  });

  it('支援順序顛倒的兩音輸入並正確排序', () => {
    const res = buildMeasuredRangeResult(84, 60, 'twoNotes');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.raw).toEqual([60, 84]);
    expect(res.myRange.low).toBe(61);
    expect(res.myRange.high).toBe(83);
  });

  it('少於 8 個半音時拒絕儲存並回傳錯誤訊息', () => {
    const res = buildMeasuredRangeResult(60, 67, 'glide');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('範圍太窄，請重測');

    // 剛好 8 個半音應通過
    const edgeOk = buildMeasuredRangeResult(60, 68, 'glide');
    expect(edgeOk.ok).toBe(true);
  });
});

describe('patternFit 與推薦音型排序', () => {
  const majorArp = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!; // span 0..12
  const ninthScale = BUILTIN_PATTERNS.find((p) => p.id === 'ninth-scale')!; // span 0..14
  const longTone = BUILTIN_PATTERNS.find((p) => p.id === 'long-tone')!; // span 0..0

  it('正確計算可練調數與可行主音上下限', () => {
    // 男中音 [44, 68] 搭大三和弦分解 (0..12)：44..56 共 13 個調
    expect(patternFit(majorArp, [44, 68])).toEqual({
      keys: 13,
      lowestTonic: 44,
      highestTonic: 56,
      fits: true,
    });

    // 長音 (0..0) 在 [44, 68] 有 25 個調
    expect(patternFit(longTone, { low: 44, high: 68 }).keys).toBe(25);
  });

  it('音型跨度大於音域時回傳 0 個調與 fits=false', () => {
    expect(patternFit(ninthScale, [60, 70])).toEqual({
      keys: 0,
      lowestTonic: null,
      highestTonic: null,
      fits: false,
    });
  });

  it('rankPatternsForRange 依可練調數排序前 5 個，且 resolveStartTonicForRange 自動修正超界起始音', () => {
    const top5 = rankPatternsForRange(BUILTIN_PATTERNS, [44, 68], 5);
    expect(top5).toHaveLength(5);
    for (let i = 1; i < top5.length; i++) {
      expect(top5[i - 1]!.fit.keys).toBeGreaterThanOrEqual(top5[i]!.fit.keys);
    }

    // 原起始音 65 在 [44, 68] 搭 majorArp (0..12) 會超出 68 → 修正為最低可行主音 44
    expect(resolveStartTonicForRange(majorArp, 65, 44, 68)).toBe(44);
    // 若未超界則維持原起始音
    expect(resolveStartTonicForRange(majorArp, 50, 44, 68)).toBe(50);
  });
});
