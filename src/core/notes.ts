/** 預設標準音高 A4 頻率（Hz） */
export const A4_DEFAULT = 440;

/** 十二平均律音名表（以升記號表示） */
export const NOTE_NAMES = [
  'C',
  'C♯',
  'D',
  'D♯',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'A♯',
  'B',
] as const;

/** 預設人聲音域（MIDI 編號 [最低, 最高]） */
export const RANGES: Record<string, readonly [number, number]> = {
  '完整 C2–C6': [36, 84],
  男低音: [40, 64],
  男中音: [45, 65],
  男高音: [48, 72],
  女低音: [53, 77],
  女中音: [57, 81],
  女高音: [60, 84],
};

/** 將 MIDI 音高轉換為頻率（Hz） */
export function midiToHz(midi: number, a4: number = A4_DEFAULT): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** 將頻率（Hz）轉換為 MIDI 音高；若 hz <= 0 或非有限數則回傳 NaN */
export function hzToMidi(hz: number, a4: number = A4_DEFAULT): number {
  if (!(hz > 0) || !Number.isFinite(hz)) {
    return NaN;
  }
  return 69 + 12 * Math.log2(hz / a4);
}

/** 計算偵測頻率與目標 MIDI 音高之間的分差（cents） */
export function centsBetween(
  hz: number,
  targetMidi: number,
  a4: number = A4_DEFAULT,
): number {
  if (!(hz > 0) || !Number.isFinite(hz)) {
    return NaN;
  }
  return 1200 * Math.log2(hz / midiToHz(targetMidi, a4));
}

/** 將 MIDI 音高轉為音名與八度字串（四捨五入至最近整數），例：61 → "C♯4" */
export function noteName(midi: number): string {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  const name = NOTE_NAMES[pc] ?? 'C';
  return `${name}${octave}`;
}
