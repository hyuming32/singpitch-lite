import type { StorageLike, TransposeOption } from './settings';

export const KEY_SELECTION_STORAGE_KEY = 'singpitch-lite.keysel.v1';

export interface KeySelectionState {
  /** 已選取的調索引清單（依練習順序排列，索引對應完整序列的 keyIndex） */
  selectedIndices: number[];
  /** 是否開啟「只練選的」 */
  onlySelected: boolean;
  /** 對應完整序列的簽章；若設定變動導致序列不同則清空選取 */
  signature: string;
}

export type KeySelectionMap = Record<string, KeySelectionState>;

export interface KeySelectionScope {
  patternId: string;
  rangeName: string;
  startTonic: number;
  transpose: TransposeOption;
}

/** 產生每組音型與設定組合的儲存鍵 */
export function makeKeySelectionScopeKey(scope: KeySelectionScope): string {
  return `${scope.patternId}|${scope.rangeName}|${scope.startTonic}|${scope.transpose}`;
}

/** 產生調性序列簽章字串 */
export function makeSequenceSignature(tonics: readonly number[]): string {
  return tonics.join(',');
}

/** 建立空白調選取狀態 */
export function createKeySelection(signature = ''): KeySelectionState {
  return {
    selectedIndices: [],
    onlySelected: false,
    signature,
  };
}

/** 切換單一調的選取狀態：未選則加入最後，已選則移除且其餘編號自動前補 */
export function toggleKeySelection(
  state: KeySelectionState,
  keyIndex: number,
  keyCount?: number,
): KeySelectionState {
  if (!Number.isInteger(keyIndex) || keyIndex < 0) {
    return state;
  }
  if (keyCount !== undefined && keyIndex >= keyCount) {
    return state;
  }

  const pos = state.selectedIndices.indexOf(keyIndex);
  if (pos === -1) {
    return {
      ...state,
      selectedIndices: [...state.selectedIndices, keyIndex],
    };
  }

  const nextSelected = state.selectedIndices.filter((_, idx) => idx !== pos);
  return {
    ...state,
    selectedIndices: nextSelected,
    onlySelected: nextSelected.length > 0 ? state.onlySelected : false,
  };
}

/** 重新排列已選取調的順序：將選取陣列中 from 位置移到 to 位置並重新編號 */
export function reorderKeySelection(
  state: KeySelectionState,
  from: number,
  to: number,
): KeySelectionState {
  const len = state.selectedIndices.length;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= len ||
    to < 0 ||
    to >= len ||
    from === to
  ) {
    return state;
  }

  const next = [...state.selectedIndices];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return {
    ...state,
    selectedIndices: next,
  };
}

/** 取得每個已選調索引對應的練習順序編號（1 起算） */
export function getKeySelectionOrderMap(
  state: KeySelectionState,
): Map<number, number> {
  const map = new Map<number, number>();
  state.selectedIndices.forEach((keyIndex, idx) => {
    map.set(keyIndex, idx + 1);
  });
  return map;
}

/** 取得單一調索引的練習順序編號（1 起算）；未選取時回傳 null */
export function getKeySelectionOrder(
  state: KeySelectionState,
  keyIndex: number,
): number | null {
  const idx = state.selectedIndices.indexOf(keyIndex);
  return idx === -1 ? null : idx + 1;
}

/** 完整序列索引 → 目前練習 tonicList 位置（未開啟只練選的時為恆等對應；未在清單中回傳 null） */
export function fullIndexToTonicListIndex(
  state: KeySelectionState,
  fullKeyIndex: number,
): number | null {
  if (!Number.isInteger(fullKeyIndex) || fullKeyIndex < 0) {
    return null;
  }
  if (!state.onlySelected) {
    return fullKeyIndex;
  }
  const pos = state.selectedIndices.indexOf(fullKeyIndex);
  return pos === -1 ? null : pos;
}

/** 目前練習 tonicList 位置 → 完整序列索引（未開啟只練選的時為恆等對應；越界回傳 null） */
export function tonicListIndexToFullIndex(
  state: KeySelectionState,
  tonicListIndex: number,
): number | null {
  if (!Number.isInteger(tonicListIndex) || tonicListIndex < 0) {
    return null;
  }
  if (!state.onlySelected) {
    return tonicListIndex;
  }
  const fullIdx = state.selectedIndices[tonicListIndex];
  return fullIdx === undefined ? null : fullIdx;
}

/**
 * 「只練選的」開啟中增減或重新排序選取後，決定下一個要接續播放的 tonicList 位置：
 * - 若原本正在唱的調仍在清單中，回傳它在新清單中的位置
 * - 若原本正在唱的調被取消，順移到原清單後方的下一個仍在清單中的調；若已到尾端則落在最後一個
 */
export function resolveKeyIndexAfterSelectionChange(
  prevSelected: readonly number[],
  nextSelected: readonly number[],
  prevTonicListIndex: number,
): number {
  if (nextSelected.length === 0) {
    return 0;
  }
  const prevFullIdx = prevSelected[prevTonicListIndex];
  if (prevFullIdx !== undefined) {
    const keptPos = nextSelected.indexOf(prevFullIdx);
    if (keptPos !== -1) {
      return keptPos;
    }
  }
  for (let i = prevTonicListIndex + 1; i < prevSelected.length; i++) {
    const candidate = prevSelected[i]!;
    const nextPos = nextSelected.indexOf(candidate);
    if (nextPos !== -1) {
      return nextPos;
    }
  }
  return Math.max(0, Math.min(prevTonicListIndex, nextSelected.length - 1));
}

/** 設定「只練選的」開關（若無任何選取則強制為 false） */
export function setOnlySelected(
  state: KeySelectionState,
  onlySelected: boolean,
): KeySelectionState {
  const nextOnly = state.selectedIndices.length > 0 ? onlySelected : false;
  if (nextOnly === state.onlySelected) {
    return state;
  }
  return {
    ...state,
    onlySelected: nextOnly,
  };
}

/** 當完整序列變動時自動清空選取，並濾除不合法或重複索引 */
export function syncKeySelectionSequence(
  state: KeySelectionState,
  nextSignature: string,
  keyCount: number,
): KeySelectionState {
  if (state.signature !== nextSignature) {
    return createKeySelection(nextSignature);
  }

  const seen = new Set<number>();
  const valid: number[] = [];
  for (const idx of state.selectedIndices) {
    if (Number.isInteger(idx) && idx >= 0 && idx < keyCount && !seen.has(idx)) {
      seen.add(idx);
      valid.push(idx);
    }
  }

  const nextOnly = valid.length > 0 ? state.onlySelected : false;
  if (
    valid.length === state.selectedIndices.length &&
    nextOnly === state.onlySelected
  ) {
    return state;
  }

  return {
    selectedIndices: valid,
    onlySelected: nextOnly,
    signature: nextSignature,
  };
}

function sanitizeSelectionEntry(raw: unknown): KeySelectionState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const signature = typeof obj.signature === 'string' ? obj.signature : '';
  const rawList = Array.isArray(obj.selectedIndices) ? obj.selectedIndices : [];
  const seen = new Set<number>();
  const selectedIndices: number[] = [];
  for (const item of rawList) {
    if (
      typeof item === 'number' &&
      Number.isInteger(item) &&
      item >= 0 &&
      !seen.has(item)
    ) {
      seen.add(item);
      selectedIndices.push(item);
    }
  }
  const onlySelected =
    selectedIndices.length > 0 && obj.onlySelected === true;

  return {
    selectedIndices,
    onlySelected,
    signature,
  };
}

/** 將調選取紀錄表序列化為 JSON 字串 */
export function serializeKeySelectionMap(map: KeySelectionMap): string {
  return JSON.stringify(map);
}

/** 從 JSON 字串反序列化調選取紀錄表，壞資料時安全回傳空物件 */
export function deserializeKeySelectionMap(
  raw: string | null | undefined,
): KeySelectionMap {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: KeySelectionMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = sanitizeSelectionEntry(v);
      if (entry) {
        result[k] = entry;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function getDefaultStorage(): StorageLike | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/** 從 localStorage 讀取指定音型與設定的調選取狀態 */
export function loadKeySelection(
  scopeKey: string,
  signature: string,
  keyCount: number,
  storage: StorageLike | undefined = getDefaultStorage(),
): KeySelectionState {
  if (!storage) {
    return createKeySelection(signature);
  }
  try {
    const map = deserializeKeySelectionMap(
      storage.getItem(KEY_SELECTION_STORAGE_KEY),
    );
    const entry = map[scopeKey];
    if (!entry) {
      return createKeySelection(signature);
    }
    return syncKeySelectionSequence(entry, signature, keyCount);
  } catch {
    return createKeySelection(signature);
  }
}

/** 將指定音型與設定的調選取狀態儲存至 localStorage */
export function saveKeySelection(
  scopeKey: string,
  state: KeySelectionState,
  storage: StorageLike | undefined = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }
  try {
    const map = deserializeKeySelectionMap(
      storage.getItem(KEY_SELECTION_STORAGE_KEY),
    );
    map[scopeKey] = state;
    storage.setItem(KEY_SELECTION_STORAGE_KEY, serializeKeySelectionMap(map));
  } catch {
    // 忽略私密瀏覽或容量限制錯誤
  }
}
