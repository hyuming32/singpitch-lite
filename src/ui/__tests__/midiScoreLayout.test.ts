import { describe, expect, it } from 'vitest';
import type { Exercise, NoteEvent } from '../../core/exercise';
import {
  buildMidiScorePages,
  midiMaxNotesPerPage,
  midiPageIndexAtTime,
  midiScoreLines,
} from '../practice/layout';

function makeLongMidiExercise(noteCount = 132, noteDur = 0.5): Exercise {
  const notes: NoteEvent[] = [];
  const countInEnd = 2.0;
  for (let i = 0; i < noteCount; i++) {
    notes.push({
      start: countInEnd + i * noteDur,
      dur: noteDur * 0.9,
      midi: 60 + (i % 12),
      keyIndex: 0,
      pass: 0,
      phase: 'sing',
    });
  }
  const end = countInEnd + noteCount * noteDur;
  return {
    keys: [
      {
        index: 0,
        tonicMidi: 60,
        key: { tonicPc: 0, mode: 'major' },
        start: countInEnd,
        notesStart: countInEnd,
        end,
      },
    ],
    notes,
    chords: [],
    clicks: [
      { t: 0, accent: true },
      { t: 0.5, accent: false },
      { t: 1.0, accent: false },
      { t: 1.5, accent: false },
    ],
    total: end,
  };
}

describe('MIDI 樂譜分頁（buildMidiScorePages / midiPageIndexAtTime / midiScoreLines）', () => {
  it('132 音長旋律分頁後每頁音數有上限、總音數守恆且頁與頁時間連續', () => {
    const ex = makeLongMidiExercise(132, 0.5);
    const availableWidth = 600;
    const maxPerPage = midiMaxNotesPerPage(availableWidth);
    const pages = buildMidiScorePages(ex, availableWidth);

    expect(pages.length).toBeGreaterThan(1);
    let totalNotes = 0;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]!;
      const count = p.noteRange[1] - p.noteRange[0];
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(maxPerPage);
      expect(p.end).toBeGreaterThan(p.start);
      if (i > 0) {
        expect(p.start).toBeCloseTo(pages[i - 1]!.end, 6);
        expect(p.noteRange[0]).toBe(pages[i - 1]!.noteRange[1]);
      }
      totalNotes += count;
    }
    expect(totalNotes).toBe(132);
    expect(pages[0]!.start).toBeCloseTo(2.0, 6);
    expect(pages[pages.length - 1]!.end).toBeCloseTo(68.0, 6);
  });

  it('播放時間正確對應到頁碼，並在跨越頁尾時自動翻頁', () => {
    const ex = makeLongMidiExercise(132, 0.5);
    const pages = buildMidiScorePages(ex, 600);

    // 預備拍期間停在第 0 頁
    expect(midiPageIndexAtTime(pages, 0.5)).toBe(0);
    // 第 0 頁中段
    expect(midiPageIndexAtTime(pages, pages[0]!.start + 0.1)).toBe(0);
    // 跨入第 1 頁
    expect(midiPageIndexAtTime(pages, pages[1]!.start)).toBe(1);
    // 最後一頁與結尾之後
    const lastIdx = pages.length - 1;
    expect(midiPageIndexAtTime(pages, pages[lastIdx]!.start + 0.1)).toBe(lastIdx);
    expect(midiPageIndexAtTime(pages, ex.total + 5)).toBe(lastIdx);

    const lines = midiScoreLines(ex, pages[1]!.start + 0.1, 2, 600);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.isCurrent).toBe(true);
    expect(lines[0]!.noteRange).toEqual(pages[1]!.noteRange);
    expect(lines[1]!.isCurrent).toBe(false);
    expect(lines[1]!.isPreview).toBe(true);
    expect(lines[1]!.noteRange).toEqual(pages[2]!.noteRange);
  });
});
