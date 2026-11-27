import { describe, expect, it } from 'vitest';
import {
  melodyCandidates,
  parseMidi,
  trackInfo,
} from '../midi';

/** 編碼 MIDI 可變長度數值（VLQ） */
function encodeVlq(value: number): number[] {
  const bytes: number[] = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

function u16(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}

function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function metaEvent(delta: number, type: number, data: number[]): number[] {
  return [...encodeVlq(delta), 0xff, type, ...encodeVlq(data.length), ...data];
}

function tempoEvent(delta: number, tempo: number): number[] {
  return metaEvent(delta, 0x51, [
    (tempo >> 16) & 0xff,
    (tempo >> 8) & 0xff,
    tempo & 0xff,
  ]);
}

function timeSigEvent(
  delta: number,
  numerator: number,
  denominatorPow2: number,
): number[] {
  return metaEvent(delta, 0x58, [numerator, denominatorPow2, 24, 8]);
}

function trackNameEvent(delta: number, name: string): number[] {
  return metaEvent(delta, 0x03, [...new TextEncoder().encode(name)]);
}

function endOfTrack(delta = 0): number[] {
  return metaEvent(delta, 0x2f, []);
}

function buildMidi(
  format: number,
  division: number,
  tracksData: number[][],
): Uint8Array {
  const out: number[] = [
    ...ascii('MThd'),
    ...u32(6),
    ...u16(format),
    ...u16(tracksData.length),
    ...u16(division),
  ];
  for (const track of tracksData) {
    out.push(...ascii('MTrk'), ...u32(track.length), ...track);
  }
  return new Uint8Array(out);
}

describe('parseMidi', () => {
  it('解析 format 0 與中途變速（tempo 變化）', () => {
    // ticksPerBeat = 480, tempo 500000 (0.5s/拍)，第三拍改為 250000 (0.25s/拍)
    const track = [
      ...tempoEvent(0, 500000),
      ...encodeVlq(0), 0x90, 60, 80,
      ...encodeVlq(480), 0x80, 60, 0, // end = 0.5
      ...encodeVlq(0), 0x90, 62, 90, // start = 0.5
      ...encodeVlq(480), 0x80, 62, 0, // end = 1.0
      ...tempoEvent(0, 250000),
      ...encodeVlq(0), 0x90, 64, 100, // start = 1.0
      ...encodeVlq(480), 0x80, 64, 0, // end = 1.25
      ...endOfTrack(0),
    ];
    const asset = parseMidi(buildMidi(0, 480, [track]));
    expect(asset.ticksPerBeat).toBe(480);
    expect(asset.tracks).toHaveLength(1);
    const notes = asset.tracks[0]!.notes;
    expect(notes).toHaveLength(3);
    expect(notes[0]!.start).toBeCloseTo(0, 6);
    expect(notes[0]!.end).toBeCloseTo(0.5, 6);
    expect(notes[1]!.start).toBeCloseTo(0.5, 6);
    expect(notes[1]!.end).toBeCloseTo(1.0, 6);
    expect(notes[2]!.start).toBeCloseTo(1.0, 6);
    expect(notes[2]!.end).toBeCloseTo(1.25, 6);
    expect(asset.tracks[0]!.name).toBe('旋律軌 1');
  });

  it('支援 format 1、running status、velocity 0、CC64 延音踏板、channel 10 略過與缺 note-off 收尾', () => {
    // 軌 0：只有 tempo 與空白軌名（有音符才會保留，這裡只放 tempo）
    const t0 = [...tempoEvent(0, 500000), ...endOfTrack(0)];
    // 軌 1：running status + velocity 0 + CC64 延音 + 最後一個音缺 note-off
    const t1 = [
      ...trackNameEvent(0, '主旋律'),
      ...encodeVlq(0), 0xb0, 64, 127, // 踩下延音踏板
      ...encodeVlq(0), 0x90, 60, 100, // C4 start = 0
      ...encodeVlq(240), 60, 0, // running status: note_on vel=0 at 0.25s（受踏板延長）
      ...encodeVlq(240), 64, 90, // running status: E4 start = 0.5
      ...encodeVlq(240), 0xb0, 64, 0, // 0.75s 放開踏板，C4 應在 0.75s 結束
      // E4 缺 note-off，應在檔案結束 1.0s 收尾
      ...endOfTrack(240),
    ];
    // 軌 2：channel 10（索引 9）打擊樂，應整個略過
    const t2 = [
      ...encodeVlq(0), 0x99, 36, 100,
      ...encodeVlq(480), 0x89, 36, 0,
      ...endOfTrack(0),
    ];

    const asset = parseMidi(buildMidi(1, 480, [t0, t1, t2]));
    expect(asset.tracks).toHaveLength(1);
    const tr = asset.tracks[0]!;
    expect(tr.index).toBe(1);
    expect(tr.name).toBe('主旋律');
    expect(tr.notes).toHaveLength(2);
    expect(tr.notes[0]!.midi).toBe(60);
    expect(tr.notes[0]!.start).toBeCloseTo(0, 6);
    expect(tr.notes[0]!.end).toBeCloseTo(0.75, 6);
    expect(tr.notes[1]!.midi).toBe(64);
    expect(tr.notes[1]!.start).toBeCloseTo(0.5, 6);
    expect(tr.notes[1]!.end).toBeCloseTo(1.0, 6);
  });

  it('正確產生 beats（含 4/4 與 6/8 拍號切換）', () => {
    // 4/4 拍 1 小節（4 拍 @ 120 BPM = 2s），接著切換 6/8 拍（每拍八分音符 @ 120*2=240）
    const t0 = [
      ...tempoEvent(0, 500000),
      ...timeSigEvent(0, 4, 2),
      ...encodeVlq(0), 0x90, 60, 80,
      ...encodeVlq(1920), 0x80, 60, 0, // 4 拍 = 1920 ticks
      ...timeSigEvent(0, 6, 3), // 6/8 拍（denominator = 8）
      ...encodeVlq(0), 0x90, 62, 80,
      ...encodeVlq(720), 0x80, 62, 0, // 3 個八分音符 = 720 ticks
      ...endOfTrack(0),
    ];
    const asset = parseMidi(buildMidi(0, 480, [t0]));
    // 4/4 的 4 拍（0, 0.5, 1.0, 1.5）+ 6/8 的 3 拍（2.0, 2.25, 2.5）
    expect(asset.beats.length).toBeGreaterThanOrEqual(7);
    expect(asset.beats[0]![1]).toBe(0);
    expect(asset.beats[0]![2]).toBeCloseTo(120, 6);
    expect(asset.beats[3]![1]).toBe(3);
    expect(asset.beats[4]![0]).toBeCloseTo(2.0, 6);
    expect(asset.beats[4]![1]).toBe(0);
    expect(asset.beats[4]![2]).toBeCloseTo(240, 6);
  });

  it('驗證錯誤情境：無效檔頭、format 2、SMPTE 與無音高音符', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow(
      '無法讀取 MIDI，請確認為標準 .mid 檔。',
    );
    const fmt2 = buildMidi(2, 480, [[...endOfTrack(0)]]);
    expect(() => parseMidi(fmt2)).toThrow('type 2');

    const smpte = buildMidi(0, 0x8000 | 25, [[...endOfTrack(0)]]);
    expect(() => parseMidi(smpte)).toThrow('SMPTE');

    const noNotes = buildMidi(0, 480, [[...tempoEvent(0, 500000), ...endOfTrack(0)]]);
    expect(() => parseMidi(noNotes)).toThrow('沒有可用的有音高旋律音符');
  });

  it('trackInfo 與 melodyCandidates 正確判斷和弦軌與排序', () => {
    const t0 = [
      ...encodeVlq(0), 0x90, 60, 80,
      ...encodeVlq(0), 0x90, 64, 80, // 與 60 完全重疊 -> polyphonic
      ...encodeVlq(480), 0x80, 60, 0,
      ...encodeVlq(0), 0x80, 64, 0,
      ...endOfTrack(0),
    ];
    const t1 = [
      ...encodeVlq(0), 0x90, 67, 80,
      ...encodeVlq(240), 0x80, 67, 0,
      ...endOfTrack(0),
    ];
    const t2 = [
      ...encodeVlq(0), 0x90, 69, 80,
      ...encodeVlq(240), 0x80, 69, 0,
      ...encodeVlq(0), 0x90, 71, 80,
      ...encodeVlq(240), 0x80, 71, 0,
      ...endOfTrack(0),
    ];
    const asset = parseMidi(buildMidi(1, 480, [t0, t1, t2]));
    expect(trackInfo(asset.tracks[0]!)).toEqual({
      low: 60,
      high: 64,
      noteCount: 2,
      polyphonic: true,
    });
    expect(trackInfo(asset.tracks[1]!).polyphonic).toBe(false);
    // 非 polyphonic 優先、音符數多優先：t2 (2 notes) -> t1 (1 note) -> t0 (polyphonic)
    expect(melodyCandidates(asset)).toEqual([2, 1, 0]);
  });

  it('真實 MIDI 檔案 smoke test（SKY_SKY.MID 與 share-voc.mid）', async () => {
    const fs = (await import(/* @vite-ignore */ ('node:' + 'fs'))) as {
      readFileSync: (path: URL) => Uint8Array;
    };
    for (const filename of ['SKY_SKY.MID', 'share-voc.mid']) {
      const data = fs.readFileSync(
        new URL(`./fixtures/${filename}`, import.meta.url),
      );
      const asset = parseMidi(data);
      expect(asset.tracks.length).toBeGreaterThanOrEqual(1);
      expect(asset.duration).toBeGreaterThan(10);
      for (const track of asset.tracks) {
        for (let i = 1; i < track.notes.length; i++) {
          const prev = track.notes[i - 1]!;
          const curr = track.notes[i]!;
          expect(curr.start).toBeGreaterThanOrEqual(prev.start);
        }
      }
      expect(asset.beats.length).toBeGreaterThan(0);
      for (let i = 1; i < asset.beats.length; i++) {
        expect(asset.beats[i]![0]).toBeGreaterThan(asset.beats[i - 1]![0]);
      }
    }
  });
});
