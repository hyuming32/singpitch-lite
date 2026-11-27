import {
  LETTERS,
  NATURAL_PC,
  accidentalSymbol,
  tonicLetterIndex,
  type Key,
} from './key';

export interface ParsedRoman {
  /** 相對主音的半音位移（以主音大音階為準，含升降前綴） */
  degreeSemitone: number;
  /** 音階級數 0..6 */
  degreeIndex: number;
  /** 組成音相對於和弦根音的半音間隔 */
  intervals: number[];
  /** 和弦名稱後綴（'', 'm', '7', 'm7', '°'） */
  suffix: string;
  /** 是否為小寫羅馬數字（小和弦／減和弦） */
  isMinor: boolean;
}

const ROMAN_DEGREE_MAP: Record<string, { index: number; semi: number }> = {
  I: { index: 0, semi: 0 },
  II: { index: 1, semi: 2 },
  III: { index: 2, semi: 4 },
  IV: { index: 3, semi: 5 },
  V: { index: 4, semi: 7 },
  VI: { index: 5, semi: 9 },
  VII: { index: 6, semi: 11 },
};

/** 解析羅馬數字和弦記號（例：I, ii, V7, vii°, ♭VI, bVII） */
export function parseRoman(roman: string): ParsedRoman {
  const trimmed = roman.trim();
  if (!trimmed) {
    throw new Error('和弦記號不可為空');
  }

  const match = /^([b♭#♯]?)(VII|III|VI|IV|II|V|I|vii|iii|vi|iv|ii|v|i)(°?)(7?)$/.exec(
    trimmed,
  );
  if (!match) {
    throw new Error(`無法辨識和弦記號「${roman}」`);
  }

  const [, prefix, numeral, dim, seventh] = match;
  if (!numeral) {
    throw new Error(`無法辨識和弦記號「${roman}」`);
  }

  const upper = numeral.toUpperCase();
  const deg = ROMAN_DEGREE_MAP[upper];
  if (!deg) {
    throw new Error(`無法辨識和弦級數「${numeral}」`);
  }

  let accOffset = 0;
  if (prefix === 'b' || prefix === '♭') {
    accOffset = -1;
  } else if (prefix === '#' || prefix === '♯') {
    accOffset = 1;
  }

  const isLower = numeral === numeral.toLowerCase();
  const isDim = dim === '°';
  const has7 = seventh === '7';

  if (isDim && has7) {
    throw new Error(`不支援減七／半減七記號「${roman}」`);
  }

  let intervals: number[];
  let suffix: string;
  if (isDim) {
    intervals = [0, 3, 6];
    suffix = '°';
  } else if (isLower) {
    intervals = has7 ? [0, 3, 7, 10] : [0, 3, 7];
    suffix = has7 ? 'm7' : 'm';
  } else {
    intervals = has7 ? [0, 4, 7, 10] : [0, 4, 7];
    suffix = has7 ? '7' : '';
  }

  return {
    degreeSemitone: (deg.semi + accOffset + 12) % 12,
    degreeIndex: deg.index,
    intervals,
    suffix,
    isMinor: isLower,
  };
}

/** 計算和弦在指定調性中的半音類別陣列（根音在第一個） */
export function chordPitchClasses(roman: string, key: Key): number[] {
  const parsed = parseRoman(roman);
  const tonicPc = ((Math.round(key.tonicPc) % 12) + 12) % 12;
  const rootPc = (tonicPc + parsed.degreeSemitone) % 12;
  return parsed.intervals.map((iv) => (rootPc + iv) % 12);
}

/** 取得和弦在指定調性中的名稱（例："G7"、"Am"、"E♭"、"C♯°"） */
export function chordName(roman: string, key: Key): string {
  const parsed = parseRoman(roman);
  const tonicPc = ((Math.round(key.tonicPc) % 12) + 12) % 12;
  const rootPc = (tonicPc + parsed.degreeSemitone) % 12;
  const letterIdx = (tonicLetterIndex(key) + parsed.degreeIndex) % 7;
  const letter = LETTERS[letterIdx] ?? 'C';
  const natPc = NATURAL_PC[letterIdx] ?? 0;
  const diff = ((rootPc - natPc + 18) % 12) - 6;
  const acc = diff === 0 ? '' : accidentalSymbol(diff);
  return `${letter}${acc}${parsed.suffix}`;
}
