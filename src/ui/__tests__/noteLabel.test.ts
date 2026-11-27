import { describe, it, expect } from 'vitest';
import { displayNoteName } from '../noteLabel';

describe('displayNoteName (國際標準：中央 Do = C4)', () => {
  it('maps MIDI numbers to scientific pitch notation', () => {
    expect(displayNoteName(60)).toBe('C4');
    expect(displayNoteName(72)).toBe('C5');
    expect(displayNoteName(48)).toBe('C3');
    expect(displayNoteName(21)).toBe('A0');
    expect(displayNoteName(108)).toBe('C8');
    expect(displayNoteName(69)).toBe('A4');
  });
});
