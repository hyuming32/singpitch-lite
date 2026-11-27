import { describe, expect, it } from 'vitest';
import { computeViewportLayout } from '../practice/viewportLayout';
import {
  isPortraitPhoneViewport,
  resolvePracticeViewport,
  toLocalPoint,
  toLocalRect,
} from '../practice/viewportRotation';

describe('viewportRotation 直放旋轉與指標座標換算', () => {
  it('正確判斷直立手機視窗並交換版面寬高', () => {
    expect(isPortraitPhoneViewport(390, 844)).toBe(true);
    expect(isPortraitPhoneViewport(844, 390)).toBe(false);
    expect(isPortraitPhoneViewport(844, 300)).toBe(false);
    expect(isPortraitPhoneViewport(1194, 834)).toBe(false);
    // iPad 直放不旋轉
    expect(isPortraitPhoneViewport(834, 1194)).toBe(false);

    const portrait = resolvePracticeViewport({ width: 390, height: 844 });
    expect(portrait.rotated).toBe(true);
    expect(portrait.isPhone).toBe(true);
    expect(portrait.isTablet).toBe(false);
    expect(portrait.device).toBe('phone');
    expect(portrait.layoutWidth).toBe(844);
    expect(portrait.layoutHeight).toBe(390);
  });

  it('resolvePracticeViewport(390, 844) 維持為 phone，且 computeViewportLayout 的高度與各區塊總和 ≤ 390', () => {
    const vp = resolvePracticeViewport(390, 844);
    expect(vp.rotated).toBe(true);
    expect(vp.isPhone).toBe(true);
    expect(vp.isTablet).toBe(false);
    expect(vp.device).toBe('phone');
    expect(vp.layoutWidth).toBe(844);
    expect(vp.layoutHeight).toBe(390);

    const layout = computeViewportLayout({
      height: vp.layoutHeight,
      width: vp.layoutWidth,
      device: vp.device,
      collapsedPref: 'auto',
    });

    expect(layout.viewportHeight).toBe(390);
    expect(layout.viewportWidth).toBe(844);
    expect(layout.device).toBe('phone');
    const totalPageHeight =
      layout.headerHeight +
      layout.workspaceHeight +
      layout.transportHeight +
      8 + // page safe padding Y (4 + 4)
      8; // page gaps (4 + 4)
    expect(totalPageHeight).toBeLessThanOrEqual(390);

    const totalWorkspaceHeight =
      layout.sheetPaperHeight +
      layout.handleHeight +
      layout.pianoHeight +
      8; // workspace gaps (4 + 4)
    expect(totalWorkspaceHeight).toBeLessThanOrEqual(layout.workspaceHeight);
  });

  it('未旋轉時 toLocalPoint 與 toLocalRect 原樣回傳', () => {
    const ctx = { rotated: false, viewportWidth: 844 };
    expect(toLocalPoint(120, 240, ctx)).toEqual({ x: 120, y: 240 });
    expect(
      toLocalRect(
        { left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 },
        ctx,
      ),
    ).toEqual({
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
      width: 100,
      height: 50,
    });
  });

  it('直放旋轉時正確將 client 座標與 DOMRect 換算為局部座標（實體左右拖對應局部上下）', () => {
    const ctx = { rotated: true, viewportWidth: 390 };

    // 容器左上角 (local 0, 0) 位於螢幕右上角 (390, 0)
    expect(toLocalPoint(390, 0, ctx)).toEqual({ x: 0, y: 0 });
    // 容器右下角 (local 844, 390) 位於螢幕左下角 (0, 844)
    expect(toLocalPoint(0, 844, ctx)).toEqual({ x: 844, y: 390 });

    // 實體往右拖（clientX 增加）：localY 減小（把手往上拉，鋼琴變高）
    const p1 = toLocalPoint(100, 300, ctx);
    const p2 = toLocalPoint(160, 300, ctx);
    expect(p2.x - p1.x).toBe(0);
    expect(p2.y - p1.y).toBe(-60);

    // 實體往下拖（clientY 增加）：localX 增加（調名方塊或鋼琴捲動往右拖）
    const p3 = toLocalPoint(200, 420, ctx);
    expect(p3.x - p2.x).toBe(120);

    // 矩形換算：local [48..796] × [250..356] 在 390×844 螢幕上為
    // left = 390 - 356 = 34, right = 390 - 250 = 140, top = 48, bottom = 796
    const localRect = toLocalRect(
      {
        left: 34,
        top: 48,
        right: 140,
        bottom: 796,
        width: 106,
        height: 748,
      },
      ctx,
    );
    expect(localRect).toEqual({
      left: 48,
      top: 250,
      right: 796,
      bottom: 356,
      width: 748,
      height: 106,
    });
  });
});
