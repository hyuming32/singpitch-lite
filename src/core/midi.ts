export interface MidiNote {
  start: number;
  end: number;
  midi: number;
  velocity: number;
  track: number;
  /** 原始 MIDI 起始 tick（僅由 parseMidi 解析時填入） */
  startTick?: number;
  /** 原始 MIDI 結束 tick（僅由 parseMidi 解析時填入） */
  endTick?: number;
}

export interface MidiTrack {
  index: number;
  name: string;
  notes: MidiNote[];
  channel?: number;
  /** GM 樂器編號（0–127），來自 Program Change（0xC0） */
  program?: number;
}

export type MidiBeat = [time: number, beatInBar: number, bpm: number];

export interface MidiTimeSignatureEvent {
  tick: number;
  time: number;
  numerator: number;
  denominator: number;
}

export interface MidiAsset {
  tracks: MidiTrack[];
  duration: number;
  ticksPerBeat: number;
  beats: MidiBeat[];
  /** MIDI 拍號事件序列（含起始預設 4/4 與中途變拍號） */
  timeSignatures?: MidiTimeSignatureEvent[];
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
const POLYPHONIC_OVERLAP_RATIO = 0.1;

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
      type: 'program_change';
      channel: number;
      program: number;
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
        if (msgType === 0xc0) {
          events.push({
            tick,
            track: trackIndex,
            order: order++,
            type: 'program_change',
            channel,
            program: data1,
          });
          continue;
        }
        if (msgType === 0xd0) {
          // 單資料位元組訊息（Channel Pressure），略過
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
    startTick: number;
    velocity: number;
    channel: number;
  }

  const active = new Map<string, PendingNote[]>();
  const orphanedOffs = new Map<string, number>();
  const sustained = new Map<string, { pitch: number; item: PendingNote }[]>();
  const pedal = new Map<string, boolean>();
  const notesByTrack = new Map<number, MidiNote[]>();
  const channelsByTrack = new Map<number, Set<number>>();
  const currentProgramByCh = new Map<string, number>();
  const trackFirstNoteProgram = new Map<number, number>();
  const trackFirstProgramFallback = new Map<number, number>();
  const timeSignatures: MidiTimeSignatureEvent[] = [];

  let now = 0;
  let lastTick = 0;
  let tempo = 500000;

  const finish = (
    track: number,
    pitch: number,
    item: PendingNote,
    end: number,
    endTick: number,
  ) => {
    // 鼓軌（channel 10）有時可能出現極短或零長度觸發，給最小有效時長
    const effectiveEnd =
      item.channel === 9 && end <= item.start ? item.start + 0.05 : end;
    const effectiveEndTick =
      item.channel === 9 && endTick <= item.startTick
        ? item.startTick + 1
        : endTick;
    if (effectiveEnd > item.start) {
      let list = notesByTrack.get(track);
      if (!list) {
        list = [];
        notesByTrack.set(track, list);
      }
      list.push({
        start: item.start,
        end: effectiveEnd,
        midi: pitch,
        velocity: item.velocity,
        track,
        startTick: item.startTick,
        endTick: effectiveEndTick,
      });
      let chSet = channelsByTrack.get(track);
      if (!chSet) {
        chSet = new Set();
        channelsByTrack.set(track, chSet);
      }
      chSet.add(item.channel);
      if (!trackFirstNoteProgram.has(track)) {
        const chProg = currentProgramByCh.get(`${track}:${item.channel}`);
        if (chProg !== undefined) {
          trackFirstNoteProgram.set(track, chProg);
        }
      }
    }
  };

  const releaseChannel = (
    track: number,
    channel: number,
    end: number,
    endTick: number,
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
          finish(track, pitch, item, end, endTick);
        }
      }
    }
    for (const key of orphanedOffs.keys()) {
      if (key.startsWith(prefix)) {
        orphanedOffs.delete(key);
      }
    }
    if (immediate) {
      const sus = sustained.get(chKey);
      if (sus) {
        sustained.delete(chKey);
        for (const { pitch, item } of sus) {
          finish(track, pitch, item, end, endTick);
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
    if (ev.type === 'time_signature') {
      const lastSig = timeSignatures[timeSignatures.length - 1];
      if (lastSig && lastSig.tick === ev.tick) {
        lastSig.numerator = ev.numerator;
        lastSig.denominator = ev.denominator;
      } else {
        timeSignatures.push({
          tick: ev.tick,
          time: now,
          numerator: ev.numerator,
          denominator: ev.denominator,
        });
      }
      continue;
    }
    if (ev.type === 'end_of_track') {
      continue;
    }
    if (ev.type === 'program_change') {
      const chKeyProg = `${ev.track}:${ev.channel}`;
      currentProgramByCh.set(chKeyProg, ev.program);
      if (!trackFirstProgramFallback.has(ev.track)) {
        trackFirstProgramFallback.set(ev.track, ev.program);
      }
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
      // 同 channel 同音高在前一個尚未 note-off 時又收到 note-on：結束前一個音並記錄一個待消耗的對應 note-off
      while (queue.length > 0) {
        const prev = queue.shift()!;
        finish(ev.track, ev.note, prev, now, ev.tick);
        orphanedOffs.set(noteKey, (orphanedOffs.get(noteKey) ?? 0) + 1);
      }
      queue.push({
        start: now,
        startTick: ev.tick,
        velocity: ev.velocity,
        channel: ev.channel,
      });
    } else if (
      ev.type === 'note_off' ||
      (ev.type === 'note_on' && ev.velocity === 0)
    ) {
      const noteKey = `${chKey}:${ev.note}`;
      const orphan = orphanedOffs.get(noteKey) ?? 0;
      if (orphan > 0) {
        orphanedOffs.set(noteKey, orphan - 1);
        continue;
      }
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
          finish(ev.track, ev.note, item, now, ev.tick);
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
            finish(ev.track, pitch, item, now, ev.tick);
          }
        }
      }
    } else if (
      ev.type === 'control_change' &&
      (ev.control === 120 || ev.control === 123)
    ) {
      releaseChannel(ev.track, ev.channel, now, ev.tick, ev.control === 120);
    }
  }

  // 缺少 note-off 時，以檔案結束時間收尾
  for (const [key, queue] of active.entries()) {
    const [trackStr, , pitchStr] = key.split(':');
    const track = Number(trackStr);
    const pitch = Number(pitchStr);
    for (const item of queue) {
      finish(track, pitch, item, now, lastTick);
    }
  }
  for (const [chKey, sus] of sustained.entries()) {
    const track = Number(chKey.split(':')[0]);
    for (const { pitch, item } of sus) {
      finish(track, pitch, item, now, lastTick);
    }
  }

  if (timeSignatures.length === 0 || timeSignatures[0]!.tick > 0) {
    timeSignatures.unshift({
      tick: 0,
      time: 0,
      numerator: 4,
      denominator: 4,
    });
  }

  const tracks: MidiTrack[] = [];
  const sortedTrackIndices = [...notesByTrack.keys()].sort((a, b) => a - b);
  for (const index of sortedTrackIndices) {
    const items = notesByTrack.get(index)!;
    if (items.length === 0) continue;
    items.sort((a, b) => a.start - b.start || a.midi - b.midi || a.end - b.end);
    const chSet = channelsByTrack.get(index);
    const channel = chSet && chSet.size === 1 ? [...chSet][0] : undefined;
    const program =
      trackFirstNoteProgram.get(index) ?? trackFirstProgramFallback.get(index);
    tracks.push({
      index,
      name: trackNames.get(index) ?? `旋律軌 ${index + 1}`,
      notes: items,
      ...(channel !== undefined ? { channel } : {}),
      ...(program !== undefined ? { program } : {}),
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
    timeSignatures,
  };
}

/** 計算音軌中不同音高同時發聲（重疊）時間佔該軌總發聲時間的比例（0..1） */
export function trackOverlapRatio(track: MidiTrack): number {
  const { notes } = track;
  if (notes.length < 2) {
    return 0;
  }

  const events: { t: number; delta: 1 | -1; midi: number }[] = [];
  for (const n of notes) {
    if (n.end > n.start) {
      events.push({ t: n.start, delta: 1, midi: n.midi });
      events.push({ t: n.end, delta: -1, midi: n.midi });
    }
  }
  if (events.length === 0) {
    return 0;
  }

  events.sort((a, b) => a.t - b.t || a.delta - b.delta);

  const pitchCounts = new Map<number, number>();
  let totalNotesActive = 0;
  let activeDur = 0;
  let polyDur = 0;
  let prevT = events[0]!.t;

  for (const ev of events) {
    const dt = ev.t - prevT;
    if (dt > 0) {
      if (totalNotesActive >= 1) {
        activeDur += dt;
      }
      if (pitchCounts.size >= 2) {
        polyDur += dt;
      }
    }
    totalNotesActive += ev.delta;
    const prevCount = pitchCounts.get(ev.midi) ?? 0;
    const nextCount = prevCount + ev.delta;
    if (nextCount <= 0) {
      pitchCounts.delete(ev.midi);
    } else {
      pitchCounts.set(ev.midi, nextCount);
    }
    prevT = ev.t;
  }

  return activeDur > 0 ? polyDur / activeDur : 0;
}

/** 計算音軌的音域、音符數與是否為和弦軌（異音重疊時間佔總發聲時間 > 10% 視為複音） */
export function trackInfo(track: MidiTrack): TrackInfo {
  const { notes } = track;
  if (notes.length === 0) {
    return { low: 0, high: 0, noteCount: 0, polyphonic: false };
  }
  let low = Infinity;
  let high = -Infinity;

  for (const n of notes) {
    if (n.midi < low) low = n.midi;
    if (n.midi > high) high = n.midi;
  }

  return {
    low,
    high,
    noteCount: notes.length,
    polyphonic: trackOverlapRatio(track) > POLYPHONIC_OVERLAP_RATIO,
  };
}

const DEFAULT_TRACK_NAME_RE = /^旋律軌\s+\d+$/;
const MELODY_NAME_RE =
  /vocal|voice|vox|melody|lead|sing|主旋律|旋律|人聲|主唱|歌/i;
const BACKING_NAME_RE = /backing|harmony|chorus|合音|和聲/i;
const DRUM_NAME_RE = /\b(drums?|percussion|kit)\b|爵士鼓|鼓組/i;

function isDrumTrack(track: MidiTrack): boolean {
  return track.channel === 9;
}

function hasExplicitMelodyName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || DEFAULT_TRACK_NAME_RE.test(trimmed)) {
    return false;
  }
  return MELODY_NAME_RE.test(trimmed);
}

function scoreMelodyTrack(track: MidiTrack): number {
  const info = trackInfo(track);
  if (info.noteCount === 0) {
    return -Infinity;
  }

  let score = 0;
  const trimmedName = track.name.trim();
  if (hasExplicitMelodyName(trimmedName)) {
    score += BACKING_NAME_RE.test(trimmedName) ? 700 : 1000;
  } else if (trimmedName && DRUM_NAME_RE.test(trimmedName)) {
    score -= 500;
  }

  // 重疊比例 <= 10%（單音）優先
  if (!info.polyphonic) {
    score += 200;
  }

  // 音域落在 C3–C6（MIDI 48–84）的比例
  let inRange = 0;
  for (const n of track.notes) {
    if (n.midi >= 48 && n.midi <= 84) {
      inRange += 1;
    }
  }
  score += (inRange / info.noteCount) * 100;

  // 音數適中加分（800 音以內隨音數遞增，超過 800 逐漸扣減過密伴奏軌）
  const countScore =
    info.noteCount <= 800
      ? (info.noteCount / 800) * 40
      : Math.max(0, 40 - ((info.noteCount - 800) / 1200) * 40);
  score += countScore;

  return score;
}

/** 依軌名關鍵字、單音特性、C3–C6 音域比例與音數適中度排序回傳候選旋律軌道索引（排除鼓軌） */
export function melodyCandidates(asset: MidiAsset): number[] {
  return asset.tracks
    .filter((track) => !isDrumTrack(track) && track.notes.length > 0)
    .map((track) => ({ track, score: scoreMelodyTrack(track) }))
    .sort((a, b) => {
      if (Math.abs(a.score - b.score) > 1e-9) {
        return b.score - a.score;
      }
      return a.track.index - b.track.index;
    })
    .map((item) => item.track.index);
}

/** 推薦最適合練唱的主旋律軌道索引（排除鼓軌 channel 10；無可用軌時回傳 null） */
export function suggestMelodyTrack(asset: MidiAsset): number | null {
  return melodyCandidates(asset)[0] ?? null;
}
