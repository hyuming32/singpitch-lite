import type { MidiAsset, MidiNote, MidiTrack } from './midi';
import { extractMelodyNotes, type MidiBarInfo } from './midiExercise';

export type NoteDurationType =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth';

export interface DecomposedDuration {
  /** 量化後時值（以 16 分音符為 1 單位） */
  dur: number;
  durationType: NoteDurationType;
  dotted: boolean;
}

export interface MidiScoreEvent {
  kind: 'note' | 'rest';
  /** 1 起算原始小節號 */
  barNumber: number;
  /** 小節內起始格（16 分音符格，0 起算） */
  startSixteenthInBar: number;
  /** 時值（16 分音符格） */
  durSixteenths: number;
  /** 相對於練習區間起點的開始秒數（已套用 speedFactor） */
  startSec: number;
  /** 持續秒數（已套用 speedFactor） */
  durSec: number;
  /** 音高（僅 kind === 'note'，已套用移調與 displayTranspose） */
  midi?: number;
  durationType: NoteDurationType;
  dotted: boolean;
  /** 是否承接前一音符的連結線 */
  tieFromPrev?: boolean;
  /** 是否以連結線連向下一音符 */
  tieToNext?: boolean;
  /** 所在拍索引（0 起算） */
  beatIndex: number;
  /** 簡譜減時線數量（8 分＝1、16 分＝2、其餘＝0） */
  jianpuUnderlines: 0 | 1 | 2;
  /** 簡譜是否顯示附點（附點四分與附點八分） */
  jianpuDot: boolean;
  /** 簡譜延長拍／多拍休止的後續拍符號與小節內格位 */
  jianpuContinuations: Array<{
    offsetSixteenthInBar: number;
    offsetSec: number;
    symbol: '–' | '0';
  }>;
}

export interface MidiScoreBar {
  /** 1 起算原始小節號 */
  barNumber: number;
  /** 相對於練習區間起點的開始秒數（已套用 speedFactor） */
  startSec: number;
  /** 相對於練習區間起點的結束秒數（已套用 speedFactor） */
  endSec: number;
  numerator: number;
  denominator: number;
  /** 此小節是否為區間第一小節或相較前一小節改變拍號 */
  timeSigChanged: boolean;
  /** 此小節包含的 16 分音符格數 */
  sixteenthsInBar: number;
  /** 每拍包含的 16 分音符格數（例：4/4 為 4、6/8 為 2） */
  sixteenthsPerBeat: number;
  /** 小節內各拍相對於區間起點的開始秒數 */
  beatStartSecs: number[];
  events: MidiScoreEvent[];
}

interface DurationSpec {
  dur: number;
  durationType: NoteDurationType;
  dotted: boolean;
}

const STANDARD_DURATIONS: readonly DurationSpec[] = [
  { dur: 16, durationType: 'whole', dotted: false },
  { dur: 12, durationType: 'half', dotted: true },
  { dur: 8, durationType: 'half', dotted: false },
  { dur: 6, durationType: 'quarter', dotted: true },
  { dur: 4, durationType: 'quarter', dotted: false },
  { dur: 3, durationType: 'eighth', dotted: true },
  { dur: 2, durationType: 'eighth', dotted: false },
  { dur: 1, durationType: 'sixteenth', dotted: false },
];

const SINGLE_DURATION_MAP = new Map<number, DurationSpec>(
  STANDARD_DURATIONS.map((spec) => [spec.dur, spec]),
);

/**
 * 第一版以 16 分音符格（ticksPerBeat / 4，容差半格）量化，不拆三連音；
 * 將 tick 位置量化為最接近的 16 分音符格索引。
 */
export function quantizeTickToSixteenth(
  tick: number,
  ticksPerBeat: number,
): number {
  const safeTpb = ticksPerBeat > 0 && Number.isFinite(ticksPerBeat) ? ticksPerBeat : 480;
  const grid = safeTpb / 4;
  return Math.round(tick / grid);
}

/**
 * 將音符長度（ticks）量化為 16 分音符格數（容差半格，至少為 1 格；
 * 例：ticksPerBeat = 120 時，略短的 29 ticks → 29 / 30 = 0.967 → 1 格＝16 分音符）。
 */
export function quantizeDurationToSixteenths(
  durTicks: number,
  ticksPerBeat: number,
): number {
  const safeTpb = ticksPerBeat > 0 && Number.isFinite(ticksPerBeat) ? ticksPerBeat : 480;
  const grid = safeTpb / 4;
  return Math.max(1, Math.round(durTicks / grid));
}

/**
 * 將量化後的 16 分音符格數拆解為標準音符／休止符時值（全、二分、四分、8 分、16 分，含附點）。
 * 不規則時值（例 5、7、9、10）拆成多個標準時值，由呼叫端以連結線（tie）連接。
 */
export function decomposeDurationSixteenths(
  durSixteenths: number,
  options: {
    isRest?: boolean;
    offsetInBar?: number;
    sixteenthsPerBeat?: number;
    barSixteenths?: number;
  } = {},
): DecomposedDuration[] {
  const safeDur = Math.max(1, Math.round(durSixteenths));
  const isRest = Boolean(options.isRest);
  const offsetInBar = Math.max(0, Math.round(options.offsetInBar ?? 0));
  const sixteenthsPerBeat = Math.max(1, Math.round(options.sixteenthsPerBeat ?? 4));
  const barSixteenths = Math.max(safeDur, Math.round(options.barSixteenths ?? 16));

  if (isRest && offsetInBar === 0 && safeDur === barSixteenths) {
    return [{ dur: barSixteenths, durationType: 'whole', dotted: false }];
  }

  if (!isRest) {
    const exact = SINGLE_DURATION_MAP.get(safeDur);
    if (exact) {
      return [{ ...exact }];
    }
    const result: DecomposedDuration[] = [];
    let rem = safeDur;
    while (rem > 0) {
      const picked =
        STANDARD_DURATIONS.find((spec) => spec.dur <= rem) ??
        STANDARD_DURATIONS[STANDARD_DURATIONS.length - 1]!;
      result.push({ ...picked });
      rem -= picked.dur;
    }
    return result;
  }

  // 休止符依拍點邊界切分，提升讀譜清晰度
  const result: DecomposedDuration[] = [];
  let rem = safeDur;
  let pos = offsetInBar;

  while (rem > 0) {
    const modBeat = pos % sixteenthsPerBeat;
    let picked: DurationSpec | undefined;

    if (modBeat !== 0) {
      const toNextBeat = Math.min(rem, sixteenthsPerBeat - modBeat);
      picked = STANDARD_DURATIONS.find((spec) => spec.dur <= toNextBeat);
    } else {
      if (sixteenthsPerBeat === 4 && (pos === 0 || pos === 8) && rem >= 8) {
        picked = SINGLE_DURATION_MAP.get(8);
      } else if (sixteenthsPerBeat === 4 && rem >= 4) {
        picked = SINGLE_DURATION_MAP.get(4);
      } else {
        const beatAligned = STANDARD_DURATIONS.find(
          (spec) => spec.dur <= rem && (spec.dur <= sixteenthsPerBeat || spec.dur % sixteenthsPerBeat === 0),
        );
        picked = beatAligned ?? STANDARD_DURATIONS.find((spec) => spec.dur <= rem);
      }
    }

    const chosen = picked ?? STANDARD_DURATIONS[STANDARD_DURATIONS.length - 1]!;
    result.push({ ...chosen });
    rem -= chosen.dur;
    pos += chosen.dur;
  }

  return result;
}

/** 依時值種類與附點輸出繁體中文名稱（供測試與本機檢查腳本使用） */
export function formatDurationName(
  durationType: NoteDurationType,
  dotted: boolean,
): string {
  const base =
    durationType === 'whole'
      ? '全音符'
      : durationType === 'half'
        ? '二分音符'
        : durationType === 'quarter'
          ? '四分音符'
          : durationType === 'eighth'
            ? '八分音符'
            : '十六分音符';
  return dotted ? `附點${base}` : base;
}

interface InternalBarGrid {
  bar: MidiBarInfo;
  numerator: number;
  denominator: number;
  sixteenthsPerBeat: number;
  sixteenthsInBar: number;
  startSixteenth: number;
  endSixteenth: number;
  beatTimes: number[];
}

function buildBarGrids(bars: readonly MidiBarInfo[]): InternalBarGrid[] {
  const grids: InternalBarGrid[] = [];
  let cursor = 0;

  for (const bar of bars) {
    const numerator = Math.max(1, bar.numerator ?? bar.beatsInBar ?? 4);
    const denominator = Math.max(1, bar.denominator ?? 4);
    const sixteenthsPerBeat = Math.max(1, Math.round(16 / denominator));
    const actualBeats =
      bar.beatTimes && bar.beatTimes.length > 0
        ? bar.beatTimes.length
        : Math.max(1, bar.beatsInBar);
    const sixteenthsInBar = Math.max(1, Math.round(actualBeats * sixteenthsPerBeat));

    const beatTimes: number[] = [];
    if (bar.beatTimes && bar.beatTimes.length === actualBeats) {
      beatTimes.push(...bar.beatTimes);
    } else {
      const step = (bar.end - bar.start) / actualBeats;
      for (let i = 0; i < actualBeats; i++) {
        beatTimes.push(bar.start + i * step);
      }
    }

    grids.push({
      bar,
      numerator,
      denominator,
      sixteenthsPerBeat,
      sixteenthsInBar,
      startSixteenth: cursor,
      endSixteenth: cursor + sixteenthsInBar,
      beatTimes,
    });
    cursor += sixteenthsInBar;
  }

  return grids;
}

/** 將原始秒數對映至累積 16 分音符格（供沒有 startTick/endTick 的合成 MidiAsset 使用） */
function secondsToFractionalSixteenth(
  t: number,
  grids: readonly InternalBarGrid[],
): number {
  if (grids.length === 0) return 0;
  const first = grids[0]!;
  if (t <= first.bar.start) {
    const beatDur = (first.bar.end - first.bar.start) / Math.max(1, first.beatTimes.length);
    return ((t - first.bar.start) / beatDur) * first.sixteenthsPerBeat;
  }

  for (let i = 0; i < grids.length; i++) {
    const g = grids[i]!;
    if (t <= g.bar.end || i === grids.length - 1) {
      const beats = g.beatTimes;
      for (let bi = 0; bi < beats.length; bi++) {
        const bStart = beats[bi]!;
        const bEnd = bi + 1 < beats.length ? beats[bi + 1]! : g.bar.end;
        if (t <= bEnd || bi === beats.length - 1) {
          const span = Math.max(1e-6, bEnd - bStart);
          const frac = (t - bStart) / span;
          return g.startSixteenth + (bi + frac) * g.sixteenthsPerBeat;
        }
      }
    }
  }
  return grids[grids.length - 1]!.endSixteenth;
}

/** 將小節內 16 分音符格位置換算為該小節內的真實秒數（對齊拍點） */
function sixteenthInBarToOrigSec(
  offsetSixteenthInBar: number,
  grid: InternalBarGrid,
): number {
  const clamped = Math.max(0, Math.min(grid.sixteenthsInBar, offsetSixteenthInBar));
  const beatFloat = clamped / grid.sixteenthsPerBeat;
  const bi = Math.min(grid.beatTimes.length - 1, Math.floor(beatFloat));
  const frac = beatFloat - bi;
  const bStart = grid.beatTimes[bi] ?? grid.bar.start;
  const bEnd =
    bi + 1 < grid.beatTimes.length ? grid.beatTimes[bi + 1]! : grid.bar.end;
  return bStart + frac * Math.max(0, bEnd - bStart);
}

interface QuantizedSpan {
  qStart: number;
  qEnd: number;
  midi: number;
}

function quantizeMelodyNotes(
  melody: readonly MidiNote[],
  ticksPerBeat: number,
  grids: readonly InternalBarGrid[],
  regionStartSixteenth: number,
  regionEndSixteenth: number,
): QuantizedSpan[] {
  const spans: QuantizedSpan[] = [];

  for (const n of melody) {
    let rawStart: number;
    let rawDur: number;
    if (n.startTick !== undefined && n.endTick !== undefined) {
      rawStart = quantizeTickToSixteenth(n.startTick, ticksPerBeat);
      rawDur = quantizeDurationToSixteenths(n.endTick - n.startTick, ticksPerBeat);
    } else {
      const fStart = secondsToFractionalSixteenth(n.start, grids);
      const fEnd = secondsToFractionalSixteenth(n.end, grids);
      rawStart = Math.round(fStart);
      rawDur = Math.max(1, Math.round(fEnd - fStart));
    }
    const rawEnd = rawStart + rawDur;
    if (rawEnd <= regionStartSixteenth || rawStart >= regionEndSixteenth) {
      continue;
    }

    let qStart = Math.max(regionStartSixteenth, rawStart);
    let qEnd = Math.min(regionEndSixteenth, rawEnd);
    if (qEnd <= qStart) {
      qEnd = Math.min(regionEndSixteenth, qStart + 1);
    }
    if (qEnd <= qStart) continue;

    const prev = spans[spans.length - 1];
    if (prev && qStart < prev.qEnd) {
      if (qStart > prev.qStart) {
        prev.qEnd = qStart;
      } else {
        qStart = prev.qEnd;
        if (qEnd <= qStart) {
          qEnd = Math.min(regionEndSixteenth, qStart + 1);
        }
        if (qEnd <= qStart) continue;
      }
    }

    spans.push({ qStart, qEnd, midi: n.midi });
  }

  return spans;
}

function buildScoreEvent(
  kind: 'note' | 'rest',
  grid: InternalBarGrid,
  regionStartOrigSec: number,
  speedFactor: number,
  startSixteenthInBar: number,
  part: DecomposedDuration,
  midi?: number,
  tieFromPrev?: boolean,
  tieToNext?: boolean,
): MidiScoreEvent {
  const sOrig = sixteenthInBarToOrigSec(startSixteenthInBar, grid);
  const eOrig = sixteenthInBarToOrigSec(startSixteenthInBar + part.dur, grid);
  const startSec = (sOrig - regionStartOrigSec) / speedFactor;
  const durSec = Math.max(0.01, (eOrig - sOrig) / speedFactor);
  const beatIndex = Math.min(
    Math.max(0, grid.beatTimes.length - 1),
    Math.floor(startSixteenthInBar / grid.sixteenthsPerBeat),
  );

  const jianpuUnderlines: 0 | 1 | 2 =
    part.durationType === 'sixteenth'
      ? 2
      : part.durationType === 'eighth'
        ? 1
        : 0;
  const jianpuDot =
    part.dotted &&
    (part.durationType === 'quarter' || part.durationType === 'eighth');

  const jianpuContinuations: MidiScoreEvent['jianpuContinuations'] = [];
  if (kind === 'rest' && part.durationType === 'whole') {
    const barBeats = Math.max(1, Math.round(part.dur / grid.sixteenthsPerBeat));
    for (let bi = 1; bi < barBeats; bi++) {
      const offSix = startSixteenthInBar + bi * grid.sixteenthsPerBeat;
      const tOrig = sixteenthInBarToOrigSec(offSix, grid);
      jianpuContinuations.push({
        offsetSixteenthInBar: offSix,
        offsetSec: (tOrig - regionStartOrigSec) / speedFactor,
        symbol: '0',
      });
    }
  } else if (kind === 'rest' && part.dur >= 8) {
    const extraBeats = Math.floor(part.dur / 4) - 1;
    for (let k = 1; k <= extraBeats; k++) {
      const offSix = startSixteenthInBar + k * 4;
      const tOrig = sixteenthInBarToOrigSec(offSix, grid);
      jianpuContinuations.push({
        offsetSixteenthInBar: offSix,
        offsetSec: (tOrig - regionStartOrigSec) / speedFactor,
        symbol: '0',
      });
    }
  } else if (kind === 'note' && (part.durationType === 'whole' || part.durationType === 'half')) {
    const extraBeats =
      part.durationType === 'whole'
        ? Math.max(1, Math.round(part.dur / 4) - 1)
        : part.dotted
          ? 2
          : 1;
    for (let k = 1; k <= extraBeats; k++) {
      const offSix = startSixteenthInBar + k * 4;
      if (offSix < grid.sixteenthsInBar) {
        const tOrig = sixteenthInBarToOrigSec(offSix, grid);
        jianpuContinuations.push({
          offsetSixteenthInBar: offSix,
          offsetSec: (tOrig - regionStartOrigSec) / speedFactor,
          symbol: '–',
        });
      }
    }
  }

  return {
    kind,
    barNumber: grid.bar.barNumber,
    startSixteenthInBar,
    durSixteenths: part.dur,
    startSec,
    durSec,
    ...(midi !== undefined ? { midi } : {}),
    durationType: part.durationType,
    dotted: part.dotted,
    ...(tieFromPrev ? { tieFromPrev: true } : {}),
    ...(tieToNext ? { tieToNext: true } : {}),
    beatIndex,
    jianpuUnderlines,
    jianpuDot,
    jianpuContinuations,
  };
}

/**
 * 依據 MidiAsset、選定音軌與 A–B 小節區間，建立量化後的逐小節樂譜結構（含休止符、附點、連結線與變拍號資訊）。
 */
export function buildQuantizedMidiBars(
  asset: MidiAsset,
  track: MidiTrack,
  bars: readonly MidiBarInfo[],
  opts: {
    startBar: number;
    endBar: number;
    transposeSemitones?: number;
    displayTranspose?: number;
    speedPercent?: number;
  },
): MidiScoreBar[] {
  if (bars.length === 0) return [];

  const sBar = Math.max(1, Math.min(bars.length, Math.round(opts.startBar)));
  const eBar = Math.max(sBar, Math.min(bars.length, Math.round(opts.endBar)));
  const transposeSemitones = Math.round(opts.transposeSemitones ?? 0);
  const displayTranspose = Math.round(opts.displayTranspose ?? 0);
  const pitchShift = transposeSemitones + displayTranspose;
  const speedPercent = Math.max(
    50,
    Math.min(150, Math.round(opts.speedPercent ?? 100)),
  );
  const speedFactor = speedPercent / 100;

  const grids = buildBarGrids(bars);
  const regionGrids = grids.slice(sBar - 1, eBar);
  if (regionGrids.length === 0) return [];

  const regionStartSixteenth = regionGrids[0]!.startSixteenth;
  const regionEndSixteenth = regionGrids[regionGrids.length - 1]!.endSixteenth;
  const regionStartOrigSec = regionGrids[0]!.bar.start;

  const melody = extractMelodyNotes(track.notes);
  const spans = quantizeMelodyNotes(
    melody,
    asset.ticksPerBeat,
    grids,
    regionStartSixteenth,
    regionEndSixteenth,
  );

  const result: MidiScoreBar[] = [];
  let spanIdx = 0;
  let prevNum = -1;
  let prevDen = -1;

  for (let gi = 0; gi < regionGrids.length; gi++) {
    const grid = regionGrids[gi]!;
    const events: MidiScoreEvent[] = [];
    let cursor = grid.startSixteenth;

    while (spanIdx < spans.length && spans[spanIdx]!.qEnd <= grid.startSixteenth) {
      spanIdx++;
    }

    let k = spanIdx;
    while (k < spans.length && spans[k]!.qStart < grid.endSixteenth) {
      const sp = spans[k]!;
      const sliceStart = Math.max(grid.startSixteenth, sp.qStart);
      const sliceEnd = Math.min(grid.endSixteenth, sp.qEnd);

      if (sliceStart > cursor) {
        const restParts = decomposeDurationSixteenths(sliceStart - cursor, {
          isRest: true,
          offsetInBar: cursor - grid.startSixteenth,
          sixteenthsPerBeat: grid.sixteenthsPerBeat,
          barSixteenths: grid.sixteenthsInBar,
        });
        let rPos = cursor - grid.startSixteenth;
        for (const rp of restParts) {
          events.push(
            buildScoreEvent(
              'rest',
              grid,
              regionStartOrigSec,
              speedFactor,
              rPos,
              rp,
            ),
          );
          rPos += rp.dur;
        }
      }

      if (sliceEnd > sliceStart) {
        const startsFromPrevBar = sp.qStart < grid.startSixteenth;
        const continuesToNextBar = sp.qEnd > grid.endSixteenth;
        const noteParts = decomposeDurationSixteenths(sliceEnd - sliceStart, {
          isRest: false,
          offsetInBar: sliceStart - grid.startSixteenth,
          sixteenthsPerBeat: grid.sixteenthsPerBeat,
          barSixteenths: grid.sixteenthsInBar,
        });

        let nPos = sliceStart - grid.startSixteenth;
        for (let pi = 0; pi < noteParts.length; pi++) {
          const np = noteParts[pi]!;
          const tieFromPrev = startsFromPrevBar ? pi === 0 || pi > 0 : pi > 0;
          const tieToNext =
            pi < noteParts.length - 1 || continuesToNextBar;
          events.push(
            buildScoreEvent(
              'note',
              grid,
              regionStartOrigSec,
              speedFactor,
              nPos,
              np,
              sp.midi + pitchShift,
              tieFromPrev,
              tieToNext,
            ),
          );
          nPos += np.dur;
        }
        cursor = sliceEnd;
      }

      if (sp.qEnd <= grid.endSixteenth) {
        k++;
      } else {
        break;
      }
    }

    if (cursor < grid.endSixteenth) {
      const restParts = decomposeDurationSixteenths(
        grid.endSixteenth - cursor,
        {
          isRest: true,
          offsetInBar: cursor - grid.startSixteenth,
          sixteenthsPerBeat: grid.sixteenthsPerBeat,
          barSixteenths: grid.sixteenthsInBar,
        },
      );
      let rPos = cursor - grid.startSixteenth;
      for (const rp of restParts) {
        events.push(
          buildScoreEvent(
            'rest',
            grid,
            regionStartOrigSec,
            speedFactor,
            rPos,
            rp,
          ),
        );
        rPos += rp.dur;
      }
    }

    const timeSigChanged =
      gi === 0 || grid.numerator !== prevNum || grid.denominator !== prevDen;
    prevNum = grid.numerator;
    prevDen = grid.denominator;

    result.push({
      barNumber: grid.bar.barNumber,
      startSec: (grid.bar.start - regionStartOrigSec) / speedFactor,
      endSec: (grid.bar.end - regionStartOrigSec) / speedFactor,
      numerator: grid.numerator,
      denominator: grid.denominator,
      timeSigChanged,
      sixteenthsInBar: grid.sixteenthsInBar,
      sixteenthsPerBeat: grid.sixteenthsPerBeat,
      beatStartSecs: grid.beatTimes.map(
        (bt) => (bt - regionStartOrigSec) / speedFactor,
      ),
      events,
    });
  }

  return result;
}
