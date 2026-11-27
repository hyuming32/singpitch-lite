import { describe, expect, it } from 'vitest';
import type { Key } from '../key';
import {
  clefForRange,
  keySignaturePositions,
  staffPosition,
  sungStaffPosition,
} from '../staff';

describe('staff', () => {
  const cMajor: Key = { tonicPc: 0, mode: 'major' };
  const dMajor: Key = { tonicPc: 2, mode: 'major' };
  const fMajor: Key = { tonicPc: 5, mode: 'major' };

  it('chooses clef based on range midpoint', () => {
    expect(clefForRange(40, 64)).toBe('bass');
    expect(clefForRange(43, 67)).toBe('bass');
    expect(clefForRange(48, 72)).toBe('treble');
  });

  it('computes staff positions and ledger lines', () => {
    expect(staffPosition(64, cMajor, 'treble')).toEqual({
      position: 0,
      accidental: '',
      ledgerLines: [],
    });
    expect(staffPosition(62, cMajor, 'treble')).toEqual({
      position: -1,
      accidental: '',
      ledgerLines: [],
    });
    expect(staffPosition(60, cMajor, 'treble')).toEqual({
      position: -2,
      accidental: '',
      ledgerLines: [-2],
    });
    expect(staffPosition(77, cMajor, 'treble')).toEqual({
      position: 8,
      accidental: '',
      ledgerLines: [],
    });
    expect(staffPosition(81, cMajor, 'treble')).toEqual({
      position: 10,
      accidental: '',
      ledgerLines: [10],
    });

    expect(staffPosition(43, cMajor, 'bass').position).toBe(0);
    expect(staffPosition(59, cMajor, 'bass').position).toBe(9);

    // D 大調中的 F♯4 不標示臨時記號，F♮4 標示 ♮
    expect(staffPosition(66, dMajor, 'treble').accidental).toBe('');
    expect(staffPosition(65, dMajor, 'treble').accidental).toBe('♮');
  });

  it('computes key signature positions', () => {
    expect(keySignaturePositions(dMajor, 'treble')).toEqual([
      { accidental: '♯', position: 8 },
      { accidental: '♯', position: 5 },
    ]);
    expect(keySignaturePositions(fMajor, 'treble')).toEqual([
      { accidental: '♭', position: 4 },
    ]);

    const eMinor: Key = { tonicPc: 4, mode: 'minor' };
    const bbMajor: Key = { tonicPc: 10, mode: 'major' };
    expect(keySignaturePositions(eMinor, 'bass')).toEqual([
      { accidental: '♯', position: 6 },
    ]);
    expect(keySignaturePositions(bbMajor, 'bass')).toEqual([
      { accidental: '♭', position: 2 },
      { accidental: '♭', position: 5 },
    ]);
  });

  it('interpolates sungStaffPosition linearly between diatonic steps', () => {
    expect(sungStaffPosition(62, dMajor, 'treble')).toBeCloseTo(-1, 6);
    expect(sungStaffPosition(66.5, dMajor, 'treble')).toBeCloseTo(1.5, 6);
    expect(sungStaffPosition(74, dMajor, 'treble')).toBeCloseTo(6, 6);
  });
});
