import { describe, expect, it } from 'vitest';
import { gClef, fClef } from '../musicGlyphs';
import {
  isIosBrowserMode,
  markIosInstallHintDismissed,
  readIosInstallHintDismissed,
} from '../practice/iosInstallHint';
import { computeStaffMetrics } from '../practice/layout';
import {
  computePortraitLayout,
  computeViewportLayout,
} from '../practice/viewportLayout';

/** 驗證五線譜（含上下加線各 2 條、音符符頭、符桿與譜號）完全落在 [0, staffHeight] 內 */
function assertStaffFitsWithTwoLedgerLines(
  staffHeight: number,
  isTablet: boolean,
  expectedSp: number,
) {
  // pos = -4 為下加二線（如高音譜號 A3），pos = 12 為上加二線（如高音譜號 C6）
  const positions = [
    { position: -4 },
    { position: 0 },
    { position: 3 },
    { position: 4 },
    { position: 8 },
    { position: 12 },
  ];
  const metrics = computeStaffMetrics(positions, staffHeight, isTablet);
  expect(metrics.lineSpacing).toBeCloseTo(expectedSp, 5);

  const yForPos = (pos: number) => metrics.baseY - pos * metrics.stepY;
  const sp = metrics.lineSpacing;

  // 五線與上下加線各 2 條（pos = -4, -2, 0, 2, 4, 6, 8, 10, 12）與符頭（±1 stepY）
  const topNoteEdge = yForPos(13);
  const bottomNoteEdge = yForPos(-5);
  expect(topNoteEdge).toBeGreaterThanOrEqual(0);
  expect(bottomNoteEdge).toBeLessThanOrEqual(staffHeight);

  // 高音譜號與低音譜號外框
  const gScale = (4 * sp) / gClef.unitsPerEm;
  const gTop = yForPos(2) - gClef.bbox.y2 * gScale;
  const gBottom = yForPos(2) - gClef.bbox.y1 * gScale;
  expect(gTop).toBeGreaterThanOrEqual(0);
  expect(gBottom).toBeLessThanOrEqual(staffHeight);

  const fScale = (4 * sp) / fClef.unitsPerEm;
  const fTop = yForPos(6) - fClef.bbox.y2 * fScale;
  const fBottom = yForPos(6) - fClef.bbox.y1 * fScale;
  expect(fTop).toBeGreaterThanOrEqual(0);
  expect(fBottom).toBeLessThanOrEqual(staffHeight);
}

describe('viewportLayout 版面高度分配', () => {
  it('iPhone Safari 分頁模式 H=300, W=844：標題 35px、播放列 30px、把手 10px，鋼琴自動收合為 18px，1 行五線譜不裁切', () => {
    const layout = computeViewportLayout({
      height: 300,
      width: 844,
      device: 'phone',
      collapsedPref: 'auto',
    });

    expect(layout.headerHeight).toBe(35);
    expect(layout.transportHeight).toBe(30);
    expect(layout.handleHeight).toBe(10);
    expect(layout.autoCollapsed).toBe(true);
    expect(layout.collapsed).toBe(true);
    expect(layout.pianoHeight).toBe(18);
    expect(layout.lineCount).toBe(1);
    expect(layout.sheetPaperHeight).toBeGreaterThanOrEqual(175);
    expect(
      layout.headerHeight +
        layout.transportHeight +
        layout.workspaceHeight +
        8 + // page padding
        8, // page gaps
    ).toBe(300);

    assertStaffFitsWithTwoLedgerLines(layout.staffHeight, false, layout.sp);
  });

  it('iPhone 空間不足手動展開（H=300, W=844, collapsedPref=expanded）：維持 1 行樂譜並把剩餘高度給鋼琴，五線譜仍不裁切', () => {
    const layout = computeViewportLayout({
      height: 300,
      width: 844,
      device: 'phone',
      collapsedPref: 'expanded',
    });

    expect(layout.collapsed).toBe(false);
    expect(layout.autoCollapsed).toBe(false);
    expect(layout.lineCount).toBe(1);
    expect(layout.pianoHeight).toBeGreaterThanOrEqual(40);
    expect(layout.pianoHeight).toBe(
      layout.workspaceHeight -
        layout.handleHeight -
        8 -
        layout.sheetPaperHeight,
    );

    assertStaffFitsWithTwoLedgerLines(layout.staffHeight, false, layout.sp);
  });

  it('iPhone 主畫面模式 H=390, W=844：鋼琴展開且不自動收合，1 行樂譜 >= 175px；手動收合鋼琴後可容納 2 行樂譜', () => {
    const expanded = computeViewportLayout({
      height: 390,
      width: 844,
      device: 'phone',
      collapsedPref: 'auto',
    });

    expect(expanded.headerHeight).toBe(35);
    expect(expanded.transportHeight).toBe(30);
    expect(expanded.handleHeight).toBe(10);
    expect(expanded.autoCollapsed).toBe(false);
    expect(expanded.collapsed).toBe(false);
    expect(expanded.pianoHeight).toBeGreaterThanOrEqual(
      expanded.autoCollapseThreshold,
    );
    expect(expanded.sheetPaperHeight).toBeGreaterThanOrEqual(175);
    expect(expanded.lineCount).toBe(1);
    assertStaffFitsWithTwoLedgerLines(expanded.staffHeight, false, expanded.sp);

    const collapsed = computeViewportLayout({
      height: 390,
      width: 844,
      device: 'phone',
      collapsedPref: 'collapsed',
    });
    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.autoCollapsed).toBe(false);
    expect(collapsed.pianoHeight).toBe(18);
    expect(collapsed.lineCount).toBe(2);
    expect(collapsed.lineHeight).toBeGreaterThanOrEqual(110);
    assertStaffFitsWithTwoLedgerLines(
      collapsed.staffHeight,
      false,
      collapsed.sp,
    );
  });

  it('iPad 主畫面模式 H=834, W=1194：2 行樂譜與 250px 鋼琴皆不裁切', () => {
    const layout = computeViewportLayout({
      height: 834,
      width: 1194,
      device: 'tablet',
      collapsedPref: 'auto',
    });

    expect(layout.autoCollapsed).toBe(false);
    expect(layout.collapsed).toBe(false);
    expect(layout.handleHeight).toBe(12);
    expect(layout.pianoHeight).toBe(250);
    expect(layout.lineCount).toBe(2);
    expect(layout.lineHeight).toBeGreaterThanOrEqual(150);
    assertStaffFitsWithTwoLedgerLines(layout.staffHeight, true, layout.sp);
  });

  it('iPad Safari 有網址列 H=700, W=1194：不足兩行時自動降為 1 行樂譜，鋼琴不收合且不裁切', () => {
    const layout = computeViewportLayout({
      height: 700,
      width: 1194,
      device: 'tablet',
      collapsedPref: 'auto',
    });

    expect(layout.autoCollapsed).toBe(false);
    expect(layout.collapsed).toBe(false);
    expect(layout.handleHeight).toBe(12);
    expect(layout.pianoHeight).toBe(250);
    expect(layout.lineCount).toBe(1);
    expect(layout.lineHeight).toBeGreaterThanOrEqual(150);
    assertStaffFitsWithTwoLedgerLines(layout.staffHeight, true, layout.sp);

    // 收合鋼琴時可改顯示 2 行
    const collapsed = computeViewportLayout({
      height: 700,
      width: 1194,
      device: 'tablet',
      collapsedPref: 'collapsed',
    });
    expect(collapsed.lineCount).toBe(2);
    expect(collapsed.lineHeight).toBeGreaterThanOrEqual(150);
    assertStaffFitsWithTwoLedgerLines(
      collapsed.staffHeight,
      true,
      collapsed.sp,
    );
  });

  it('極端矮視窗 H=260, W=844：自動收合鋼琴並縮放 sp，上下加線各 2 條仍完全落在面板內', () => {
    const layout = computeViewportLayout({
      height: 260,
      width: 844,
      device: 'phone',
      collapsedPref: 'auto',
    });

    expect(layout.headerHeight).toBe(35);
    expect(layout.transportHeight).toBe(30);
    expect(layout.handleHeight).toBe(10);
    expect(layout.autoCollapsed).toBe(true);
    expect(layout.collapsed).toBe(true);
    expect(layout.pianoHeight).toBe(18);
    expect(layout.lineCount).toBe(1);
    expect(layout.sp).toBeGreaterThan(0);
    assertStaffFitsWithTwoLedgerLines(layout.staffHeight, false, layout.sp);
  });

  it('自動收合條件邊界：< 白鍵寬 × 1.8 時自動收合，>= 白鍵寬 × 1.8 時保持展開', () => {
    // 手機 contentWidth = 844 - 96 = 748，whiteKeyWidth = 748 / 19 ≈ 39.37，門檻 ≈ 70.86
    // 非樂譜與非鋼琴固定高度 = 35 + 30 + 10 + 8 + 8 + 8 = 99，minPreferredSheetPaperH = 175
    // H = 344 -> remainingForPiano = 245 - 175 = 70 < 70.86 -> 自動收合
    const justBelow = computeViewportLayout({
      height: 344,
      width: 844,
      device: 'phone',
      collapsedPref: 'auto',
    });
    expect(justBelow.autoCollapsed).toBe(true);
    expect(justBelow.collapsed).toBe(true);

    // H = 345 -> remainingForPiano = 246 - 175 = 71 >= 70.86 -> 展開
    const justAbove = computeViewportLayout({
      height: 345,
      width: 844,
      device: 'phone',
      collapsedPref: 'auto',
    });
    expect(justAbove.autoCollapsed).toBe(false);
    expect(justAbove.collapsed).toBe(false);
    expect(justAbove.pianoHeight).toBe(71);
  });
});

describe('computePortraitLayout 手機直放版面分配', () => {
  it.each([
    { label: '390×844 主畫面', W: 390, H: 844 },
    { label: '390×664 Safari 有網址列', W: 390, H: 664 },
    { label: '375×667 iPhone SE', W: 375, H: 667 },
  ])('$label：總高 ≤ H、3 行樂譜每行 ≥ 最小行高、鋼琴 116px 且上下加線不裁切', ({ W, H }) => {
    const layout = computePortraitLayout(W, H, {
      top: 4,
      bottom: 4,
      left: 8,
      right: 8,
    });

    expect(layout.totalHeight).toBeLessThanOrEqual(H);
    expect(layout.headerHeight).toBe(38);
    expect(layout.centsHeight).toBe(24);
    expect(layout.jianpuHeight).toBe(20);
    expect(layout.handleHeight).toBe(10);
    expect(layout.pianoHeight).toBe(116);
    expect(layout.collapsed).toBe(false);
    expect(layout.patternTitleHeight).toBe(32);
    expect(layout.transportRow1Height).toBe(48);
    expect(layout.transportRow2Height).toBe(44);
    expect(layout.lineCount).toBe(3);
    expect(layout.lineHeight).toBeGreaterThanOrEqual(layout.minLineHeight);

    assertStaffFitsWithTwoLedgerLines(layout.staffHeight, false, layout.sp);
  });
});

describe('iosInstallHint iOS 非主畫面提示判斷', () => {
  it('僅在 iOS 且非 standalone 模式時顯示，關閉後記住狀態', () => {
    expect(
      isIosBrowserMode({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        navigatorStandalone: false,
        mediaStandalone: false,
      }),
    ).toBe(true);

    // iPadOS 桌機版 UA（MacIntel + maxTouchPoints > 1）
    expect(
      isIosBrowserMode({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
        navigatorStandalone: false,
        mediaStandalone: false,
      }),
    ).toBe(true);

    // 已加入主畫面（navigator.standalone 或 display-mode: standalone）不顯示
    expect(
      isIosBrowserMode({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        navigatorStandalone: true,
        mediaStandalone: false,
      }),
    ).toBe(false);
    expect(
      isIosBrowserMode({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        navigatorStandalone: false,
        mediaStandalone: true,
      }),
    ).toBe(false);

    // 非 iOS 不顯示
    expect(
      isIosBrowserMode({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
        navigatorStandalone: false,
        mediaStandalone: false,
      }),
    ).toBe(false);

    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(readIosInstallHintDismissed(fakeStorage)).toBe(false);
    markIosInstallHintDismissed(fakeStorage);
    expect(readIosInstallHintDismissed(fakeStorage)).toBe(true);
  });
});
