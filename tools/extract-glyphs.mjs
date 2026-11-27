#!/usr/bin/env node
/**
 * 一次性／可重現的 Bravura (SMuFL) 字形輪廓抽取腳本
 *
 * 使用方式（不需安裝 opentype.js 至專案 dependencies）：
 *   npx -y -p opentype.js node tools/extract-glyphs.mjs [Bravura.otf 路徑或網址]
 *
 * 預設從 GitHub steinbergmedia/bravura (tag: bravura-1.482) 下載 Bravura.otf，
 * 抽取指定 SMuFL 字形之原始字型座標輪廓（y 軸向上，1 em = 4 個線距），
 * 並輸出至 src/ui/musicGlyphs.ts。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DEFAULT_FONT_URL =
  'https://raw.githubusercontent.com/steinbergmedia/bravura/bravura-1.482/redist/otf/Bravura.otf';
const BRAVURA_VERSION = '1.482';

const GLYPHS = [
  { name: 'gClef', codePoint: 0xe050, label: '高音譜號' },
  { name: 'fClef', codePoint: 0xe062, label: '低音譜號' },
  { name: 'accidentalSharp', codePoint: 0xe262, label: '升記號' },
  { name: 'accidentalFlat', codePoint: 0xe260, label: '降記號' },
  { name: 'accidentalNatural', codePoint: 0xe261, label: '還原記號' },
  { name: 'noteheadBlack', codePoint: 0xe0a4, label: '四分音符實心符頭' },
];

function loadOpentype() {
  const require = createRequire(import.meta.url);
  try {
    return require('opentype.js');
  } catch {
    // 若透過 `npx -y -p opentype.js node ...` 執行，從 PATH 中的 _npx 目錄載入
    const pathEntries = (process.env.PATH ?? '').split(path.delimiter);
    const npxBin = pathEntries.find((p) => p.includes('_npx'));
    if (npxBin) {
      const npxRequire = createRequire(path.join(path.dirname(npxBin), 'index.js'));
      return npxRequire('opentype.js');
    }
    throw new Error('找不到 opentype.js，請改用 `npx -y -p opentype.js node tools/extract-glyphs.mjs` 執行。');
  }
}

async function loadFontBuffer(source) {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`下載字型失敗：${res.status} ${res.statusText} (${source})`);
    }
    return await res.arrayBuffer();
  }
  const buf = fs.readFileSync(source);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function main() {
  const source = process.argv[2] ?? DEFAULT_FONT_URL;
  const opentype = loadOpentype();
  const buffer = await loadFontBuffer(source);
  const font = opentype.parse(buffer);
  const unitsPerEm = font.unitsPerEm;

  const entries = [];
  for (const spec of GLYPHS) {
    const ch = String.fromCodePoint(spec.codePoint);
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.index === 0) {
      throw new Error(`字型中找不到字形 ${spec.name} (U+${spec.codePoint.toString(16).toUpperCase()})`);
    }
    // 使用 glyph.path 取得原始字型座標（y 向上，原點 (0,0) 在 SMuFL 基準線上）
    const d = glyph.path.toPathData(2);
    const bb = glyph.path.getBoundingBox();
    const bbox = {
      x1: Math.round(bb.x1 * 100) / 100,
      y1: Math.round(bb.y1 * 100) / 100,
      x2: Math.round(bb.x2 * 100) / 100,
      y2: Math.round(bb.y2 * 100) / 100,
    };
    entries.push({ ...spec, d, bbox });
  }

  const lines = [
    '/**',
    ' * SMuFL 標準樂譜字形輪廓資料（由 tools/extract-glyphs.mjs 自動產生，請勿手動編輯）',
    ' *',
    ` * 字型來源：Bravura v${BRAVURA_VERSION} (${DEFAULT_FONT_URL})`,
    ' * 授權聲明：Bravura © Steinberg Media Technologies GmbH, SIL Open Font License 1.1',
    ' * 授權全文請見專案根目錄 THIRD_PARTY_LICENSES.md',
    ' *',
    ' * 座標慣例（SMuFL 標準）：',
    ' * - 1 em (unitsPerEm) = 4 個五線譜線距',
    ' * - 字形原點 (0, 0) 位於基準線上（例如高音譜號在 G4 線、低音譜號在 F3 線）',
    ' * - y 軸向上為正；繪製於 SVG 時需搭配 scale(s, -s) 翻轉垂直方向',
    ' */',
    '',
    'export interface GlyphBBox {',
    '  readonly x1: number;',
    '  readonly y1: number;',
    '  readonly x2: number;',
    '  readonly y2: number;',
    '}',
    '',
    'export interface MusicGlyph {',
    '  readonly d: string;',
    '  readonly unitsPerEm: number;',
    '  readonly bbox: GlyphBBox;',
    '}',
    '',
  ];

  for (const e of entries) {
    const hex = e.codePoint.toString(16).toUpperCase().padStart(4, '0');
    lines.push(`/** ${e.label}（U+${hex} ${e.name}） */`);
    lines.push(`export const ${e.name}: MusicGlyph = {`);
    lines.push(`  d: ${JSON.stringify(e.d)},`);
    lines.push(`  unitsPerEm: ${unitsPerEm},`);
    lines.push(
      `  bbox: { x1: ${e.bbox.x1}, y1: ${e.bbox.y1}, x2: ${e.bbox.x2}, y2: ${e.bbox.y2} },`,
    );
    lines.push('};');
    lines.push('');
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(__dirname, '../src/ui/musicGlyphs.ts');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`已寫入 ${outPath}（unitsPerEm=${unitsPerEm}，共 ${entries.length} 個字形）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
