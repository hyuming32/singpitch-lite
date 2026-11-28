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

export interface MidiSongSettings {
  trackIndex: number;
  startBar: number;
  endBar: number;
  transposeSemitones: number;
  speedPercent: number;
  manualKey: Key | null;
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

  return {
    trackIndex: Math.max(0, Math.round(obj.trackIndex)),
    startBar,
    endBar,
    transposeSemitones: Math.max(-12, Math.min(12, transposeRaw)),
    speedPercent: Math.max(50, Math.min(150, speedRaw)),
    manualKey: sanitizeKey(obj.manualKey),
  };
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
