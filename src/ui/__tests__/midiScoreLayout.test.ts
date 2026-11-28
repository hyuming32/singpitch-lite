import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Exercise, NoteEvent } from '../../core/exercise';
import type { MidiAsset, MidiNote } from '../../core/midi';
import { buildMidiExercise, computeMidiBars } from '../../core/midiExercise';
import {
  buildMidiScorePages,
  listPassWindows,
  midiMaxNotesPerPage,
  midiPageIndexAtTime,
  midiScoreLines,
} from '../practice/layout';
import { findBarAtPassSec } from '../../core/midiSeek';
import { JianpuStrip } from '../practice/JianpuStrip';
import {
  buildMidiLineGlyphs,
  buildMidiMeasurePages,
  chooseBarsForLine,
  computeIntroCountdownBars,
  midiLineTimeToX,
  midiMeasurePageIndexAtTime,
  midiMeasureScoreLines,
} from '../practice/midiLayout';
import { StaffView } from '../practice/StaffView';

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

function makeSixteenthRichMidiAsset(barCount = 8): MidiAsset {
  const bpm = 60; // 1 拍 = 1 秒，1 小節 = 4 秒
  const notes: MidiNote[] = [];
  for (let b = 0; b < barCount; b++) {
    // 每小節放 4 個 16 分音符 + 1 個四分 + 1 個二分 = 16 格
    const base = b * 4;
    for (let s = 0; s < 4; s++) {
      notes.push({
        start: base + s * 0.25,
        end: base + (s + 1) * 0.25 - 0.01,
        midi: 60 + s,
        velocity: 90,
        track: 0,
        startTick: b * 480 + s * 30,
        endTick: b * 480 + (s + 1) * 30 - 1,
      });
    }
    notes.push({
      start: base + 1.0,
      end: base + 2.0,
      midi: 67,
      velocity: 90,
      track: 0,
      startTick: b * 480 + 120,
      endTick: b * 480 + 240,
    });
    notes.push({
      start: base + 2.0,
      end: base + 4.0,
      midi: 64,
      velocity: 90,
      track: 0,
      startTick: b * 480 + 240,
      endTick: b * 480 + 480,
    });
  }
  const beats: MidiAsset['beats'] = [];
  for (let i = 0; i < barCount * 4; i++) {
    beats.push([i * 1.0, i % 4, bpm]);
  }
  return {
    tracks: [{ index: 0, name: 'Vocal', notes }],
    duration: barCount * 4,
    ticksPerBeat: 120,
    beats,
  };
}

describe('MIDI 小節制排版、拍點對應與簡譜／五線譜繪製', () => {
  it('每行小節數依可用寬度決定（手機橫放 2 小節、iPad 4 小節、窄寬減為 1 小節）', () => {
    const asset = makeSixteenthRichMidiAsset(8);
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 8,
      countIn: true,
    });

    expect(chooseBarsForLine(res.scoreBars, 0, 260)).toBe(1);
    expect(chooseBarsForLine(res.scoreBars, 0, 580)).toBe(2);
    expect(chooseBarsForLine(res.scoreBars, 0, 1000)).toBe(4);

    const phonePages = buildMidiMeasurePages(res.exercise, res.scoreBars, 580);
    expect(phonePages).toHaveLength(4);
    expect(phonePages.every((p) => p.bars.length === 2)).toBe(true);

    const tabletPages = buildMidiMeasurePages(res.exercise, res.scoreBars, 1000);
    expect(tabletPages).toHaveLength(2);
    expect(tabletPages.every((p) => p.bars.length === 4)).toBe(true);
  });

  it('播放時間正確對應至行與拍點座標，且含前奏時計算剩餘小節倒數', () => {
    const asset = makeSixteenthRichMidiAsset(8);
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 8,
      countIn: true,
    });
    const pages = buildMidiMeasurePages(res.exercise, res.scoreBars, 580);

    // 預備拍（4s）後第 1 頁 4..12s、第 2 頁 12..20s
    expect(midiMeasurePageIndexAtTime(pages, 1.5)).toBe(0);
    expect(midiMeasurePageIndexAtTime(pages, 4.5)).toBe(0);
    expect(midiMeasurePageIndexAtTime(pages, 12.1)).toBe(1);

    const lines = midiMeasureScoreLines(res.exercise, res.scoreBars, 12.5, 2, 580);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.isCurrent).toBe(true);
    expect(lines[0]!.page.firstBarNumber).toBe(3);
    expect(lines[1]!.isPreview).toBe(true);
    expect(lines[1]!.page.firstBarNumber).toBe(5);

    const built = buildMidiLineGlyphs({
      page: lines[0]!.page,
      key: res.transposedKey,
      clef: 'treble',
      scoreWidth: 680,
      lineSpacing: 12,
      isFirstLineInPass: false,
      isLastPageInPass: false,
      passStartSec: 4.0,
    });
    // 2 小節 × 4 拍 = 8 個拍點刻度
    expect(built.renderData.beatTicks).toHaveLength(8);
    // 第 3 小節第 2 拍（abs t = 13.0）游標應精準落在對應拍點 x 上
    const xAtBeat2 = midiLineTimeToX(
      13.0,
      built.renderData.segments,
      built.renderData.leftPad,
      built.renderData.rightEdge,
    );
    expect(xAtBeat2).toBeCloseTo(built.renderData.beatTicks[1]!.x, 5);

    // 若前 3 小節空白、第 4 小節才開唱，第 1 小節期間應倒數 3 小節
    const introNotes: MidiNote[] = [
      {
        start: 12.0,
        end: 13.0,
        midi: 64,
        velocity: 90,
        track: 0,
        startTick: 1440,
        endTick: 1560,
      },
    ];
    const introAsset = makeSixteenthRichMidiAsset(5);
    introAsset.tracks[0]!.notes = introNotes;
    const introRes = buildMidiExercise(introAsset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 5,
      countIn: true,
    });
    expect(computeIntroCountdownBars(introRes.scoreBars, 4.0, 4.5)).toBe(3);
    expect(computeIntroCountdownBars(introRes.scoreBars, 4.0, 8.5)).toBe(2);
    expect(computeIntroCountdownBars(introRes.scoreBars, 4.0, 12.5)).toBe(1);
    expect(computeIntroCountdownBars(introRes.scoreBars, 4.0, 16.5)).toBeNull();
  });

  it('簡譜帶與五線譜正確繪製 8/16 分減時線、延長拍 –、休止符 0、小節線與小節號', () => {
    const notes: MidiNote[] = [
      { start: 0, end: 0.25, midi: 60, velocity: 90, track: 0, startTick: 0, endTick: 30 }, // 16 分（2 條線）
      { start: 0.25, end: 0.75, midi: 62, velocity: 90, track: 0, startTick: 30, endTick: 90 }, // 8 分（1 條線）
      { start: 0.75, end: 1.0, midi: 64, velocity: 90, track: 0, startTick: 90, endTick: 120 }, // 16 分（2 條線）
      // 1.0..2.0 空隙 -> 四分休止符 (0)
      { start: 2.0, end: 4.0, midi: 67, velocity: 90, track: 0, startTick: 240, endTick: 480 }, // 二分音符（含延長拍 –）
    ];
    const asset = makeSixteenthRichMidiAsset(1);
    asset.tracks[0]!.notes = notes;
    const bars = computeMidiBars(asset);
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 1,
      countIn: false,
    });
    expect(bars).toHaveLength(1);
    const pages = buildMidiMeasurePages(res.exercise, res.scoreBars, 600);
    const built = buildMidiLineGlyphs({
      page: pages[0]!,
      key: res.transposedKey,
      clef: 'treble',
      scoreWidth: 600,
      lineSpacing: 12,
      isFirstLineInPass: true,
      isLastPageInPass: true,
      passStartSec: 0,
    });

    const jianpuHtml = renderToStaticMarkup(
      createElement(JianpuStrip, {
        glyphs: built.glyphs,
        activeIndex: 0,
        sec: 0.1,
        activeKey: res.transposedKey,
        tonicMidi: 60,
        jianpuMode: 'fixed',
        isTablet: false,
        extraMarkers: built.renderData.jianpuMarkers,
      }),
    );
    expect(jianpuHtml).toContain('has-2'); // 16 分音符兩條減時線
    expect(jianpuHtml).toContain('has-1'); // 8 分音符一條減時線
    expect(jianpuHtml).toContain('>0<'); // 休止符寫 0
    expect(jianpuHtml).toContain('>–<'); // 二分音符延長拍用 –

    const staffHtml = renderToStaticMarkup(
      createElement(StaffView, {
        width: 600,
        height: 140,
        clef: 'treble',
        activeKey: res.transposedKey,
        window: {
          keyIndex: 0,
          pass: 0,
          phase: 'sing',
          start: pages[0]!.start,
          end: pages[0]!.end,
        },
        glyphs: built.glyphs,
        activeIndex: 0,
        chords: [],
        leftPad: built.renderData.leftPad,
        metrics: { stepY: 6, lineSpacing: 12, baseY: 88, chordY: 12 },
        sung: [],
        countIn: { active: false, dots: [] },
        isTablet: false,
        midiData: built.renderData,
        sec: 0.1,
        introCountdownBars: 2,
      }),
    );
    expect(staffHtml).toContain('staff-bar-number');
    expect(staffHtml).toContain('staff-time-sig');
    expect(staffHtml).toContain('staff-barline');
    expect(staffHtml).toContain('staff-beat-tick');
    expect(staffHtml).toContain('staff-rest');
    expect(staffHtml).toContain('staff-beam-group');
    expect(staffHtml).toContain('再 2 小節開唱');
  });

  it('第 8 小節標準旋律排版：相鄰符頭間距 ≥ 14、符槓不跨拍、同組符桿方向一致、簡譜 x 對齊且窄距隱藏唱名', () => {
    // 60 BPM, 120 TPB -> 1 拍 = 120 ticks = 1.0s，1 格 16 分 = 30 ticks = 0.25s
    const bar8Notes: MidiNote[] = [
      // 拍 1：G4 8分、G4 16分、A4 16分
      { start: 0.0, end: 0.49, midi: 67, velocity: 99, track: 0, startTick: 0, endTick: 59 },
      { start: 0.5, end: 0.74, midi: 67, velocity: 99, track: 0, startTick: 60, endTick: 89 },
      { start: 0.75, end: 0.99, midi: 69, velocity: 99, track: 0, startTick: 90, endTick: 119 },
      // 拍 2：A4 16分、E4 8分、G4 16分
      { start: 1.0, end: 1.24, midi: 69, velocity: 99, track: 0, startTick: 120, endTick: 149 },
      { start: 1.25, end: 1.74, midi: 64, velocity: 99, track: 0, startTick: 150, endTick: 209 },
      { start: 1.75, end: 1.99, midi: 67, velocity: 99, track: 0, startTick: 210, endTick: 239 },
      // 拍 3：G4 附點8分、G4 16分
      { start: 2.0, end: 2.74, midi: 67, velocity: 99, track: 0, startTick: 240, endTick: 329 },
      { start: 2.75, end: 2.99, midi: 67, velocity: 99, track: 0, startTick: 330, endTick: 359 },
      // 拍 4：C5 16分、D5 8分、D5 16分
      { start: 3.0, end: 3.24, midi: 72, velocity: 99, track: 0, startTick: 360, endTick: 389 },
      { start: 3.25, end: 3.74, midi: 74, velocity: 99, track: 0, startTick: 390, endTick: 449 },
      { start: 3.75, end: 3.99, midi: 74, velocity: 99, track: 0, startTick: 450, endTick: 479 },
    ];
    const asset: MidiAsset = {
      tracks: [{ index: 0, name: 'Vocal', notes: bar8Notes }],
      duration: 4.0,
      ticksPerBeat: 120,
      beats: [
        [0, 0, 60],
        [1, 1, 60],
        [2, 2, 60],
        [3, 3, 60],
      ],
    };
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 1,
      countIn: false,
    });
    const lineSpacing = 12;
    const scoreWidth = 600;
    const pages = buildMidiMeasurePages(res.exercise, res.scoreBars, scoreWidth - 96, lineSpacing);
    const built = buildMidiLineGlyphs({
      page: pages[0]!,
      key: res.transposedKey,
      clef: 'treble',
      scoreWidth,
      lineSpacing,
      isFirstLineInPass: true,
      isLastPageInPass: true,
      passStartSec: 0,
    });

    expect(built.glyphs).toHaveLength(11);
    for (let i = 1; i < built.glyphs.length; i++) {
      expect(built.glyphs[i]!.x - built.glyphs[i - 1]!.x).toBeGreaterThanOrEqual(14);
    }

    // 4 拍各成一組符槓，絕不跨拍、同組方向一致（拍 1–3 朝上、拍 4 朝下）
    expect(built.renderData.beamGroups).toHaveLength(4);
    for (let bi = 0; bi < built.renderData.beamGroups.length; bi++) {
      const grp = built.renderData.beamGroups[bi]!;
      const firstRef = built.glyphs[grp.notes[0]!.glyphIndex]!;
      for (const ref of grp.notes) {
        const g = built.glyphs[ref.glyphIndex]!;
        expect(g.barNumber).toBe(firstRef.barNumber);
        expect(g.beatIndex).toBe(firstRef.beatIndex);
        expect(g.stemUp).toBe(grp.stemUp);
      }
    }
    expect(built.renderData.beamGroups[0]!.stemUp).toBe(true);
    expect(built.renderData.beamGroups[1]!.stemUp).toBe(true);
    expect(built.renderData.beamGroups[2]!.stemUp).toBe(true);
    expect(built.renderData.beamGroups[3]!.stemUp).toBe(false);

    // 簡譜每個數字 x 與五線譜符頭 x 完全相同，具同拍相連減時線，且間距 < 38 時隱藏唱名
    const jianpuHtml = renderToStaticMarkup(
      createElement(JianpuStrip, {
        glyphs: built.glyphs,
        activeIndex: 0,
        sec: 0.1,
        activeKey: res.transposedKey,
        tonicMidi: 60,
        jianpuMode: 'fixed',
        isTablet: true,
        underlineSegments: built.renderData.jianpuUnderlineSegments,
        minNoteSpacingPx: built.renderData.minNoteSpacingPx,
      }),
    );
    for (const g of built.glyphs) {
      expect(jianpuHtml).toContain(`left:${g.x}px`);
    }
    expect(jianpuHtml).toContain('jianpu-connected-underline');
    expect(jianpuHtml).not.toContain('jianpu-strip-solfege');
  });

  it('區間第一小節開頭有休止時，pass 視窗、分頁、歌詞／拉桿 passSec 與多遍起點皆對齊小節起點', () => {
    // 4/4 拍、60 BPM（每拍 1 秒、每小節 4 秒），2 小節，第 1 小節前 2 拍休止（音符從 2.0s 開始）
    const notes: MidiNote[] = [
      { start: 2.0, end: 3.0, midi: 60, velocity: 90, track: 0, startTick: 240, endTick: 360 },
      { start: 3.0, end: 4.0, midi: 62, velocity: 90, track: 0, startTick: 360, endTick: 480 },
      { start: 4.0, end: 6.0, midi: 64, velocity: 90, track: 0, startTick: 480, endTick: 720 },
    ];
    const asset: MidiAsset = {
      tracks: [{ index: 0, name: 'Vocal', notes }],
      duration: 8.0,
      ticksPerBeat: 120,
      beats: [
        [0, 0, 60],
        [1, 1, 60],
        [2, 2, 60],
        [3, 3, 60],
        [4, 0, 60],
        [5, 1, 60],
        [6, 2, 60],
        [7, 3, 60],
      ],
    };

    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 2,
      countIn: true,
    });
    const windows = listPassWindows(res.exercise);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start).toBeCloseTo(4.0, 6);

    const pages = buildMidiMeasurePages(res.exercise, res.scoreBars, 580);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.start).toBeCloseTo(4.0, 6);

    // sec = 6.0 時，歌詞與進度拉桿使用的 passSec = 6.0 - 4.0 = 2.0
    const passSecAt6 = 6.0 - windows[0]!.start;
    expect(passSecAt6).toBeCloseTo(2.0, 6);
    expect(findBarAtPassSec(res.scoreBars, passSecAt6)?.barNumber).toBe(1);

    const passDur = 8.0;

    // repeats = 2：第二遍視窗 start = 4.0 + passDur
    const repeatRes = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 2,
      countIn: true,
      repeats: 2,
      mode: 'follow',
    });
    const repeatWindows = listPassWindows(repeatRes.exercise);
    expect(repeatWindows).toHaveLength(2);
    expect(repeatWindows[0]!.start).toBeCloseTo(4.0, 6);
    expect(repeatWindows[1]!.start).toBeCloseTo(4.0 + passDur, 6);

    // listen-then-sing：示範遍 start = 4.0，演唱遍 start = 4.0 + passDur
    const ltsRes = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 2,
      countIn: true,
      repeats: 1,
      mode: 'listen-then-sing',
    });
    const ltsWindows = listPassWindows(ltsRes.exercise);
    expect(ltsWindows).toHaveLength(2);
    expect(ltsWindows[0]!.phase).toBe('listen');
    expect(ltsWindows[0]!.start).toBeCloseTo(4.0, 6);
    expect(ltsWindows[1]!.phase).toBe('sing');
    expect(ltsWindows[1]!.start).toBeCloseTo(4.0 + passDur, 6);
  });
});

