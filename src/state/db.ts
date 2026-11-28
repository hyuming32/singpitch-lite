export const SINGPITCH_DB_NAME = 'singpitch-lite';
export const SINGPITCH_DB_VERSION = 2;
export const MIDI_STORE_NAME = 'midi';
export const PRACTICE_LOG_STORE_NAME = 'practiceLog';

/** 開啟共用的 IndexedDB 資料庫並確保所有 object store 皆已建立 */
export function openSingpitchDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(SINGPITCH_DB_NAME, SINGPITCH_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MIDI_STORE_NAME)) {
        db.createObjectStore(MIDI_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PRACTICE_LOG_STORE_NAME)) {
        db.createObjectStore(PRACTICE_LOG_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      reject(req.error ?? new Error('無法開啟 IndexedDB'));
    };
  });
}
