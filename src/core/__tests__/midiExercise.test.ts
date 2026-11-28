import { describe, expect, it } from 'vitest';
import { melodyCandidates, parseMidi, type MidiAsset, type MidiNote } from '../midi';
import {
  autoTransposeForRange,
  buildMidiExercise,
  computeMidiBars,
  extractMelodyNotes,
  sliceMelodyByBars,
  transposeKey,
} from '../midiExercise';

function makeNote(
  start: number,
  end: number,
  midi: number,
  velocity = 80,
  track = 0,
): MidiNote {
  return { start, end, midi, velocity, track };
}

function makeSimpleAsset(notes: MidiNote[], bpm = 120, beatsPerBar = 4): MidiAsset {
  const beatSec = 60 / bpm;
  const maxEnd = notes.reduce((acc, n) => Math.max(acc, n.end), 0);
  const totalBeats = Math.max(beatsPerBar, Math.ceil(maxEnd / beatSec));
  const beats: [number, number, number][] = [];
  for (let i = 0; i < totalBeats; i++) {
    beats.push([i * beatSec, i % beatsPerBar, bpm]);
  }
  return {
    tracks: [{ index: 0, name: 'Melody', notes }],
    duration: maxEnd,
    ticksPerBeat: 480,
    beats,
  };
}

describe('extractMelodyNotes（複音取最高音）', () => {
  it('同一時間點有多個音時取最高音，並切分非同步重疊', () => {
    const notes: MidiNote[] = [
      makeNote(0, 2, 60), // C4 全音
      makeNote(0, 1, 67), // G4 前半
      makeNote(1, 2, 64), // E4 後半
    ];
    const melody = extractMelodyNotes(notes);
    expect(melody).toHaveLength(2);
    expect(melody[0]!.midi).toBe(67);
    expect(melody[0]!.start).toBeCloseTo(0, 5);
    expect(melody[0]!.end).toBeCloseTo(1, 5);
    expect(melody[1]!.midi).toBe(64);
    expect(melody[1]!.start).toBeCloseTo(1, 5);
    expect(melody[1]!.end).toBeCloseTo(2, 5);
  });

  it('同音反覆敲擊不會合併成同一個音符', () => {
    const notes: MidiNote[] = [
      makeNote(0, 0.5, 64),
      makeNote(0.5, 1.0, 64),
    ];
    const melody = extractMelodyNotes(notes);
    expect(melody).toHaveLength(2);
    expect(melody[0]!.end).toBeCloseTo(0.5, 5);
    expect(melody[1]!.start).toBeCloseTo(0.5, 5);
  });
});

describe('computeMidiBars 與 sliceMelodyByBars（A–B 小節切段與時間歸零）', () => {
  it('依 beatInBar 算出小節並切出指定區間、時間歸零', () => {
    // 120 BPM 4/4 拍：每小節 2 秒，共 3 小節
    const asset = makeSimpleAsset([
      makeNote(0.0, 0.5, 60), // 第 1 小節
      makeNote(2.0, 2.5, 62), // 第 2 小節
      makeNote(2.5, 3.0, 64), // 第 2 小節
      makeNote(4.0, 4.5, 65), // 第 3 小節
    ]);
    const bars = computeMidiBars(asset);
    expect(bars).toHaveLength(3);
    expect(bars[1]!.start).toBeCloseTo(2.0, 5);
    expect(bars[1]!.end).toBeCloseTo(4.0, 5);

    const sliced = sliceMelodyByBars(asset.tracks[0]!, bars, 2, 2);
    expect(sliced.notes).toHaveLength(2);
    expect(sliced.notes[0]!.midi).toBe(62);
    expect(sliced.notes[0]!.start).toBeCloseTo(0, 5);
    expect(sliced.notes[0]!.end).toBeCloseTo(0.5, 5);
    expect(sliced.notes[1]!.midi).toBe(64);
    expect(sliced.notes[1]!.start).toBeCloseTo(0.5, 5);
    expect(sliced.notes[1]!.end).toBeCloseTo(1.0, 5);
    expect(sliced.regionDur).toBeCloseTo(2.0, 5);
  });
});

describe('autoTransposeForRange（自動移調）', () => {
  it('完全放得進音域時選擇最貼近音域中心的移調量', () => {
    const notes = [{ midi: 60 }, { midi: 64 }, { midi: 67 }]; // C4–G4 (中心 63.5)
    // 音域 F3–F5 (53–77，中心 65)：shift=+1 或 +2 都很貼近，+1 中心 64.5、+2 中心 65.5
    const shift = autoTransposeForRange(notes, 53, 77);
    expect(shift).toBe(1);
  });

  it('無法完全放進音域時選擇超出總半音數最少者', () => {
    const notes = [{ midi: 48 }, { midi: 72 }]; // C3–C5 (跨度 24，中心 60)
    // 音域 C4–G5 (60–79，中心 69.5)：shift=+7..+12 皆超出 5 半音，其中 +9 中心 69 最貼近音域中心
    const shift = autoTransposeForRange(notes, 60, 79);
    expect(shift).toBe(9);
  });
});

describe('buildMidiExercise', () => {
  it('產生含正確 KeyBlock、預備拍 clicks、移調與變速（時間縮放與 BPM）的 Exercise', () => {
    // 100 BPM 4/4 拍（每拍 0.6 秒，每小節 2.4 秒）
    const asset = makeSimpleAsset(
      [
        makeNote(0.0, 0.6, 60),
        makeNote(0.6, 1.2, 62),
        makeNote(1.2, 1.8, 64),
        makeNote(1.8, 2.4, 67),
      ],
      100,
      4,
    );

    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 1,
      transposeSemitones: 2,
      speedPercent: 50,
      originalKey: { tonicPc: 0, mode: 'major' },
      mode: 'listen-then-sing',
      repeats: 2,
      countIn: true,
    });

    // BPM = 100 * 0.5 = 50
    expect(res.baseBpm).toBe(100);
    expect(res.effectiveBpm).toBe(50);
    // 移調 +2 半音：C 大調 -> D 大調
    expect(res.transposedKey).toEqual({ tonicPc: 2, mode: 'major' });

    const { exercise } = res;
    expect(exercise.chords).toEqual([]);
    expect(exercise.keys).toHaveLength(1);
    expect(exercise.keys[0]!.key).toEqual({ tonicPc: 2, mode: 'major' });

    // 預備拍 4 拍（50 BPM -> 每拍 1.2 秒）
    expect(exercise.clicks).toHaveLength(4);
    expect(exercise.clicks[0]).toEqual({ t: 0, accent: true });
    expect(exercise.clicks[1]!.t).toBeCloseTo(1.2, 5);
    expect(exercise.clicks[1]!.accent).toBe(false);

    // 1 listen + 2 sing = 3 遍 × 4 音 = 12 音
    expect(exercise.notes).toHaveLength(12);
    expect(exercise.notes[0]!.phase).toBe('listen');
    expect(exercise.notes[0]!.midi).toBe(62); // 60 + 2
    expect(exercise.notes[0]!.start).toBeCloseTo(4.8, 5); // 4 拍預備拍後
    expect(exercise.notes[0]!.dur).toBeCloseTo(1.2, 5); // 0.6 / 0.5
    expect(exercise.notes[4]!.phase).toBe('sing');
    expect(exercise.notes[4]!.pass).toBe(0);
    expect(exercise.notes[8]!.phase).toBe('sing');
    expect(exercise.notes[8]!.pass).toBe(1);

    // 總長 = 4.8s count-in + 3 * (2.4 / 0.5) = 4.8 + 14.4 = 19.2s
    expect(exercise.total).toBeCloseTo(19.2, 5);
  });

  it('可從標準 MIDI 二進位位元組解析並建立有效的 Exercise', () => {
    // 組裝標準 format 0 MIDI：480 TPB、120 BPM、2 小節旋律
    const trackBytes = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 500000 (120 BPM)
      0x00, 0x90, 60, 100, // C4 on
      0x83, 0x60, 0x80, 60, 0, // +480 ticks off
      0x00, 0x90, 64, 100, // E4 on
      0x83, 0x60, 0x80, 64, 0, // +480 ticks off
      0x00, 0x90, 67, 100, // G4 on
      0x87, 0x40, 0x80, 67, 0, // +960 ticks off
      0x00, 0xff, 0x2f, 0x00, // end of track
    ];
    const header = [
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0, // MThd, fmt 0, 1 track, 480 TPB
      0x4d, 0x54, 0x72, 0x6b,
      (trackBytes.length >>> 24) & 0xff,
      (trackBytes.length >>> 16) & 0xff,
      (trackBytes.length >>> 8) & 0xff,
      trackBytes.length & 0xff,
    ];
    const asset = parseMidi(new Uint8Array([...header, ...trackBytes]));
    const candidates = melodyCandidates(asset);
    expect(candidates.length).toBeGreaterThan(0);

    const bars = computeMidiBars(asset);
    expect(bars.length).toBeGreaterThan(0);

    const res = buildMidiExercise(asset, {
      trackIndex: candidates[0]!,
      startBar: 1,
      endBar: bars.length,
    });

    expect(res.exercise.keys.length).toBe(1);
    expect(res.exercise.notes.length).toBe(3);
    expect(res.exercise.clicks.length).toBe(4);
    expect(res.exercise.total).toBeGreaterThan(0);
  });

  it('transposeKey 正確處理負半音移調', () => {
    expect(transposeKey({ tonicPc: 0, mode: 'minor' }, -3)).toEqual({
      tonicPc: 9,
      mode: 'minor',
    });
  });
});
