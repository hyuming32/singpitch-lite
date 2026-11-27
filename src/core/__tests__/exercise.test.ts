import { describe, expect, it } from 'vitest';
import { buildExercise } from '../exercise';
import { BUILTIN_PATTERNS } from '../patterns';

describe('exercise', () => {
  const majorArp = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;

  it('builds up-down transposition with exact key count', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      transpose: 'up-down',
    });
    expect(ex.keys).toHaveLength(15);
    expect(ex.keys[0]?.tonicMidi).toBe(60);
    expect(ex.keys[7]?.tonicMidi).toBe(67);
    expect(ex.keys[14]?.tonicMidi).toBe(60);
    expect(ex.clicks).toHaveLength(4);
    expect(ex.clicks[0]?.accent).toBe(true);
    expect(ex.clicks[1]?.accent).toBe(false);
  });

  it('generates 7 * repeats notes in fixed mode and halves duration for staccato', () => {
    const legato = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      repeats: 2,
      articulation: 'legato',
      transpose: 'fixed',
    });
    expect(legato.notes).toHaveLength(14);
    expect(legato.notes[0]?.dur).toBeCloseTo(0.5, 6);

    const staccato = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      repeats: 2,
      articulation: 'staccato',
      transpose: 'fixed',
    });
    expect(staccato.notes).toHaveLength(14);
    expect(staccato.notes[0]?.dur).toBeCloseTo(0.25, 6);
  });

  it('supports listen-then-sing and cadence', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      mode: 'listen-then-sing',
      cadence: true,
      repeats: 1,
    });
    expect(ex.notes.filter((n) => n.phase === 'listen')).toHaveLength(7);
    expect(ex.notes.filter((n) => n.phase === 'sing')).toHaveLength(7);
    expect(ex.chords.filter((c) => c.role === 'cadence')).toHaveLength(3);
  });

  it('throws on out-of-range or invalid bpm', () => {
    expect(() =>
      buildExercise(majorArp, {
        startTonic: 70,
        low: 48,
        high: 79,
        bpm: 120,
      }),
    ).toThrowError(/超出音域/);

    expect(() =>
      buildExercise(majorArp, {
        startTonic: 60,
        low: 48,
        high: 79,
        bpm: 20,
      }),
    ).toThrowError(/BPM/);
  });

  it('supports tonicList custom key sequence with continuous timing', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      transpose: 'up-down',
      countInBeats: 4,
      restBeats: 1,
      cadence: true,
      mode: 'listen-then-sing',
      repeats: 1,
      tonicList: [65, 60, 63],
    });

    expect(ex.keys.map((k) => k.tonicMidi)).toEqual([65, 60, 63]);
    expect(ex.keys.map((k) => k.index)).toEqual([0, 1, 2]);
    // 預備拍 4 拍 @ 120 BPM = 2.0s
    expect(ex.keys[0]?.start).toBeCloseTo(2.0, 6);
    // 每個調之間休息 1 拍 = 0.5s，且時間嚴格遞增連續
    for (let i = 0; i < ex.keys.length; i++) {
      const k = ex.keys[i]!;
      expect(k.end).toBeGreaterThan(k.start);
      if (i > 0) {
        expect(k.start - ex.keys[i - 1]!.end).toBeCloseTo(0.5, 6);
      }
    }
    expect(ex.total).toBeCloseTo(ex.keys[ex.keys.length - 1]!.end, 6);
  });

  it('supports repeats combined with tonicList', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      repeats: 3,
      countInBeats: 0,
      restBeats: 0,
      tonicList: [62, 67],
    });

    expect(ex.keys).toHaveLength(2);
    // 每個調 3 遍 × 7 音 = 21 音，2 個調共 42 音
    expect(ex.notes).toHaveLength(42);
    expect(ex.notes.filter((n) => n.keyIndex === 0)).toHaveLength(21);
    expect(ex.notes.filter((n) => n.keyIndex === 1)).toHaveLength(21);
    expect(ex.notes.filter((n) => n.keyIndex === 1 && n.pass === 2)).toHaveLength(7);
  });

  it('treats empty tonicList as omitted and falls back to transpose', () => {
    const fallback = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      transpose: 'up',
      tonicList: [],
    });
    const baseline = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      transpose: 'up',
    });

    expect(fallback.keys.map((k) => k.tonicMidi)).toEqual(
      baseline.keys.map((k) => k.tonicMidi),
    );
    expect(fallback.total).toBeCloseTo(baseline.total, 6);
  });

  it('supports displayTranspose without changing range feasibility or timing', () => {
    const base = buildExercise(majorArp, {
      startTonic: 48, // C3（男中音範圍內）
      low: 43,
      high: 67,
      bpm: 120,
      transpose: 'up',
      countInBeats: 0,
      restBeats: 0,
    });
    const shifted = buildExercise(majorArp, {
      startTonic: 48,
      low: 43,
      high: 67,
      bpm: 120,
      transpose: 'up',
      countInBeats: 0,
      restBeats: 0,
      displayTranspose: 12,
    });

    expect(shifted.keys).toHaveLength(base.keys.length);
    expect(shifted.total).toBeCloseTo(base.total, 6);
    for (let i = 0; i < base.keys.length; i++) {
      expect(shifted.keys[i]!.tonicMidi).toBe(base.keys[i]!.tonicMidi + 12);
    }
    expect(shifted.notes).toHaveLength(base.notes.length);
    for (let i = 0; i < base.notes.length; i++) {
      expect(shifted.notes[i]!.midi).toBe(base.notes[i]!.midi + 12);
      expect(shifted.notes[i]!.start).toBeCloseTo(base.notes[i]!.start, 6);
    }
  });
});
