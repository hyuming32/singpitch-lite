import type { Exercise } from '../../core/exercise';
import { keyName, type Key } from '../../core/key';
import type { JianpuAccidental } from '../../core/jianpu';
import type { MidiScoreBar, MidiScoreEvent, NoteDurationType } from '../../core/midiScore';
import { staffPosition, type Clef } from '../../core/staff';
import {
  listPassWindows,
  staffLeftPad,
  timeToX,
  type NoteGlyph,
  type ScoreLine,
} from './layout';

export const MIN_SIXTEENTH_SPACING_PX = 14;

export interface MidiBarLayoutSegment {
  barNumber: number;
  /** 練習時間軸絕對開始秒數 */
  absStartSec: number;
  /** 練習時間軸絕對結束秒數 */
  absEndSec: number;
  /** 小節線起始 X */
  barStartX: number;
  /** 內容區（第一拍）起始 X */
  contentStartX: number;
  /** 小節結束線 X */
  endX: number;
  numerator: number;
  denominator: number;
  timeSigChanged: boolean;
  sixteenthsInBar: number;
  sixteenthsPerBeat: number;
  beatAbsSecs: number[];
  events: MidiScoreEvent[];
}

export interface MidiBeatTick {
  x: number;
  t: number;
  isDownbeat: boolean;
  barNumber: number;
  beatIndex: number;
}

export interface MidiBarlineMark {
  x: number;
  barNumber: number;
  isStart?: boolean;
  isFinal?: boolean;
}

export interface MidiTimeSigMark {
  x: number;
  numerator: number;
  denominator: number;
}

export interface MidiBeamNoteRef {
  glyphIndex: number;
  x: number;
  position: number;
  durationType: NoteDurationType;
}

export interface MidiBeamGroup {
  stemUp: boolean;
  extremePosition: number;
  notes: MidiBeamNoteRef[];
}

export interface MidiJianpuMarker {
  x: number;
  t: number;
  symbol: '–' | '0';
}

export interface MidiJianpuUnderlineSegment {
  x1: number;
  x2: number;
  level: 1 | 2;
  /** 該連線所屬最後一個音符的結束秒數（供播放變色判斷） */
  endSec: number;
  /** 是否包含目前正在唱的音 */
  isCurrent: boolean;
}

export interface MidiMeasurePage {
  keyIndex: number;
  pass: number;
  phase: 'listen' | 'sing';
  /** 此頁涵蓋的小節（相對於 scoreBars 陣列的 [startBarIdx, endBarIdx)） */
  barRange: readonly [number, number];
  /** 此頁第一小節的原始小節號（1 起算） */
  firstBarNumber: number;
  start: number;
  end: number;
  pageIndex: number;
  totalPages: number;
  bars: MidiScoreBar[];
}

export interface MidiLineRenderData {
  lineBarNumber: number;
  leftPad: number;
  rightEdge: number;
  /** 此行相鄰音符／休止符的最小水平間距（px） */
  minNoteSpacingPx: number;
  segments: MidiBarLayoutSegment[];
  beatTicks: MidiBeatTick[];
  barlines: MidiBarlineMark[];
  timeSigs: MidiTimeSigMark[];
  beamGroups: MidiBeamGroup[];
  jianpuMarkers: MidiJianpuMarker[];
  jianpuUnderlineSegments: MidiJianpuUnderlineSegment[];
}

function minEventSixteenths(bar: MidiScoreBar): number {
  let minDur = 4;
  let hasNoteOrSubBeatRest = false;
  for (const ev of bar.events) {
    if (ev.kind === 'note' || ev.durationType !== 'whole') {
      hasNoteOrSubBeatRest = true;
      if (ev.durSixteenths < minDur) {
        minDur = ev.durSixteenths;
      }
    }
  }
  return hasNoteOrSubBeatRest ? Math.max(1, minDur) : 4;
}

function requiredBarWidthPx(
  bar: MidiScoreBar,
  isLineStart: boolean,
  lineSpacing = 10,
): number {
  const minUnit = minEventSixteenths(bar);
  const minGapPx = Math.max(MIN_SIXTEENTH_SPACING_PX, 1.45 * lineSpacing);
  const perSixteenth =
    minUnit <= 1 ? minGapPx : minUnit === 2 ? Math.max(10, minGapPx * 0.65) : Math.max(8, minGapPx * 0.45);
  const contentMin = Math.max(112, bar.sixteenthsInBar * perSixteenth);
  const leadTrailPad = 1.6 * lineSpacing;
  const inlineTsExtra = !isLineStart && bar.timeSigChanged ? 2.2 * lineSpacing : 0;
  return contentMin + leadTrailPad + inlineTsExtra;
}

/** 依可用寬度決定每行應放幾個整數小節（手機橫放約 2 小節、iPad 約 4 小節；保證相鄰音符不重疊且 16 分間距 ≥ 14 px） */
export function chooseBarsForLine(
  bars: readonly MidiScoreBar[],
  startIdx: number,
  usableWidth: number,
  lineSpacing = 10,
): number {
  const remaining = bars.length - startIdx;
  if (remaining <= 1) return Math.max(0, remaining);

  const safeUsable = Number.isFinite(usableWidth) ? Math.max(120, usableWidth) : 600;
  const targetMax = safeUsable >= 820 ? 4 : 2;
  const maxTry = Math.min(targetMax, remaining);

  let bestCount = 1;
  let accumulated = 0;
  for (let k = 0; k < maxTry; k++) {
    const bar = bars[startIdx + k]!;
    accumulated += requiredBarWidthPx(bar, k === 0, lineSpacing);
    if (accumulated <= safeUsable + 1e-6) {
      bestCount = k + 1;
    } else {
      break;
    }
  }
  return bestCount;
}

/** 將 MIDI Exercise 的各遍旋律依可用寬度切成「每行整數個小節」的連續分頁 */
export function buildMidiMeasurePages(
  ex: Exercise,
  scoreBars: readonly MidiScoreBar[],
  availableWidth: number,
  lineSpacing = 10,
): MidiMeasurePage[] {
  const windows = listPassWindows(ex);
  if (windows.length === 0 || scoreBars.length === 0) {
    return [];
  }

  const rawPages: Omit<MidiMeasurePage, 'pageIndex' | 'totalPages'>[] = [];

  for (const w of windows) {
    let barIdx = 0;
    while (barIdx < scoreBars.length) {
      const count = Math.max(
        1,
        chooseBarsForLine(scoreBars, barIdx, availableWidth, lineSpacing),
      );
      const slice = scoreBars.slice(barIdx, barIdx + count);
      const first = slice[0]!;
      const last = slice[slice.length - 1]!;
      const pageStart = w.start + first.startSec;
      const pageEnd =
        barIdx + count >= scoreBars.length
          ? Math.max(pageStart + 0.01, w.end)
          : Math.max(pageStart + 0.01, w.start + last.endSec);

      rawPages.push({
        keyIndex: w.keyIndex,
        pass: w.pass,
        phase: w.phase,
        barRange: [barIdx, barIdx + count],
        firstBarNumber: first.barNumber,
        start: pageStart,
        end: pageEnd,
        bars: slice,
      });

      barIdx += count;
    }
  }

  const totalPages = rawPages.length;
  return rawPages.map((p, pageIndex) => ({
    ...p,
    pageIndex,
    totalPages,
  }));
}

/** 依目前播放秒數找出對應的 MIDI 小節頁索引（0 起算） */
export function midiMeasurePageIndexAtTime(
  pages: readonly MidiMeasurePage[],
  sec: number,
): number {
  if (pages.length === 0) return 0;
  if (sec < pages[0]!.start) return 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    if (sec >= p.start && sec < p.end) {
      return i;
    }
  }
  return pages.length - 1;
}

export interface MidiMeasureScoreLine extends ScoreLine {
  page: MidiMeasurePage;
}

/** 規劃 MIDI 練唱的小節式樂譜顯示行（目前頁＋後續預覽頁） */
export function midiMeasureScoreLines(
  ex: Exercise,
  scoreBars: readonly MidiScoreBar[],
  sec: number,
  maxLines: number,
  availableWidth: number,
  lineSpacing = 10,
): MidiMeasureScoreLine[] {
  const pages = buildMidiMeasurePages(ex, scoreBars, availableWidth, lineSpacing);
  if (pages.length === 0) return [];

  const activeIdx = midiMeasurePageIndexAtTime(pages, sec);
  const count = Math.max(1, Math.min(maxLines, pages.length - activeIdx));
  const lines: MidiMeasureScoreLine[] = [];

  for (let i = 0; i < count; i++) {
    const page = pages[activeIdx + i]!;
    const isCurrent = i === 0;
    const prevPage = activeIdx + i > 0 ? pages[activeIdx + i - 1]! : null;
    const isSamePassContinuation =
      prevPage !== null &&
      prevPage.keyIndex === page.keyIndex &&
      prevPage.pass === page.pass &&
      prevPage.phase === page.phase;

    lines.push({
      keyIndex: page.keyIndex,
      pass: page.pass,
      phase: page.phase,
      noteRange: [0, 0],
      start: page.start,
      end: page.end,
      isCurrent,
      label: isCurrent
        ? null
        : `第 ${page.pageIndex + 1}/${page.totalPages} 頁`,
      isSamePassContinuation,
      isPreview: !isCurrent,
      page,
    });
  }

  return lines;
}

/** 將絕對播放秒數對映至 MIDI 行內各小節的分段 X 座標（精準跨越變拍號與小節線間隙） */
export function midiLineTimeToX(
  t: number,
  segments: readonly MidiBarLayoutSegment[],
  fallbackLeft: number,
  fallbackRight: number,
): number {
  if (segments.length === 0) {
    return fallbackLeft;
  }
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (t <= first.absStartSec) {
    return first.contentStartX;
  }
  if (t >= last.absEndSec) {
    return last.endX;
  }
  for (const seg of segments) {
    if (t >= seg.absStartSec && t <= seg.absEndSec) {
      return timeToX(
        t,
        seg.absStartSec,
        seg.absEndSec,
        seg.contentStartX,
        seg.endX,
      );
    }
  }
  return fallbackRight;
}

/** 計算單一 MIDI 樂譜行的完整繪製資料（小節線、拍號、拍點、音符／休止符、連結線、符槓、簡譜對齊點） */
export function buildMidiLineGlyphs(params: {
  page: MidiMeasurePage;
  key: Key;
  clef: Clef;
  scoreWidth: number;
  rightPad?: number;
  lineSpacing: number;
  isFirstLineInPass: boolean;
  isLastPageInPass: boolean;
  passStartSec: number;
}): {
  glyphs: NoteGlyph[];
  renderData: MidiLineRenderData;
} {
  const {
    page,
    key,
    clef,
    scoreWidth,
    rightPad = 18,
    lineSpacing,
    isFirstLineInPass,
    isLastPageInPass,
    passStartSec,
  } = params;

  const baseLeftPad = staffLeftPad(key, clef, lineSpacing);
  const firstBar = page.bars[0];
  const showHeaderTimeSig =
    Boolean(firstBar) && (isFirstLineInPass || Boolean(firstBar?.timeSigChanged));
  const headerTsWidth = showHeaderTimeSig ? 1.8 * lineSpacing : 0;
  const leftPad = Math.ceil(baseLeftPad + headerTsWidth);
  const rightEdge = Math.max(leftPad + 40, scoreWidth - rightPad);

  const timeSigs: MidiTimeSigMark[] = [];
  if (showHeaderTimeSig && firstBar) {
    timeSigs.push({
      x: baseLeftPad + 0.55 * lineSpacing,
      numerator: firstBar.numerator,
      denominator: firstBar.denominator,
    });
  }

  // 計算行內各小節水平寬度（依 16 分音符格數等比分配剩餘寬度，保留小節頭尾空間與中途變拍號空間）
  const normalLeadPad = 0.9 * lineSpacing;
  const timeSigLeadPad = 2.5 * lineSpacing;
  const trailPad = 0.65 * lineSpacing;

  const barLeadPads = page.bars.map((b, idx) =>
    idx > 0 && b.timeSigChanged ? timeSigLeadPad : normalLeadPad,
  );
  const totalPad =
    barLeadPads.reduce((a, b) => a + b, 0) + page.bars.length * trailPad;
  const totalSixteenths = page.bars.reduce(
    (sum, b) => sum + b.sixteenthsInBar,
    0,
  );
  const totalLineWidth = Math.max(40, rightEdge - leftPad);
  const distributable = Math.max(20, totalLineWidth - totalPad);

  const segments: MidiBarLayoutSegment[] = [];
  const barlines: MidiBarlineMark[] = [];
  const beatTicks: MidiBeatTick[] = [];
  const glyphs: NoteGlyph[] = [];
  const jianpuMarkers: MidiJianpuMarker[] = [];

  let xCursor = leftPad;

  for (let bi = 0; bi < page.bars.length; bi++) {
    const bar = page.bars[bi]!;
    const leadPad = barLeadPads[bi]!;
    const contentWidth =
      totalSixteenths > 0
        ? (bar.sixteenthsInBar / totalSixteenths) * distributable
        : distributable / Math.max(1, page.bars.length);
    const barStartX = xCursor;
    const contentStartX = barStartX + leadPad;
    const contentEndX = contentStartX + contentWidth;
    const endX =
      bi === page.bars.length - 1 ? rightEdge : contentEndX + trailPad;

    const absStartSec = passStartSec + bar.startSec;
    const absEndSec = passStartSec + bar.endSec;

    if (bi > 0) {
      barlines.push({
        x: barStartX,
        barNumber: bar.barNumber,
        isStart: true,
      });
      if (bar.timeSigChanged) {
        timeSigs.push({
          x: barStartX + 1.1 * lineSpacing,
          numerator: bar.numerator,
          denominator: bar.denominator,
        });
      }
    }

    const beatAbsSecs = bar.beatStartSecs.map((bs) => passStartSec + bs);
    for (let k = 0; k < beatAbsSecs.length; k++) {
      const bt = beatAbsSecs[k]!;
      const bx = timeToX(bt, absStartSec, absEndSec, contentStartX, contentEndX);
      beatTicks.push({
        x: bx,
        t: bt,
        isDownbeat: k === 0,
        barNumber: bar.barNumber,
        beatIndex: k,
      });
    }

    segments.push({
      barNumber: bar.barNumber,
      absStartSec,
      absEndSec,
      barStartX,
      contentStartX,
      endX: contentEndX,
      numerator: bar.numerator,
      denominator: bar.denominator,
      timeSigChanged: bar.timeSigChanged,
      sixteenthsInBar: bar.sixteenthsInBar,
      sixteenthsPerBeat: bar.sixteenthsPerBeat,
      beatAbsSecs,
      events: bar.events,
    });

    for (const ev of bar.events) {
      const evAbsStart = passStartSec + ev.startSec;
      const gx = timeToX(
        evAbsStart,
        absStartSec,
        absEndSec,
        contentStartX,
        contentEndX,
      );

      if (ev.kind === 'rest') {
        const restPos = ev.durationType === 'whole' ? 6 : 4;
        glyphs.push({
          x: gx,
          position: restPos,
          accidental: '' as JianpuAccidental,
          ledgerLines: [],
          stemUp: true,
          midi: 60,
          start: evAbsStart,
          dur: ev.durSec,
          isRest: true,
          durationType: ev.durationType,
          dotted: ev.dotted,
          barNumber: bar.barNumber,
          beatIndex: ev.beatIndex,
          jianpuUnderlines: ev.jianpuUnderlines,
          jianpuDot: ev.jianpuDot,
        });
      } else {
        const midi = ev.midi ?? 60;
        const sp = staffPosition(midi, key, clef);
        glyphs.push({
          x: gx,
          position: sp.position,
          accidental: sp.accidental,
          ledgerLines: sp.ledgerLines,
          stemUp: sp.position < 4,
          midi,
          start: evAbsStart,
          dur: ev.durSec,
          isRest: false,
          durationType: ev.durationType,
          dotted: ev.dotted,
          ...(ev.tieFromPrev ? { tieFromPrev: true } : {}),
          ...(ev.tieToNext ? { tieToNext: true } : {}),
          barNumber: bar.barNumber,
          beatIndex: ev.beatIndex,
          jianpuUnderlines: ev.jianpuUnderlines,
          jianpuDot: ev.jianpuDot,
          ...(ev.tieFromPrev ? { jianpuSymbol: '–' as const } : {}),
        });
      }

      for (const cont of ev.jianpuContinuations) {
        const contAbs = passStartSec + cont.offsetSec;
        const cx = timeToX(
          contAbs,
          absStartSec,
          absEndSec,
          contentStartX,
          contentEndX,
        );
        jianpuMarkers.push({
          x: cx,
          t: contAbs,
          symbol: cont.symbol,
        });
      }
    }

    xCursor = endX;
  }

  barlines.push({
    x: rightEdge,
    barNumber: page.bars[page.bars.length - 1]?.barNumber ?? page.firstBarNumber,
    isFinal: isLastPageInPass,
  });

  // 計算相鄰音符／休止符最小水平間距（px），供簡譜自適應縮放與隱藏唱名使用
  let minNoteSpacingPx = 40;
  for (let i = 1; i < glyphs.length; i++) {
    const dx = glyphs[i]!.x - glyphs[i - 1]!.x;
    if (dx > 0 && dx < minNoteSpacingPx) {
      minNoteSpacingPx = dx;
    }
  }

  // 同小節同一拍內的連續 8/16 分音符組成符槓（beam）群組
  const beamGroups: MidiBeamGroup[] = [];
  let gi = 0;
  while (gi < glyphs.length) {
    const g = glyphs[gi]!;
    const isBeamable =
      !g.isRest &&
      (g.durationType === 'eighth' || g.durationType === 'sixteenth');
    if (!isBeamable) {
      gi++;
      continue;
    }

    const runIndices: number[] = [gi];
    let gj = gi + 1;
    while (gj < glyphs.length) {
      const next = glyphs[gj]!;
      if (
        !next.isRest &&
        (next.durationType === 'eighth' || next.durationType === 'sixteenth') &&
        next.barNumber === g.barNumber &&
        next.beatIndex === g.beatIndex
      ) {
        runIndices.push(gj);
        gj++;
      } else {
        break;
      }
    }

    if (runIndices.length >= 2) {
      // 依組內離中線（position = 4）最遠的音決定符桿方向；平手時朝下
      let maxAbsDist = -1;
      let maxSigned = 0;
      for (const idx of runIndices) {
        const dist = glyphs[idx]!.position - 4;
        const absDist = Math.abs(dist);
        if (absDist > maxAbsDist) {
          maxAbsDist = absDist;
          maxSigned = dist;
        } else if (absDist === maxAbsDist && dist >= 0) {
          maxSigned = Math.max(maxSigned, dist);
        }
      }
      const stemUp = maxSigned < 0;
      let extremePosition = glyphs[runIndices[0]!]!.position;
      for (const idx of runIndices) {
        const pos = glyphs[idx]!.position;
        extremePosition = stemUp
          ? Math.max(extremePosition, pos)
          : Math.min(extremePosition, pos);
      }
      const groupId = beamGroups.length;
      const notes: MidiBeamNoteRef[] = [];
      for (const idx of runIndices) {
        const item = glyphs[idx]!;
        item.stemUp = stemUp;
        item.beamed = true;
        item.beamGroupId = groupId;
        notes.push({
          glyphIndex: idx,
          x: item.x,
          position: item.position,
          durationType: item.durationType ?? 'eighth',
        });
      }
      beamGroups.push({
        stemUp,
        extremePosition,
        notes,
      });
    }

    gi = gj;
  }

  // 計算簡譜帶同拍相連減時線段（8 分＝1 條、16 分＝2 條；同拍內相鄰音符連線）
  const jianpuUnderlineSegments: MidiJianpuUnderlineSegment[] = [];
  const halfSpan = Math.min(8, Math.max(4, minNoteSpacingPx * 0.3));
  let ui = 0;
  while (ui < glyphs.length) {
    const g = glyphs[ui]!;
    if ((g.jianpuUnderlines ?? 0) < 1) {
      ui++;
      continue;
    }
    let uj = ui + 1;
    while (uj < glyphs.length) {
      const next = glyphs[uj]!;
      if (
        (next.jianpuUnderlines ?? 0) >= 1 &&
        next.barNumber === g.barNumber &&
        next.beatIndex === g.beatIndex
      ) {
        uj++;
      } else {
        break;
      }
    }

    const first = glyphs[ui]!;
    const last = glyphs[uj - 1]!;
    jianpuUnderlineSegments.push({
      x1: first.x - halfSpan,
      x2: last.x + halfSpan,
      level: 1,
      endSec: last.start + last.dur,
      isCurrent: false,
    });

    // 第二條減時線（16 分音符）
    let si = ui;
    while (si < uj) {
      if ((glyphs[si]!.jianpuUnderlines ?? 0) < 2) {
        si++;
        continue;
      }
      let sj = si + 1;
      while (sj < uj && (glyphs[sj]!.jianpuUnderlines ?? 0) >= 2) {
        sj++;
      }
      const sFirst = glyphs[si]!;
      const sLast = glyphs[sj - 1]!;
      jianpuUnderlineSegments.push({
        x1: sFirst.x - halfSpan,
        x2: sLast.x + halfSpan,
        level: 2,
        endSec: sLast.start + sLast.dur,
        isCurrent: false,
      });
      si = sj;
    }

    ui = uj;
  }

  return {
    glyphs,
    renderData: {
      lineBarNumber: page.firstBarNumber,
      leftPad,
      rightEdge,
      minNoteSpacingPx,
      segments,
      beatTicks,
      barlines,
      timeSigs,
      beamGroups,
      jianpuMarkers,
      jianpuUnderlineSegments,
    },
  };
}

/** 依目前的播放時間計算若第一個音距起點超過 1 小節，還剩幾小節開唱 */
export function computeIntroCountdownBars(
  scoreBars: readonly MidiScoreBar[],
  passStartSec: number,
  sec: number,
): number | null {
  if (scoreBars.length <= 1) return null;
  let firstNoteBarIdx = -1;
  let firstNoteStartSec = Infinity;

  for (let i = 0; i < scoreBars.length; i++) {
    const bar = scoreBars[i]!;
    for (const ev of bar.events) {
      if (ev.kind === 'note') {
        firstNoteBarIdx = i;
        firstNoteStartSec = passStartSec + ev.startSec;
        break;
      }
    }
    if (firstNoteBarIdx !== -1) break;
  }

  if (firstNoteBarIdx === -1) return null;
  const firstBar = scoreBars[0]!;
  const firstBarDur = Math.max(0.05, firstBar.endSec - firstBar.startSec);
  if (firstNoteStartSec - passStartSec <= firstBarDur + 1e-4) {
    return null;
  }
  if (sec < passStartSec - 1e-4 || sec >= firstNoteStartSec - 1e-4) {
    return null;
  }

  let currentBarIdx = 0;
  for (let i = 0; i < scoreBars.length; i++) {
    const bar = scoreBars[i]!;
    if (sec >= passStartSec + bar.startSec - 1e-4 && sec < passStartSec + bar.endSec - 1e-4) {
      currentBarIdx = i;
      break;
    }
  }

  const remaining = firstNoteBarIdx - currentBarIdx;
  return remaining >= 1 ? remaining : null;
}

/** 格式化 MIDI 行首標籤（含調名與頁碼進度） */
export function formatMidiLineLabel(
  key: Key,
  phase: 'listen' | 'sing',
  pass: number,
  pageIndex: number,
  totalPages: number,
  isPreviewLine: boolean,
): string {
  const keyText = keyName(key).split(' ')[0] ?? 'C';
  if (isPreviewLine) {
    return `第 ${pageIndex + 1}/${totalPages} 頁`;
  }
  const phaseText = phase === 'listen' ? `${keyText} 示範` : `${keyText} 第 ${pass + 1} 遍`;
  return totalPages > 1 ? `${phaseText} · ${pageIndex + 1}/${totalPages}` : phaseText;
}
