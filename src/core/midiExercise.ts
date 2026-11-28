import type {
  ClickEvent,
  Exercise,
  KeyBlock,
  NoteEvent,
} from './exercise';
import type { Key } from './key';
import { detectKey, keyConfidence, type KeyConfidence } from './keyDetect';
import type { MidiAsset, MidiNote, MidiTrack } from './midi';

export interface MidiBarInfo {
  /** 小節編號（1 起算） */
  barNumber: number;
  /** 小節開始時間（秒） */
  start: number;
  /** 小節結束時間（秒） */
  end: number;
  /** 此小節第一拍的速度（BPM） */
  bpm: number;
  /** 此小節拍數 */
  beatsInBar: number;
}

export interface MidiExerciseOptions {
  /** 要練習的音軌索引（對應 MidiTrack.index） */
  trackIndex: number;
  /** 起始小節（1 起算，含） */
  startBar: number;
  /** 結束小節（1 起算，含） */
  endBar: number;
  /** 移調半音數（-12..+12），預設 0 */
  transposeSemitones?: number;
  /** 變速百分比（50..150），預設 100 */
  speedPercent?: number;
  /** 未移調前的調性；未提供時自動以 detectKey 判斷 */
  originalKey?: Key;
  /** 跟唱或先聽再唱，預設 'follow' */
  mode?: 'follow' | 'listen-then-sing';
  /** 演唱重複遍數，預設 1 */
  repeats?: number;
  /** 是否在開頭加入 1 小節預備拍，預設 true */
  countIn?: boolean;
  /** 顯示與示範音高的半音平移量（如男聲高音譜 8va 為 +12），預設 0 */
  displayTranspose?: number;
}

export interface MidiExerciseResult {
  exercise: Exercise;
  /** 區間第一拍原始 BPM */
  baseBpm: number;
  /** 套用變速後的 BPM */
  effectiveBpm: number;
  /** 未移調前判斷或指定的調性 */
  originalKey: Key;
  /** 移調後的調性 */
  transposedKey: Key;
  /** 區間內擷取的單音旋律（未移調、未時間縮放） */
  melodyNotes: MidiNote[];
}

const EPS = 1e-6;
const MIN_NOTE_DUR = 0.01;

/** 將複音音符序列依時間點取最高音，合併同一來源音符的連續切片為單音旋律 */
export function extractMelodyNotes(notes: readonly MidiNote[]): MidiNote[] {
  const valid = notes
    .map((n, idx) => ({ note: n, idx }))
    .filter(({ note }) => note.end > note.start + EPS);

  if (valid.length === 0) {
    return [];
  }

  // 收集所有音符起訖時間點作為掃描線邊界
  const boundarySet = new Set<number>();
  for (const { note } of valid) {
    boundarySet.add(note.start);
    boundarySet.add(note.end);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  interface Slice {
    start: number;
    end: number;
    note: MidiNote;
    sourceIdx: number;
  }

  const slices: Slice[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i]!;
    const segEnd = boundaries[i + 1]!;
    if (segEnd - segStart <= EPS) {
      continue;
    }
    const mid = (segStart + segEnd) * 0.5;

    let best: { note: MidiNote; idx: number } | null = null;
    for (const item of valid) {
      if (item.note.start <= mid && item.note.end >= mid) {
        if (
          !best ||
          item.note.midi > best.note.midi ||
          (item.note.midi === best.note.midi &&
            (item.note.velocity > best.note.velocity ||
              (item.note.velocity === best.note.velocity &&
                item.note.start < best.note.start)))
        ) {
          best = item;
        }
      }
    }

    if (best) {
      const prev = slices[slices.length - 1];
      if (
        prev &&
        prev.sourceIdx === best.idx &&
        Math.abs(prev.end - segStart) <= 1e-5
      ) {
        prev.end = segEnd;
      } else {
        slices.push({
          start: segStart,
          end: segEnd,
          note: best.note,
          sourceIdx: best.idx,
        });
      }
    }
  }

  return slices
    .filter((s) => s.end - s.start >= 1e-4)
    .map((s) => ({
      start: s.start,
      end: s.end,
      midi: s.note.midi,
      velocity: s.note.velocity,
      track: s.note.track,
    }));
}

/** 依 MidiAsset.beats 的 beatInBar 計算每小節起訖時間與速度 */
export function computeMidiBars(asset: MidiAsset): MidiBarInfo[] {
  const { beats, duration } = asset;

  if (beats.length === 0) {
    const defaultBeatSec = 0.5; // 120 BPM
    const barDur = defaultBeatSec * 4;
    const totalBars = Math.max(1, Math.ceil(Math.max(duration, barDur) / barDur));
    const bars: MidiBarInfo[] = [];
    for (let i = 0; i < totalBars; i++) {
      bars.push({
        barNumber: i + 1,
        start: i * barDur,
        end: (i + 1) * barDur,
        bpm: 120,
        beatsInBar: 4,
      });
    }
    return bars;
  }

  const barStartIndices: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const [, beatInBar] = beats[i]!;
    if (i === 0 || beatInBar === 0) {
      barStartIndices.push(i);
    }
  }

  const bars: MidiBarInfo[] = [];
  for (let b = 0; b < barStartIndices.length; b++) {
    const idx = barStartIndices[b]!;
    const nextIdx =
      b + 1 < barStartIndices.length ? barStartIndices[b + 1]! : beats.length;
    const [startTime, , bpm] = beats[idx]!;
    const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;

    let endTime: number;
    if (b + 1 < barStartIndices.length) {
      endTime = beats[nextIdx]![0];
    } else {
      const [lastBeatTime, , lastBeatBpm] = beats[beats.length - 1]!;
      const lastBeatSec =
        60 / (Number.isFinite(lastBeatBpm) && lastBeatBpm > 0 ? lastBeatBpm : safeBpm);
      endTime = Math.max(duration, lastBeatTime + lastBeatSec);
    }

    const beatsInBar = Math.max(1, nextIdx - idx);
    bars.push({
      barNumber: b + 1,
      start: startTime,
      end: Math.max(startTime + 0.05, endTime),
      bpm: safeBpm,
      beatsInBar,
    });
  }

  return bars;
}

/** 切出 A–B 小節區間內的單音旋律音符，並將時間歸零（未縮放速度） */
export function sliceMelodyByBars(
  track: MidiTrack,
  bars: readonly MidiBarInfo[],
  startBar: number,
  endBar: number,
): {
  notes: MidiNote[];
  regionStart: number;
  regionEnd: number;
  regionDur: number;
  baseBpm: number;
  beatsInBar: number;
} {
  const melody = extractMelodyNotes(track.notes);
  if (bars.length === 0) {
    return {
      notes: [],
      regionStart: 0,
      regionEnd: 0,
      regionDur: 0,
      baseBpm: 120,
      beatsInBar: 4,
    };
  }

  const sBar = Math.max(1, Math.min(bars.length, Math.round(startBar)));
  const eBar = Math.max(sBar, Math.min(bars.length, Math.round(endBar)));
  const firstBar = bars[sBar - 1]!;
  const lastBar = bars[eBar - 1]!;
  const regionStart = firstBar.start;
  const regionEnd = lastBar.end;
  const regionDur = Math.max(0.05, regionEnd - regionStart);

  const sliced: MidiNote[] = [];
  for (const n of melody) {
    if (n.start >= regionStart - 1e-4 && n.start < regionEnd - 1e-4) {
      const clampedStart = Math.max(regionStart, n.start);
      const clampedEnd = Math.min(regionEnd, n.end);
      if (clampedEnd > clampedStart + 1e-4) {
        sliced.push({
          start: clampedStart - regionStart,
          end: clampedEnd - regionStart,
          midi: n.midi,
          velocity: n.velocity,
          track: n.track,
        });
      }
    }
  }

  return {
    notes: sliced,
    regionStart,
    regionEnd,
    regionDur,
    baseBpm: firstBar.bpm,
    beatsInBar: firstBar.beatsInBar,
  };
}

/** 計算移調後的新調性 */
export function transposeKey(key: Key, semitones: number): Key {
  const shift = Math.round(semitones);
  const tonicPc = (((key.tonicPc + shift) % 12) + 12) % 12;
  return { tonicPc, mode: key.mode };
}

/**
 * 依目前音域 [low, high] 計算最適合的半音移調量（-12..+12）：
 * - 優先選擇使所有音符落入音域（超出量最少）的移調量
 * - 相同超出量下，選擇旋律中心最貼近音域中心的移調量
 * - 仍平手時選絕對值較小者
 */
export function autoTransposeForRange(
  notes: readonly { midi: number }[],
  low: number,
  high: number,
): number {
  if (notes.length === 0) {
    return 0;
  }

  let minMidi = Infinity;
  let maxMidi = -Infinity;
  for (const n of notes) {
    if (n.midi < minMidi) minMidi = n.midi;
    if (n.midi > maxMidi) maxMidi = n.midi;
  }

  const melodyMid = (minMidi + maxMidi) * 0.5;
  const rangeMid = (low + high) * 0.5;

  let bestShift = 0;
  let bestOverflow = Infinity;
  let bestCenterDist = Infinity;

  for (let shift = -12; shift <= 12; shift++) {
    let overflow = 0;
    for (const n of notes) {
      const m = n.midi + shift;
      if (m < low) overflow += low - m;
      else if (m > high) overflow += m - high;
    }
    const centerDist = Math.abs(melodyMid + shift - rangeMid);

    if (
      overflow < bestOverflow ||
      (overflow === bestOverflow &&
        (centerDist < bestCenterDist - 1e-6 ||
          (Math.abs(centerDist - bestCenterDist) <= 1e-6 &&
            Math.abs(shift) < Math.abs(bestShift))))
    ) {
      bestShift = shift;
      bestOverflow = overflow;
      bestCenterDist = centerDist;
    }
  }

  return bestShift;
}

/** 偵測區間旋律的調性與信心度，若無音符則預設 C 大調（低信心） */
export function detectMelodyKey(
  notes: readonly { start: number; end: number; midi: number }[],
): { key: Key; confidence: KeyConfidence } {
  const ranked = detectKey(notes);
  if (ranked.length === 0) {
    return { key: { tonicPc: 0, mode: 'major' }, confidence: 'low' };
  }
  return {
    key: ranked[0]!.key,
    confidence: keyConfidence(ranked),
  };
}

/** 依旋律平均音高與主音 pitch class 決定最自然的參考主音 MIDI */
function resolveTonicMidi(
  notes: readonly { midi: number }[],
  tonicPc: number,
): number {
  const pc = ((tonicPc % 12) + 12) % 12;
  if (notes.length === 0) {
    return 60 + pc;
  }
  let sum = 0;
  for (const n of notes) {
    sum += n.midi;
  }
  const avg = sum / notes.length;
  const octave = Math.round((avg - pc) / 12) - 1;
  return Math.max(24, Math.min(96, (octave + 1) * 12 + pc));
}

/** 將 MidiAsset 與練習選項轉換為現有 PracticePage／AudioEngine 使用的 Exercise */
export function buildMidiExercise(
  asset: MidiAsset,
  opts: MidiExerciseOptions,
): MidiExerciseResult {
  const track =
    asset.tracks.find((t) => t.index === opts.trackIndex) ?? asset.tracks[0];
  if (!track) {
    throw new Error('MIDI 沒有可用的音軌');
  }

  const bars = computeMidiBars(asset);
  const sliced = sliceMelodyByBars(
    track,
    bars,
    opts.startBar,
    opts.endBar,
  );

  const transposeSemitones = Math.max(
    -12,
    Math.min(12, Math.round(opts.transposeSemitones ?? 0)),
  );
  const speedPercent = Math.max(
    50,
    Math.min(150, Math.round(opts.speedPercent ?? 100)),
  );
  const speedFactor = speedPercent / 100;
  const displayTranspose = Math.round(opts.displayTranspose ?? 0);
  const repeats = Math.max(1, Math.round(opts.repeats ?? 1));
  const mode = opts.mode ?? 'follow';
  const countIn = opts.countIn ?? true;

  const detected = detectMelodyKey(sliced.notes);
  const originalKey = opts.originalKey ?? detected.key;
  const transposedKey = transposeKey(originalKey, transposeSemitones);

  const baseBpm = sliced.baseBpm;
  const effectiveBpm = Math.round(baseBpm * speedFactor * 10) / 10;
  const beatSec = 60 / (baseBpm * speedFactor);

  const clicks: ClickEvent[] = [];
  let tCursor = 0;
  if (countIn) {
    for (let i = 0; i < sliced.beatsInBar; i++) {
      clicks.push({ t: tCursor + i * beatSec, accent: i === 0 });
    }
    tCursor += sliced.beatsInBar * beatSec;
  }

  const passDur = sliced.regionDur / speedFactor;
  const notes: NoteEvent[] = [];
  const keyStart = tCursor;
  const notesStart = tCursor;

  const shiftedNotes = sliced.notes.map((n) => ({
    ...n,
    midi: n.midi + transposeSemitones + displayTranspose,
  }));

  const emitPass = (pass: number, phase: 'listen' | 'sing') => {
    for (const n of shiftedNotes) {
      const dur = Math.max(MIN_NOTE_DUR, (n.end - n.start) / speedFactor);
      notes.push({
        start: tCursor + n.start / speedFactor,
        dur,
        midi: n.midi,
        keyIndex: 0,
        pass,
        phase,
      });
    }
    tCursor += passDur;
  };

  if (mode === 'listen-then-sing') {
    emitPass(0, 'listen');
  }
  for (let p = 0; p < repeats; p++) {
    emitPass(p, 'sing');
  }

  const tonicMidi = resolveTonicMidi(shiftedNotes, transposedKey.tonicPc);
  const keys: KeyBlock[] = [
    {
      index: 0,
      tonicMidi,
      key: transposedKey,
      start: keyStart,
      notesStart,
      end: tCursor,
    },
  ];

  return {
    exercise: {
      keys,
      notes,
      chords: [],
      clicks,
      total: tCursor,
    },
    baseBpm,
    effectiveBpm,
    originalKey,
    transposedKey,
    melodyNotes: sliced.notes,
  };
}
