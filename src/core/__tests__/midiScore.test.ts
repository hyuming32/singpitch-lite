import { describe, expect, it } from 'vitest';
import { parseMidi, type MidiAsset, type MidiNote } from '../midi';
import { computeMidiBars } from '../midiExercise';
import {
  buildQuantizedMidiBars,
  decomposeDurationSixteenths,
  quantizeDurationToSixteenths,
  quantizeTickToSixteenth,
} from '../midiScore';

function makeVladAsset(
  notes: MidiNote[],
  opts: {
    ticksPerBeat?: number;
    bpm?: number;
    duration?: number;
    timeSignatures?: MidiAsset['timeSignatures'];
    beats?: MidiAsset['beats'];
  } = {},
): MidiAsset {
  const ticksPerBeat = opts.ticksPerBeat ?? 120;
  const bpm = opts.bpm ?? 60;
  const beatSec = 60 / bpm;
  const duration =
    opts.duration ?? Math.max(4 * beatSec, ...notes.map((n) => n.end));

  let beats = opts.beats;
  if (!beats) {
    const totalBeats = Math.max(4, Math.ceil(duration / beatSec));
    beats = [];
    for (let i = 0; i < totalBeats; i++) {
      beats.push([i * beatSec, i % 4, bpm]);
    }
  }

  return {
    tracks: [{ index: 0, name: 'Vocal', notes }],
    duration,
    ticksPerBeat,
    beats,
    ...(opts.timeSignatures ? { timeSignatures: opts.timeSignatures } : {}),
  };
}

describe('midiScore（量化、時值拆解、跨小節連結線、休止符與變拍號）', () => {
  it('將略短的 29 tick（@120 TPB）量化為 16 分音符，起點依半格容差貼齊 16 分格', () => {
    expect(quantizeDurationToSixteenths(29, 120)).toBe(1);
    expect(quantizeDurationToSixteenths(59, 120)).toBe(2);
    expect(quantizeDurationToSixteenths(89, 120)).toBe(3);
    expect(quantizeDurationToSixteenths(119, 120)).toBe(4);
    expect(quantizeTickToSixteenth(3302, 120)).toBe(110); // 3300/30 = 110，誤差 2 ticks < 15
    expect(quantizeTickToSixteenth(3288, 120)).toBe(110); // -12 ticks < 15 仍吸附到 110
  });

  it('將量化時值拆為全、二分、四分、8 分、16 分（含附點）與不規則時值連結線', () => {
    expect(decomposeDurationSixteenths(16)).toEqual([
      { dur: 16, durationType: 'whole', dotted: false },
    ]);
    expect(decomposeDurationSixteenths(12)).toEqual([
      { dur: 12, durationType: 'half', dotted: true },
    ]);
    expect(decomposeDurationSixteenths(8)).toEqual([
      { dur: 8, durationType: 'half', dotted: false },
    ]);
    expect(decomposeDurationSixteenths(6)).toEqual([
      { dur: 6, durationType: 'quarter', dotted: true },
    ]);
    expect(decomposeDurationSixteenths(4)).toEqual([
      { dur: 4, durationType: 'quarter', dotted: false },
    ]);
    expect(decomposeDurationSixteenths(3)).toEqual([
      { dur: 3, durationType: 'eighth', dotted: true },
    ]);
    expect(decomposeDurationSixteenths(2)).toEqual([
      { dur: 2, durationType: 'eighth', dotted: false },
    ]);
    expect(decomposeDurationSixteenths(1)).toEqual([
      { dur: 1, durationType: 'sixteenth', dotted: false },
    ]);

    // 不規則時值 5（四分 + 16 分）與 9（二分 + 16 分）
    expect(decomposeDurationSixteenths(5)).toEqual([
      { dur: 4, durationType: 'quarter', dotted: false },
      { dur: 1, durationType: 'sixteenth', dotted: false },
    ]);
    expect(decomposeDurationSixteenths(9)).toEqual([
      { dur: 8, durationType: 'half', dotted: false },
      { dur: 1, durationType: 'sixteenth', dotted: false },
    ]);
  });

  it('跨小節音符正確拆出連結線（tieToNext / tieFromPrev），空隙補上標準休止符與簡譜減時線', () => {
    // 60 BPM，120 TPB（1 拍 = 1s = 120 ticks；1 格 16 分 = 30 ticks = 0.25s）
    // 第 1 小節（0..4s）：
    //   0..0.25s：16 分音符（C4，29 ticks）
    //   0.25..0.75s：空隙 2 格 -> 8 分休止符
    //   0.75..1.25s：8 分音符（D4）
    //   1.25..3.75s：空隙 10 格 -> 休止符
    //   3.75..4.25s：跨小節音符（E4，從第 1 小節最後一格跨入第 2 小節第一格）
    const notes: MidiNote[] = [
      { start: 0, end: 29 / 120, midi: 60, velocity: 90, track: 0, startTick: 0, endTick: 29 },
      { start: 0.75, end: 1.25, midi: 62, velocity: 90, track: 0, startTick: 90, endTick: 150 },
      { start: 3.75, end: 4.25, midi: 64, velocity: 90, track: 0, startTick: 450, endTick: 510 },
    ];
    const asset = makeVladAsset(notes, { duration: 8.0 });
    const bars = computeMidiBars(asset);
    const scoreBars = buildQuantizedMidiBars(asset, asset.tracks[0]!, bars, {
      startBar: 1,
      endBar: 2,
    });

    expect(scoreBars).toHaveLength(2);
    const bar1 = scoreBars[0]!;
    const bar2 = scoreBars[1]!;

    // 第 1 小節第一音為 16 分音符（jianpuUnderlines = 2）
    expect(bar1.events[0]!.kind).toBe('note');
    expect(bar1.events[0]!.durationType).toBe('sixteenth');
    expect(bar1.events[0]!.jianpuUnderlines).toBe(2);

    // 接著空隙 2 格（0.25..0.75）為 8 分休止符（jianpuUnderlines = 1）
    const bar1Rest = bar1.events[1]!;
    expect(bar1Rest.kind).toBe('rest');
    expect(bar1Rest.durationType).toBe('eighth');
    expect(bar1Rest.jianpuUnderlines).toBe(1);

    // 第 1 小節最後一個事件為 E4 16 分音符，tieToNext = true
    const bar1Last = bar1.events[bar1.events.length - 1]!;
    expect(bar1Last.kind).toBe('note');
    expect(bar1Last.midi).toBe(64);
    expect(bar1Last.durationType).toBe('sixteenth');
    expect(bar1Last.tieToNext).toBe(true);

    // 第 2 小節第一個事件為 E4 16 分音符，tieFromPrev = true
    const bar2First = bar2.events[0]!;
    expect(bar2First.kind).toBe('note');
    expect(bar2First.midi).toBe(64);
    expect(bar2First.durationType).toBe('sixteenth');
    expect(bar2First.tieFromPrev).toBe(true);

    // 第 2 小節剩餘 15 格全為休止符，總格數守恆
    const bar1Sum = bar1.events.reduce((s, e) => s + e.durSixteenths, 0);
    const bar2Sum = bar2.events.reduce((s, e) => s + e.durSixteenths, 0);
    expect(bar1Sum).toBe(16);
    expect(bar2Sum).toBe(16);
  });

  it('支援中途改拍號（4/4 → 2/4 → 4/4）的小節切分與變拍號標記', () => {
    const vlq = (v: number): number[] => {
      const b = [v & 0x7f];
      let x = v >>> 7;
      while (x > 0) {
        b.unshift((x & 0x7f) | 0x80);
        x >>>= 7;
      }
      return b;
    };
    const trackBytes = [
      // tempo 500000 (120 BPM) + 4/4
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
      0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
      // Bar 1 (4/4, 1920 ticks): 全音符 C4
      0x00, 0x90, 60, 90,
      ...vlq(1920), 0x80, 60, 0,
      // Bar 2 (2/4, 960 ticks): 二分音符 D4
      0x00, 0xff, 0x58, 0x04, 0x02, 0x02, 0x18, 0x08,
      0x00, 0x90, 62, 90,
      ...vlq(960), 0x80, 62, 0,
      // Bar 3 (4/4, 1920 ticks): 四分音符 E4 + 剩餘休止
      0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08,
      0x00, 0x90, 64, 90,
      ...vlq(480), 0x80, 64, 0,
      ...vlq(1440), 0xff, 0x2f, 0x00,
    ];
    const len = trackBytes.length;
    const midiBytes = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
      ...trackBytes,
    ]);

    const asset = parseMidi(midiBytes);
    const bars = computeMidiBars(asset);
    const scoreBars = buildQuantizedMidiBars(asset, asset.tracks[0]!, bars, {
      startBar: 1,
      endBar: 3,
    });

    expect(scoreBars).toHaveLength(3);
    expect(scoreBars[0]!.numerator).toBe(4);
    expect(scoreBars[0]!.denominator).toBe(4);
    expect(scoreBars[0]!.sixteenthsInBar).toBe(16);
    expect(scoreBars[0]!.timeSigChanged).toBe(true);

    expect(scoreBars[1]!.numerator).toBe(2);
    expect(scoreBars[1]!.denominator).toBe(4);
    expect(scoreBars[1]!.sixteenthsInBar).toBe(8);
    expect(scoreBars[1]!.timeSigChanged).toBe(true);
    expect(scoreBars[1]!.beatStartSecs).toHaveLength(2);
    expect(scoreBars[1]!.events[0]!.durationType).toBe('half');

    expect(scoreBars[2]!.numerator).toBe(4);
    expect(scoreBars[2]!.denominator).toBe(4);
    expect(scoreBars[2]!.sixteenthsInBar).toBe(16);
    expect(scoreBars[2]!.timeSigChanged).toBe(true);
    expect(scoreBars[2]!.events[0]!.durationType).toBe('quarter');
  });
});
