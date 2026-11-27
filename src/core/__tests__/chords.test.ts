import { describe, expect, it } from 'vitest';
import { chordName, chordPitchClasses, parseRoman } from '../chords';
import type { Key } from '../key';

describe('chords', () => {
  it('computes chord names and pitch classes', () => {
    const cMajor: Key = { tonicPc: 0, mode: 'major' };
    const aMinor: Key = { tonicPc: 9, mode: 'minor' };
    const dMajor: Key = { tonicPc: 2, mode: 'major' };
    const bbMajor: Key = { tonicPc: 10, mode: 'major' };
    const cMinor: Key = { tonicPc: 0, mode: 'minor' };

    expect(chordName('V7', cMajor)).toBe('G7');
    expect(chordPitchClasses('V7', cMajor)).toEqual([7, 11, 2, 5]);
    expect(chordName('i', aMinor)).toBe('Am');
    expect(chordName('V', aMinor)).toBe('E');
    expect(chordName('iv', aMinor)).toBe('Dm');
    expect(chordName('I', dMajor)).toBe('D');
    expect(chordName('vii°', dMajor)).toBe('C♯°');
    expect(chordName('♭VII', dMajor)).toBe('C');
    expect(chordName('IV', bbMajor)).toBe('E♭');
    expect(chordName('bVII', cMajor)).toBe('B♭');
    expect(chordName('♭VI', cMajor)).toBe('A♭');
    expect(chordName('♭III', cMajor)).toBe('E♭');
    expect(chordName('♭VI', cMinor)).toBe('A♭');
    expect(chordName('V/7', cMajor)).toBe('G/B');
    expect(chordPitchClasses('V/7', cMajor)).toEqual([11, 2, 7]);
    expect(chordName('V/7', dMajor)).toBe('A/C♯');
    expect(chordName('V/7', aMinor)).toBe('E/G♯');
  });

  it('throws Traditional Chinese error on invalid input', () => {
    expect(() => parseRoman('')).toThrowError(/空/);
    expect(() => parseRoman('VIII')).toThrowError(/無法辨識/);
  });
});
