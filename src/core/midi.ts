export interface MidiNote {
  start: number;
  end: number;
  midi: number;
  velocity: number;
  track: number;
}

export interface MidiTrack {
  index: number;
  name: string;
  notes: MidiNote[];
  channel?: number;
}

export type MidiBeat = [time: number, beatInBar: number, bpm: number];

export interface MidiAsset {
  tracks: MidiTrack[];
  duration: number;
  ticksPerBeat: number;
  beats: MidiBeat[];
}

export interface TrackInfo {
  low: number;
  high: number;
  noteCount: number;
  polyphonic: boolean;
}

const MAX_MIDI_SECONDS = 900;
const MAX_BEATS_COUNT = 20000;
const MAX_BEATS_SECONDS = 1800;
const POLYPHONIC_OVERLAP_SEC = 0.03;

const ERR_INVALID_MIDI = '無法讀取 MIDI，請確認為標準 .mid 檔。';
const ERR_TYPE2_MIDI =
  '此 MIDI 為 type 2 獨立時間軌，請先轉成 type 0 或 type 1 再匯入。';
const ERR_SMPTE_MIDI = '暫不支援 SMPTE MIDI，請先轉成以拍數計時的 MIDI。';
const ERR_NO_NOTES = 'MIDI 沒有可用的有音高旋律音符，請選擇包含旋律的檔案。';
const ERR_TOO_LONG = 'MIDI 最多 15 分鐘，請先裁出練習段落。';
const ERR_BEATS_TOO_LONG = 'MIDI 節拍資料過多或過長';

type RawEvent =
  | {
      tick: number;
      track: number;
      order: number;
      type: 'set_tempo';
      tempo: number;
    }
  | {
      tick: number;
      track: number;
      order: number;
      type: 'time_signature';
      numerator: number;
      denominator: number;
    }
  | {
      tick: number;
      track: number;
      order: number;
      type: 'note_on';
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      tick: number;
      track: number;
      order: number;
      type: 'note_off';
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      tick: number;
      track: number;
      order: number;
      type: 'control_change';
      channel: number;
      control: number;
      value: number;
    }
  | {
      tick: number;
      track: number;
      order: number;
      type: 'end_of_track';
    };

class ByteReader {
  private readonly bytes: Uint8Array;
  pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get length(): number {
    return this.bytes.length;
  }

  readU8(limit: number = this.bytes.length): number {
    if (this.pos >= limit) {
      throw new Error(ERR_INVALID_MIDI);
    }
    return this.bytes[this.pos++]!;
  }

  peekU8(limit: number = this.bytes.length): number {
    if (this.pos >= limit) {
      throw new Error(ERR_INVALID_MIDI);
    }
    return this.bytes[this.pos]!;
  }

  readU16BE(limit: number = this.bytes.length): number {
    if (this.pos + 2 > limit) {
      throw new Error(ERR_INVALID_MIDI);
    }
    const v = (this.bytes[this.pos]! << 8) | this.bytes[this.pos + 1]!;
    this.pos += 2;
    return v;
  }

  readU32BE(limit: number = this.bytes.length): number {
    if (this.pos + 4 > limit) {
      throw new Error(ERR_INVALID_MIDI);
    }
    const v =
      ((this.bytes[this.pos]! << 24) |
        (this.bytes[this.pos + 1]! << 16) |
        (this.bytes[this.pos + 2]! << 8) |
        this.bytes[this.pos + 3]!) >>>
      0;
    this.pos += 4;
    return v;
  }

  readAscii4(limit: number = this.bytes.length): string {
    if (this.pos + 4 > limit) {
      throw new Error(ERR_INVALID_MIDI);
    }
    const s = String.fromCharCode(
      this.bytes[this.pos]!,
      this.bytes[this.pos + 1]!,
      this.bytes[this.pos + 2]!,
      this.bytes[this.pos + 3]!,
    );
    this.pos += 4;
    return s;
  }

  readVarLen(limit: number = this.bytes.length): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.readU8(limit);
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) {
        return value;
      }
    }
    throw new Error(ERR_INVALID_MIDI);
  }

  readBytes(len: number, limit: number = this.bytes.length): Uint8Array {
    if (len < 0 || this.pos + len > limit) {
      throw new Error(ERR_INVALID_MIDI);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }

  skip(len: number, limit: number = this.bytes.length): void {
    if (len < 0 || this.pos + len > limit) {
      throw new Error(ERR_INVALID_MIDI);
    }
    this.pos += len;
  }
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

function ticksToSeconds(
  ticks: number,
  ticksPerBeat: number,
  tempo: number,
): number {
  return (ticks / ticksPerBeat) * (tempo / 1_000_000);
}

function compareEvents(a: RawEvent, b: RawEvent): number {
  return a.tick - b.tick || a.track - b.track || a.order - b.order;
}

/** 計算由全域 tempo 與拍號事件組成的拍點序列 */
function buildBeats(
  events: RawEvent[],
  endTick: number,
  ticksPerBeat: number,
): MidiBeat[] {
  const tempoOrSig = events.filter(
    (e) => e.type === 'set_tempo' || e.type === 'time_signature',
  );
  let tempo = 500000;
  let numerator = 4;
  let denominator = 4;
  let lastTick = 0;
  let seconds = 0;
  let nextTick = 0;
  let beat = 0;
  const result: MidiBeat[] = [];

  const sentinel: { tick: number; msg: RawEvent | null }[] = [
    ...tempoOrSig.map((msg) => ({ tick: msg.tick, msg })),
    { tick: endTick + 1, msg: null },
  ];

  for (const { tick, msg } of sentinel) {
    while (nextTick < tick && nextTick <= endTick) {
      const stamp = seconds + ticksToSeconds(nextTick - lastTick, ticksPerBeat, tempo);
      result.push([
        stamp,
        beat % numerator,
        (60_000_000 / tempo) * (denominator / 4),
      ]);
      if (result.length > MAX_BEATS_COUNT || stamp > MAX_BEATS_SECONDS) {
        throw new Error(ERR_BEATS_TOO_LONG);
      }
      beat += 1;
      nextTick += (ticksPerBeat * 4) / denominator;
    }
    seconds += ticksToSeconds(tick - lastTick, ticksPerBeat, tempo);
    lastTick = tick;
    if (msg?.type === 'set_tempo') {
      tempo = msg.tempo;
    } else if (msg?.type === 'time_signature') {
      numerator = msg.numerator;
      denominator = msg.denominator;
      nextTick = tick;
      beat = 0;
    }
  }

  return result;
}

/** 解析標準 MIDI 檔案（format 0 / 1） */
export function parseMidi(data: Uint8Array | ArrayBuffer): MidiAsset {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const reader = new ByteReader(bytes);

  if (reader.length < 14 || reader.readAscii4() !== 'MThd') {
    throw new Error(ERR_INVALID_MIDI);
  }
  const headerLen = reader.readU32BE();
  if (headerLen < 6 || reader.pos + headerLen > reader.length) {
    throw new Error(ERR_INVALID_MIDI);
  }
  const format = reader.readU16BE();
  const numTracks = reader.readU16BE();
  const division = reader.readU16BE();
  if (headerLen > 6) {
    reader.skip(headerLen - 6);
  }

  if (format === 2) {
    throw new Error(ERR_TYPE2_MIDI);
  }
  if (format !== 0 && format !== 1) {
    throw new Error(ERR_INVALID_MIDI);
  }
  if ((division & 0x8000) !== 0 || division <= 0) {
    throw new Error(ERR_SMPTE_MIDI);
  }
  const ticksPerBeat = division;

  const events: RawEvent[] = [];
  const trackNames = new Map<number, string>();
  let endTick = 0;
  let trackIndex = 0;

  while (trackIndex < numTracks) {
    if (reader.pos + 8 > reader.length) {
      throw new Error(ERR_INVALID_MIDI);
    }
    const chunkId = reader.readAscii4();
    const chunkLen = reader.readU32BE();
    const chunkEnd = reader.pos + chunkLen;
    if (chunkEnd > reader.length) {
      throw new Error(ERR_INVALID_MIDI);
    }
    if (chunkId !== 'MTrk') {
      reader.skip(chunkLen);
      continue;
    }

    let tick = 0;
    let order = 0;
    let runningStatus = 0;
    let rawName = '';

    while (reader.pos < chunkEnd) {
      const delta = reader.readVarLen(chunkEnd);
      tick += delta;

      let status = reader.peekU8(chunkEnd);
      if (status < 0x80) {
        if (runningStatus === 0) {
          throw new Error(ERR_INVALID_MIDI);
        }
        status = runningStatus;
      } else {
        reader.readU8(chunkEnd);
        if (status < 0xf0) {
          runningStatus = status;
        } else if (status === 0xf0 || status === 0xf7 || status === 0xff) {
          runningStatus = 0;
        }
      }

      if (status === 0xff) {
        const metaType = reader.readU8(chunkEnd);
        const metaLen = reader.readVarLen(chunkEnd);
        const metaData = reader.readBytes(metaLen, chunkEnd);
        if (metaType === 0x03) {
          rawName = utf8Decoder.decode(metaData);
        } else if (metaType === 0x51 && metaLen === 3) {
          const tempo =
            (metaData[0]! << 16) | (metaData[1]! << 8) | metaData[2]!;
          if (tempo > 0) {
            events.push({
              tick,
              track: trackIndex,
              order: order++,
              type: 'set_tempo',
              tempo,
            });
          }
        } else if (metaType === 0x58 && metaLen >= 2) {
          const numerator = metaData[0]!;
          const denominator = 1 << metaData[1]!;
          if (numerator > 0 && denominator > 0) {
            events.push({
              tick,
              track: trackIndex,
              order: order++,
              type: 'time_signature',
              numerator,
              denominator,
            });
          }
        } else if (metaType === 0x2f) {
          events.push({
            tick,
            track: trackIndex,
            order: order++,
            type: 'end_of_track',
          });
          reader.pos = chunkEnd;
          break;
        }
      } else if (status === 0xf0 || status === 0xf7) {
        const sysexLen = reader.readVarLen(chunkEnd);
        reader.skip(sysexLen, chunkEnd);
      } else if (status >= 0x80 && status <= 0xef) {
        const msgType = status & 0xf0;
        const channel = status & 0x0f;
        const data1 = reader.readU8(chunkEnd);
        if (msgType === 0xc0 || msgType === 0xd0) {
          // 單資料位元組訊息（Program Change / Channel Pressure），略過
          continue;
        }
        const data2 = reader.readU8(chunkEnd);
        if (msgType === 0x90) {
          events.push({
            tick,
            track: trackIndex,
            order: order++,
            type: 'note_on',
            channel,
            note: data1,
            velocity: data2,
          });
        } else if (msgType === 0x80) {
          events.push({
            tick,
            track: trackIndex,
            order: order++,
            type: 'note_off',
            channel,
            note: data1,
            velocity: data2,
          });
        } else if (msgType === 0xb0) {
          events.push({
            tick,
            track: trackIndex,
            order: order++,
            type: 'control_change',
            channel,
            control: data1,
            value: data2,
          });
        }
      } else {
        throw new Error(ERR_INVALID_MIDI);
      }
    }

    reader.pos = chunkEnd;
    trackNames.set(
      trackIndex,
      rawName || `旋律軌 ${trackIndex + 1}`,
    );
    if (tick > endTick) {
      endTick = tick;
    }
    trackIndex += 1;
  }

  events.sort(compareEvents);

  interface PendingNote {
    start: number;
    velocity: number;
    channel: number;
  }

  const active = new Map<string, PendingNote[]>();
  const sustained = new Map<string, { pitch: number; item: PendingNote }[]>();
  const pedal = new Map<string, boolean>();
  const notesByTrack = new Map<number, MidiNote[]>();
  const channelsByTrack = new Map<number, Set<number>>();

  let now = 0;
  let lastTick = 0;
  let tempo = 500000;

  const finish = (track: number, pitch: number, item: PendingNote, end: number) => {
    if (end > item.start) {
      let list = notesByTrack.get(track);
      if (!list) {
        list = [];
        notesByTrack.set(track, list);
      }
      list.push({
        start: item.start,
        end,
        midi: pitch,
        velocity: item.velocity,
        track,
      });
      let chSet = channelsByTrack.get(track);
      if (!chSet) {
        chSet = new Set();
        channelsByTrack.set(track, chSet);
      }
      chSet.add(item.channel);
    }
  };

  const releaseChannel = (
    track: number,
    channel: number,
    end: number,
    immediate: boolean,
  ) => {
    const chKey = `${track}:${channel}`;
    const prefix = `${chKey}:`;
    const isPedalDown = pedal.get(chKey) ?? false;
    for (const [key, queue] of active.entries()) {
      if (!key.startsWith(prefix)) continue;
      const pitch = Number(key.slice(prefix.length));
      while (queue.length > 0) {
        const item = queue.shift()!;
        if (isPedalDown && !immediate) {
          let sus = sustained.get(chKey);
          if (!sus) {
            sus = [];
            sustained.set(chKey, sus);
          }
          sus.push({ pitch, item });
        } else {
          finish(track, pitch, item, end);
        }
      }
    }
    if (immediate) {
      const sus = sustained.get(chKey);
      if (sus) {
        sustained.delete(chKey);
        for (const { pitch, item } of sus) {
          finish(track, pitch, item, end);
        }
      }
    }
  };

  for (const ev of events) {
    now += ticksToSeconds(ev.tick - lastTick, ticksPerBeat, tempo);
    lastTick = ev.tick;
    if (now > MAX_MIDI_SECONDS) {
      throw new Error(ERR_TOO_LONG);
    }
    if (ev.type === 'set_tempo') {
      tempo = ev.tempo;
      continue;
    }
    if (ev.type === 'time_signature' || ev.type === 'end_of_track') {
      continue;
    }
    // 略過打擊樂 channel 10（索引 9）
    if (ev.channel === 9) {
      continue;
    }

    const chKey = `${ev.track}:${ev.channel}`;
    if (ev.type === 'note_on' && ev.velocity > 0) {
      const noteKey = `${chKey}:${ev.note}`;
      let queue = active.get(noteKey);
      if (!queue) {
        queue = [];
        active.set(noteKey, queue);
      }
      queue.push({ start: now, velocity: ev.velocity, channel: ev.channel });
    } else if (
      ev.type === 'note_off' ||
      (ev.type === 'note_on' && ev.velocity === 0)
    ) {
      const noteKey = `${chKey}:${ev.note}`;
      const queue = active.get(noteKey);
      if (queue && queue.length > 0) {
        const item = queue.shift()!;
        if (pedal.get(chKey)) {
          let sus = sustained.get(chKey);
          if (!sus) {
            sus = [];
            sustained.set(chKey, sus);
          }
          sus.push({ pitch: ev.note, item });
        } else {
          finish(ev.track, ev.note, item, now);
        }
      }
    } else if (ev.type === 'control_change' && ev.control === 64) {
      const wasDown = pedal.get(chKey) ?? false;
      const isDown = ev.value >= 64;
      pedal.set(chKey, isDown);
      if (wasDown && !isDown) {
        const sus = sustained.get(chKey);
        if (sus) {
          sustained.delete(chKey);
          for (const { pitch, item } of sus) {
            finish(ev.track, pitch, item, now);
          }
        }
      }
    } else if (
      ev.type === 'control_change' &&
      (ev.control === 120 || ev.control === 123)
    ) {
      releaseChannel(ev.track, ev.channel, now, ev.control === 120);
    }
  }

  // 缺少 note-off 時，以檔案結束時間收尾
  for (const [key, queue] of active.entries()) {
    const [trackStr, , pitchStr] = key.split(':');
    const track = Number(trackStr);
    const pitch = Number(pitchStr);
    for (const item of queue) {
      finish(track, pitch, item, now);
    }
  }
  for (const [chKey, sus] of sustained.entries()) {
    const track = Number(chKey.split(':')[0]);
    for (const { pitch, item } of sus) {
      finish(track, pitch, item, now);
    }
  }

  const tracks: MidiTrack[] = [];
  const sortedTrackIndices = [...notesByTrack.keys()].sort((a, b) => a - b);
  for (const index of sortedTrackIndices) {
    const items = notesByTrack.get(index)!;
    if (items.length === 0) continue;
    items.sort((a, b) => a.start - b.start || a.midi - b.midi || a.end - b.end);
    const chSet = channelsByTrack.get(index);
    const channel = chSet && chSet.size === 1 ? [...chSet][0] : undefined;
    tracks.push({
      index,
      name: trackNames.get(index) ?? `旋律軌 ${index + 1}`,
      notes: items,
      ...(channel !== undefined ? { channel } : {}),
    });
  }

  if (tracks.length === 0) {
    throw new Error(ERR_NO_NOTES);
  }

  const beats = buildBeats(events, endTick, ticksPerBeat);

  return {
    tracks,
    duration: now,
    ticksPerBeat,
    beats,
  };
}

/** 計算音軌的音域、音符數與是否為和弦軌（時間重疊超過 30 ms） */
export function trackInfo(track: MidiTrack): TrackInfo {
  const { notes } = track;
  if (notes.length === 0) {
    return { low: 0, high: 0, noteCount: 0, polyphonic: false };
  }
  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || a.midi - b.midi || a.end - b.end,
  );
  let low = Infinity;
  let high = -Infinity;
  let maxEnd = -Infinity;
  let polyphonic = false;

  for (const n of sorted) {
    if (n.midi < low) low = n.midi;
    if (n.midi > high) high = n.midi;
    if (!polyphonic && maxEnd > -Infinity) {
      const overlap = Math.min(maxEnd, n.end) - n.start;
      if (overlap > POLYPHONIC_OVERLAP_SEC) {
        polyphonic = true;
      }
    }
    if (n.end > maxEnd) maxEnd = n.end;
  }

  return {
    low,
    high,
    noteCount: notes.length,
    polyphonic,
  };
}

/** 依「非和弦軌優先、音符數多優先」排序回傳候選旋律軌道索引 */
export function melodyCandidates(asset: MidiAsset): number[] {
  return asset.tracks
    .map((track) => ({ track, info: trackInfo(track) }))
    .sort((a, b) => {
      if (a.info.polyphonic !== b.info.polyphonic) {
        return a.info.polyphonic ? 1 : -1;
      }
      if (a.info.noteCount !== b.info.noteCount) {
        return b.info.noteCount - a.info.noteCount;
      }
      return a.track.index - b.track.index;
    })
    .map((item) => item.track.index);
}
