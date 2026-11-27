import { noteName } from '../core/notes';

/**
 * 畫面顯示用音名：採 Yamaha／多數 MIDI 軟體慣例，中央 Do（MIDI 60）＝ C3。
 * 只影響文字，不影響任何音高計算（內部一律用 MIDI 編號）。
 */
export function displayNoteName(midi: number): string {
  const sci = noteName(midi); // 科學音名，中央 Do = C4
  const m = sci.match(/^(.*?)(-?\d+)$/);
  if (!m) return sci;
  return `${m[1]}${Number(m[2]) - 1}`;
}
