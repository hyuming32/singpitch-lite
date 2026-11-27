import { noteName } from '../core/notes';

export interface DisplayNoteOptions {
  /** 預留顯示選項（例：升降記號格式或八度基準） */
  accidentalStyle?: 'sharp';
}

/**
 * 畫面顯示用音名：採國際科學音名標準，中央 Do（MIDI 60）＝ C4。
 * 只影響文字，不影響任何音高計算（內部一律用 MIDI 編號）。
 */
export function displayNoteName(
  midi: number,
  _options?: DisplayNoteOptions,
): string {
  return noteName(midi);
}
