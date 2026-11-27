import { describe, expect, it } from 'vitest';
import { buildExercise } from '../../core/exercise';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { compileExercise } from '../dsp/schedule';

describe('compileExercise', () => {
  const rate = 48000;
  const majorArp = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
  const fifthGlide = BUILTIN_PATTERNS.find((p) => p.id === 'fifth-glide')!;

  it('compiles major arpeggio with clicks, cadence, pad, and listen-then-sing', () => {
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

    // 驗證 cadence 三個和弦（每個和弦 3 個音 = 9 個 noteOn）
    const cadenceOn = compiled.events.filter(
      (e) => e.type === 'noteOn' && e.bus === 'cadence',
    );
    expect(cadenceOn).toHaveLength(9);

    // 驗證 pad id 前綴
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
});
