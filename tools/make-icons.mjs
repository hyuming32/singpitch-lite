import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BG = [0x17, 0x1b, 0x24]; // #171b24
const FG = [0x4c, 0xa4, 0xff]; // #4ca4ff

// 預先計算 CRC32 查表以產生標準 PNG chunk
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq)) : 0;
  const cx = x1 + t * vx;
  const cy = y1 + t * vy;
  return Math.hypot(px - cx, py - cy);
}

/** 在正規化座標 (-1..1) 中計算八分音符的距離場（回傳像素混合比例 0..1） */
function noteCoverage(nx, ny, scale) {
  const x = nx / scale;
  const y = ny / scale;

  // 傾斜橢圓符頭（左下）
  const hx = x + 0.16;
  const hy = y - 0.34;
  const cos = Math.cos(-0.35);
  const sin = Math.sin(-0.35);
  const rx = hx * cos - hy * sin;
  const ry = hx * sin + hy * cos;
  const headDist = (Math.hypot(rx / 0.25, ry / 0.17) - 1) * 0.19;

  // 垂直符桿（右側向上）
  const stemDist = distToSegment(x, y, 0.055, 0.32, 0.055, -0.52) - 0.055;

  // 符尾旗幟（上端往右下彎）
  const flag1 = distToSegment(x, y, 0.055, -0.52, 0.36, -0.28) - 0.05;
  const flag2 = distToSegment(x, y, 0.36, -0.28, 0.31, -0.02) - 0.042;

  const minDist = Math.min(headDist, stemDist, flag1, flag2);
  // 抗鋸齒羽化
  return Math.max(0, Math.min(1, 0.5 - minDist * 26));
}

function renderIcon(size, maskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.68 : 0.86;
  for (let y = 0; y < size; y++) {
    const ny = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const alpha = noteCoverage(nx, ny, scale);
      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(BG[0] * (1 - alpha) + FG[0] * alpha);
      buf[idx + 1] = Math.round(BG[1] * (1 - alpha) + FG[1] * alpha);
      buf[idx + 2] = Math.round(BG[2] * (1 - alpha) + FG[2] * alpha);
      buf[idx + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

const outDir = path.resolve('public');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), renderIcon(192, false));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), renderIcon(512, false));
fs.writeFileSync(
  path.join(outDir, 'icon-512-maskable.png'),
  renderIcon(512, true),
);
fs.writeFileSync(
  path.join(outDir, 'apple-touch-icon.png'),
  renderIcon(180, false),
);
console.log('Generated PWA icons in public/');
