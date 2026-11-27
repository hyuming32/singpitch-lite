import { describe, expect, it } from 'vitest';
import {
  A4_DEFAULT,
  RANGES,
  centsBetween,
  hzToMidi,
  midiToHz,
  noteName,
} from '../notes';

describe('notes', () => {
  it('converts between MIDI and Hz accurately', () => {
    expect(A4_DEFAULT).toBe(440);
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(57)).toBeCloseTo(220, 6);
    expect(hzToMidi(440)).toBeCloseTo(69, 6);
    expect(hzToMidi(880)).toBeCloseTo(81, 6);
    expect(hzToMidi(0)).toBeNaN();
    expect(hzToMidi(-100)).toBeNaN();
  });

  it('computes centsBetween', () => {
    expect(centsBetween(440, 69)).toBeCloseTo(0, 6);
    expect(centsBetween(midiToHz(69.5), 69)).toBeCloseTo(50, 6);
    expect(centsBetween(0, 69)).toBeNaN();
  });

  it('formats note names with rounding', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C♯4');
    expect(noteName(60.6)).toBe('C♯4');
    expect(noteName(69)).toBe('A4');
  });

  it('defines expected vocal ranges', () => {
    expect(RANGES['完整 C2–C6']).toEqual([36, 84]);
    expect(RANGES['男低音']).toEqual([40, 64]);
    expect(RANGES['男中音']).toEqual([44, 68]);
    expect(RANGES['男高音']).toEqual([48, 72]);
    expect(RANGES['女低音']).toEqual([52, 76]);
    expect(RANGES['女中音']).toEqual([57, 81]);
    expect(RANGES['女高音']).toEqual([60, 84]);
  });
});
