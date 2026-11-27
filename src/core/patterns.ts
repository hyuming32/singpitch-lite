import { MAJOR_SEMITONES } from './key';

export interface PatternEvent {
  /** 相對主音的半音數；null 代表休止符 */
  semitone: number | null;
  beats: number;
  glideToNext: boolean;
}

export interface ParsedPattern {
  events: PatternEvent[];
  staccato: boolean;
}

export interface PatternDef {
  id: string;
  name: string;
  category: string;
  jianpu: string;
  /** 以空白分隔的羅馬數字和弦，平均分配於整個圖案長度上 */
  chords: string;
  glide?: boolean;
}

export class JianpuParseError extends Error {
  readonly index: number;

  constructor(message: string, index: number) {
    super(message);
    this.name = 'JianpuParseError';
    this.index = index;
  }
}

function parseNoteToken(token: string, tokenIndex: number): number {
  const match = /^([b♭#♯]?)([1-7])([']*|[,]*)$/.exec(token);
  if (!match) {
    if (/^[b♭#♯]?[089]/.test(token) || /^[b♭#♯]?\d+/.test(token)) {
      throw new JianpuParseError(
        `第 ${tokenIndex} 個符號「${token}」無法辨識，請用 1–7`,
        tokenIndex,
      );
    }
    throw new JianpuParseError(
      `第 ${tokenIndex} 個符號「${token}」無法辨識`,
      tokenIndex,
    );
  }

  const [, acc, degStr, octStr] = match;
  const deg = Number(degStr) - 1;
  let semi = MAJOR_SEMITONES[deg] ?? 0;

  if (acc === 'b' || acc === '♭') {
    semi -= 1;
  } else if (acc === '#' || acc === '♯') {
    semi += 1;
  }

  if (octStr) {
    if (octStr.startsWith("'")) {
      semi += octStr.length * 12;
    } else if (octStr.startsWith(',')) {
      semi -= octStr.length * 12;
    }
  }

  return semi;
}

/** 解析簡譜字串為音符事件序列 */
export function parseJianpu(text: string): ParsedPattern {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new JianpuParseError('簡譜不可為空', 1);
  }

  const rawTokens = trimmed.split(/[\s\u3000]+/);
  let staccato = false;
  if (rawTokens[rawTokens.length - 1] === '.') {
    staccato = true;
    rawTokens.pop();
    if (rawTokens.length === 0) {
      throw new JianpuParseError('簡譜不可只有跳音記號「.」', 1);
    }
  }

  const events: PatternEvent[] = [];
  let pendingGlide = false;

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i]!;
    const tokenIndex = i + 1;

    if (tok === '~') {
      const prev = events[events.length - 1];
      if (!prev || pendingGlide || prev.semitone === null) {
        throw new JianpuParseError(
          `第 ${tokenIndex} 個符號「~」前必須為音符`,
          tokenIndex,
        );
      }
      prev.glideToNext = true;
      pendingGlide = true;
      continue;
    }

    if (tok === '-') {
      if (pendingGlide) {
        throw new JianpuParseError(
          `第 ${tokenIndex} 個符號「-」不能接在「~」之後`,
          tokenIndex,
        );
      }
      const prev = events[events.length - 1];
      if (!prev) {
        throw new JianpuParseError('第 1 個符號不能是延長記號「-」', 1);
      }
      prev.beats += 1;
      continue;
    }

    if (tok.includes('~')) {
      if (pendingGlide) {
        throw new JianpuParseError(
          `第 ${tokenIndex} 個符號「${tok}」不能連續使用「~」`,
          tokenIndex,
        );
      }
      const parts = tok.split('~');
      if (parts.some((p) => p === '')) {
        throw new JianpuParseError(
          `第 ${tokenIndex} 個符號「${tok}」滑音格式錯誤`,
          tokenIndex,
        );
      }
      for (let k = 0; k < parts.length; k++) {
        const semi = parseNoteToken(parts[k]!, tokenIndex);
        events.push({
          semitone: semi,
          beats: 1,
          glideToNext: k < parts.length - 1,
        });
      }
      pendingGlide = false;
      continue;
    }

    if (tok === '0') {
      if (pendingGlide) {
        throw new JianpuParseError(
          `第 ${tokenIndex} 個符號「0」不能作為滑音終點`,
          tokenIndex,
        );
      }
      events.push({ semitone: null, beats: 1, glideToNext: false });
      pendingGlide = false;
      continue;
    }

    const semi = parseNoteToken(tok, tokenIndex);
    events.push({ semitone: semi, beats: 1, glideToNext: false });
    pendingGlide = false;
  }

  if (pendingGlide) {
    throw new JianpuParseError(
      '簡譜不能以滑音記號「~」結尾',
      rawTokens.length,
    );
  }

  return { events, staccato };
}

/** 內建練唱圖案庫 */
export const BUILTIN_PATTERNS: readonly PatternDef[] = [
  // 五聲
  {
    id: 'five-tone-updown',
    name: '五聲上下行',
    category: '五聲',
    jianpu: '1 2 3 5 6 5 3 2 1',
    chords: 'I',
  },
  {
    id: 'five-note-updown',
    name: '五音上下行',
    category: '五聲',
    jianpu: '1 2 3 4 5 4 3 2 1',
    chords: 'I',
  },
  {
    id: 'three-note',
    name: '三音來回',
    category: '五聲',
    jianpu: '1 2 3 2 1',
    chords: 'I',
  },
  {
    id: 'five-note-desc',
    name: '五音下行',
    category: '五聲',
    jianpu: '5 4 3 2 1 -',
    chords: 'I',
  },
  {
    id: 'five-note-repeat',
    name: '五音高點重複',
    category: '五聲',
    jianpu: '1 2 3 4 5 5 5 5 4 3 2 1',
    chords: 'I',
  },
  {
    id: 'pentatonic-desc-run',
    name: '五聲下行轉音',
    category: '五聲',
    jianpu: "1' 6 5 3 2 1 -",
    chords: 'I',
  },
  // 大調
  {
    id: 'major-scale',
    name: '完整大調上下行',
    category: '大調',
    jianpu: "1 2 3 4 5 6 7 1' 7 6 5 4 3 2 1",
    chords: 'I IV I V I',
  },
  {
    id: 'major-desc',
    name: '大調下行',
    category: '大調',
    jianpu: "1' 7 6 5 4 3 2 1 -",
    chords: 'I',
  },
  {
    id: 'ninth-scale',
    name: '九度音階',
    category: '大調',
    jianpu: "1 3 5 1' 2' 1' 7 6 5 4 3 2 1",
    chords: 'I',
  },
  {
    id: 'tenth-scale',
    name: '十度延伸音階',
    category: '大調',
    jianpu: "1 2 3 4 5 6 7 1' 2' 3' 2' 1' 7 6 5 4 3 2 1",
    chords: 'I',
  },
  {
    id: 'third-sequence',
    name: '三度模進音階',
    category: '大調',
    jianpu: '1 3 2 4 3 5 4 6 5 3 1',
    chords: 'I',
  },
  // 小調
  {
    id: 'natural-minor',
    name: '自然小調',
    category: '小調',
    jianpu: "1 2 b3 4 5 b6 b7 1' b7 b6 5 4 b3 2 1",
    chords: 'i',
  },
  {
    id: 'harmonic-minor',
    name: '和聲小調',
    category: '小調',
    jianpu: "1 2 b3 4 5 b6 7 1' 7 b6 5 4 b3 2 1",
    chords: 'i iv i V i',
  },
  {
    id: 'melodic-minor',
    name: '旋律小調',
    category: '小調',
    jianpu: "1 2 b3 4 5 6 7 1' b7 b6 5 4 b3 2 1",
    chords: 'i',
  },
  {
    id: 'minor-five',
    name: '小調五音',
    category: '小調',
    jianpu: '1 2 b3 4 5 4 b3 2 1',
    chords: 'i',
  },
  {
    id: 'blues-scale',
    name: '藍調音階',
    category: '小調',
    jianpu: "1 b3 4 #4 5 b7 1' b7 5 #4 4 b3 1",
    chords: 'i',
  },
  // 跳音／琶音
  {
    id: 'fifth-leap',
    name: '五度跳躍',
    category: '跳音／琶音',
    jianpu: '1 5 1',
    chords: 'I',
  },
  {
    id: 'octave-leap',
    name: '八度跳躍',
    category: '跳音／琶音',
    jianpu: "1 1' 1",
    chords: 'I',
  },
  {
    id: 'major-arpeggio',
    name: '大三和弦分解',
    category: '跳音／琶音',
    jianpu: "1 3 5 1' 5 3 1",
    chords: 'I',
  },
  {
    id: 'major-triad-desc',
    name: '大三和弦下行',
    category: '跳音／琶音',
    jianpu: "1' 5 3 1 -",
    chords: 'I',
  },
  {
    id: 'major-arp-repeat',
    name: '八度琶音高音維持',
    category: '跳音／琶音',
    jianpu: "1 3 5 1' 1' 1' 5 3 1",
    chords: 'I',
  },
  {
    id: 'rossini-arp',
    name: '十二度羅西尼琶音',
    category: '跳音／琶音',
    jianpu: "1 3 5 1' 3' 1' 5 3 1",
    chords: 'I',
  },
  {
    id: 'minor-arpeggio',
    name: '小三和弦分解',
    category: '跳音／琶音',
    jianpu: "1 b3 5 1' 5 b3 1",
    chords: 'i',
  },
  {
    id: 'triad-return',
    name: '三和弦來回',
    category: '跳音／琶音',
    jianpu: '1 3 5 3 1',
    chords: 'I',
  },
  {
    id: 'dom7-arpeggio',
    name: '屬七和弦分解',
    category: '跳音／琶音',
    jianpu: '1 3 5 b7 5 3 1',
    chords: 'I7',
  },
  // 滑音／警笛
  {
    id: 'fifth-glide',
    name: '五度滑音',
    category: '滑音／警笛',
    jianpu: '1~5~1',
    chords: 'I',
    glide: true,
  },
  {
    id: 'octave-siren',
    name: '八度警笛',
    category: '滑音／警笛',
    jianpu: "1~1'~1",
    chords: 'I',
    glide: true,
  },
  {
    id: 'hold-glide',
    name: '定點滑向',
    category: '滑音／警笛',
    jianpu: '1 - 1~5 - -',
    chords: 'I',
    glide: true,
  },
  // 基礎
  {
    id: 'long-tone',
    name: '單音長音',
    category: '基礎',
    jianpu: '1 - - -',
    chords: 'I',
  },
  {
    id: 'chromatic',
    name: '半音階',
    category: '基礎',
    jianpu: "1 #1 2 #2 3 4 #4 5 #5 6 #6 7 1' 7 b7 6 b6 5 b5 4 3 b3 2 b2 1",
    chords: 'I',
  },
];
