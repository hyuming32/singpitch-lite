import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildExercise } from '../../core/exercise';
import type { Key } from '../../core/key';
import { hzToMidi } from '../../core/notes';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { sungStaffPosition } from '../../core/staff';
import {
  FULL_PIANO_HIGH_MIDI,
  FULL_PIANO_LOW_MIDI,
  layoutKeyboard,
  needleXForMidi,
} from '../piano/pianoGeometry';
import { StaffView } from '../practice/StaffView';
import {
  computeStaffMetrics,
  noteGlyphs,
  passWindow,
  staffLeftPad,
} from '../practice/layout';

describe('音高顯示換算（hz → midi → StaffView y 位置／鋼琴指針）(B3)', () => {
  it('hz=261.63 經 hzToMidi 與 StaffView 繪製後的 y 座標等於中央 C（MIDI 60）符頭位置', () => {
    const cMajor: Key = { tonicPc: 0, mode: 'major' };
    const majorArpeggio = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const ex = buildExercise(majorArpeggio, {
      startTonic: 60, // 中央 C（MIDI 60）
      low: 48,
      high: 84,
      bpm: 120,
      noteBeats: 1,
      repeats: 1,
      transpose: 'fixed',
      countInBeats: 0,
      mode: 'follow',
    });

    const win = passWindow(ex, 0.05)!;
    const width = 720;
    const height = 160;
    const glyphs = noteGlyphs(ex, win, cMajor, 'treble', width);
    const firstNote = glyphs[0]!;
    expect(firstNote.midi).toBe(60);
    expect(firstNote.position).toBe(-2);

    const metrics = computeStaffMetrics(
      glyphs.map((g) => ({ position: g.position })),
      height,
      false,
    );
    const leftPad = staffLeftPad(cMajor, 'treble', metrics.lineSpacing);

    const midiFromHz = hzToMidi(261.63, 440);
    expect(midiFromHz).toBeCloseTo(60, 2);
    expect(sungStaffPosition(midiFromHz, cMajor, 'treble')).toBeCloseTo(-2, 2);

    const sungPoint = { t: firstNote.start + 0.05, midi: midiFromHz };
    const svg = renderToStaticMarkup(
      <StaffView
        width={width}
        height={height}
        clef="treble"
        activeKey={cMajor}
        window={win}
        glyphs={glyphs}
        activeIndex={0}
        chords={[]}
        leftPad={leftPad}
        metrics={metrics}
        sung={[sungPoint]}
        countIn={{ active: false, dots: [] }}
        isTablet={false}
      />,
    );

    // 1. 解析 MIDI 60 符頭的 <ellipse cy="..."> 座標
    const ellipseMatch = svg.match(/<ellipse[^>]*\scy="([^"]+)"/);
    expect(ellipseMatch).not.toBeNull();
    const noteHeadY = Number(ellipseMatch![1]);

    // 2. 解析演唱黃線 <path d="M...,Y" stroke="#e8b400"> 的 y 座標
    const pathMatch = svg.match(/<path d="M[^,]+,([^"]+)"[^>]*stroke="#e8b400"/);
    expect(pathMatch).not.toBeNull();
    const sungY = Number(pathMatch![1]);

    const expectedY = metrics.baseY - firstNote.position * metrics.stepY;
    expect(noteHeadY).toBeCloseTo(expectedY, 3);
    expect(sungY).toBeCloseTo(noteHeadY, 1);

    // 3. 驗證鋼琴指針也準確對齊 MIDI 60 白鍵中心
    const kb = layoutKeyboard({
      lowMidi: FULL_PIANO_LOW_MIDI,
      highMidi: FULL_PIANO_HIGH_MIDI,
      W: 36,
      preset: 'korg',
      height: 120,
    });
    const c4Key = kb.whites.find((w) => w.midi === 60)!;
    const needleX = needleXForMidi(midiFromHz, kb)!;
    expect(needleX).toBeCloseTo(c4Key.x + c4Key.w / 2, 1);
  });
});
