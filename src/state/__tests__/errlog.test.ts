import { describe, expect, it } from 'vitest';
import {
  ERRLOG_STORAGE_KEY,
  MAX_ERRLOG_ENTRIES,
  MAX_STACK_CHARS,
  appendErrorLog,
  clearErrorLogs,
  loadErrorLogs,
  type ErrorLogStorageLike,
} from '../errlog';

function createMemoryStorage(
  initial: Record<string, string> = {},
): ErrorLogStorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(k) {
      return map.get(k) ?? null;
    },
    setItem(k, v) {
      map.set(k, v);
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

describe('errlog（全域錯誤紀錄環形保存）', () => {
  it('寫入並保留最多 20 筆環形緩衝紀錄', () => {
    const storage = createMemoryStorage();
    for (let i = 1; i <= 25; i++) {
      appendErrorLog(
        {
          source: 'onerror',
          message: `err-${i}`,
          stack: `stack-${i}`,
          time: `2026-11-27T00:00:${String(i).padStart(2, '0')}Z`,
          userAgent: 'TestUA',
          standalone: true,
        },
        storage,
      );
    }

    const logs = loadErrorLogs(storage);
    expect(logs).toHaveLength(MAX_ERRLOG_ENTRIES);
    expect(logs[0]!.message).toBe('err-6');
    expect(logs[logs.length - 1]!.message).toBe('err-25');
    expect(logs[logs.length - 1]!.standalone).toBe(true);
    expect(logs[logs.length - 1]!.userAgent).toBe('TestUA');
  });

  it('stack 長度超過 500 字會被截斷，且支援清除與壞 JSON 恢復', () => {
    const storage = createMemoryStorage({
      [ERRLOG_STORAGE_KEY]: '{broken-json',
    });
    expect(loadErrorLogs(storage)).toEqual([]);

    const longStack = 'x'.repeat(800);
    appendErrorLog(
      {
        source: 'ErrorBoundary',
        message: 'boom',
        stack: longStack,
        userAgent: 'iPhone',
        standalone: false,
      },
      storage,
    );

    const logs = loadErrorLogs(storage);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.stack).toHaveLength(MAX_STACK_CHARS);

    clearErrorLogs(storage);
    expect(loadErrorLogs(storage)).toEqual([]);
  });
});
