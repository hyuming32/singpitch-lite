import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildExercise } from '../../core/exercise';
import type { Key } from '../../core/key';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { StaffView } from '../practice/StaffView';
import { freeSpan, freeSungPoints } from '../practice/freeSung';
import {
  computeStaffMetrics,
  noteGlyphs,
  passWindow,
  staffLeftPad,
} from '../practice/layout';

describe('沒播放時的即時黃線會畫在五線譜上', () => {
  it('停在開頭、只有麥克風樣本也會畫出 staff-live-sung 路徑', () => {
    const cMajor: Key = { tonicPc: 0, mode: 'major' };
    const pattern = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const ex = buildExercise(pattern, {
      startTonic: 60, low: 48, high: 84, bpm: 120, noteBeats: 1, repeats: 1,
      transpose: 'fixed', countInBeats: 0, mode: 'follow',
    });
    const win = passWindow(ex, 0)!;
    const width = 720;
    const height = 160;
    const glyphs = noteGlyphs(ex, win, cMajor, 'treble', width);
    const metrics = computeStaffMetrics(glyphs.map((g) => ({ position: g.position })), height, false);
    const leftPad = staffLeftPad(cMajor, 'treble', metrics.lineSpacing);

    const now = 50;
    const samples = Array.from({ length: 40 }, (_, i) => ({ wall: now - 1 + i * 0.025, midi: 60 }));
    const span = freeSpan(win.start, win.end, 0)!;
    const live = freeSungPoints(samples, now, span);
    expect(live.length).toBeGreaterThan(30);
    expect(Math.max(...live.map((p) => p.t))).toBeCloseTo(win.end, 1);

    const svg = renderToStaticMarkup(
      <StaffView width={width} height={height} clef="treble" activeKey={cMajor} window={win}
        glyphs={glyphs} activeIndex={0} chords={[]} leftPad={leftPad} metrics={metrics}
        sung={[]} liveSung={live} countIn={{ active: false, dots: [] }} isTablet={false} />,
    );
    expect(svg).toMatch(/class="staff-live-sung" d="M[\d.]+,[\d.]+ L/);
  });

  it('沒有即時樣本時不畫', () => {
    const cMajor: Key = { tonicPc: 0, mode: 'major' };
    const pattern = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const ex = buildExercise(pattern, {
      startTonic: 60, low: 48, high: 84, bpm: 120, noteBeats: 1, repeats: 1,
      transpose: 'fixed', countInBeats: 0, mode: 'follow',
    });
    const win = passWindow(ex, 0)!;
    const glyphs = noteGlyphs(ex, win, cMajor, 'treble', 720);
    const metrics = computeStaffMetrics(glyphs.map((g) => ({ position: g.position })), 160, false);
    const svg = renderToStaticMarkup(
      <StaffView width={720} height={160} clef="treble" activeKey={cMajor} window={win}
        glyphs={glyphs} activeIndex={0} chords={[]} leftPad={40} metrics={metrics}
        sung={[]} countIn={{ active: false, dots: [] }} isTablet={false} />,
    );
    expect(svg).not.toContain('staff-live-sung');
  });
});
