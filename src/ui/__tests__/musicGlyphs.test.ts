import { describe, expect, it } from 'vitest';
import {
  accidentalGlyph,
  glyphScale,
  glyphScreenBBox,
  glyphTransform,
} from '../Glyph';
import {
  accidentalFlat,
  accidentalNatural,
  accidentalSharp,
  fClef,
  gClef,
  noteheadBlack,
} from '../musicGlyphs';

describe('musicGlyphs & Glyph', () => {
  it('所有匯出的 Bravura 字形皆有非空 path 與合法 bbox', () => {
    const all = [
      gClef,
      fClef,
      accidentalSharp,
      accidentalFlat,
      accidentalNatural,
      noteheadBlack,
    ];

    for (const g of all) {
      expect(g.d.length).toBeGreaterThan(10);
      expect(g.unitsPerEm).toBeGreaterThan(0);
      expect(g.bbox.x2).toBeGreaterThan(g.bbox.x1);
      expect(g.bbox.y2).toBeGreaterThan(g.bbox.y1);
    }
  });

  it('gClef 與 fClef 的線距比例符合 SMuFL 標準', () => {
    // 1 em = 4 個線距
    const gUnitPerSp = gClef.unitsPerEm / 4;
    const gHeightSp = (gClef.bbox.y2 - gClef.bbox.y1) / gUnitPerSp;
    const gWidthSp = (gClef.bbox.x2 - gClef.bbox.x1) / gUnitPerSp;
    expect(gHeightSp).toBeGreaterThanOrEqual(6.5);
    expect(gHeightSp).toBeLessThanOrEqual(7.5);
    expect(gWidthSp).toBeGreaterThanOrEqual(2.5);
    expect(gWidthSp).toBeLessThanOrEqual(3.0);

    const fUnitPerSp = fClef.unitsPerEm / 4;
    const fHeightSp = (fClef.bbox.y2 - fClef.bbox.y1) / fUnitPerSp;
    expect(fHeightSp).toBeGreaterThanOrEqual(3.0);
    expect(fHeightSp).toBeLessThanOrEqual(4.0);
  });

  it('glyphTransform 於 sp=10 時對齊 G 線 y，且高音譜號上緣高於第五線、下緣低於第一線', () => {
    const sp = 10;
    // 假設第五線 F5 在 y = 20，由上往下每線間隔 sp=10：
    // 第五線 20、第四線 30、第三線 40、第二線(G4) 50、第一線(E4) 60
    const fifthLineY = 20;
    const gLineY = 50;
    const firstLineY = 60;
    const x = 12;

    const s = glyphScale(sp, gClef.unitsPerEm);
    expect(glyphTransform(x, gLineY, sp, gClef.unitsPerEm)).toBe(
      `translate(${x}, ${gLineY}) scale(${s}, ${-s})`,
    );

    // 原點 (0, 0) 經 translate(x, gLineY) scale(s, -s) 轉換後，y 應精確等於 gLineY
    const originScreenY = gLineY + 0 * -s;
    expect(originScreenY).toBe(gLineY);

    const box = glyphScreenBBox(gClef, x, gLineY, sp);
    expect(box.top).toBeLessThan(fifthLineY); // SVG y 越小越靠上
    expect(box.bottom).toBeGreaterThan(firstLineY); // SVG y 越大越靠下
  });

  it('accidentalGlyph 正確對應升／降／還原記號', () => {
    expect(accidentalGlyph('♯')).toBe(accidentalSharp);
    expect(accidentalGlyph('♭')).toBe(accidentalFlat);
    expect(accidentalGlyph('♮')).toBe(accidentalNatural);
    expect(accidentalGlyph('')).toBeNull();
  });
});
