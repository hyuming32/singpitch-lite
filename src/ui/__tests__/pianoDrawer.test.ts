import { describe, expect, it } from 'vitest';
import {
  PIANO_COLLAPSE_THRESHOLD,
  clampPianoHeight,
  resolveDrawerPointerEnd,
} from '../practice/pianoDrawer';

describe('pianoDrawer', () => {
  it('拖動放開位置低於 40 px 時進入收合狀態', () => {
    const result = resolveDrawerPointerEnd({
      savedHeight: 130,
      collapsed: false,
      deltaY: 95, // 130 - 95 = 35 < 40
      distance: 95,
      miniHeight: 18,
      defaultHeight: 130,
      maxHeight: 220,
    });
    expect(result.collapsed).toBe(true);
    expect(result.height).toBe(130);
  });

  it('點擊（移動小於 6 px）會在收合與展開間切換', () => {
    const collapsedRes = resolveDrawerPointerEnd({
      savedHeight: 140,
      collapsed: false,
      deltaY: 2,
      distance: 3,
      miniHeight: 18,
      defaultHeight: 130,
      maxHeight: 220,
    });
    expect(collapsedRes.collapsed).toBe(true);

    const expandedRes = resolveDrawerPointerEnd({
      savedHeight: 140,
      collapsed: true,
      deltaY: -1,
      distance: 2,
      miniHeight: 18,
      defaultHeight: 130,
      maxHeight: 220,
    });
    expect(expandedRes.collapsed).toBe(false);
    expect(expandedRes.height).toBe(140);
  });

  it('高度會夾在上下限之間', () => {
    expect(clampPianoHeight(20, 220)).toBe(PIANO_COLLAPSE_THRESHOLD);
    expect(clampPianoHeight(500, 220)).toBe(220);

    const draggedTooTall = resolveDrawerPointerEnd({
      savedHeight: 130,
      collapsed: false,
      deltaY: -200, // 130 - (-200) = 330 > 220
      distance: 200,
      miniHeight: 18,
      defaultHeight: 130,
      maxHeight: 220,
    });
    expect(draggedTooTall.collapsed).toBe(false);
    expect(draggedTooTall.height).toBe(220);
  });
});
