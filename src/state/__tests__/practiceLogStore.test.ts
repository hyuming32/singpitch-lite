import { describe, expect, it } from 'vitest';
import type { PracticeLogEntry } from '../../core/practiceLog';
import { MemoryPracticeLogStore } from '../practiceLogStore';

function makeEntry(id: string, startedAtMs: number): PracticeLogEntry {
  return {
    id,
    startedAtMs,
    durationSec: 120,
    source: {
      kind: 'scale',
      patternId: 'five-up-down',
      patternName: '五音上下行',
    },
    mode: 'follow',
    bpm: 96,
    rangeName: '女中音',
    voice: 'normal',
    keys: ['C4', 'D♭4'],
    lowestKey: 'C4',
    highestKey: 'D♭4',
    completedPasses: 2,
    usedMic: false,
  };
}

describe('MemoryPracticeLogStore（記憶體版練習紀錄儲存）', () => {
  it('支援新增、列出（由新到舊）、覆寫更新、單筆刪除與全部清除', async () => {
    const store = new MemoryPracticeLogStore();
    expect(store.persistent).toBe(false);
    expect(await store.list()).toEqual([]);

    const e1 = makeEntry('a', 1000);
    const e2 = makeEntry('b', 2000);
    await store.put(e1);
    await store.put(e2);

    const list1 = await store.list();
    expect(list1.map((e) => e.id)).toEqual(['b', 'a']);

    // 同一 id 覆寫（續播合併）
    await store.put({ ...e1, durationSec: 240 });
    const updated = (await store.list()).find((e) => e.id === 'a');
    expect(updated?.durationSec).toBe(240);

    // 單筆刪除
    await store.delete('a');
    expect((await store.list()).map((e) => e.id)).toEqual(['b']);

    // 全部清除
    await store.clear();
    expect(await store.list()).toEqual([]);
  });
});
