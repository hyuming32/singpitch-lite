import { describe, expect, it } from 'vitest';
import { detectKey, keyConfidence } from '../keyDetect';

function makeScale(midis: number[], dur = 0.5) {
  return midis.map((midi, i) => ({
    start: i * dur,
    end: (i + 1) * dur,
    midi,
  }));
}

describe('detectKey', () => {
  it('空陣列回傳空陣列', () => {
    expect(detectKey([])).toEqual([]);
    expect(keyConfidence([])).toBe('low');
  });

  it('C 大調音階第一名為 C 大調', () => {
    const notes = makeScale([60, 62, 64, 65, 67, 69, 71, 72]);
    const ranked = detectKey(notes);
    expect(ranked).toHaveLength(24);
    expect(ranked[0]!.key).toEqual({ tonicPc: 0, mode: 'major' });
  });

  it('A 和聲小調旋律第一名為 A 小調', () => {
    // A B C D E F G♯ A 加 A C E 長音
    const melody = makeScale([57, 59, 60, 62, 64, 65, 68, 69], 0.4);
    const longTonic = [
      { start: 3.2, end: 4.8, midi: 57 },
      { start: 4.8, end: 6.0, midi: 60 },
      { start: 6.0, end: 7.2, midi: 64 },
    ];
    const ranked = detectKey([...melody, ...longTonic]);
    expect(ranked[0]!.key).toEqual({ tonicPc: 9, mode: 'minor' });
  });

  it('D 大調三和弦分解重複第一名為 D 大調且具區辨度', () => {
    const pattern = [62, 66, 69, 74, 69, 66, 62];
    const notes = makeScale([...pattern, ...pattern], 0.5);
    const ranked = detectKey(notes);
    expect(ranked[0]!.key).toEqual({ tonicPc: 2, mode: 'major' });
    expect(['high', 'medium']).toContain(keyConfidence(ranked));
  });

  it('keyConfidence 依前後分數差回傳 high / medium / low', () => {
    expect(
      keyConfidence([
        { key: { tonicPc: 0, mode: 'major' }, score: 0.9 },
        { key: { tonicPc: 9, mode: 'minor' }, score: 0.75 },
      ]),
    ).toBe('high');
    expect(
      keyConfidence([
        { key: { tonicPc: 0, mode: 'major' }, score: 0.8 },
        { key: { tonicPc: 9, mode: 'minor' }, score: 0.74 },
      ]),
    ).toBe('medium');
    expect(
      keyConfidence([
        { key: { tonicPc: 0, mode: 'major' }, score: 0.7 },
        { key: { tonicPc: 9, mode: 'minor' }, score: 0.68 },
      ]),
    ).toBe('low');
  });
});
