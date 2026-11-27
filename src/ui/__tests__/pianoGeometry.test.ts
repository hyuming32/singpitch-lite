import { describe, expect, it } from 'vitest';
import {
  BLACK_KEY_CENTERS,
  BLACK_WIDTH,
  PIANO_PRESETS,
  keyAt,
  layoutKeyboard,
} from '../piano/pianoGeometry';

describe('pianoGeometry', () => {
  it('完整 88 鍵包含 52 白鍵、36 黑鍵，總寬為 52W', () => {
    const W = 40;
    const layout = layoutKeyboard({ W, preset: 'real' });
    expect(layout.whites).toHaveLength(52);
    expect(layout.blacks).toHaveLength(36);
    expect(layout.totalWidth).toBe(52 * W);
  });

  it('C♯/D♯/F♯/G♯/A♯ 黑鍵左緣皆等於 (八度起點 + 中心) − 寬/2', () => {
    const W = 50;
    const layout = layoutKeyboard({ lowMidi: 60, highMidi: 72, W, preset: 'real' });
    const blackMap = new Map(layout.blacks.map((b) => [b.midi, b]));

    const expected: Array<[number, number]> = [
      [61, BLACK_KEY_CENTERS[1]!], // C♯4
      [63, BLACK_KEY_CENTERS[3]!], // D♯4
      [66, BLACK_KEY_CENTERS[6]!], // F♯4
      [68, BLACK_KEY_CENTERS[8]!], // G♯4
      [70, BLACK_KEY_CENTERS[10]!], // A♯4
    ];

    for (const [midi, center] of expected) {
      const bk = blackMap.get(midi)!;
      expect(bk).toBeDefined();
      expect(bk.x).toBeCloseTo((0 + center) * W - (BLACK_WIDTH * W) / 2, 6);
    }
  });

  it('keyAt 在黑鍵區域優先回傳黑鍵，黑鍵下方回傳白鍵', () => {
    const W = 40;
    const layout = layoutKeyboard({ lowMidi: 60, highMidi: 72, W, preset: 'korg' });
    const cs4 = layout.blacks.find((b) => b.midi === 61)!;

    // 黑鍵中心點：必須回傳黑鍵 61
    expect(keyAt(cs4.x + cs4.w / 2, cs4.len * 0.5, layout)).toBe(61);

    // 黑鍵正下方（仍屬於 C4 區域）：回傳白鍵 60
    const c4 = layout.whites.find((w) => w.midi === 60)!;
    expect(keyAt(c4.x + c4.w * 0.5, cs4.len + 10, layout)).toBe(60);

    // 超出範圍回傳 null
    expect(keyAt(-1, 10, layout)).toBeNull();
    expect(keyAt(10, layout.whiteLen + 1, layout)).toBeNull();
  });

  it('容器高度小於理論白鍵長時從前端裁切，並限制黑鍵長度上限', () => {
    const W = 40;
    const h = 100;
    const layout = layoutKeyboard({
      lowMidi: 60,
      highMidi: 72,
      W,
      preset: 'tablet',
      height: h,
    });

    const L = PIANO_PRESETS.tablet.aspectRatio * W; // 184
    expect(layout.theoreticalWhiteLen).toBeCloseTo(L, 6);
    expect(layout.whiteLen).toBe(h);
    expect(layout.blackLen).toBeCloseTo(
      Math.min(PIANO_PRESETS.tablet.blackLengthRatio * L, 0.75 * h),
      6,
    );
  });

  it('fillHeight=true 時白鍵填滿容器高度，黑鍵依比例縮放（無下方空白）', () => {
    const W = 24.93;
    const h = 104;
    const layout = layoutKeyboard({
      lowMidi: 21,
      highMidi: 108,
      W,
      preset: 'korg',
      height: h,
      fillHeight: true,
    });

    expect(layout.whiteLen).toBe(h);
    expect(layout.whites[0]!.len).toBe(h);
    expect(layout.blackLen).toBeCloseTo(
      PIANO_PRESETS.korg.blackLengthRatio * h,
      6,
    );
  });
});
