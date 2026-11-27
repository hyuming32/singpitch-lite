import { describe, expect, it } from 'vitest';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { buildMiniStaffNotes } from '../miniStaffData';

describe('buildMiniStaffNotes', () => {
  it('大三和弦分解從 C4 起算的五線譜位置與加線正確', () => {
    const majorArpeggio = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const notes = buildMiniStaffNotes(majorArpeggio, {
      width: 220,
      leftPad: 36,
      rightPad: 14,
      tonicMidi: 60,
    });

    expect(notes.map((n) => n.position)).toEqual([-2, 0, 2, 5, 2, 0, -2]);
    expect(notes[0]!.ledgerLines).toEqual([-2]);
    expect(notes[6]!.ledgerLines).toEqual([-2]);
    expect(notes[3]!.ledgerLines).toEqual([]);
    expect(notes[0]!.x).toBe(36);
    expect(notes[6]!.x).toBe(206);
  });

  it('滑音圖案會標記 glideToNext', () => {
    const fifthGlide = BUILTIN_PATTERNS.find((p) => p.id === 'fifth-glide')!;
    const notes = buildMiniStaffNotes(fifthGlide);
    expect(notes).toHaveLength(3);
    expect(notes[0]!.glideToNext).toBe(true);
    expect(notes[1]!.glideToNext).toBe(true);
    expect(notes[2]!.glideToNext).toBe(false);
  });
});
