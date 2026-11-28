import type { Key, KeyMode } from '../core/key';
import { MIDI_STORE_NAME, openSingpitchDb } from './db';
import type { StorageLike } from './settings';

export const MIDI_SETTINGS_STORAGE_KEY = 'singpitch-lite.midi.v1';
const STORE_NAME = MIDI_STORE_NAME;

export interface MidiLibraryMeta {
  id: string;
  hash: string;
  name: string;
  importedAt: string;
}

export interface MidiLibraryEntry extends MidiLibraryMeta {
  bytes: Uint8Array;
}

export interface MidiStore {
  readonly persistent: boolean;
  list(): Promise<MidiLibraryMeta[]>;
  get(id: string): Promise<MidiLibraryEntry | null>;
  put(entry: MidiLibraryEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

export type MidiTrackRole = 'vocal' | 'accompaniment' | 'rhythm' | 'mute';

export interface MidiMixerSettings {
  vocalEnabled: boolean;
  vocalVolume: number;
  accompEnabled: boolean;
  accompVolume: number;
  rhythmEnabled: boolean;
  rhythmVolume: number;
}

export const DEFAULT_MIDI_MIXER: MidiMixerSettings = {
  vocalEnabled: true,
  vocalVolume: 80,
  accompEnabled: true,
  accompVolume: 60,
  rhythmEnabled: true,
  rhythmVolume: 50,
};

export interface MidiSongSettings {
  trackIndex: number;
  startBar: number;
  endBar: number;
  transposeSemitones: number;
  speedPercent: number;
  manualKey: Key | null;
  /** 各軌分軌角色（以軌道 index 為鍵；未設定代表舊資料，使用自動預分） */
  trackRoles?: Record<number, MidiTrackRole>;
  /** 混音器三組開關與音量（0–100） */
  mixer?: MidiMixerSettings;
  /** 每首字幕時間位移（−10～+10 秒，每 0.05 秒一格） */
  lyricsOffsetSec?: number;
  /** 使用者是否曾主動修改過 A–B 區間（舊資料遷移用） */
  regionUserSet?: boolean;
  /** 譜內 A–B 重複起點小節號（1 起算，須在 startBar..endBar 內） */
  loopStartBar?: number;
  /** 譜內 A–B 重複終點小節號（1 起算，須在 startBar..endBar 內） */
  loopEndBar?: number;
}

/** 計算位元組陣列的 FNV-1a 32 位元十六進位雜湊值 */
export function fnv1aHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 去除 .mid / .midi 副檔名以顯示歌名 */
export function stripMidiExtension(filename: string): string {
  const trimmed = filename.trim();
  const stripped = trimmed.replace(/\.(midi?|MID|MIDI)$/i, '');
  return stripped || trimmed || '未命名 MIDI';
}

/** 記憶體版 MIDI 曲庫（供測試與無 IndexedDB 環境使用） */
export class MemoryMidiStore implements MidiStore {
  readonly persistent = false;
  private readonly items = new Map<string, MidiLibraryEntry>();

  async list(): Promise<MidiLibraryMeta[]> {
    return [...this.items.values()]
      .map(({ id, hash, name, importedAt }) => ({
        id,
        hash,
        name,
        importedAt,
      }))
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async get(id: string): Promise<MidiLibraryEntry | null> {
    const found = this.items.get(id);
    if (!found) return null;
    return {
      ...found,
      bytes: new Uint8Array(found.bytes),
    };
  }

  async put(entry: MidiLibraryEntry): Promise<void> {
    this.items.set(entry.id, {
      ...entry,
      bytes: new Uint8Array(entry.bytes),
    });
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

/** IndexedDB 版 MIDI 曲庫 */
export class IndexedDbMidiStore implements MidiStore {
  readonly persistent = true;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    this.dbPromise = openSingpitchDb().catch((err) => {
      this.dbPromise = null;
      throw err;
    });
    return this.dbPromise;
  }

  async list(): Promise<MidiLibraryMeta[]> {
    const db = await this.openDb();
    return new Promise<MidiLibraryMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as MidiLibraryEntry[]) ?? [];
        const metas = rows
          .map(({ id, hash, name, importedAt }) => ({
            id,
            hash,
            name,
            importedAt,
          }))
          .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
        resolve(metas);
      };
      req.onerror = () => reject(req.error ?? new Error('讀取 MIDI 清單失敗'));
    });
  }

  async get(id: string): Promise<MidiLibraryEntry | null> {
    const db = await this.openDb();
    return new Promise<MidiLibraryEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const row = req.result as
          | (Omit<MidiLibraryEntry, 'bytes'> & {
              bytes: Uint8Array | ArrayBuffer;
            })
          | undefined;
        if (!row) {
          resolve(null);
          return;
        }
        const bytes =
          row.bytes instanceof Uint8Array
            ? row.bytes
            : new Uint8Array(row.bytes);
        resolve({
          id: row.id,
          hash: row.hash,
          name: row.name,
          importedAt: row.importedAt,
          bytes,
        });
      };
      req.onerror = () => reject(req.error ?? new Error('讀取 MIDI 檔案失敗'));
    });
  }

  async put(entry: MidiLibraryEntry): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({
        id: entry.id,
        hash: entry.hash,
        name: entry.name,
        importedAt: entry.importedAt,
        bytes: new Uint8Array(entry.bytes),
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('儲存 MIDI 檔案失敗'));
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('刪除 MIDI 檔案失敗'));
    });
  }
}

/** 建立環境適合的 MIDI 曲庫實作（不支援 IndexedDB 時退回記憶體版） */
export function createMidiStore(): MidiStore {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbMidiStore();
  }
  return new MemoryMidiStore();
}

function getDefaultStorage(): StorageLike | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

function sanitizeKey(raw: unknown): Key | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.tonicPc !== 'number' ||
    !Number.isInteger(obj.tonicPc) ||
    obj.tonicPc < 0 ||
    obj.tonicPc > 11
  ) {
    return null;
  }
  const mode: KeyMode | null =
    obj.mode === 'major' || obj.mode === 'minor' ? obj.mode : null;
  if (!mode) {
    return null;
  }
  return { tonicPc: obj.tonicPc, mode };
}

function isValidTrackRole(val: unknown): val is MidiTrackRole {
  return (
    val === 'vocal' ||
    val === 'accompaniment' ||
    val === 'rhythm' ||
    val === 'mute'
  );
}

function sanitizeTrackRoles(
  raw: unknown,
  preferredVocalIndex: number,
): Record<number, MidiTrackRole> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const out: Record<number, MidiTrackRole> = {};
  let hasAny = false;
  const vocalKeys: number[] = [];

  for (const [k, v] of Object.entries(obj)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || !isValidTrackRole(v)) {
      continue;
    }
    out[idx] = v;
    hasAny = true;
    if (v === 'vocal') {
      vocalKeys.push(idx);
    }
  }

  if (!hasAny) {
    return undefined;
  }

  // 確保主唱最多只有一軌（優先保留與 trackIndex 相符者）
  if (vocalKeys.length > 1) {
    const keep = vocalKeys.includes(preferredVocalIndex)
      ? preferredVocalIndex
      : vocalKeys[0]!;
    for (const k of vocalKeys) {
      if (k !== keep) {
        out[k] = 'accompaniment';
      }
    }
  }

  return out;
}

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeMidiMixer(raw: unknown): MidiMixerSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  return {
    vocalEnabled:
      typeof obj.vocalEnabled === 'boolean'
        ? obj.vocalEnabled
        : DEFAULT_MIDI_MIXER.vocalEnabled,
    vocalVolume: clampVolume(obj.vocalVolume, DEFAULT_MIDI_MIXER.vocalVolume),
    accompEnabled:
      typeof obj.accompEnabled === 'boolean'
        ? obj.accompEnabled
        : DEFAULT_MIDI_MIXER.accompEnabled,
    accompVolume: clampVolume(obj.accompVolume, DEFAULT_MIDI_MIXER.accompVolume),
    rhythmEnabled:
      typeof obj.rhythmEnabled === 'boolean'
        ? obj.rhythmEnabled
        : DEFAULT_MIDI_MIXER.rhythmEnabled,
    rhythmVolume: clampVolume(obj.rhythmVolume, DEFAULT_MIDI_MIXER.rhythmVolume),
  };
}

/** 取得正規化後的混音器設定（舊資料無 mixer 欄位時回傳預設值） */
export function resolveMidiMixer(
  settings?: Pick<MidiSongSettings, 'mixer'> | null,
): MidiMixerSettings {
  if (!settings?.mixer) {
    return { ...DEFAULT_MIDI_MIXER };
  }
  return { ...settings.mixer };
}

export const MIDI_LYRICS_OFFSET_MIN = -10;
export const MIDI_LYRICS_OFFSET_MAX = 10;
export const MIDI_LYRICS_OFFSET_STEP = 0.05;

function sanitizeLyricsOffset(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const clamped = Math.max(
    MIDI_LYRICS_OFFSET_MIN,
    Math.min(MIDI_LYRICS_OFFSET_MAX, value),
  );
  const snapped = Math.round(clamped * 20) / 20;
  return snapped === 0 ? 0 : snapped;
}

/** 取得每首 MIDI 的字幕時間位移（舊資料無欄位時回傳 0） */
export function resolveMidiLyricsOffset(
  settings?: Pick<MidiSongSettings, 'lyricsOffsetSec'> | null,
): number {
  return settings?.lyricsOffsetSec ?? 0;
}

function sanitizeLoopBar(
  value: unknown,
  startBar: number,
  endBar: number,
): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    return undefined;
  }
  if (value < startBar || value > endBar) {
    return undefined;
  }
  return value;
}

/** 驗證並正規化單首 MIDI 設定 */
export function sanitizeMidiSongSettings(raw: unknown): MidiSongSettings | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.trackIndex !== 'number' ||
    !Number.isFinite(obj.trackIndex) ||
    typeof obj.startBar !== 'number' ||
    !Number.isFinite(obj.startBar) ||
    typeof obj.endBar !== 'number' ||
    !Number.isFinite(obj.endBar)
  ) {
    return null;
  }

  const startBar = Math.max(1, Math.round(obj.startBar));
  const endBar = Math.max(startBar, Math.round(obj.endBar));
  const transposeRaw =
    typeof obj.transposeSemitones === 'number' &&
    Number.isFinite(obj.transposeSemitones)
      ? Math.round(obj.transposeSemitones)
      : 0;
  const speedRaw =
    typeof obj.speedPercent === 'number' && Number.isFinite(obj.speedPercent)
      ? Math.round(obj.speedPercent / 5) * 5
      : 100;
  const trackIndex = Math.max(0, Math.round(obj.trackIndex));
  const trackRoles = sanitizeTrackRoles(obj.trackRoles, trackIndex);
  const mixer = sanitizeMidiMixer(obj.mixer);
  const lyricsOffsetSec = sanitizeLyricsOffset(obj.lyricsOffsetSec);
  const regionUserSet =
    typeof obj.regionUserSet === 'boolean' ? obj.regionUserSet : undefined;

  let loopStartBar = sanitizeLoopBar(obj.loopStartBar, startBar, endBar);
  let loopEndBar = sanitizeLoopBar(obj.loopEndBar, startBar, endBar);
  if (
    loopStartBar !== undefined &&
    loopEndBar !== undefined &&
    loopEndBar < loopStartBar
  ) {
    [loopStartBar, loopEndBar] = [loopEndBar, loopStartBar];
  }

  return {
    trackIndex,
    startBar,
    endBar,
    transposeSemitones: Math.max(-12, Math.min(12, transposeRaw)),
    speedPercent: Math.max(50, Math.min(150, speedRaw)),
    manualKey: sanitizeKey(obj.manualKey),
    ...(trackRoles ? { trackRoles } : {}),
    ...(mixer ? { mixer } : {}),
    ...(lyricsOffsetSec !== undefined ? { lyricsOffsetSec } : {}),
    ...(regionUserSet !== undefined ? { regionUserSet } : {}),
    ...(loopStartBar !== undefined ? { loopStartBar } : {}),
    ...(loopEndBar !== undefined ? { loopEndBar } : {}),
  };
}

/**
 * 舊設定遷移：若尚未標記使用者自訂區間（regionUserSet !== true），
 * 且 startBar 剛好等於舊版自動略過前奏算出的小節（> 1），則一次性重設回第 1 小節。
 */
export function migrateMidiSongRange(
  settings: MidiSongSettings,
  legacyAutoStartBar: number | null,
): { settings: MidiSongSettings; changed: boolean } {
  if (settings.regionUserSet) {
    return { settings, changed: false };
  }
  if (
    legacyAutoStartBar !== null &&
    legacyAutoStartBar > 1 &&
    settings.startBar === legacyAutoStartBar
  ) {
    return {
      settings: {
        ...settings,
        startBar: 1,
      },
      changed: true,
    };
  }
  return { settings, changed: false };
}

function readAllSongSettings(
  storage: StorageLike | undefined,
): Record<string, unknown> {
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(MIDI_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** 讀取指定 MIDI 檔案雜湊對應的練習設定 */
export function loadMidiSongSettings(
  hash: string,
  storage: StorageLike | undefined = getDefaultStorage(),
): MidiSongSettings | null {
  if (!hash) return null;
  const all = readAllSongSettings(storage);
  return sanitizeMidiSongSettings(all[hash]);
}

/** 儲存指定 MIDI 檔案雜湊對應的練習設定 */
export function saveMidiSongSettings(
  hash: string,
  settings: MidiSongSettings,
  storage: StorageLike | undefined = getDefaultStorage(),
): void {
  if (!storage || !hash) return;
  const sanitized = sanitizeMidiSongSettings(settings);
  if (!sanitized) return;
  try {
    const all = readAllSongSettings(storage);
    all[hash] = sanitized;
    storage.setItem(MIDI_SETTINGS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 忽略私密瀏覽或容量限制錯誤
  }
}
