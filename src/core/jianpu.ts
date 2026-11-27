import {
  LETTERS,
  MAJOR_SEMITONES,
  accidentalSymbol,
  spell,
  tonicLetterIndex,
  type Key,
} from './key';

export type JianpuMode = 'fixed' | 'movable';

export type JianpuAccidental = '' | '♯' | '♭' | '♮' | '𝄪' | '𝄫';

export interface JianpuNote {
  digit: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '0';
  accidental: JianpuAccidental;
  /** 八度偏移：正數為上加點數，負數為下加點數 */
  octave: number;
}

const SOLFEGE_NAMES = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'] as const;

function normPc(pc: number): number {
  return ((Math.round(pc) % 12) + 12) % 12;
}

/** 將簡譜音符格式化為字串（升降記號置於數字前，不含八度點），例："♯4" */
export function formatJianpu(note: JianpuNote): string {
  return `${note.accidental}${note.digit}`;
}

/** 將 MIDI 音高轉換為簡譜音符（支援固定調與首調） */
export function toJianpu(
  midi: number,
  key: Key,
  mode: JianpuMode = 'fixed',
  refTonicMidi?: number,
): JianpuNote {
  const m = Math.round(midi);
  const spelled = spell(m, key);
  const letterIdx = LETTERS.indexOf(spelled.letter);

  if (mode === 'fixed') {
    const digit = String(letterIdx + 1) as JianpuNote['digit'];
    const accidental: JianpuAccidental =
      spelled.accidental === 0 ? '' : accidentalSymbol(spelled.accidental);
    return {
      digit,
      accidental,
      octave: spelled.octave - 4,
    };
  }

  // 首調：主音 = 1，依字母距離算級數
  const startLetter = tonicLetterIndex(key);
  const degree = (letterIdx - startLetter + 7) % 7;
  const digit = String(degree + 1) as JianpuNote['digit'];

  // 升降記號相對於「主音大音階同級音」的半音差
  const pc = normPc(m);
  const majorDegreePc =
    (normPc(key.tonicPc) + (MAJOR_SEMITONES[degree] ?? 0)) % 12;
  const diff = ((pc - majorDegreePc + 18) % 12) - 6;
  const accidental: JianpuAccidental = diff === 0 ? '' : accidentalSymbol(diff);

  // 八度以參考主音所在八度為基準，依字母級數差除以 7 向下取整
  const step = letterIdx + 7 * spelled.octave;
  let refStep: number;
  if (refTonicMidi !== undefined) {
    const refSpelled = spell(refTonicMidi, key);
    refStep = LETTERS.indexOf(refSpelled.letter) + 7 * refSpelled.octave;
  } else {
    refStep = startLetter + 7 * 4;
  }
  const octave = Math.floor((step - refStep) / 7);

  return { digit, accidental, octave };
}

/** 取得唱名（例：「Do」、「升Fa」、「降Ti」） */
export function solfegeName(
  midi: number,
  key: Key,
  mode: JianpuMode = 'fixed',
): string {
  const jp = toJianpu(midi, key, mode);
  if (jp.digit === '0') {
    return '';
  }
  const idx = Number(jp.digit) - 1;
  const base = SOLFEGE_NAMES[idx] ?? 'Do';
  let prefix = '';
  switch (jp.accidental) {
    case '♯':
      prefix = '升';
      break;
    case '♭':
      prefix = '降';
      break;
    case '𝄪':
      prefix = '重升';
      break;
    case '𝄫':
      prefix = '重降';
      break;
    default:
      prefix = '';
  }
  return `${prefix}${base}`;
}
