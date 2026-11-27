import { describe, expect, it } from 'vitest';
import {
  KEY_SELECTION_STORAGE_KEY,
  createKeySelection,
  deserializeKeySelectionMap,
  fullIndexToTonicListIndex,
  getKeySelectionOrder,
  getKeySelectionOrderMap,
  loadKeySelection,
  makeKeySelectionScopeKey,
  makeSequenceSignature,
  reorderKeySelection,
  resolveKeyIndexAfterSelectionChange,
  saveKeySelection,
  serializeKeySelectionMap,
  setOnlySelected,
  syncKeySelectionSequence,
  toggleKeySelection,
  tonicListIndexToFullIndex,
} from '../keySelection';
import type { StorageLike } from '../settings';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('keySelection 調選取狀態純函式', () => {
  it('toggle 選取新調排在最後，取消時其餘編號往前補', () => {
    let state = createKeySelection('60,61,62,63,64');
    state = toggleKeySelection(state, 3, 5);
    state = toggleKeySelection(state, 1, 5);
    state = toggleKeySelection(state, 4, 5);

    expect(state.selectedIndices).toEqual([3, 1, 4]);
    expect(getKeySelectionOrder(state, 3)).toBe(1);
    expect(getKeySelectionOrder(state, 1)).toBe(2);
    expect(getKeySelectionOrder(state, 4)).toBe(3);
    expect(getKeySelectionOrder(state, 0)).toBeNull();

    // 取消第 2 個（keyIndex 1），原本 #3 的 keyIndex 4 往前補成 #2
    state = toggleKeySelection(state, 1, 5);
    expect(state.selectedIndices).toEqual([3, 4]);
    const orderMap = getKeySelectionOrderMap(state);
    expect(orderMap.get(3)).toBe(1);
    expect(orderMap.get(4)).toBe(2);
    expect(orderMap.has(1)).toBe(false);

    // 取消最後一顆時自動關閉 onlySelected
    state = setOnlySelected(state, true);
    expect(state.onlySelected).toBe(true);
    state = toggleKeySelection(state, 3, 5);
    state = toggleKeySelection(state, 4, 5);
    expect(state.selectedIndices).toEqual([]);
    expect(state.onlySelected).toBe(false);
  });

  it('reorder(from, to) 正確改變練習順序並重新編號', () => {
    let state = createKeySelection('60,61,62,63,64');
    state = toggleKeySelection(state, 0, 5);
    state = toggleKeySelection(state, 2, 5);
    state = toggleKeySelection(state, 4, 5);
    // [0, 2, 4] -> 把索引 2 (keyIndex 4) 移到索引 0
    state = reorderKeySelection(state, 2, 0);
    expect(state.selectedIndices).toEqual([4, 0, 2]);
    expect(getKeySelectionOrder(state, 4)).toBe(1);
    expect(getKeySelectionOrder(state, 0)).toBe(2);
    expect(getKeySelectionOrder(state, 2)).toBe(3);

    // 越界不變動
    expect(reorderKeySelection(state, -1, 1)).toEqual(state);
    expect(reorderKeySelection(state, 0, 9)).toEqual(state);
  });

  it('序列變動時清空選取與只練選的開關', () => {
    let state = createKeySelection('60,61,62');
    state = toggleKeySelection(state, 0, 3);
    state = toggleKeySelection(state, 2, 3);
    state = setOnlySelected(state, true);

    // 相同簽章保留
    expect(syncKeySelectionSequence(state, '60,61,62', 3)).toEqual(state);

    // 簽章變動立即清空
    const cleared = syncKeySelectionSequence(state, '60,61,62,63', 4);
    expect(cleared).toEqual({
      selectedIndices: [],
      onlySelected: false,
      signature: '60,61,62,63',
    });
  });

  it('序列化、反序列化與依音型儲存讀取一致', () => {
    const storage = createMemoryStorage();
    const scopeA = makeKeySelectionScopeKey({
      patternId: 'major-arpeggio',
      rangeName: '男高音',
      startTonic: 60,
      transpose: 'up-down',
    });
    const scopeB = makeKeySelectionScopeKey({
      patternId: 'five-tone-scale',
      rangeName: '男高音',
      startTonic: 60,
      transpose: 'up-down',
    });
    const sig = makeSequenceSignature([60, 61, 62, 61, 60]);

    let stateA = createKeySelection(sig);
    stateA = toggleKeySelection(stateA, 2, 5);
    stateA = toggleKeySelection(stateA, 0, 5);
    stateA = setOnlySelected(stateA, true);
    saveKeySelection(scopeA, stateA, storage);

    expect(loadKeySelection(scopeA, sig, 5, storage)).toEqual(stateA);
    expect(loadKeySelection(scopeB, sig, 5, storage)).toEqual(
      createKeySelection(sig),
    );

    // 序列化與壞資料防呆
    const raw = serializeKeySelectionMap({ [scopeA]: stateA });
    expect(deserializeKeySelectionMap(raw)[scopeA]).toEqual(stateA);
    expect(deserializeKeySelectionMap('{bad json')).toEqual({});
    expect(deserializeKeySelectionMap('[]')).toEqual({});

    const badStorage = createMemoryStorage({
      [KEY_SELECTION_STORAGE_KEY]: 'not-json',
    });
    expect(loadKeySelection(scopeA, sig, 5, badStorage)).toEqual(
      createKeySelection(sig),
    );
  });

  it('完整序列索引與 tonicList 位置雙向對應及選取變動接續位置', () => {
    let state = createKeySelection('60,61,62,63,64');
    state = toggleKeySelection(state, 4, 5); // #1 -> full 4
    state = toggleKeySelection(state, 1, 5); // #2 -> full 1
    state = toggleKeySelection(state, 3, 5); // #3 -> full 3

    // 未開啟只練選的：恆等對應
    expect(fullIndexToTonicListIndex(state, 2)).toBe(2);
    expect(tonicListIndexToFullIndex(state, 2)).toBe(2);

    // 開啟只練選的：雙向映射
    state = setOnlySelected(state, true);
    expect(fullIndexToTonicListIndex(state, 4)).toBe(0);
    expect(fullIndexToTonicListIndex(state, 1)).toBe(1);
    expect(fullIndexToTonicListIndex(state, 3)).toBe(2);
    expect(fullIndexToTonicListIndex(state, 0)).toBeNull();

    expect(tonicListIndexToFullIndex(state, 0)).toBe(4);
    expect(tonicListIndexToFullIndex(state, 1)).toBe(1);
    expect(tonicListIndexToFullIndex(state, 2)).toBe(3);
    expect(tonicListIndexToFullIndex(state, 5)).toBeNull();

    // 選取重排時，若目前正在唱 full 1（pos 1），重排後仍停留在 full 1（pos 0）
    expect(
      resolveKeyIndexAfterSelectionChange([4, 1, 3], [1, 3, 4], 1),
    ).toBe(0);

    // 若目前正在唱的 full 1 被取消，跳到原清單下一個 full 3（在新清單 pos 1）
    expect(
      resolveKeyIndexAfterSelectionChange([4, 1, 3], [4, 3], 1),
    ).toBe(1);

    // 若最後一個 full 3 被取消，落在剩餘清單最後一個
    expect(
      resolveKeyIndexAfterSelectionChange([4, 1, 3], [4, 1], 2),
    ).toBe(1);
  });
});
