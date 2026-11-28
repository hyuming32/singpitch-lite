import type {
  MidiMixerSettings,
  MidiSongSettings,
  MidiTrackRole,
} from '../state/midiLibrary';
import type { MicInputMode } from '../state/settings';
import type { SchedEvent } from '../audio/dsp/schedule';
import {
  suggestMelodyTrack,
  type MidiAsset,
  type MidiNote,
  type MidiTrack,
} from './midi';
import { computeMidiBars, type MidiBarInfo } from './midiExercise';
import { midiToHz } from './notes';

export type SynthTimbre = 'piano' | 'organ' | 'strings' | 'bass' | 'guitar';

export type DrumSound =
  | 'kick'
  | 'snare'
  | 'closedHat'
  | 'openHat'
  | 'cymbal'
  | 'tom';

export interface AccompNoteEvent {
  start: number;
  dur: number;
  midi: number;
  /** 正規化力度（0..1） */
  velocity: number;
  timbre: SynthTimbre;
  trackIndex: number;
}

export interface RhythmHitEvent {
  start: number;
  dur: number;
  midi: number;
  drum: DrumSound;
  /** 正規化力度（0..1） */
  velocity: number;
  trackIndex: number;
}

export interface BuildMidiMixLayersOptions {
  trackRoles: Readonly<Record<number, MidiTrackRole>>;
  startBar: number;
  endBar: number;
  transposeSemitones?: number;
  speedPercent?: number;
  mode?: 'follow' | 'listen-then-sing';
  repeats?: number;
  countIn?: boolean;
  mixer?: Pick<MidiMixerSettings, 'accompEnabled' | 'rhythmEnabled'>;
}

export interface MidiMixLayers {
  accompNotes: AccompNoteEvent[];
  rhythmHits: RhythmHitEvent[];
  hasAccompTracks: boolean;
  hasRhythmTracks: boolean;
}

/** 通用 MIDI（GM Level 1）128 種樂器繁體中文名稱 */
export const GM_INSTRUMENT_NAMES_ZH: readonly string[] = [
  // 0–7 鋼琴
  '平台鋼琴',
  '明亮鋼琴',
  '電平台鋼琴',
  '酒吧鋼琴',
  '電鋼琴 1',
  '電鋼琴 2',
  '大鍵琴',
  '古鋼琴',
  // 8–15 半音打擊樂器
  '鋼片琴',
  '鐵琴',
  '音樂盒',
  '顫音琴',
  '馬林巴琴',
  '木琴',
  '管鐘',
  '揚琴',
  // 16–23 風琴
  '音栓風琴',
  '敲擊風琴',
  '搖滾風琴',
  '教堂管風琴',
  '簧風琴',
  '手風琴',
  '口琴',
  '探戈手風琴',
  // 24–31 吉他
  '尼龍弦吉他',
  '鋼弦吉他',
  '爵士電吉他',
  '清音電吉他',
  '悶音電吉他',
  '過載吉他',
  '失真吉他',
  '吉他泛音',
  // 32–39 貝斯
  '原聲貝斯',
  '指彈電貝斯',
  '撥片電貝斯',
  '無品貝斯',
  '擊弦貝斯 1',
  '擊弦貝斯 2',
  '合成貝斯 1',
  '合成貝斯 2',
  // 40–47 弦樂
  '小提琴',
  '中提琴',
  '大提琴',
  '低音提琴',
  '顫弓弦樂',
  '撥奏弦樂',
  '管弦豎琴',
  '定音鼓',
  // 48–55 合奏
  '弦樂合奏 1',
  '弦樂合奏 2',
  '合成弦樂 1',
  '合成弦樂 2',
  '人聲合唱啊',
  '人聲喔',
  '合成人聲',
  '管弦齊奏',
  // 56–63 銅管
  '小號',
  '長號',
  '低音號',
  '弱音小號',
  '法國號',
  '銅管合奏',
  '合成銅管 1',
  '合成銅管 2',
  // 64–71 簧片
  '高音薩克斯風',
  '中音薩克斯風',
  '次中音薩克斯風',
  '上低音薩克斯風',
  '雙簧管',
  '英國管',
  '低音管',
  '單簧管',
  // 72–79 吹管
  '短笛',
  '長笛',
  '直笛',
  '排笛',
  '瓶笛',
  '尺八',
  '口哨',
  '陶笛',
  // 80–87 合成主奏
  '合成主音方波',
  '合成主音鋸齒波',
  '合成主音汽笛風琴',
  '合成主音吹管',
  '合成主音吉他',
  '合成主音人聲',
  '合成主音五度',
  '合成主音低音',
  // 88–95 合成襯底
  '合成襯底新世紀',
  '合成襯底溫暖',
  '合成襯底複音',
  '合成襯底合唱',
  '合成襯底弓弦',
  '合成襯底金屬',
  '合成襯底光暈',
  '合成襯底掃頻',
  // 96–103 合成音效
  '合成雨聲',
  '合成電影配樂',
  '合成水晶',
  '合成氛圍',
  '合成明亮',
  '合成哥布林',
  '合成回音',
  '合成科幻',
  // 104–111 民族樂器
  '西塔琴',
  '斑鳩琴',
  '三味線',
  '十三絃箏',
  '卡林巴琴',
  '風笛',
  '民間小提琴',
  '嗩吶',
  // 112–119 打擊樂器
  '叮噹鈴',
  '阿哥哥鈴',
  '鋼鼓',
  '木魚',
  '太鼓',
  '旋律通鼓',
  '合成鼓',
  '反轉銅鈸',
  // 120–127 音效
  '吉他滑弦雜音',
  '呼吸聲',
  '海浪聲',
  '鳥鳴聲',
  '電話鈴聲',
  '直升機聲',
  '掌聲',
  '槍聲',
];

/** 音色類別對應的繁體中文標籤 */
export const SYNTH_TIMBRE_LABEL_ZH: Record<SynthTimbre, string> = {
  piano: '鋼琴',
  organ: '風琴',
  strings: '弦樂',
  bass: '貝斯',
  guitar: '吉他',
};

/** 判斷 GM Program 編號是否屬於打擊類（112–119） */
export function isGmPercussiveProgram(program?: number): boolean {
  return (
    typeof program === 'number' &&
    Number.isInteger(program) &&
    program >= 112 &&
    program <= 119
  );
}

/** 判斷音軌是否為打擊／節奏候選軌（channel 10 或 GM 打擊類） */
export function isRhythmTrackCandidate(
  track: Pick<MidiTrack, 'channel' | 'program'>,
): boolean {
  return track.channel === 9 || isGmPercussiveProgram(track.program);
}

/** 取得音軌的 GM 樂器繁體中文顯示名稱 */
export function getGmInstrumentName(
  track: Pick<MidiTrack, 'channel' | 'program'>,
): string {
  if (track.channel === 9) {
    return '鼓組';
  }
  if (
    typeof track.program === 'number' &&
    Number.isInteger(track.program) &&
    track.program >= 0 &&
    track.program <= 127
  ) {
    return GM_INSTRUMENT_NAMES_ZH[track.program]!;
  }
  return '鋼琴（未指定）';
}

/** 依 GM Program 編號分類到最接近的內建合成音色（不確定時用鋼琴） */
export function classifyProgramTimbre(program?: number): SynthTimbre {
  if (
    typeof program !== 'number' ||
    !Number.isInteger(program) ||
    program < 0 ||
    program > 127
  ) {
    return 'piano';
  }
  if (program <= 15) return 'piano';
  if (program <= 23) return 'organ';
  if (program <= 31) return 'guitar';
  if (program <= 39) return 'bass';
  if (program <= 45) return 'strings';
  if (program === 46) return 'guitar'; // 豎琴為撥弦
  if (program === 47) return 'bass'; // 定音鼓低音敲擊
  if (program <= 55) return 'strings';
  if (program <= 87) return 'organ'; // 銅管、簧片、吹管、合成主奏
  if (program <= 95) return 'strings'; // 合成襯底（慢起音）
  if (program <= 103) return 'piano'; // 合成音效
  if (program <= 108) return 'guitar'; // 撥弦民族樂器（西塔、斑鳩、三味線、箏、卡林巴）
  if (program === 110) return 'strings'; // 民間小提琴
  if (program <= 111) return 'organ'; // 風笛、嗩吶
  return 'piano';
}

/** 將 GM 鼓組 MIDI 音號對應到 6 種合成鼓聲類別（未對應者取最接近類別） */
export function mapGmDrumNote(midiNote: number): DrumSound {
  const n = Math.round(midiNote);
  switch (n) {
    // 大鼓
    case 35:
    case 36:
      return 'kick';
    // 小鼓／響弦／邊擊／拍手
    case 37:
    case 38:
    case 39:
    case 40:
      return 'snare';
    // 閉合 hi-hat 與短高頻金屬／木質敲擊
    case 42:
    case 44:
    case 54:
    case 69:
    case 70:
    case 73:
    case 75:
    case 76:
    case 77:
    case 80:
      return 'closedHat';
    // 開放 hi-hat 與延長高頻刮奏／三角鐵
    case 46:
    case 74:
    case 81:
      return 'openHat';
    // 銅鈸類
    case 49:
    case 51:
    case 52:
    case 53:
    case 55:
    case 57:
    case 58:
    case 59:
      return 'cymbal';
    // 通鼓與具音高鼓類（Bongo, Conga, Timbale, Agogo, Cuica, Cowbell）
    case 41:
    case 43:
    case 45:
    case 47:
    case 48:
    case 50:
    case 56:
    case 60:
    case 61:
    case 62:
    case 63:
    case 64:
    case 65:
    case 66:
    case 67:
    case 68:
    case 71:
    case 72:
    case 78:
    case 79:
      return 'tom';
    default:
      if (n < 37) return 'kick';
      if (n <= 40) return 'snare';
      if (n <= 50) return 'tom';
      if (n <= 60) return 'cymbal';
      return 'closedHat';
  }
}

/**
 * 自動預分各軌角色：
 * - suggestMelodyTrack（或指定的非鼓主唱軌）＝ 主唱
 * - channel 10 或 GM 打擊類 ＝ 節奏組
 * - 其他有音的軌 ＝ 伴奏
 * - 沒有音的軌不列出
 */
export function autoAssignTrackRoles(
  asset: MidiAsset,
  preferredVocalTrackIndex?: number,
): Record<number, MidiTrackRole> {
  const nonEmpty = asset.tracks.filter((t) => t.notes.length > 0);
  if (nonEmpty.length === 0) {
    return {};
  }

  let vocalIdx: number | null = null;
  if (preferredVocalTrackIndex !== undefined) {
    const preferred = nonEmpty.find(
      (t) => t.index === preferredVocalTrackIndex && !isRhythmTrackCandidate(t),
    );
    if (preferred) {
      vocalIdx = preferred.index;
    }
  }
  if (vocalIdx === null) {
    vocalIdx = suggestMelodyTrack(asset);
  }

  const roles: Record<number, MidiTrackRole> = {};
  for (const track of nonEmpty) {
    if (vocalIdx !== null && track.index === vocalIdx) {
      roles[track.index] = 'vocal';
    } else if (isRhythmTrackCandidate(track)) {
      roles[track.index] = 'rhythm';
    } else {
      roles[track.index] = 'accompaniment';
    }
  }
  return roles;
}

/**
 * 設定單一軌道角色並維持「主唱只能一軌」規則：
 * 當選另一軌為主唱時，原主唱自動改為伴奏。
 */
export function setTrackRole(
  roles: Readonly<Record<number, MidiTrackRole>>,
  trackIndex: number,
  nextRole: MidiTrackRole,
): Record<number, MidiTrackRole> {
  const next: Record<number, MidiTrackRole> = { ...roles };
  if (nextRole === 'vocal') {
    for (const [keyStr, role] of Object.entries(next)) {
      const idx = Number(keyStr);
      if (idx !== trackIndex && role === 'vocal') {
        next[idx] = 'accompaniment';
      }
    }
  }
  next[trackIndex] = nextRole;
  return next;
}

/** 取得目前設定中的主唱軌索引（無主唱時回傳 null） */
export function findVocalTrackIndex(
  roles: Readonly<Record<number, MidiTrackRole>>,
  asset: MidiAsset,
): number | null {
  for (const track of asset.tracks) {
    if (track.notes.length > 0 && roles[track.index] === 'vocal') {
      return track.index;
    }
  }
  return null;
}

/** 解析有效分軌角色（舊資料無 trackRoles 時自動預分） */
export function resolveTrackRoles(
  asset: MidiAsset,
  songSettings?: Pick<MidiSongSettings, 'trackIndex' | 'trackRoles'> | null,
): Record<number, MidiTrackRole> {
  const nonEmpty = asset.tracks.filter((t) => t.notes.length > 0);
  if (!songSettings?.trackRoles) {
    return autoAssignTrackRoles(asset, songSettings?.trackIndex);
  }

  const auto = autoAssignTrackRoles(asset, songSettings.trackIndex);
  const resolved: Record<number, MidiTrackRole> = {};
  let vocalCount = 0;

  for (const track of nonEmpty) {
    const savedRole = songSettings.trackRoles[track.index];
    const role = savedRole ?? auto[track.index] ?? 'accompaniment';
    if (role === 'vocal') {
      if (vocalCount === 0) {
        resolved[track.index] = 'vocal';
        vocalCount++;
      } else {
        resolved[track.index] = 'accompaniment';
      }
    } else {
      resolved[track.index] = role;
    }
  }

  return resolved;
}

const EPS = 1e-6;
const MIN_NOTE_DUR = 0.01;

/** 切出 A–B 小節區間內的原始複音音符（保留全部音高與力度，時間歸零） */
export function sliceTrackNotesByBars(
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
  for (const n of track.notes) {
    if (n.start >= regionStart - 1e-4 && n.start < regionEnd - 1e-4) {
      const clampedStart = Math.max(regionStart, n.start);
      const clampedEnd = Math.min(regionEnd, Math.max(clampedStart + EPS, n.end));
      if (clampedEnd > clampedStart + 1e-5) {
        sliced.push({
          start: clampedStart - regionStart,
          end: clampedEnd - regionStart,
          midi: n.midi,
          velocity: n.velocity,
          track: n.track,
          ...(n.startTick !== undefined ? { startTick: n.startTick } : {}),
          ...(n.endTick !== undefined ? { endTick: n.endTick } : {}),
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

function normalizeVelocity(vel: number): number {
  if (!Number.isFinite(vel) || vel <= 0) return 0;
  return Math.max(0.05, Math.min(1, vel / 127));
}

/** 依分軌設定、A–B 區間、移調、變速與模式產生伴奏與節奏組播放事件 */
export function buildMidiMixLayers(
  asset: MidiAsset,
  opts: BuildMidiMixLayersOptions,
): MidiMixLayers {
  const bars = computeMidiBars(asset);
  if (bars.length === 0) {
    return {
      accompNotes: [],
      rhythmHits: [],
      hasAccompTracks: false,
      hasRhythmTracks: false,
    };
  }

  const transposeSemitones = Math.max(
    -12,
    Math.min(12, Math.round(opts.transposeSemitones ?? 0)),
  );
  const speedPercent = Math.max(
    50,
    Math.min(150, Math.round(opts.speedPercent ?? 100)),
  );
  const speedFactor = speedPercent / 100;
  const repeats = Math.max(1, Math.round(opts.repeats ?? 1));
  const mode = opts.mode ?? 'follow';
  const countIn = opts.countIn ?? true;
  const accompEnabled = opts.mixer?.accompEnabled ?? true;
  const rhythmEnabled = opts.mixer?.rhythmEnabled ?? true;

  const sBar = Math.max(1, Math.min(bars.length, Math.round(opts.startBar)));
  const eBar = Math.max(sBar, Math.min(bars.length, Math.round(opts.endBar)));
  const firstBar = bars[sBar - 1]!;
  const lastBar = bars[eBar - 1]!;
  const regionDur = Math.max(0.05, lastBar.end - firstBar.start);
  const beatSec = 60 / (firstBar.bpm * speedFactor);
  const countInOffset = countIn ? firstBar.beatsInBar * beatSec : 0;
  const passDur = regionDur / speedFactor;
  const totalPasses = (mode === 'listen-then-sing' ? 1 : 0) + repeats;

  const accompTracks = asset.tracks.filter(
    (t) => t.notes.length > 0 && opts.trackRoles[t.index] === 'accompaniment',
  );
  const rhythmTracks = asset.tracks.filter(
    (t) => t.notes.length > 0 && opts.trackRoles[t.index] === 'rhythm',
  );

  const accompNotes: AccompNoteEvent[] = [];
  if (accompEnabled) {
    for (const track of accompTracks) {
      const sliced = sliceTrackNotesByBars(track, bars, sBar, eBar);
      const timbre = classifyProgramTimbre(track.program);
      for (let p = 0; p < totalPasses; p++) {
        const passStart = countInOffset + p * passDur;
        for (const n of sliced.notes) {
          const dur = Math.max(MIN_NOTE_DUR, (n.end - n.start) / speedFactor);
          const midi = Math.max(0, Math.min(127, n.midi + transposeSemitones));
          accompNotes.push({
            start: passStart + n.start / speedFactor,
            dur,
            midi,
            velocity: normalizeVelocity(n.velocity),
            timbre,
            trackIndex: track.index,
          });
        }
      }
    }
    accompNotes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  }

  const rhythmHits: RhythmHitEvent[] = [];
  if (rhythmEnabled) {
    for (const track of rhythmTracks) {
      const sliced = sliceTrackNotesByBars(track, bars, sBar, eBar);
      for (let p = 0; p < totalPasses; p++) {
        const passStart = countInOffset + p * passDur;
        for (const n of sliced.notes) {
          const dur = Math.max(0.03, (n.end - n.start) / speedFactor);
          // 節奏組不移調
          rhythmHits.push({
            start: passStart + n.start / speedFactor,
            dur,
            midi: n.midi,
            drum: mapGmDrumNote(n.midi),
            velocity: normalizeVelocity(n.velocity),
            trackIndex: track.index,
          });
        }
      }
    }
    rhythmHits.sort((a, b) => a.start - b.start || a.midi - b.midi);
  }

  return {
    accompNotes,
    rhythmHits,
    hasAccompTracks: accompTracks.length > 0,
    hasRhythmTracks: rhythmTracks.length > 0,
  };
}

/** 判斷是否應顯示「伴奏／節奏組喇叭干擾麥克風」提示（每次進練唱頁最多一次） */
export function shouldShowAccompSpeakerHint(params: {
  isMidiMode: boolean;
  hasAccompOrRhythmEnabled: boolean;
  micActive: boolean;
  micMode: MicInputMode;
  alreadyShownThisVisit: boolean;
}): boolean {
  return (
    params.isMidiMode &&
    params.hasAccompOrRhythmEnabled &&
    params.micActive &&
    params.micMode !== 'headphone' &&
    !params.alreadyShownThisVisit
  );
}

/** 產生單一軌道的試聽排程事件（從第一個有音小節起約 maxDurationSec 秒，預設 8 秒） */
export function buildTrackPreviewEvents(params: {
  track: MidiTrack;
  bars: readonly MidiBarInfo[];
  role: MidiTrackRole;
  rate: number;
  a4?: number;
  maxDurationSec?: number;
}): { events: SchedEvent[]; totalFrames: number; durationSec: number } {
  const { track, bars, role, rate, a4 = 440, maxDurationSec = 8 } = params;
  const validNotes = track.notes.filter((n) => n.end > n.start + EPS);
  if (validNotes.length === 0) {
    return { events: [], totalFrames: 0, durationSec: 0 };
  }

  let firstStart = Infinity;
  for (const n of validNotes) {
    if (n.start < firstStart) firstStart = n.start;
  }

  const firstBar = bars.find((b) => firstStart < b.end - 1e-4) ?? bars[0];
  const windowStart = firstBar ? firstBar.start : firstStart;
  const windowEnd = windowStart + maxDurationSec;

  const isDrum = role === 'rhythm' || isRhythmTrackCandidate(track);
  const timbre = classifyProgramTimbre(track.program);
  const events: SchedEvent[] = [];
  let maxEndRel = 0;

  for (let i = 0; i < validNotes.length; i++) {
    const n = validNotes[i]!;
    if (n.start < windowStart - 1e-4) continue;
    if (n.start >= windowEnd - 1e-4) break;
    const relStart = Math.max(0, n.start - windowStart);
    const relEnd = Math.min(maxDurationSec, Math.max(relStart + 0.05, n.end - windowStart));
    if (relEnd > maxEndRel) maxEndRel = relEnd;

    const frame = Math.round(relStart * rate);
    const vel = normalizeVelocity(n.velocity);
    if (isDrum) {
      events.push({
        frame,
        type: 'drum',
        drum: mapGmDrumNote(n.midi),
        midi: n.midi,
        velocity: vel,
        bus: 'rhythm',
      });
    } else {
      const id = `prev:${track.index}:${i}`;
      events.push({
        frame,
        type: 'noteOn',
        id,
        hz: midiToHz(n.midi, a4),
        held: false,
        bus: 'accomp',
        timbre,
        velocity: vel,
      });
      events.push({
        frame: Math.max(frame + 1, Math.round(relEnd * rate)),
        type: 'noteOff',
        id,
        bus: 'accomp',
      });
    }
  }

  events.sort((a, b) => {
    if (a.frame !== b.frame) return a.frame - b.frame;
    const aOff = a.type === 'noteOff' ? 0 : 1;
    const bOff = b.type === 'noteOff' ? 0 : 1;
    return aOff - bOff;
  });

  const durationSec = Math.min(maxDurationSec, Math.max(0.2, maxEndRel + 0.25));
  const totalFrames = Math.round(durationSec * rate);
  return { events, totalFrames, durationSec };
}
