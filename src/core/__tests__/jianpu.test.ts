import { describe, expect, it } from 'vitest';
import { formatJianpu, solfegeName, toJianpu } from '../jianpu';
import type { Key } from '../key';

describe('jianpu', () => {
  it('converts D major in fixed and movable modes', () => {
    const dMajor: Key = { tonicPc: 2, mode: 'major' };

    const fixed = [62, 66, 69, 74].map((m) => toJianpu(m, dMajor, 'fixed'));
    expect(fixed.map(formatJianpu)).toEqual(['2', '♯4', '6', '2']);
    expect(fixed.map((n) => n.octave)).toEqual([0, 0, 0, 1]);

    const movable = [62, 66, 69, 74].map((m) =>
      toJianpu(m, dMajor, 'movable', 62),
    );
    expect(movable.map(formatJianpu)).toEqual(['1', '3', '5', '1']);
    expect(movable.map((n) => n.octave)).toEqual([0, 0, 0, 1]);
  });

  it('handles D minor and Bb major', () => {
    const dMinor: Key = { tonicPc: 2, mode: 'minor' };
    expect(formatJianpu(toJianpu(65, dMinor, 'movable', 62))).toBe('♭3');
    expect(formatJianpu(toJianpu(73, dMinor, 'movable', 62))).toBe('7');

    const fixed73 = toJianpu(73, dMinor, 'fixed');
    expect(formatJianpu(fixed73)).toBe('♯1');
    expect(fixed73.octave).toBe(1);

    const bbMajor: Key = { tonicPc: 10, mode: 'major' };
    expect(formatJianpu(toJianpu(70, bbMajor, 'fixed'))).toBe('♭7');
    expect(formatJianpu(toJianpu(63, bbMajor, 'fixed'))).toBe('♭3');
  });

  it('produces solfege names', () => {
    const dMajor: Key = { tonicPc: 2, mode: 'major' };
    expect(solfegeName(66, dMajor, 'fixed')).toBe('升Fa');
    expect(solfegeName(66, dMajor, 'movable')).toBe('Mi');

    const bbMajor: Key = { tonicPc: 10, mode: 'major' };
    expect(solfegeName(70, bbMajor, 'fixed')).toBe('降Ti');
  });
});
