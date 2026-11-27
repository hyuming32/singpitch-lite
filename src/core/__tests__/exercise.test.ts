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
    expect(cadences).toHaveLength(3);
    expect(cadences.map((c) => c.roman)).toEqual(['I', 'V/7', 'I']);
    expect(cadences[0]?.dur).toBeCloseTo(0.5, 6);
    expect(cadences[1]?.dur).toBeCloseTo(0.5, 6);
    expect(cadences[2]?.dur).toBeCloseTo(0.5, 6);
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
    // 每個調只有 1 組 cadence（第 1 調 3 個和弦、之後每調 4 個和弦），總組數＝調數
    const cadenceKeys = new Set(cadenceChords.map((c) => c.keyIndex));
    expect(cadenceKeys.size).toBe(numKeys);
    expect(cadenceChords).toHaveLength(3 + (numKeys - 1) * 4);

    // 每個調的 cadence 皆位於該調第 1 遍起點（notesStart）之前，同調遍與遍之間沒有 cadence
    for (const kb of withCadence.keys) {
      const keyCadences = cadenceChords.filter((c) => c.keyIndex === kb.index);
      const expectedCount = kb.index === 0 ? 3 : 4;
      expect(keyCadences).toHaveLength(expectedCount);
      expect(kb.notesStart - kb.start).toBeCloseTo(expectedCount * 0.5, 6);
      for (const c of keyCadences) {
        expect(c.start).toBeGreaterThanOrEqual(kb.start - 1e-6);
        expect(c.start + c.dur).toBeLessThanOrEqual(kb.notesStart + 1e-6);
      }
    }

    // pad 伴奏和弦不受影響，每個調的每一遍都有
    const chordCountPerPass = majorArp.chords.trim().split(/\s+/).length;
    const padChords = withCadence.chords.filter((c) => c.role === 'pad');
    expect(padChords).toHaveLength(numKeys * 3 * chordCountPerPass);

    // 總時長僅多出「第 1 調 1.5 秒 + 其餘調各 2.0 秒」，而非「調數 × repeats × cadence」
    const expectedCadenceDur = 1.5 + (numKeys - 1) * 2.0;
    expect(withCadence.total - withoutCadence.total).toBeCloseTo(
      expectedCadenceDur,
      6,
    );
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
    expect(cadenceChords).toHaveLength(7); // 第 1 調 3 和弦 + 第 2 調 4 和弦

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

  it('supports single-chord fast cadence with bookend chord and no rest gap', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120, // 1 拍 = 0.5 秒
      mode: 'follow',
      cadence: 'single',
      repeats: 1,
      countInBeats: 0,
      transpose: 'up',
    });

    const cadences = ex.chords.filter((c) => c.role === 'cadence');
    // 每個調前後各有 1 拍 I 級和弦（C → 唱段 → C → C# → 唱段 → C#）
    expect(cadences).toHaveLength(ex.keys.length * 2);
    for (let i = 0; i < ex.keys.length; i++) {
      const kb = ex.keys[i]!;
      const keyCadences = cadences.filter((c) => c.keyIndex === kb.index);
      expect(keyCadences).toHaveLength(2);
      expect(keyCadences[0]?.roman).toBe('I');
      expect(keyCadences[1]?.roman).toBe('I');
      expect(keyCadences[0]?.dur).toBeCloseTo(0.5, 6);
      expect(keyCadences[1]?.dur).toBeCloseTo(0.5, 6);
      // 開頭 1 拍後立刻開唱
      expect(kb.notesStart - kb.start).toBeCloseTo(0.5, 6);
      // 調與調之間無空白休息拍，收尾和弦結束即緊接下一調引導和弦
      if (i > 0) {
        expect(kb.start).toBeCloseTo(ex.keys[i - 1]!.end, 6);
      }
    }
  });

  it('leading 與 direct 模式的事件順序、roman、拍長、midis 與無空拍皆符合規格', () => {
    const leadingEx = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 84,
      bpm: 120, // 1 拍 = 0.5 秒
      transpose: 'up',
      cadence: 'leading',
      countInBeats: 0,
      restBeats: 1,
    });

    const k0Cad = leadingEx.chords.filter((c) => c.role === 'cadence' && c.keyIndex === 0);
    expect(k0Cad.map((c) => c.roman)).toEqual(['I', 'V/7', 'I']);
    expect(k0Cad.map((c) => c.dur)).toEqual([0.5, 0.5, 0.5]);
    expect(k0Cad.map((c) => c.midis)).toEqual([
      [48, 52, 55],
      [47, 50, 55],
      [48, 52, 55],
    ]);
    // notesStart 緊接最後一個引導和弦（無空拍）
    expect(k0Cad[2]!.start + k0Cad[2]!.dur).toBeCloseTo(leadingEx.keys[0]!.notesStart, 6);

    const k1Cad = leadingEx.chords.filter((c) => c.role === 'cadence' && c.keyIndex === 1);
    expect(k1Cad.map((c) => c.roman)).toEqual(['I', 'I', 'V/7', 'I']);
    expect(k1Cad.map((c) => c.dur)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(k1Cad.map((c) => c.midis)).toEqual([
      [48, 52, 55],
      [49, 53, 56],
      [48, 51, 56],
      [49, 53, 56],
    ]);
    expect(k1Cad[0]!.name).toBe('C');
    expect(k1Cad[3]!.start + k1Cad[3]!.dur).toBeCloseTo(leadingEx.keys[1]!.notesStart, 6);

    const k2Cad = leadingEx.chords.filter((c) => c.role === 'cadence' && c.keyIndex === 2);
    expect(k2Cad.map((c) => c.midis)).toEqual([
      [49, 53, 56],
      [50, 54, 57],
      [49, 52, 57],
      [50, 54, 57],
    ]);

    const directEx = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 84,
      bpm: 120,
      transpose: 'up',
      cadence: 'direct',
      countInBeats: 0,
      restBeats: 1,
    });

    const d0Cad = directEx.chords.filter((c) => c.role === 'cadence' && c.keyIndex === 0);
    expect(d0Cad.map((c) => c.roman)).toEqual(['I']);
    expect(d0Cad.map((c) => c.dur)).toEqual([1.0]);
    expect(d0Cad.map((c) => c.midis)).toEqual([[48, 52, 55]]);
    expect(d0Cad[0]!.start + d0Cad[0]!.dur).toBeCloseTo(directEx.keys[0]!.notesStart, 6);

    const d1Cad = directEx.chords.filter((c) => c.role === 'cadence' && c.keyIndex === 1);
    expect(d1Cad.map((c) => c.roman)).toEqual(['I', 'I']);
    expect(d1Cad.map((c) => c.dur)).toEqual([1.0, 1.0]);
    expect(d1Cad.map((c) => c.midis)).toEqual([
      [48, 52, 55],
      [49, 53, 56],
    ]);
    expect(d1Cad[1]!.start + d1Cad[1]!.dur).toBeCloseTo(directEx.keys[1]!.notesStart, 6);
  });

  it('transpose up 跑 8 個調與 up-down 下行段皆維持就近平行聲部移動，且所有 cadence midis 長度為 3', () => {
    const upEx = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79, // C4..G4 => 8 個調 (60..67)
      bpm: 120,
      transpose: 'up',
      cadence: 'direct',
      countInBeats: 0,
    });
    expect(upEx.keys).toHaveLength(8);
    const upCadences = upEx.chords.filter((c) => c.role === 'cadence');
    for (const c of upCadences) {
      expect(c.midis).toHaveLength(3);
    }
    for (let ki = 1; ki < upEx.keys.length; ki++) {
      const keyCad = upCadences.filter((c) => c.keyIndex === ki);
      expect(keyCad).toHaveLength(2);
      const prevI = keyCad[0]!.midis!;
      const nextI = keyCad[1]!.midis!;
      for (let v = 0; v < 3; v++) {
        expect(nextI[v]!).toBeGreaterThan(prevI[v]!);
      }
    }

    const upDownEx = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 74, // C4..D4 => 60, 61, 62, 61, 60
      bpm: 120,
      transpose: 'up-down',
      cadence: 'direct',
      countInBeats: 0,
    });
    expect(upDownEx.keys.map((k) => k.tonicMidi)).toEqual([60, 61, 62, 61, 60]);
    // 第 4 個調（index 3，D→C#）與第 5 個調（index 4，C#→C）為下行段
    for (const ki of [3, 4]) {
      const keyCad = upDownEx.chords.filter(
        (c) => c.role === 'cadence' && c.keyIndex === ki,
      );
      expect(keyCad).toHaveLength(2);
      const prevI = keyCad[0]!.midis!;
      const nextI = keyCad[1]!.midis!;
      for (let v = 0; v < 3; v++) {
        expect(nextI[v]!).toBeLessThan(prevI[v]!);
      }
    }
    // D→C# 參考音高：[50, 54, 57] -> [49, 53, 56]
    const dToCSharp = upDownEx.chords.filter(
      (c) => c.role === 'cadence' && c.keyIndex === 3,
    );
    expect(dToCSharp.map((c) => c.midis)).toEqual([
      [50, 54, 57],
      [49, 53, 56],
    ]);
  });

  it('小調 i 與 V/7 的 midis 排列正確，且舊值 double 相容為 leading', () => {
    const minorArp = BUILTIN_PATTERNS.find((p) => p.id === 'minor-arpeggio')!;
    const ex = buildExercise(minorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      transpose: 'fixed',
      cadence: 'double' as unknown as 'leading',
      countInBeats: 0,
    });
    const cad = ex.chords.filter((c) => c.role === 'cadence');
    expect(cad.map((c) => c.roman)).toEqual(['i', 'V/7', 'i']);
    expect(cad.map((c) => c.midis)).toEqual([
      [48, 51, 55],
      [47, 50, 55],
      [48, 51, 55],
    ]);
    for (const c of cad) {
      expect(c.midis).toHaveLength(3);
    }
  });
});
