import {
  PIANO_COLLAPSE_THRESHOLD,
  PORTRAIT_DEFAULT_PIANO_HEIGHT,
  PORTRAIT_MIN_LINE_HEIGHT,
  clampPianoHeight,
  defaultPianoHeight,
  handleBarHeight,
  miniPianoHeight,
  minScoreLineHeight,
} from './pianoDrawer';

export type PracticeDevice = 'phone' | 'tablet';
export type PianoCollapsedPref = 'auto' | 'collapsed' | 'expanded';

export interface ViewportLayoutInput {
  /** 可用視窗高度（px，來自 window.visualViewport.height） */
  height: number;
  /** 可用視窗寬度（px，來自 window.visualViewport.width） */
  width: number;
  /** 裝置類型 */
  device: PracticeDevice;
  /** 鋼琴收合偏好：auto 依空間自動判斷、collapsed 強制收合、expanded 手動展開 */
  collapsedPref: PianoCollapsedPref;
  /** 使用者偏好／拖曳儲存的鋼琴高度（px） */
  preferredPianoHeight?: number | null;
  /** 覆寫的拖曳中鋼琴高度（px），僅供即時預覽用 */
  overridePianoHeight?: number | null;
  /** 實測或安全區垂直內距總和（padTop + padBottom） */
  safePaddingY?: number;
  /** 實測或安全區水平內距總和（padLeft + padRight） */
  safePaddingX?: number;
  /** 額外頂／底工具列高度（例如 MIDI 進度拉桿），預設 0 */
  extraChromeHeight?: number;
  /** 譜面內卡拉 OK 歌詞帶高度（px），預設 0 */
  lyricsBandHeight?: number;
}

export interface ViewportLayoutResult {
  device: PracticeDevice;
  viewportHeight: number;
  viewportWidth: number;
  headerHeight: number;
  transportHeight: number;
  workspaceHeight: number;
  sheetPaperHeight: number;
  centsHeight: number;
  scoreAreaHeight: number;
  lineHeight: number;
  jianpuHeight: number;
  staffHeight: number;
  /** 依該行五線譜可用高度反推的線距 sp（px） */
  sp: number;
  /** 半格距 stepY = sp / 2（px） */
  stepY: number;
  lineCount: 1 | 2;
  handleHeight: number;
  pianoHeight: number;
  whiteKeyWidth: number;
  autoCollapseThreshold: number;
  maxPianoHeight: number;
  collapsed: boolean;
  autoCollapsed: boolean;
}

/** 依五線譜可用高度反推線距 sp，確保五線、上下加線各 2 條、符頭、符桿與和弦空間不裁切 */
export function computeSpFromStaffHeight(
  staffHeight: number,
  isTablet: boolean,
): { sp: number; stepY: number } {
  const chordLane = isTablet ? 24 : 16;
  const bottomMargin = isTablet ? 10 : 6;
  const usable = Math.max(18, staffHeight - chordLane - bottomMargin);
  // pos = -5（下加二線音符下緣）到 pos = +13（上加二線音符上緣）共 18 個半格
  const spanSteps = 18;
  const maxStep = isTablet ? 9 : 7;
  const stepY = Math.min(maxStep, usable / spanSteps);
  return { sp: stepY * 2, stepY };
}

/** 純函式計算練唱頁面各區塊高度、樂譜行數、自動收合狀態與五線譜線距 sp */
export function computeViewportLayout(
  input: ViewportLayoutInput,
): ViewportLayoutResult {
  const isTablet = input.device === 'tablet';
  const viewportHeight =
    Number.isFinite(input.height) && input.height > 0
      ? Math.round(input.height)
      : isTablet
        ? 834
        : 390;
  const viewportWidth =
    Number.isFinite(input.width) && input.width > 0
      ? Math.round(input.width)
      : isTablet
        ? 1194
        : 844;

  const headerHeight = isTablet ? 61 : 40;
  const transportHeight = isTablet ? 64 : 30;
  const pageGap = isTablet ? 10 : 4;
  const wsGap = isTablet ? 10 : 4;
  const padY =
    input.safePaddingY !== undefined && Number.isFinite(input.safePaddingY)
      ? Math.max(0, Math.round(input.safePaddingY))
      : isTablet
        ? 28
        : 8;
  const padX =
    input.safePaddingX !== undefined && Number.isFinite(input.safePaddingX)
      ? Math.max(0, Math.round(input.safePaddingX))
      : isTablet
        ? 48
        : 96;

  const handleHeight = handleBarHeight(isTablet);
  const miniPianoH = miniPianoHeight(isTablet);
  const defaultPianoH = defaultPianoHeight(isTablet);
  const centsHeight = 0;
  const sheetPadY = isTablet ? 16 : 4;
  const jianpuHeight = isTablet ? 52 : 24;
  const minLineHeight = minScoreLineHeight(isTablet);
  const extraChromeH = Math.max(0, Math.round(input.extraChromeHeight ?? 0));
  const lyricsBandH = Math.max(0, Math.round(input.lyricsBandHeight ?? 0));

  // 正常情況下優先保留給「1 行完整五線譜＋簡譜」的最小面板高度
  const minPreferredSheetPaperH = isTablet ? 203 : 175;
  // 使用者手動展開時，仍須保證 1 行五線譜含上下加線各 2 條不被裁切的嚴格最小高度
  const minUnclippedStaffH = isTablet ? 90 : 72;
  const minUnclippedSheetPaperH =
    sheetPadY + centsHeight + lyricsBandH + jianpuHeight + minUnclippedStaffH;

  const workspaceHeight = Math.max(
    0,
    viewportHeight - padY - headerHeight - transportHeight - extraChromeH - pageGap * 2,
  );
  const availableSheetPlusPiano = Math.max(
    0,
    workspaceHeight - handleHeight - wsGap * 2,
  );

  const contentWidth = Math.max(240, viewportWidth - padX);
  const whiteKeyWidth = contentWidth / (isTablet ? 22 : 19);
  const autoCollapseThreshold = whiteKeyWidth * 1.8;

  const strictMaxPianoH = Math.max(
    0,
    availableSheetPlusPiano - minUnclippedSheetPaperH,
  );

  let collapsed = false;
  let autoCollapsed = false;
  let pianoHeight = miniPianoH;
  let maxPianoHeight = Math.max(PIANO_COLLAPSE_THRESHOLD, strictMaxPianoH);
  let forceSingleLine = false;

  if (
    input.overridePianoHeight !== undefined &&
    input.overridePianoHeight !== null &&
    Number.isFinite(input.overridePianoHeight)
  ) {
    maxPianoHeight = Math.max(PIANO_COLLAPSE_THRESHOLD, strictMaxPianoH);
    pianoHeight = clampPianoHeight(input.overridePianoHeight, maxPianoHeight);
    collapsed = false;
    autoCollapsed = false;
    if (availableSheetPlusPiano - minPreferredSheetPaperH < autoCollapseThreshold) {
      forceSingleLine = true;
    }
  } else if (input.collapsedPref === 'collapsed') {
    collapsed = true;
    autoCollapsed = false;
    pianoHeight = miniPianoH;
  } else if (input.collapsedPref === 'expanded') {
    if (strictMaxPianoH < PIANO_COLLAPSE_THRESHOLD) {
      // 極端矮視窗連 40px 鋼琴都無法在不裁切樂譜的情況下容納，維持自動收合
      collapsed = true;
      autoCollapsed = true;
      pianoHeight = miniPianoH;
    } else {
      collapsed = false;
      autoCollapsed = false;
      maxPianoHeight = strictMaxPianoH;
      const targetPiano = input.preferredPianoHeight ?? defaultPianoH;
      pianoHeight = clampPianoHeight(targetPiano, maxPianoHeight);
      if (availableSheetPlusPiano - minPreferredSheetPaperH < autoCollapseThreshold) {
        forceSingleLine = true;
      }
    }
  } else {
    // 'auto'：先保證 1 行樂譜最小高度，再將剩餘空間交給鋼琴
    const remainingForPiano = availableSheetPlusPiano - minPreferredSheetPaperH;
    if (remainingForPiano < autoCollapseThreshold) {
      autoCollapsed = true;
      collapsed = true;
      pianoHeight = miniPianoH;
    } else {
      autoCollapsed = false;
      collapsed = false;
      maxPianoHeight = remainingForPiano;
      const targetPiano = input.preferredPianoHeight ?? defaultPianoH;
      pianoHeight = clampPianoHeight(targetPiano, maxPianoHeight);
    }
  }

  const sheetPaperHeight = Math.max(0, availableSheetPlusPiano - pianoHeight);
  const scoreAreaHeight = Math.max(
    0,
    sheetPaperHeight - sheetPadY - centsHeight - lyricsBandH,
  );

  // 兩行樂譜僅在每行皆能 >= 最小行高（並計入 1px 分隔線）時才出現
  const lineCount: 1 | 2 =
    !forceSingleLine && scoreAreaHeight >= minLineHeight * 2 + 1 ? 2 : 1;
  const lineBorder = lineCount === 2 ? 1 : 0;
  const lineHeight = Math.floor((scoreAreaHeight - lineBorder) / lineCount);
  const staffHeight = Math.max(40, lineHeight - jianpuHeight);
  const { sp, stepY } = computeSpFromStaffHeight(staffHeight, isTablet);

  return {
    device: input.device,
    viewportHeight,
    viewportWidth,
    headerHeight,
    transportHeight,
    workspaceHeight,
    sheetPaperHeight,
    centsHeight,
    scoreAreaHeight,
    lineHeight,
    jianpuHeight,
    staffHeight,
    sp,
    stepY,
    lineCount,
    handleHeight,
    pianoHeight,
    whiteKeyWidth,
    autoCollapseThreshold,
    maxPianoHeight,
    collapsed,
    autoCollapsed,
  };
}

export interface PortraitSafeArea {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  x?: number;
  y?: number;
}

export interface PortraitLayoutOptions {
  collapsedPref?: PianoCollapsedPref;
  preferredPianoHeight?: number | null;
  overridePianoHeight?: number | null;
  extraChromeHeight?: number;
  lyricsBandHeight?: number;
}

export interface PortraitLayoutResult {
  viewportWidth: number;
  viewportHeight: number;
  safePaddingY: number;
  safePaddingX: number;
  headerHeight: number;
  patternTitleHeight: number;
  transportRow1Height: number;
  transportRow2Height: number;
  transportGap: number;
  transportHeight: number;
  workspaceHeight: number;
  sheetPaperHeight: number;
  centsHeight: number;
  scoreAreaHeight: number;
  lineHeight: number;
  minLineHeight: number;
  jianpuHeight: number;
  staffHeight: number;
  sp: number;
  stepY: number;
  lineCount: 1 | 2 | 3;
  handleHeight: number;
  pianoHeight: number;
  whiteKeyWidth: number;
  autoCollapseThreshold: number;
  maxPianoHeight: number;
  collapsed: boolean;
  autoCollapsed: boolean;
  /** 各區塊與間距的總高度（應 <= viewportHeight） */
  totalHeight: number;
}

/** 純函式計算手機直放練唱版面各區塊高度（含 3 行樂譜與兩排播放列） */
export function computePortraitLayout(
  width: number,
  height: number,
  safe?: PortraitSafeArea,
  options: PortraitLayoutOptions = {},
): PortraitLayoutResult {
  const viewportWidth =
    Number.isFinite(width) && width > 0 ? Math.round(width) : 390;
  const viewportHeight =
    Number.isFinite(height) && height > 0 ? Math.round(height) : 844;

  const safePaddingY =
    safe?.y !== undefined && Number.isFinite(safe.y)
      ? Math.max(0, Math.round(safe.y))
      : safe && (safe.top !== undefined || safe.bottom !== undefined)
        ? Math.max(0, Math.round((safe.top ?? 0) + (safe.bottom ?? 0)))
        : 8;
  const safePaddingX =
    safe?.x !== undefined && Number.isFinite(safe.x)
      ? Math.max(0, Math.round(safe.x))
      : safe && (safe.left !== undefined || safe.right !== undefined)
        ? Math.max(0, Math.round((safe.left ?? 0) + (safe.right ?? 0)))
        : 16;

  const headerHeight = 43;
  const centsHeight = 0;
  const jianpuHeight = 20;
  const handleHeight = handleBarHeight(false); // 10
  const miniPianoH = miniPianoHeight(false); // 18
  const defaultPianoH = PORTRAIT_DEFAULT_PIANO_HEIGHT; // 116
  const patternTitleHeight = 32;
  const transportRow1Height = 48;
  const transportRow2Height = 44;
  const transportGap = 4;
  const transportHeight =
    transportRow1Height + transportGap + transportRow2Height; // 96

  const pageGap = 4;
  const wsGap = 4;
  const sheetPadY = 4;
  const minLineHeight = PORTRAIT_MIN_LINE_HEIGHT; // 88
  const extraChromeH = Math.max(0, Math.round(options.extraChromeHeight ?? 0));
  const lyricsBandH = Math.max(0, Math.round(options.lyricsBandHeight ?? 0));

  // 頁面直向四塊：header + workspace + patternTitle + transport（共 3 個 pageGap）
  const workspaceHeight = Math.max(
    0,
    viewportHeight -
      safePaddingY -
      headerHeight -
      patternTitleHeight -
      transportHeight -
      extraChromeH -
      pageGap * 3,
  );
  const availableSheetPlusPiano = Math.max(
    0,
    workspaceHeight - handleHeight - wsGap * 2,
  );

  const contentWidth = Math.max(240, viewportWidth - safePaddingX);
  const whiteKeyWidth = contentWidth / 15; // 2 個八度（15 個白鍵 C–C）
  const autoCollapseThreshold = whiteKeyWidth * 1.8;

  // 優先保留 3 行最小高度 + 2px 分隔線
  const minPreferredSheetPaperH =
    sheetPadY + centsHeight + minLineHeight * 3 + 2;
  const minUnclippedStaffH = 66;
  const minUnclippedSheetPaperH =
    sheetPadY + centsHeight + lyricsBandH + jianpuHeight + minUnclippedStaffH;
  const strictMaxPianoH = Math.max(
    0,
    availableSheetPlusPiano - minUnclippedSheetPaperH,
  );

  const collapsedPref = options.collapsedPref ?? 'auto';
  const preferredPianoH = options.preferredPianoHeight ?? null;
  const overridePianoH = options.overridePianoHeight ?? null;

  let collapsed = false;
  let autoCollapsed = false;
  let pianoHeight = miniPianoH;
  let maxPianoHeight = Math.max(PIANO_COLLAPSE_THRESHOLD, strictMaxPianoH);

  if (
    overridePianoH !== undefined &&
    overridePianoH !== null &&
    Number.isFinite(overridePianoH)
  ) {
    maxPianoHeight = Math.max(PIANO_COLLAPSE_THRESHOLD, strictMaxPianoH);
    pianoHeight = clampPianoHeight(overridePianoH, maxPianoHeight);
    collapsed = false;
    autoCollapsed = false;
  } else if (collapsedPref === 'collapsed') {
    collapsed = true;
    autoCollapsed = false;
    pianoHeight = miniPianoH;
  } else if (collapsedPref === 'expanded') {
    if (strictMaxPianoH < PIANO_COLLAPSE_THRESHOLD) {
      collapsed = true;
      autoCollapsed = true;
      pianoHeight = miniPianoH;
    } else {
      collapsed = false;
      autoCollapsed = false;
      maxPianoHeight = strictMaxPianoH;
      const targetPiano = preferredPianoH ?? defaultPianoH;
      pianoHeight = clampPianoHeight(targetPiano, maxPianoHeight);
    }
  } else {
    const remainingForPiano = availableSheetPlusPiano - minPreferredSheetPaperH;
    if (remainingForPiano < autoCollapseThreshold) {
      autoCollapsed = true;
      collapsed = true;
      pianoHeight = miniPianoH;
    } else {
      autoCollapsed = false;
      collapsed = false;
      maxPianoHeight = remainingForPiano;
      const targetPiano = preferredPianoH ?? defaultPianoH;
      pianoHeight = clampPianoHeight(targetPiano, maxPianoHeight);
    }
  }

  const sheetPaperHeight = Math.max(0, availableSheetPlusPiano - pianoHeight);
  const scoreAreaHeight = Math.max(
    0,
    sheetPaperHeight - sheetPadY - centsHeight - lyricsBandH,
  );

  let lineCount: 1 | 2 | 3 = 1;
  if (scoreAreaHeight >= minLineHeight * 3 + 2) {
    lineCount = 3;
  } else if (scoreAreaHeight >= minLineHeight * 2 + 1) {
    lineCount = 2;
  }

  const lineBorders = lineCount - 1;
  const lineHeight = Math.floor((scoreAreaHeight - lineBorders) / lineCount);
  const staffHeight = Math.max(40, lineHeight - jianpuHeight);
  const { sp, stepY } = computeSpFromStaffHeight(staffHeight, false);

  const totalHeight =
    safePaddingY +
    headerHeight +
    sheetPaperHeight +
    handleHeight +
    pianoHeight +
    wsGap * 2 +
    patternTitleHeight +
    transportHeight +
    extraChromeH +
    pageGap * 3;

  return {
    viewportWidth,
    viewportHeight,
    safePaddingY,
    safePaddingX,
    headerHeight,
    patternTitleHeight,
    transportRow1Height,
    transportRow2Height,
    transportGap,
    transportHeight,
    workspaceHeight,
    sheetPaperHeight,
    centsHeight,
    scoreAreaHeight,
    lineHeight,
    minLineHeight,
    jianpuHeight,
    staffHeight,
    sp,
    stepY,
    lineCount,
    handleHeight,
    pianoHeight,
    whiteKeyWidth,
    autoCollapseThreshold,
    maxPianoHeight,
    collapsed,
    autoCollapsed,
    totalHeight,
  };
}
