/** 鋼琴幾何比例常數（以白鍵中心距 W = 1.0 為基準） */
export const WHITE_GAP = 0.04;
export const BLACK_WIDTH = 0.52;
export const BLACK_TOP_WIDTH = 0.45;
export const BLACK_LENGTH_RATIO = 0.63;

/** 完整 88 鍵範圍：A0 (21) 至 C8 (108) */
export const FULL_PIANO_LOW_MIDI = 21;
export const FULL_PIANO_HIGH_MIDI = 108;

/** 黑鍵中心相對於該八度 C 左緣的距離（以 W 為單位，禁止全部置中） */
export const BLACK_KEY_CENTERS: Readonly<Record<number, number>> = {
  1: 0.92, // C♯ / D♭
  3: 2.08, // D♯ / E♭
  6: 3.90, // F♯ / G♭
  8: 5.00, // G♯ / A♭
  10: 6.10, // A♯ / B♭
};

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** 判斷 MIDI 音高是否為黑鍵 */
export function isBlackMidi(midi: number): boolean {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return BLACK_PITCH_CLASSES.has(pc);
}

export type PianoPresetName = 'real' | 'korg' | 'tablet';

export interface PianoPresetSpec {
  aspectRatio: number;
  blackWidth: number;
  blackTopWidth: number;
  blackLengthRatio: number;
}

/** 鋼琴尺寸比例 presets */
export const PIANO_PRESETS: Readonly<Record<PianoPresetName, PianoPresetSpec>> = {
  real: {
    aspectRatio: 6.38,
    blackWidth: BLACK_WIDTH,
    blackTopWidth: BLACK_TOP_WIDTH,
    blackLengthRatio: BLACK_LENGTH_RATIO,
  },
  korg: {
    aspectRatio: 3.1,
    blackWidth: 0.50,
    blackTopWidth: 0.43,
    blackLengthRatio: 0.62,
  },
  tablet: {
    aspectRatio: 4.6,
    blackWidth: BLACK_WIDTH,
    blackTopWidth: BLACK_TOP_WIDTH,
    blackLengthRatio: BLACK_LENGTH_RATIO,
  },
};

export interface WhiteKeyLayout {
  midi: number;
  x: number;
  w: number;
  len: number;
}

export interface BlackKeyLayout {
  midi: number;
  x: number;
  w: number;
  len: number;
  topW: number;
}

export interface KeyboardLayout {
  lowMidi: number;
  highMidi: number;
  W: number;
  preset: PianoPresetName;
  whites: WhiteKeyLayout[];
  blacks: BlackKeyLayout[];
  totalWidth: number;
  theoreticalWhiteLen: number;
  whiteLen: number;
  blackLen: number;
}

export interface LayoutKeyboardOptions {
  lowMidi?: number;
  highMidi?: number;
  W?: number;
  preset?: PianoPresetName;
  /** 容器可用高度（若小於理論白鍵長，從白鍵前端裁掉並限制黑鍵長度） */
  height?: number;
}

/** 計算目標 C 音相對於 lowMidi 的白鍵格數偏移（可為負，用於 A0 等非 C 起點） */
function whiteOffsetOfC(lowMidi: number, cMidi: number): number {
  let count = 0;
  if (cMidi >= lowMidi) {
    for (let m = lowMidi; m < cMidi; m++) {
      if (!isBlackMidi(m)) count++;
    }
  } else {
    for (let m = cMidi; m < lowMidi; m++) {
      if (!isBlackMidi(m)) count--;
    }
  }
  return count;
}

/** 依真實鋼琴幾何比例計算每個白鍵與黑鍵的座標與尺寸 */
export function layoutKeyboard(
  options: LayoutKeyboardOptions = {},
): KeyboardLayout {
  const {
    lowMidi = FULL_PIANO_LOW_MIDI,
    highMidi = FULL_PIANO_HIGH_MIDI,
    W = 1.0,
    preset = 'real',
    height,
  } = options;

  const spec = PIANO_PRESETS[preset];
  const theoreticalWhiteLen = spec.aspectRatio * W;
  const whiteLen =
    height !== undefined && Number.isFinite(height)
      ? Math.max(0, Math.min(theoreticalWhiteLen, height))
      : theoreticalWhiteLen;

  const rawBlackLen = spec.blackLengthRatio * theoreticalWhiteLen;
  const blackLen =
    height !== undefined && Number.isFinite(height)
      ? Math.max(0, Math.min(rawBlackLen, 0.75 * height))
      : rawBlackLen;

  const gapPx = WHITE_GAP * W;
  const whiteDrawW = (1 - WHITE_GAP) * W;
  const blackDrawW = spec.blackWidth * W;
  const blackTopW = spec.blackTopWidth * W;

  const whites: WhiteKeyLayout[] = [];
  const blacks: BlackKeyLayout[] = [];

  for (let m = lowMidi; m <= highMidi; m++) {
    if (!isBlackMidi(m)) {
      const slotIdx = whites.length;
      whites.push({
        midi: m,
        x: slotIdx * W + gapPx / 2,
        w: whiteDrawW,
        len: whiteLen,
      });
    } else {
      const pc = ((m % 12) + 12) % 12;
      const centerRatio = BLACK_KEY_CENTERS[pc]!;
      const cMidi = m - pc;
      const octaveStart = whiteOffsetOfC(lowMidi, cMidi) * W;
      const x = octaveStart + centerRatio * W - blackDrawW / 2;
      blacks.push({
        midi: m,
        x,
        w: blackDrawW,
        len: blackLen,
        topW: blackTopW,
      });
    }
  }

  return {
    lowMidi,
    highMidi,
    W,
    preset,
    whites,
    blacks,
    totalWidth: whites.length * W,
    theoreticalWhiteLen,
    whiteLen,
    blackLen,
  };
}

/** 命中測試：y 在黑鍵長度內且 x 在黑鍵範圍時優先回傳黑鍵，否則回傳白鍵或 null */
export function keyAt(
  x: number,
  y: number,
  layout: KeyboardLayout,
): number | null {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    x > layout.totalWidth ||
    y < 0 ||
    y > layout.whiteLen
  ) {
    return null;
  }

  for (const bk of layout.blacks) {
    if (y <= bk.len && x >= bk.x && x <= bk.x + bk.w) {
      return bk.midi;
    }
  }

  for (const wk of layout.whites) {
    if (y <= wk.len && x >= wk.x && x <= wk.x + wk.w) {
      return wk.midi;
    }
  }

  // 若落在白鍵間細縫，對應至所屬白鍵格避免觸控死角
  const slotIdx = Math.min(
    layout.whites.length - 1,
    Math.max(0, Math.floor(x / layout.W)),
  );
  return layout.whites[slotIdx]?.midi ?? null;
}

/** 取得整數 MIDI 音鍵的水平中心 x 座標 */
function integerKeyCenterX(midi: number, layout: KeyboardLayout): number | null {
  const rounded = Math.round(midi);
  if (!isBlackMidi(rounded)) {
    const wk = layout.whites.find((w) => w.midi === rounded);
    return wk ? wk.x + wk.w / 2 : null;
  }
  const bk = layout.blacks.find((b) => b.midi === rounded);
  return bk ? bk.x + bk.w / 2 : null;
}

/** 依浮點 MIDI 音高內插計算黃色指針的水平 x 座標（px） */
export function needleXForMidi(
  midiFloat: number,
  layout: KeyboardLayout,
): number | null {
  if (!Number.isFinite(midiFloat)) {
    return null;
  }
  if (midiFloat < layout.lowMidi - 0.5 || midiFloat > layout.highMidi + 0.5) {
    return null;
  }

  const clamped = Math.max(layout.lowMidi, Math.min(layout.highMidi, midiFloat));
  const m0 = Math.floor(clamped);
  const m1 = Math.ceil(clamped);

  const x0 = integerKeyCenterX(m0, layout);
  if (x0 === null) return null;
  if (m0 === m1) return x0;

  const x1 = integerKeyCenterX(m1, layout);
  if (x1 === null) return x0;

  const frac = clamped - m0;
  return x0 * (1 - frac) + x1 * frac;
}
