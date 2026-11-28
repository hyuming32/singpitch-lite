import { melodyCandidates, parseMidi } from '../core/midi';
import { computeMidiBars } from '../core/midiExercise';
import {
  loadMidiSongSettings,
  type MidiLibraryEntry,
  type MidiSongSettings,
} from '../state/midiLibrary';
import type { MidiPracticeSource } from './midi/MidiPage';

export type AppRoute = 'scale' | 'practice' | 'midi' | 'log';

export interface ActivePracticeSession {
  mode: 'scale' | 'midi';
  id?: string;
  hash?: string;
  startBar?: number;
  endBar?: number;
}

/** 判斷目前是否處於「正要進入 MIDI 練唱、尚待從 IndexedDB 載回曲目」的狀態 */
export function shouldRestoreMidiPractice(params: {
  route: AppRoute;
  practiceSource: 'scale' | 'midi';
  activeMidiSource: MidiPracticeSource | null;
  session: ActivePracticeSession | null;
}): boolean {
  if (params.route !== 'practice') return false;
  if (params.practiceSource !== 'midi') return false;
  if (params.activeMidiSource !== null) return false;
  return Boolean(
    params.session && params.session.mode === 'midi' && params.session.id,
  );
}

/** 依目前來源與掛載序號產生 PracticePage 的 key，切換歌曲／區間／軌別／音型時強制完整重建 */
export function buildPracticePageKey(params: {
  mountSeq: number;
  practiceSource: 'scale' | 'midi';
  midiSource: MidiPracticeSource | null;
  patternId: string;
}): string {
  if (params.practiceSource === 'midi' && params.midiSource) {
    const { id, hash, songSettings } = params.midiSource;
    return `midi:${params.mountSeq}:${id}:${hash}:${songSettings.trackIndex}:${songSettings.startBar}-${songSettings.endBar}`;
  }
  return `scale:${params.mountSeq}:${params.patternId}`;
}

/** 由 IndexedDB 曲目與 session 資料組出完整的 MidiPracticeSource */
export function buildMidiSourceFromEntry(
  entry: MidiLibraryEntry,
  sess: ActivePracticeSession,
): MidiPracticeSource {
  const asset = parseMidi(entry.bytes);
  const bars = computeMidiBars(asset);
  const maxBar = Math.max(1, bars.length);
  const saved = loadMidiSongSettings(entry.hash);
  const startBar = Math.max(
    1,
    Math.min(maxBar, sess.startBar ?? saved?.startBar ?? 1),
  );
  const endBar = Math.max(
    startBar,
    Math.min(maxBar, sess.endBar ?? saved?.endBar ?? maxBar),
  );
  const songSettings: MidiSongSettings = saved
    ? { ...saved, startBar, endBar }
    : {
        trackIndex: melodyCandidates(asset)[0] ?? asset.tracks[0]?.index ?? 0,
        startBar,
        endBar,
        transposeSemitones: 0,
        speedPercent: 100,
        manualKey: null,
      };
  return {
    id: entry.id,
    hash: entry.hash,
    name: entry.name,
    asset,
    songSettings,
  };
}
