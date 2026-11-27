export const PIANO_COLLAPSE_THRESHOLD = 40;
export const PIANO_CLICK_DISTANCE = 6;

/** 依裝置類型取得預設鋼琴高度（px） */
export function defaultPianoHeight(isTablet: boolean): number {
  return isTablet ? 250 : 130;
}

/** 手機直放模式預設鋼琴高度（px） */
export const PORTRAIT_DEFAULT_PIANO_HEIGHT = 116;

/** 手機直放模式單行樂譜最小高度（px） */
export const PORTRAIT_MIN_LINE_HEIGHT = 88;

/** 依裝置類型取得收合後的迷你鍵盤高度（px） */
export function miniPianoHeight(isTablet: boolean): number {
  return isTablet ? 24 : 18;
}

/** 依裝置類型取得把手列高度（px） */
export function handleBarHeight(isTablet: boolean): number {
  return isTablet ? 12 : 10;
}

/** 依裝置類型取得單行樂譜最小高度（px） */
export function minScoreLineHeight(isTablet: boolean): number {
  return isTablet ? 150 : 110;
}

/** 將鋼琴高度夾在 [minHeight, maxHeight] 內 */
export function clampPianoHeight(
  height: number,
  maxHeight: number,
  minHeight = PIANO_COLLAPSE_THRESHOLD,
): number {
  const safeMax = Math.max(minHeight, Math.round(maxHeight));
  const safeMin = Math.min(minHeight, safeMax);
  if (!Number.isFinite(height)) {
    return safeMin;
  }
  return Math.max(safeMin, Math.min(safeMax, Math.round(height)));
}

export interface DrawerDragParams {
  /** 拖曳開始前的展開高度 */
  savedHeight: number;
  /** 拖曳開始時是否為收合狀態 */
  collapsed: boolean;
  /** 指標垂直位移（向下為正、向上為負） */
  deltaY: number;
  /** 收合時的迷你高度（作為收合狀態往上拖的起點） */
  miniHeight: number;
  maxHeight: number;
  minHeight?: number;
}

export interface DrawerDragPreview {
  /** 預覽顯示高度（展開時） */
  height: number;
  /** 若此時放開是否會進入收合狀態 */
  wouldCollapse: boolean;
}

/** 計算拖曳進行中的預覽高度與是否低於收合門檻 */
export function previewDrawerDrag({
  savedHeight,
  collapsed,
  deltaY,
  miniHeight,
  maxHeight,
  minHeight = PIANO_COLLAPSE_THRESHOLD,
}: DrawerDragParams): DrawerDragPreview {
  const startH = collapsed ? miniHeight : savedHeight;
  const rawHeight = startH - deltaY;
  return {
    height: clampPianoHeight(rawHeight, maxHeight, minHeight),
    wouldCollapse: rawHeight < minHeight,
  };
}

export interface DrawerPointerEndParams extends DrawerDragParams {
  /** 指標總移動距離（用於判斷點擊或拖曳） */
  distance: number;
  defaultHeight: number;
}

export interface DrawerStateResult {
  collapsed: boolean;
  height: number;
}

/** 決定放開把手後的最終收合狀態與高度 */
export function resolveDrawerPointerEnd({
  savedHeight,
  collapsed,
  deltaY,
  distance,
  miniHeight,
  defaultHeight,
  maxHeight,
  minHeight = PIANO_COLLAPSE_THRESHOLD,
}: DrawerPointerEndParams): DrawerStateResult {
  const fallbackExpanded = clampPianoHeight(
    savedHeight >= minHeight ? savedHeight : defaultHeight,
    maxHeight,
    minHeight,
  );

  // 點一下（移動 < 6 px）在收合／展開間切換
  if (distance < PIANO_CLICK_DISTANCE) {
    return {
      collapsed: !collapsed,
      height: fallbackExpanded,
    };
  }

  const startH = collapsed ? miniHeight : savedHeight;
  const rawHeight = startH - deltaY;
  if (rawHeight < minHeight) {
    return {
      collapsed: true,
      height: fallbackExpanded,
    };
  }

  return {
    collapsed: false,
    height: clampPianoHeight(rawHeight, maxHeight, minHeight),
  };
}
