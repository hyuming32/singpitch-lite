import type { PracticeLogEntry } from '../core/practiceLog';
import { openSingpitchDb, PRACTICE_LOG_STORE_NAME } from './db';

export interface PracticeLogStore {
  readonly persistent: boolean;
  list(): Promise<PracticeLogEntry[]>;
  put(entry: PracticeLogEntry): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

function cloneEntry(entry: PracticeLogEntry): PracticeLogEntry {
  return {
    ...entry,
    source: { ...entry.source },
    keys: [...entry.keys],
  };
}

/** 記憶體版練習紀錄儲存（供測試與無 IndexedDB 環境使用） */
export class MemoryPracticeLogStore implements PracticeLogStore {
  readonly persistent = false;
  private readonly items = new Map<string, PracticeLogEntry>();

  async list(): Promise<PracticeLogEntry[]> {
    return [...this.items.values()]
      .map(cloneEntry)
      .sort((a, b) => b.startedAtMs - a.startedAtMs);
  }

  async put(entry: PracticeLogEntry): Promise<void> {
    this.items.set(entry.id, cloneEntry(entry));
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }

  async clear(): Promise<void> {
    this.items.clear();
  }
}

/** IndexedDB 版練習紀錄儲存 */
export class IndexedDbPracticeLogStore implements PracticeLogStore {
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

  async list(): Promise<PracticeLogEntry[]> {
    const db = await this.openDb();
    return new Promise<PracticeLogEntry[]>((resolve, reject) => {
      const tx = db.transaction(PRACTICE_LOG_STORE_NAME, 'readonly');
      const store = tx.objectStore(PRACTICE_LOG_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as PracticeLogEntry[]) ?? [];
        resolve(
          rows
            .map(cloneEntry)
            .sort((a, b) => b.startedAtMs - a.startedAtMs),
        );
      };
      req.onerror = () =>
        reject(req.error ?? new Error('讀取練習紀錄失敗'));
    });
  }

  async put(entry: PracticeLogEntry): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PRACTICE_LOG_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PRACTICE_LOG_STORE_NAME);
      const req = store.put(cloneEntry(entry));
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('儲存練習紀錄失敗'));
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PRACTICE_LOG_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PRACTICE_LOG_STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('刪除練習紀錄失敗'));
    });
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PRACTICE_LOG_STORE_NAME, 'readwrite');
      const store = tx.objectStore(PRACTICE_LOG_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error('清除練習紀錄失敗'));
    });
  }
}

/** 建立環境適合的練習紀錄儲存實作（不支援 IndexedDB 時退回記憶體版） */
export function createPracticeLogStore(): PracticeLogStore {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbPracticeLogStore();
  }
  return new MemoryPracticeLogStore();
}
