import { describe, expect, it } from 'vitest';
import { keyName, keySignature, spell, type Key } from '../key';

describe('key', () => {
  it('formats key names', () => {
    expect(keyName({ tonicPc: 2, mode: 'major' })).toBe('D 大調');
    expect(keyName({ tonicPc: 9, mode: 'minor' })).toBe('A 小調');
    expect(keyName({ tonicPc: 10, mode: 'major' })).toBe('B♭ 大調');
  });

  it('computes key signatures for major and minor keys', () => {
    expect(keySignature({ tonicPc: 9, mode: 'minor' })).toEqual({
      type: 'none',
      count: 0,
    });
    expect(keySignature({ tonicPc: 4, mode: 'minor' })).toEqual({
      type: 'sharp',
      count: 1,
    });
    expect(keySignature({ tonicPc: 2, mode: 'minor' })).toEqual({
      type: 'flat',
      count: 1,
    });
    expect(keySignature({ tonicPc: 0, mode: 'minor' })).toEqual({
      type: 'flat',
      count: 3,
    });
    expect(keySignature({ tonicPc: 6, mode: 'minor' })).toEqual({
      type: 'sharp',
      count: 3,
    });
    expect(keySignature({ tonicPc: 3, mode: 'minor' })).toEqual({
      type: 'flat',
      count: 6,
    });
  });

  it('spells diatonic, raised minor 6th/7th, and chromatic notes', () => {
    const cMinor: Key = { tonicPc: 0, mode: 'minor' };
    expect(spell(71, cMinor)).toEqual({
      letter: 'B',
      accidental: 0,
      octave: 4,
    });
    expect(spell(69, cMinor)).toEqual({
      letter: 'A',
      accidental: 0,
      octave: 4,
    });

    const dMinor: Key = { tonicPc: 2, mode: 'minor' };
    expect(spell(73, dMinor)).toEqual({
      letter: 'C',
      accidental: 1,
      octave: 5,
    });

    const aMinor: Key = { tonicPc: 9, mode: 'minor' };
    expect(spell(68, aMinor)).toEqual({
      letter: 'G',
      accidental: 1,
      octave: 4,
    });

    // F♯ 大調的 E♯4 邊界測試
    const fSharpMajor: Key = { tonicPc: 6, mode: 'major' };
    expect(spell(65, fSharpMajor)).toEqual({
      letter: 'E',
      accidental: 1,
      octave: 4,
    });
  });
});
