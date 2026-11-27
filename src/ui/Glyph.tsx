import type { SVGProps } from 'react';
import {
  accidentalFlat,
  accidentalNatural,
  accidentalSharp,
  type MusicGlyph,
} from './musicGlyphs';

/** 計算 SMuFL 字形縮放比例（1 em = 4 個五線譜線距） */
export function glyphScale(sp: number, unitsPerEm: number): number {
  return (4 * sp) / unitsPerEm;
}

/** 計算將 SMuFL 字形原點對齊 (x, y) 並翻轉 y 軸的 SVG transform 字串 */
export function glyphTransform(
  x: number,
  y: number,
  sp: number,
  unitsPerEm: number,
): string {
  const s = glyphScale(sp, unitsPerEm);
  return `translate(${x}, ${y}) scale(${s}, ${-s})`;
}

export interface ScreenBBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** 計算字形經 glyphTransform 轉換後在 SVG 畫面座標中的外框 */
export function glyphScreenBBox(
  glyph: MusicGlyph,
  x: number,
  y: number,
  sp: number,
): ScreenBBox {
  const s = glyphScale(sp, glyph.unitsPerEm);
  const left = x + glyph.bbox.x1 * s;
  const right = x + glyph.bbox.x2 * s;
  const top = y - glyph.bbox.y2 * s;
  const bottom = y - glyph.bbox.y1 * s;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/** 依升降／還原記號字元取得對應的 SMuFL 字形 */
export function accidentalGlyph(accidental: string): MusicGlyph | null {
  switch (accidental) {
    case '♯':
    case '#':
      return accidentalSharp;
    case '♭':
    case 'b':
      return accidentalFlat;
    case '♮':
      return accidentalNatural;
    default:
      return null;
  }
}

interface GlyphProps extends Omit<SVGProps<SVGPathElement>, 'd' | 'transform'> {
  glyph: MusicGlyph;
  x: number;
  y: number;
  sp: number;
}

/** 繪製 SMuFL 樂譜字形（自動以 scale(s, -s) 翻轉字型座標並對齊原點至 (x, y)） */
export function Glyph({ glyph, x, y, sp, ...rest }: GlyphProps) {
  return (
    <path
      d={glyph.d}
      transform={glyphTransform(x, y, sp, glyph.unitsPerEm)}
      {...rest}
    />
  );
}
