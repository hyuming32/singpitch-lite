import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PATTERNS,
  JianpuParseError,
  parseJianpu,
} from '../patterns';

describe('patterns', () => {
  it('parses standard jianpu with extensions and accidentals', () => {
    const parsed = parseJianpu('1 2 b3 4 5 - 4 b3 2 1 -');
    expect(parsed.staccato).toBe(false);
    expect(parsed.events.map((e) => e.semitone)).toEqual([
      0, 2, 3, 5, 7, 5, 3, 2, 0,
    ]);
    const totalBeats = parsed.events.reduce((sum, e) => sum + e.beats, 0);
    expect(totalBeats).toBe(11);
  });

  it('parses glides, octaves, rests, and staccato', () => {
    const glide = parseJianpu('1~5~1');
    expect(glide.events).toEqual([
      { semitone: 0, beats: 1, glideToNext: true },
      { semitone: 7, beats: 1, glideToNext: true },
      { semitone: 0, beats: 1, glideToNext: false },
    ]);

    const spacedGlide = parseJianpu('1 ~ 5 ~ 1 .');
    expect(spacedGlide.staccato).toBe(true);
    expect(spacedGlide.events).toEqual(glide.events);

    expect(parseJianpu("1' 1, 0").events.map((e) => e.semitone)).toEqual([
      12,
      -12,
      null,
    ]);
  });

  it('throws JianpuParseError with 1-based token index', () => {
    try {
      parseJianpu('1 2 8');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JianpuParseError);
      expect((err as JianpuParseError).index).toBe(3);
    }

    expect(() => parseJianpu('')).toThrow(JianpuParseError);
    expect(() => parseJianpu('- 1')).toThrow(JianpuParseError);
    expect(() => parseJianpu('1 ~')).toThrow(JianpuParseError);
  });

  it('parses all builtin patterns without error', () => {
    expect(BUILTIN_PATTERNS.length).toBeGreaterThanOrEqual(20);
    for (const p of BUILTIN_PATTERNS) {
      const res = parseJianpu(p.jianpu);
      expect(res.events.length).toBeGreaterThan(0);
    }
  });
});
