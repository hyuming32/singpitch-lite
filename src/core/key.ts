export type KeyMode = 'major' | 'minor';

export interface Key {
  tonicPc: number;
  mode: KeyMode;
}

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface SpelledNote {
  letter: Letter;
  /** 升降記號：-2 = 𝄫, -1 = ♭, 0 = ♮, 1 = ♯, 2 = 𝄪 */
  accidental: number;
  octave: number;
}

export interface KeySignature {
  type: 'sharp' | 'flat' | 'none';
  count: number;
}

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const NATURAL_PC: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

const MAJOR_TONIC_NAMES = [
  'C',
  'D♭',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
] as const;

const MINOR_TONIC_NAMES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'G♯',
  'A',
  'B♭',
  'B',
] as const;

const MAJOR_TONIC_SPELLING: readonly (readonly [number, number])[] = [
  [0, 0],  // C
  [1, -1], // D♭
  [1, 0],  // D
  [2, -1], // E♭
  [2, 0],  // E
  [3, 0],  // F
  [3, 1],  // F♯
  [4, 0],  // G
  [5, -1], // A♭
  [5, 0],  // A
  [6, -1], // B♭
  [6, 0],  // B
];

const MINOR_TONIC_SPELLING: readonly (readonly [number, number])[] = [
  [0, 0],  // C
  [0, 1],  // C♯
  [1, 0],  // D
  [2, -1], // E♭
  [2, 0],  // E
  [3, 0],  // F
  [3, 1],  // F♯
  [4, 0],  // G
  [4, 1],  // G♯
  [5, 0],  // A
  [6, -1], // B♭
  [6, 0],  // B
];

const MAJOR_SIG: readonly KeySignature[] = [
  { type: 'none', count: 0 },  // C
  { type: 'flat', count: 5 },  // D♭
  { type: 'sharp', count: 2 }, // D
  { type: 'flat', count: 3 },  // E♭
  { type: 'sharp', count: 4 }, // E
  { type: 'flat', count: 1 },  // F
  { type: 'sharp', count: 6 }, // F♯
  { type: 'sharp', count: 1 }, // G
  { type: 'flat', count: 4 },  // A♭
  { type: 'sharp', count: 3 }, // A
  { type: 'flat', count: 2 },  // B♭
  { type: 'sharp', count: 5 }, // B
];

const MINOR_SIG: readonly KeySignature[] = [
  { type: 'flat', count: 3 },  // C
  { type: 'sharp', count: 4 }, // C♯
  { type: 'flat', count: 1 },  // D
  { type: 'flat', count: 6 },  // E♭
  { type: 'sharp', count: 1 }, // E
  { type: 'flat', count: 4 },  // F
  { type: 'sharp', count: 3 }, // F♯
  { type: 'flat', count: 2 },  // G
  { type: 'sharp', count: 5 }, // G♯
  { type: 'none', count: 0 },  // A
  { type: 'flat', count: 5 },  // B♭
  { type: 'sharp', count: 2 }, // B
];

export const MAJOR_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
export const MINOR_SEMITONES = [0, 2, 3, 5, 7, 8, 10] as const;

function normPc(pc: number): number {
  return ((Math.round(pc) % 12) + 12) % 12;
}

/** 取得調性中文名稱，例如「D 大調」、「A 小調」、「B♭ 大調」 */
export function keyName(key: Key): string {
  const pc = normPc(key.tonicPc);
  const name =
    key.mode === 'major'
      ? (MAJOR_TONIC_NAMES[pc] ?? 'C')
      : (MINOR_TONIC_NAMES[pc] ?? 'C');
  return `${name} ${key.mode === 'major' ? '大調' : '小調'}`;
}

/** 取得調號資訊（升／降／無記號與記號數量） */
export function keySignature(key: Key): KeySignature {
  const pc = normPc(key.tonicPc);
  const sig = key.mode === 'major' ? MAJOR_SIG[pc] : MINOR_SIG[pc];
  return sig ?? { type: 'none', count: 0 };
}

/** 取得主音的字母索引（0=C..6=B） */
export function tonicLetterIndex(key: Key): number {
  const pc = normPc(key.tonicPc);
  const pair =
    key.mode === 'major' ? MAJOR_TONIC_SPELLING[pc] : MINOR_TONIC_SPELLING[pc];
  return pair ? pair[0] : 0;
}

/** 計算某字母在給定目標半音類別時所需的升降記號（-2..2） */
function accidentalForPc(letterIdx: number, targetPc: number): number {
  const nat = NATURAL_PC[letterIdx] ?? 0;
  return ((targetPc - nat + 18) % 12) - 6;
}

/** 取得該調自然音階 7 個音的字母索引與升降記號 */
export function diatonicScaleSpelling(
  key: Key,
): { letterIdx: number; accidental: number; pc: number }[] {
  const tonicPc = normPc(key.tonicPc);
  const startLetter = tonicLetterIndex(key);
  const intervals = key.mode === 'major' ? MAJOR_SEMITONES : MINOR_SEMITONES;
  return intervals.map((semi, degree) => {
    const letterIdx = (startLetter + degree) % 7;
    const pc = (tonicPc + semi) % 12;
    return {
      letterIdx,
      accidental: accidentalForPc(letterIdx, pc),
      pc,
    };
  });
}

function buildSpelled(
  midi: number,
  letterIdx: number,
  accidental: number,
): SpelledNote {
  const letter = LETTERS[letterIdx] ?? 'C';
  // 八度依字母計，扣除升降記號後取 C-based 八度（例：B♯3 → 60-1=59 → 八度 3）
  const octave = Math.floor((midi - accidental) / 12) - 1;
  return { letter, accidental, octave };
}

/** 依調性拼出 MIDI 音高的音名、升降記號與八度 */
export function spell(midi: number, key: Key): SpelledNote {
  const m = Math.round(midi);
  const pc = normPc(m);
  const tonicPc = normPc(key.tonicPc);
  const scale = diatonicScaleSpelling(key);

  // 1. 屬於自然音階的音，直接採用調號拼法
  const diatonic = scale.find((s) => s.pc === pc);
  if (diatonic) {
    return buildSpelled(m, diatonic.letterIdx, diatonic.accidental);
  }

  // 2. 小調第 6、7 級升高音（+9、+11 半音）：把自然小音階第 6、7 級字母升半音
  if (key.mode === 'minor') {
    const rel = (pc - tonicPc + 12) % 12;
    if (rel === 9) {
      const deg6 = scale[5]!;
      return buildSpelled(m, deg6.letterIdx, deg6.accidental + 1);
    }
    if (rel === 11) {
      const deg7 = scale[6]!;
      return buildSpelled(m, deg7.letterIdx, deg7.accidental + 1);
    }
  }

  // 3. 其他變化音：白鍵優先拼為本位音；黑鍵依調號方向拼為升或降
  const natIdx = NATURAL_PC.indexOf(pc);
  if (natIdx !== -1) {
    return buildSpelled(m, natIdx, 0);
  }

  const sig = keySignature(key);
  if (sig.type === 'flat') {
    const aboveIdx = NATURAL_PC.indexOf((pc + 1) % 12);
    return buildSpelled(m, aboveIdx, -1);
  }
  const belowIdx = NATURAL_PC.indexOf((pc + 11) % 12);
  return buildSpelled(m, belowIdx, 1);
}

/** 將升降記號數字轉為符號字串 */
export function accidentalSymbol(accidental: number): '' | '♯' | '♭' | '♮' | '𝄪' | '𝄫' {
  switch (accidental) {
    case -2:
      return '𝄫';
    case -1:
      return '♭';
    case 0:
      return '♮';
    case 1:
      return '♯';
    case 2:
      return '𝄪';
    default:
      return '';
  }
}
