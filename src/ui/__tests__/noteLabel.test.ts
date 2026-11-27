import { describe, it, expect } from 'vitest';
import { displayNoteName } from '../noteLabel';

describe('displayNoteName (中央 Do = C3)', () => {
  it('maps MIDI numbers to Yamaha-style octave', () => {
    expect(displayNoteName(60)).toBe('C3');
    expect(displayNoteName(72)).toBe('C4');
    expect(displayNoteName(48)).toBe('C2');
    expect(displayNoteName(21)).toBe('A-1');
    expect(displayNoteName(108)).toBe('C7');
    expect(displayNoteName(69)).toBe('A3');
  });
});
