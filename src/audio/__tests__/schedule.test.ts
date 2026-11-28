import { describe, expect, it } from 'vitest';
import { buildExercise } from '../../core/exercise';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { compileExercise } from '../dsp/schedule';

describe('compileExercise', () => {
  const rate = 48000;
  const majorArp = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
  const fifthGlide = BUILTIN_PATTERNS.find((p) => p.id === 'fifth-glide')!;

  it('compiles major arpeggio with clicks, cadence, and listen-then-sing (no pad when cadence is on)', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      cadence: true,
      countInBeats: 4,
      mode: 'listen-then-sing',
      repeats: 1,
      transpose: 'fixed',
    });

    const compiled = compileExercise(ex, rate, {
      pianoDuringSing: true,
      pad: true,
      click: true,
    });

    // 驗證節拍器數量與 frame
    const clicks = compiled.events.filter((e) => e.type === 'click');
    expect(clicks).toHaveLength(4);
    expect(clicks.map((c) => c.frame)).toEqual([0, 24000, 48000, 72000]);

    // 驗證 cadence 三個引導和弦（I → V/7 → I，每個和弦 3 個音 = 9 個 noteOn）
    const cadenceOn = compiled.events.filter(
      (e) => e.type === 'noteOn' && e.bus === 'cadence',
    );
    expect(cadenceOn).toHaveLength(9);
    // 驗證 C 大調 I [48,52,55] → V/7 [47,50,55] → I [48,52,55]
    const cadenceIds = cadenceOn.map((e) => (e.type === 'noteOn' ? e.id : ''));
    expect(cadenceIds).toEqual([
      'cadence:0:48',
      'cadence:0:52',
      'cadence:0:55',
      'cadence:1:47',
      'cadence:1:50',
      'cadence:1:55',
      'cadence:2:48',
      'cadence:2:52',
      'cadence:2:55',
    ]);

    // 有 cadence 時不產生 pad 事件
    const padOn = compiled.events.filter(
      (e) => e.type === 'noteOn' && e.bus === 'pad',
    );
    expect(padOn).toHaveLength(0);

    // 驗證事件依 frame 排序，且每個 noteOn 都有對應 noteOff
    const activeIds = new Set<string>();
    for (let i = 1; i < compiled.events.length; i++) {
      const prev = compiled.events[i - 1]!;
      const curr = compiled.events[i]!;
      expect(curr.frame).toBeGreaterThanOrEqual(prev.frame);
      if (curr.frame === prev.frame && curr.type === 'noteOff') {
        expect(prev.type).toBe('noteOff');
      }
    }
    for (const ev of compiled.events) {
      if (ev.type === 'noteOn' || ev.type === 'glide') {
        expect(activeIds.has(ev.id)).toBe(false);
        activeIds.add(ev.id);
      } else if (ev.type === 'noteOff') {
        expect(activeIds.has(ev.id)).toBe(true);
        activeIds.delete(ev.id);
      }
    }
    expect(activeIds.size).toBe(0);
  });

  it('compiles pad noteOn events when cadence is off and pad is true', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      cadence: 'off',
      countInBeats: 0,
      repeats: 1,
      transpose: 'fixed',
    });

    const compiled = compileExercise(ex, rate, {
      pianoDuringSing: true,
      pad: true,
      click: false,
    });

    const padOn = compiled.events.filter(
      (e) => e.type === 'noteOn' && e.bus === 'pad',
    );
    expect(padOn.length).toBeGreaterThan(0);
    for (const p of padOn) {
      if (p.type === 'noteOn') {
        expect(p.id.startsWith('pad:')).toBe(true);
        expect(p.held).toBe(true);
      }
    }
  });

  it('omits sing notes when pianoDuringSing is false while keeping listen notes', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      cadence: true,
      countInBeats: 4,
      mode: 'listen-then-sing',
      repeats: 1,
      transpose: 'fixed',
    });

    const compiled = compileExercise(ex, rate, { pianoDuringSing: false });
    const melodyOns = compiled.events.filter(
      (e) => e.type === 'noteOn' && e.bus === 'melody',
    );
    // 只有 listen 階段的 7 個音
    expect(melodyOns).toHaveLength(7);
  });

  it('routes sing phase notes to melodySing bus separately from listen phase', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      cadence: true,
      countInBeats: 4,
      mode: 'listen-then-sing',
      repeats: 1,
      transpose: 'fixed',
    });

    const compiled = compileExercise(ex, rate, { pianoDuringSing: true });
    const listenOns = compiled.events.filter(
      (e) => e.type === 'noteOn' && e.bus === 'melody',
    );
    const singOns = compiled.events.filter(
      (e) => e.type === 'noteOn' && e.bus === 'melodySing',
    );
    expect(listenOns).toHaveLength(7);
    expect(singOns).toHaveLength(7);
  });

  it('produces glide events for glide patterns when voiceForGlide is true', () => {
    const ex = buildExercise(fifthGlide, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm: 120,
      mode: 'listen-then-sing',
      repeats: 1,
      transpose: 'fixed',
    });

    const compiled = compileExercise(ex, rate, { voiceForGlide: true });
    const glides = compiled.events.filter((e) => e.type === 'glide');
    expect(glides.length).toBeGreaterThan(0);
  });

  it('produces beatClicks on metro bus across the entire exercise without duplicates', () => {
    const bpm = 120;
    const countInBeats = 4;
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm,
      cadence: true,
      countInBeats,
      mode: 'listen-then-sing',
      repeats: 1,
      transpose: 'fixed',
    });

    const compiled = compileExercise(ex, rate, {
      beatClicks: true,
      bpm,
      click: true,
    });

    const clicks = compiled.events.filter((e) => e.type === 'click');
    const firstBeat = ex.clicks[0]?.t ?? 0;
    const beatSec = 60 / bpm;
    // 預備拍起至 ex.total（不含結束點），精確拍數為 ceil((ex.total - firstBeat - 1e-6) / beatSec)
    const expectedCount = Math.ceil((ex.total - firstBeat - 1e-6) / beatSec);
    expect(clicks).toHaveLength(expectedCount);
    expect(expectedCount).toBeGreaterThan(countInBeats);

    // 全部走 'metro' 匯流排、無重複時間點、accent 每 4 拍一次
    for (let i = 0; i < clicks.length; i++) {
      const c = clicks[i]!;
      if (c.type === 'click') {
        expect(c.bus).toBe('metro');
        expect(c.accent).toBe(i % 4 === 0);
      }
      if (i > 0) {
        expect(c.frame).toBeGreaterThan(clicks[i - 1]!.frame);
      }
    }
  });

  it('countInOnClickBus：預備拍走 click 匯流排、之後每拍走 metro，不重複', () => {
    const bpm = 120;
    const countInBeats = 4;
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm,
      cadence: false,
      countInBeats,
      mode: 'follow',
      repeats: 1,
      transpose: 'fixed',
    });
    const compiled = compileExercise(ex, rate, {
      beatClicks: true,
      countInOnClickBus: true,
      click: true,
      bpm,
    });
    const clickBus = compiled.events.filter(
      (e) => e.type === 'click' && e.bus === 'click',
    );
    const metroBus = compiled.events.filter(
      (e) => e.type === 'click' && e.bus === 'metro',
    );
    expect(clickBus).toHaveLength(ex.clicks.length);
    expect(metroBus.length).toBeGreaterThan(0);
    const lastCountIn = Math.max(...clickBus.map((e) => e.frame));
    expect(Math.min(...metroBus.map((e) => e.frame))).toBeGreaterThan(lastCountIn);
  });

  it('supports decimal bpm=72.5 with beat interval 60/72.5 sec (< 1 sample error)', () => {
    const bpm = 72.5;
    const expectedBeatSec = 60 / bpm;
    const expectedBeatFrames = expectedBeatSec * rate;

    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 79,
      bpm,
      cadence: false,
      countInBeats: 4,
      mode: 'follow',
      repeats: 1,
      transpose: 'fixed',
    });

    const compiled = compileExercise(ex, rate, {
      beatClicks: true,
      bpm,
      click: true,
    });

    const clicks = compiled.events.filter((e) => e.type === 'click');
    expect(clicks.length).toBeGreaterThan(4);

    for (let i = 0; i < clicks.length; i++) {
      const expectedFrame = i * expectedBeatFrames;
      expect(Math.abs(clicks[i]!.frame - expectedFrame)).toBeLessThan(1);
      if (i > 0) {
        const intervalSec = (clicks[i]!.frame - clicks[i - 1]!.frame) / rate;
        expect(Math.abs(intervalSec - expectedBeatSec)).toBeLessThan(1 / rate);
      }
    }
  });

  it('cadence 事件帶有 midis 時，排程出來的音高與 midis 完全一致', () => {
    const ex = buildExercise(majorArp, {
      startTonic: 60,
      low: 48,
      high: 74, // C4, C#4, D4
      bpm: 120,
      cadence: 'direct',
      countInBeats: 0,
      transpose: 'up',
    });

    const compiled = compileExercise(ex, rate, {
      a4: 440,
      pad: false,
      click: false,
    });

    const cadenceChords = ex.chords.filter((c) => c.role === 'cadence');
    const cadenceOn = compiled.events.filter(
      (e): e is Extract<typeof e, { type: 'noteOn' }> =>
        e.type === 'noteOn' && e.bus === 'cadence',
    );

    const expectedMidis = cadenceChords.flatMap((c) => c.midis ?? []);
    expect(cadenceOn).toHaveLength(expectedMidis.length);
    for (let i = 0; i < expectedMidis.length; i++) {
      const expectedHz = 440 * Math.pow(2, (expectedMidis[i]! - 69) / 12);
      expect(cadenceOn[i]!.hz).toBeCloseTo(expectedHz, 6);
    }
  });

  it('影子模式空拍事件不送出任何鋼琴音（即使 pianoDuringSing 為 true）', () => {
    const ex = buildExercise(
      { jianpu: '1 2 3~5', chords: 'I' },
      {
        startTonic: 60,
        low: 48,
        high: 79,
        bpm: 60,
        mode: 'shadow',
        countInBeats: 0,
        cadence: 'off',
        transpose: 'fixed',
      },
    );

    const compiled = compileExercise(ex, rate, {
      pianoDuringSing: true,
      pad: true,
      click: false,
      beatClicks: false,
    });

    // 4 個示範音（1, 2, 3~5, 5，各有開始與結束）共 8 筆事件；空拍與 pad 皆不應出現
    const melodyEvents = compiled.events.filter(
      (e) => e.type === 'noteOn' || e.type === 'noteOff' || e.type === 'glide',
    );
    expect(melodyEvents).toHaveLength(8);
    for (const ev of melodyEvents) {
      if ('bus' in ev) {
        expect(ev.bus).toBe('melody');
      }
    }
  });
});
