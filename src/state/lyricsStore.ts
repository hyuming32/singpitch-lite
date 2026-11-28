import type { LyricDocument } from '../core/lyrics';
import { LYRICS_STORE_NAME, openSingpitchDb } from './db';

export interface ImportedLyricsEntry {
  /** 對應的 MIDI 曲庫 id（即檔案雜湊） */
  id: string;
  fileName: string;
  importedAt: string;
  document: LyricDocument;
}

export interface LyricsStore {
  readonly persistent: boolean;
  get(id: string): Promise<ImportedLyricsEntry | null>;
  put(entry: ImportedLyricsEntry): Promise<void>;
  delete(id: string): Promise<void>;
}

function cloneEntry(entry: ImportedLyricsEntry): ImportedLyricsEntry {
  return {
    id: entry.id,
    fileName: entry.fileName,
    importedAt: entry.importedAt,
    document: {
      ...entry.document,
      lines: entry.document.lines.map((line) => ({
        ...line,
        tokens: line.tokens.map((tok) => ({ ...tok })),
      })),
    },
  };
}

/** 記憶體版匯入歌詞儲存（供測試與無 IndexedDB 環境使用） */
export class MemoryLyricsStore implements LyricsStore {
  readonly persistent = false;
  private readonly items = new Map<string, ImportedLyricsEntry>();

  async get(id: string): Promise<ImportedLyricsEntry | null> {
    const found = this.items.get(id);
    return found ? cloneEntry(found) : null;
  }

  async put(entry: ImportedLyricsEntry): Promise<void> {
    this.items.set(entry.id, cloneEntry(entry));
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

/** IndexedDB 版匯入歌詞儲存 */
export class IndexedDbLyricsStore implements LyricsStore {
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

  async get(id: string): Promise<ImportedLyricsEntry | null> {
    const db = await this.openDb();
    return new Promise<ImportedLyricsEntry | null>((resolve, reject) => {
      const tx = db.transaction(LYRICS_STORE_NAME, 'readonly');
      const store = tx.objectStore(LYRICS_STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const row = req.result as ImportedLyricsEntry | undefined;
        resolve(row ? cloneEntry(row) : null);
      };
      req.onerror = () => reject(req.error ?? new Error('讀取匯入歌詞失敗'));
    });
  }

  async put(entry: ImportedLyricsEntry): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LYRICS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LYRICS_STORE_NAME);
      const req = store.put(cloneEntry(entry));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('儲存匯入歌詞失敗'));
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LYRICS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LYRICS_STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('刪除匯入歌詞失敗'));
    });
  }
}

/** 建立環境適合的歌詞儲存實作（不支援 IndexedDB 時退回記憶體版） */
export function createLyricsStore(): LyricsStore {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbLyricsStore();
  }
  return new MemoryLyricsStore();
}
