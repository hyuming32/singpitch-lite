import { describe, expect, it } from 'vitest';
import { computePortraitLayout } from '../practice/viewportLayout';
import {
  isPortraitPhoneViewport,
  resolvePracticeViewport,
  toLocalPoint,
  toLocalRect,
} from '../practice/viewportRotation';

describe('viewportRotation 直放版面判定與座標恆等函式', () => {
  it('正確判斷直立手機視窗且不再旋轉 90° 交換寬高', () => {
    expect(isPortraitPhoneViewport(390, 844)).toBe(true);
    expect(isPortraitPhoneViewport(844, 390)).toBe(false);
    expect(isPortraitPhoneViewport(844, 300)).toBe(false);
    expect(isPortraitPhoneViewport(1194, 834)).toBe(false);
    // iPad 直放不視為手機直放
    expect(isPortraitPhoneViewport(834, 1194)).toBe(false);

    const portrait = resolvePracticeViewport({ width: 390, height: 844 });
    expect(portrait.rotated).toBe(false);
    expect(portrait.isPhone).toBe(true);
    expect(portrait.isPortrait).toBe(true);
    expect(portrait.isTablet).toBe(false);
    expect(portrait.device).toBe('phone');
    expect(portrait.layoutWidth).toBe(390);
    expect(portrait.layoutHeight).toBe(844);

    const landscape = resolvePracticeViewport({ width: 844, height: 390 });
    expect(landscape.rotated).toBe(false);
    expect(landscape.isPhone).toBe(true);
    expect(landscape.isPortrait).toBe(false);
    expect(landscape.layoutWidth).toBe(844);
    expect(landscape.layoutHeight).toBe(390);
  });

  it('resolvePracticeViewport(390, 844) 搭配 computePortraitLayout 各區塊總高 ≤ 844', () => {
    const vp = resolvePracticeViewport(390, 844);
    expect(vp.rotated).toBe(false);
    expect(vp.isPortrait).toBe(true);

    const layout = computePortraitLayout(vp.layoutWidth, vp.layoutHeight);
    expect(layout.viewportWidth).toBe(390);
    expect(layout.viewportHeight).toBe(844);
    expect(layout.totalHeight).toBeLessThanOrEqual(844);
  });

  it('toLocalPoint 與 toLocalRect 皆回傳恆等座標（不再套用旋轉換算）', () => {
    const ctxNoRot = { rotated: false, viewportWidth: 844 };
    const ctxFlagged = { rotated: true, viewportWidth: 390 };

    expect(toLocalPoint(120, 240, ctxNoRot)).toEqual({ x: 120, y: 240 });
    expect(toLocalPoint(120, 240, ctxFlagged)).toEqual({ x: 120, y: 240 });

    const sampleRect = {
      left: 10,
      top: 20,
      right: 110,
      bottom: 70,
      width: 100,
      height: 50,
    };
    expect(toLocalRect(sampleRect, ctxNoRot)).toEqual(sampleRect);
    expect(toLocalRect(sampleRect, ctxFlagged)).toEqual(sampleRect);
  });
});
