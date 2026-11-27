import { describe, expect, it } from 'vitest';
import { buildExercise, infLoopSeekTarget } from '../exercise';
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
    const cadences = ex.chords.filter((c) => c.role === 'cadence');
    expect(cadences).toHaveLength(2);
    expect(cadences.map((c) => c.roman)).toEqual(['I', 'V/7']);
    expect(cadences[0]?.dur).toBeCloseTo(1.0, 6);
    expect(cadences[1]?.dur).toBeCloseTo(0.5, 6);
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

  it('repeats=3 時 cadence 只出現在每個調第 1 遍之前、總時長相應縮短、pad 每遍皆有', () => {
    const baseOpts = {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120, // 1 拍 = 0.5 秒
      transpose: 'up-down' as const,
      repeats: 3,
      countInBeats: 4,
      restBeats: 1,
    };
    const withCadence = buildExercise(majorArp, { ...baseOpts, cadence: true });
    const withoutCadence = buildExercise(majorArp, { ...baseOpts, cadence: false });
    const singleRepeat = buildExercise(majorArp, {
      ...baseOpts,
      repeats: 1,
      cadence: true,
    });

    const numKeys = withCadence.keys.length;
    expect(numKeys).toBeGreaterThan(2);

    const cadenceChords = withCadence.chords.filter((c) => c.role === 'cadence');
    // 每個調只有 1 組 cadence（2 個和弦：I, V/7），總組數＝調數
    const cadenceKeys = new Set(cadenceChords.map((c) => c.keyIndex));
    expect(cadenceKeys.size).toBe(numKeys);
    expect(cadenceChords).toHaveLength(numKeys * 2);

    // 每個調的 cadence 皆位於該調第 1 遍起點（notesStart）之前，同調遍與遍之間沒有 cadence
    for (const kb of withCadence.keys) {
      const keyCadences = cadenceChords.filter((c) => c.keyIndex === kb.index);
      expect(keyCadences).toHaveLength(2);
      expect(kb.notesStart - kb.start).toBeCloseTo(2.0, 6); // 4 拍 × 0.5 秒
      for (const c of keyCadences) {
        expect(c.start).toBeGreaterThanOrEqual(kb.start - 1e-6);
        expect(c.start + c.dur).toBeLessThanOrEqual(kb.notesStart + 1e-6);
      }
    }

    // pad 伴奏和弦不受影響，每個調的每一遍都有
    const chordCountPerPass = majorArp.chords.trim().split(/\s+/).length;
    const padChords = withCadence.chords.filter((c) => c.role === 'pad');
    expect(padChords).toHaveLength(numKeys * 3 * chordCountPerPass);

    // 總時長僅多出「調數 × 1 組 cadence (2 秒)」，而非「調數 × repeats × 1 組 cadence」
    expect(withCadence.total - withoutCadence.total).toBeCloseTo(numKeys * 2.0, 6);
    // 相較於 repeats=1，repeats=3 只增加純唱段時長（不含多餘 cadence）
    const passDur = singleRepeat.keys[0]!.end - singleRepeat.keys[0]!.notesStart;
    expect(withCadence.total - singleRepeat.total).toBeCloseTo(
      numKeys * 2 * passDur,
      6,
    );
  });

  it('tonicList 與 listen-then-sing 模式下 cadence 也只在每調第 1 遍前播放', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      mode: 'listen-then-sing',
      cadence: true,
      repeats: 3,
      countInBeats: 0,
      restBeats: 1,
      tonicList: [60, 64],
    });

    expect(ex.keys).toHaveLength(2);
    const cadenceChords = ex.chords.filter((c) => c.role === 'cadence');
    expect(cadenceChords).toHaveLength(4); // 2 個調 × 2 和弦（I, V/7）

    for (const kb of ex.keys) {
      const listenNotes = ex.notes.filter(
        (n) => n.keyIndex === kb.index && n.phase === 'listen',
      );
      expect(listenNotes[0]!.start).toBeCloseTo(kb.notesStart, 6);
      // 示範與第 1–3 遍唱之間皆無 cadence
      const lateCadence = cadenceChords.filter(
        (c) => c.keyIndex === kb.index && c.start >= kb.notesStart - 1e-6,
      );
      expect(lateCadence).toHaveLength(0);
    }

    // pad 涵蓋示範 + 3 遍唱（共 4 遍）
    const chordCountPerPass = majorArp.chords.trim().split(/\s+/).length;
    expect(ex.chords.filter((c) => c.role === 'pad')).toHaveLength(
      2 * 4 * chordCountPerPass,
    );
  });

  it('∞ 循環 seek 位置跳過 cadence 區段（follow 與 listen-then-sing 皆適用）', () => {
    const followEx = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      mode: 'follow',
      cadence: true,
      repeats: 1,
      countInBeats: 4,
      transpose: 'up',
    });

    for (const kb of followEx.keys) {
      const target = infLoopSeekTarget(kb);
      expect(target).toBeCloseTo(kb.notesStart, 6);
      expect(target).toBeGreaterThan(kb.start);
      const firstNote = followEx.notes.find((n) => n.keyIndex === kb.index)!;
      expect(target).toBeCloseTo(firstNote.start, 6);
      const keyCadences = followEx.chords.filter(
        (c) => c.role === 'cadence' && c.keyIndex === kb.index,
      );
      for (const c of keyCadences) {
        expect(c.start + c.dur).toBeLessThanOrEqual(target + 1e-6);
      }
    }

    const listenEx = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      mode: 'listen-then-sing',
      cadence: true,
      repeats: 1,
      tonicList: [62, 65],
    });
    for (const kb of listenEx.keys) {
      const target = infLoopSeekTarget(kb);
      expect(target).toBeCloseTo(kb.notesStart, 6);
      const firstListenNote = listenEx.notes.find(
        (n) => n.keyIndex === kb.index && n.phase === 'listen',
      )!;
      expect(target).toBeCloseTo(firstListenNote.start, 6);
    }

    const noCadenceEx = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      cadence: false,
      repeats: 1,
    });
    expect(infLoopSeekTarget(noCadenceEx.keys[0]!)).toBeCloseTo(
      noCadenceEx.keys[0]!.start,
      6,
    );
  });
});
