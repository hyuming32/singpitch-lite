import type { MidiAsset, MidiLyricEvent, MidiNote, MidiTimeSignatureEvent } from './midi';
import type { MidiScoreBar } from './midiScore';
import { extractMelodyNotes } from './midiExercise';
import type { NoteGlyph } from '../ui/practice/layout';

export const MAX_LYRIC_LINES = 5000;
export const MAX_LYRIC_LINE_CHARS = 500;
export const MAX_MIDI_AUTO_LINE_TOKENS = 20;

export const ERR_UNKNOWN_ENCODING = '無法辨識字幕編碼';

export interface LyricToken {
  /** 唱詞文字（單一漢字／注音／英文單字） */
  text: string;
  /** 起點時間（原曲秒數；經換算函式後為單遍相對秒數） */
  start: number;
  /** 終點時間（原曲秒數；經換算函式後為單遍相對秒數） */
  end: number;
}

export interface LyricLine {
  /** 該行起始時間（秒） */
  time: number;
  /** 該行完整顯示文字 */
  text: string;
  /** 逐字／逐詞時間標記 */
  tokens: LyricToken[];
}

export interface LyricDocument {
  lines: LyricLine[];
  title?: string;
  artist?: string;
  encoding?: string;
}

export interface KaraokeSegment {
  text: string;
  start: number;
  end: number;
  isTimed: boolean;
}

export interface StaffLyricMark {
  glyphIndex: number;
  x: number;
  text: string;
  isExtension: boolean;
  /** 此標籤實際字級（px）；未指定時使用 StaffLyricLayout.fontSize */
  fontSize?: number;
  /** 多字元注音等直排疊成一格顯示 */
  isVerticalStack?: boolean;
}

export interface StaffLyricLayout {
  marks: StaffLyricMark[];
  fontSize: number;
  beatOnlyFallback: boolean;
}

const BOPOMOFO_RE = /[\u3100-\u312F\u31A0-\u31BF]+/u;
const CJK_SINGLE_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/u;
const OTHER_WORD_RE = /[\p{L}\p{N}]+/u;

const TOKEN_SCAN_RE = new RegExp(
  [
    BOPOMOFO_RE.source,
    CJK_SINGLE_CHAR_RE.source,
    LATIN_WORD_RE.source,
    OTHER_WORD_RE.source,
  ].join('|'),
  'gu',
);

const PURE_PUNCT_OR_SPACE_RE = /^[\p{P}\p{S}\s]+$/u;

/** 判斷字串是否全為標點符號或空白（不佔唱詞時間） */
export function isPunctuationOrSpace(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || PURE_PUNCT_OR_SPACE_RE.test(trimmed);
}

/**
 * 將歌詞文字切分為可演唱 token：
 * - 漢字／假名／韓文一字一個
 * - 連續注音符號（如「ㄐㄧㄢ」）視為一個字
 * - 英文／數字單字一個字一個
 * - 標點符號與空白略過不佔時間
 */
export function splitSingableTokens(text: string): string[] {
  const tokens: string[] = [];
  TOKEN_SCAN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_SCAN_RE.exec(text)) !== null) {
    if (match[0]) {
      tokens.push(match[0]);
    }
  }
  return tokens;
}

/**
 * 判斷位元組陣列的文字編碼並解碼：
 * - UTF-8 BOM / UTF-16 LE BOM / UTF-16 BE BOM 依 BOM 解碼
 * - 否則依序以 fatal 模式嘗試 utf-8 → big5 → gbk
 * - 全部失敗時拋出「無法辨識字幕編碼」
 */
export function decodeTextBytes(bytes: Uint8Array): {
  text: string;
  encoding: string;
} {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(3),
      );
      return { text, encoding: 'utf-8-bom' };
    } catch {
      throw new Error(ERR_UNKNOWN_ENCODING);
    }
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    try {
      const text = new TextDecoder('utf-16le', { fatal: true }).decode(
        bytes.subarray(2),
      );
      return { text, encoding: 'utf-16le' };
    } catch {
      throw new Error(ERR_UNKNOWN_ENCODING);
    }
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      const text = new TextDecoder('utf-16be', { fatal: true }).decode(
        bytes.subarray(2),
      );
      return { text, encoding: 'utf-16be' };
    } catch {
      throw new Error(ERR_UNKNOWN_ENCODING);
    }
  }

  for (const enc of ['utf-8', 'big5', 'gbk'] as const) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(bytes);
      return { text, encoding: enc };
    } catch {
      // 繼續嘗試下一個編碼
    }
  }

  throw new Error(ERR_UNKNOWN_ENCODING);
}

/** 整首 MIDI 歌詞事件共用同一編碼判斷與逐筆解碼 */
export function detectChunksEncoding(chunks: readonly Uint8Array[]): {
  encoding: string;
  decodeChunk: (chunk: Uint8Array) => string;
} {
  const nonEmpty = chunks.filter((c) => c.length > 0);
  if (nonEmpty.length === 0) {
    return {
      encoding: 'utf-8',
      decodeChunk: () => '',
    };
  }

  let totalLen = nonEmpty.length - 1;
  for (const c of nonEmpty) {
    totalLen += c.length;
  }
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (let i = 0; i < nonEmpty.length; i++) {
    if (i > 0) {
      combined[offset++] = 0x0a;
    }
    const c = nonEmpty[i]!;
    combined.set(c, offset);
    offset += c.length;
  }

  const { encoding } = decodeTextBytes(combined);
  const decoderLabel = encoding === 'utf-8-bom' ? 'utf-8' : encoding;
  const decoder = new TextDecoder(decoderLabel, { fatal: true });

  return {
    encoding,
    decodeChunk: (chunk: Uint8Array) => {
      if (chunk.length === 0) return '';
      if (
        encoding === 'utf-8-bom' &&
        chunk.length >= 3 &&
        chunk[0] === 0xef &&
        chunk[1] === 0xbb &&
        chunk[2] === 0xbf
      ) {
        return decoder.decode(chunk.subarray(3));
      }
      if (
        (encoding === 'utf-16le' || encoding === 'utf-16be') &&
        chunk.length >= 2 &&
        ((chunk[0] === 0xff && chunk[1] === 0xfe) ||
          (chunk[0] === 0xfe && chunk[1] === 0xff))
      ) {
        return decoder.decode(chunk.subarray(2));
      }
      return decoder.decode(chunk);
    },
  };
}

function distributeTokensEvenly(
  text: string,
  startSec: number,
  endSec: number,
): LyricToken[] {
  const words = splitSingableTokens(text);
  if (words.length === 0) {
    return [];
  }
  const safeStart = Math.max(0, startSec);
  const safeEnd = Math.max(safeStart, endSec);
  const span = safeEnd - safeStart;
  return words.map((word, idx) => ({
    text: word,
    start: safeStart + (idx / words.length) * span,
    end: safeStart + ((idx + 1) / words.length) * span,
  }));
}

function parseLrcTimestamp(
  mmStr: string,
  ssStr: string,
  fracStr: string | undefined,
  lineNo: number,
): number {
  const mm = Number(mmStr);
  const ss = Number(ssStr);
  if (
    !Number.isInteger(mm) ||
    !Number.isInteger(ss) ||
    mm < 0 ||
    ss < 0 ||
    ss >= 60
  ) {
    throw new Error(`第 ${lineNo} 行：時間標籤格式錯誤`);
  }
  let ms = 0;
  if (fracStr !== undefined && fracStr.length > 0) {
    const padded = fracStr.slice(0, 3).padEnd(3, '0');
    ms = Number(padded);
    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error(`第 ${lineNo} 行：時間標籤格式錯誤`);
    }
  }
  return mm * 60 + ss + ms / 1000;
}

const LRC_TIME_TAG_RE = /^\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const LRC_META_TAG_RE = /^\[([a-zA-Z]+):([^\]]*)\]\s*$/;
const LRC_NUMERIC_BRACKET_RE = /^\[(\d+):([^\]]*)\]/;
const LRC_WORD_TAG_RE = /<(\d+):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

/** 解析 LRC（含 [ti:]、[ar:]、[offset:±ms]、多時間標籤與 <mm:ss.xx> 逐字時間） */
export function parseLrc(text: string): LyricDocument {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  let title: string | undefined;
  let artist: string | undefined;
  let offsetMs = 0;

  interface RawLrcLine {
    lineNo: number;
    time: number;
    rawBody: string;
    enhancedBaseOffsetSec: number;
    order: number;
  }

  const rawEntries: RawLrcLine[] = [];
  let order = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i]!.trim();
    if (!raw) continue;

    // 先檢查 meta 標籤 [ti:] [ar:] [offset:]
    const metaMatch = LRC_META_TAG_RE.exec(raw);
    if (metaMatch && !LRC_TIME_TAG_RE.test(raw)) {
      const key = metaMatch[1]!.toLowerCase();
      const val = metaMatch[2]!.trim();
      if (key === 'ti') {
        title = val;
      } else if (key === 'ar') {
        artist = val;
      } else if (key === 'offset') {
        if (!/^[+-]?\d+$/.test(val)) {
          throw new Error(`第 ${lineNo} 行：offset 格式錯誤`);
        }
        offsetMs = Number(val);
      }
      continue;
    }

    let rest = raw;
    const times: number[] = [];
    while (rest.startsWith('[')) {
      const tm = LRC_TIME_TAG_RE.exec(rest);
      if (tm) {
        times.push(parseLrcTimestamp(tm[1]!, tm[2]!, tm[3], lineNo));
        rest = rest.slice(tm[0].length);
      } else if (LRC_NUMERIC_BRACKET_RE.test(rest)) {
        throw new Error(`第 ${lineNo} 行：時間標籤格式錯誤`);
      } else {
        break;
      }
    }

    if (times.length === 0) {
      continue;
    }

    const cleanCheck = rest.replace(/<[^>]*>/g, '');
    if (cleanCheck.length > MAX_LYRIC_LINE_CHARS) {
      throw new Error(
        `第 ${lineNo} 行：單行字數超過上限（最多 ${MAX_LYRIC_LINE_CHARS} 字）`,
      );
    }

    const baseFirstTime = times[0]!;
    for (const t of times) {
      rawEntries.push({
        lineNo,
        time: Math.max(0, t + offsetMs / 1000),
        rawBody: rest,
        enhancedBaseOffsetSec: t - baseFirstTime,
        order: order++,
      });
    }
  }

  rawEntries.sort((a, b) => a.time - b.time || a.order - b.order);

  const lines: LyricLine[] = [];
  for (let i = 0; i < rawEntries.length; i++) {
    const item = rawEntries[i]!;
    const nextEntryTime = rawEntries[i + 1]?.time;

    // 空白時間標籤行作為前一行結束邊界，不產生顯示行
    const plainBody = item.rawBody.replace(/<[^>]*>/g, '').trim();
    if (!plainBody) {
      continue;
    }

    if (lines.length >= MAX_LYRIC_LINES) {
      throw new Error(
        `第 ${item.lineNo} 行：字幕行數超過上限（最多 ${MAX_LYRIC_LINES} 行）`,
      );
    }

    // 檢查是否含 <mm:ss.xx> 逐字標籤
    if (/<[^>]+>/.test(item.rawBody)) {
      const segments: Array<{ time: number; text: string }> = [];
      let lastIdx = 0;
      let currentStart = item.time;
      let match: RegExpExecArray | null;
      const scanRe = new RegExp(LRC_WORD_TAG_RE.source, 'g');
      while ((match = scanRe.exec(item.rawBody)) !== null) {
        const prefixText = item.rawBody.slice(lastIdx, match.index);
        if (prefixText) {
          segments.push({ time: currentStart, text: prefixText });
        }
        const tagTime = parseLrcTimestamp(
          match[1]!,
          match[2]!,
          match[3],
          item.lineNo,
        );
        currentStart = Math.max(
          0,
          tagTime + item.enhancedBaseOffsetSec + offsetMs / 1000,
        );
        lastIdx = match.index + match[0].length;
      }
      const trailingText = item.rawBody.slice(lastIdx);
      if (trailingText) {
        segments.push({ time: currentStart, text: trailingText });
      } else if (segments.length > 0) {
        // 行尾單獨一個 <mm:ss.xx> 代表最後一字的結束時間
        segments.push({ time: currentStart, text: '' });
      }

      // 若有任何看似時間但格式錯誤的 <...>
      if (segments.length === 0 && /<[^>]+>/.test(item.rawBody)) {
        throw new Error(`第 ${item.lineNo} 行：逐字時間標籤格式錯誤`);
      }

      const tokens: LyricToken[] = [];
      for (let si = 0; si < segments.length; si++) {
        const seg = segments[si]!;
        if (!seg.text) continue;
        const nextSegTime = segments[si + 1]?.time;
        const fallbackEnd =
          nextEntryTime !== undefined
            ? Math.max(seg.time, Math.min(nextEntryTime, seg.time + 8))
            : seg.time + 8;
        const segEnd =
          nextSegTime !== undefined ? Math.max(seg.time, nextSegTime) : fallbackEnd;
        tokens.push(...distributeTokensEvenly(seg.text, seg.time, segEnd));
      }

      const cleanText = item.rawBody.replace(/<[^>]*>/g, '').trim();
      lines.push({
        time: tokens[0]?.start ?? item.time,
        text: cleanText,
        tokens,
      });
    } else {
      const lineEnd =
        nextEntryTime !== undefined
          ? Math.max(item.time, Math.min(nextEntryTime, item.time + 8))
          : item.time + 8;
      const cleanText = plainBody;
      lines.push({
        time: item.time,
        text: cleanText,
        tokens: distributeTokensEvenly(cleanText, item.time, lineEnd),
      });
    }
  }

  return {
    lines,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  };
}

function parseAssTimestamp(raw: string, lineNo: number): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(raw.trim());
  if (!m) {
    throw new Error(`第 ${lineNo} 行：ASS Start 時間格式錯誤`);
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const frac = m[4] ? Number(m[4].slice(0, 3).padEnd(3, '0')) / 1000 : 0;
  if (min >= 60 || sec >= 60) {
    throw new Error(`第 ${lineNo} 行：ASS Start 時間格式錯誤`);
  }
  return h * 3600 + min * 60 + sec + frac;
}

const ASS_KARAOKE_ANY_RE = /\{[^}]*\\(?:kf|k|K)\d+[^}]*\}/;
const ASS_TAG_BLOCK_RE = /\{([^}]*)\}/g;
const ASS_KARAOKE_TAG_RE = /\\(?:kf|k|K)(\d+)/g;

/** 解析 ASS 字幕（只讀 [Events]，依 Format 欄位取含 {\k}/{\kf}/{\K} 的 Dialogue） */
export function parseAss(text: string): LyricDocument {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  let inEvents = false;
  let formatFields: string[] | null = null;
  let startCol = -1;

  const lines: LyricLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i]!.trim();
    if (!raw || raw.startsWith(';')) continue;

    if (raw.startsWith('[') && raw.endsWith(']')) {
      const secName = raw.slice(1, -1).trim().toLowerCase();
      inEvents = secName === 'events';
      continue;
    }

    if (!inEvents) continue;

    if (/^format\s*:/i.test(raw)) {
      const body = raw.slice(raw.indexOf(':') + 1);
      formatFields = body.split(',').map((f) => f.trim().toLowerCase());
      startCol = formatFields.indexOf('start');
      const lastField = formatFields[formatFields.length - 1];
      if (startCol === -1 || lastField !== 'text') {
        throw new Error(
          `第 ${lineNo} 行：ASS Format 欄位必須包含 Start 且 Text 必須在最後`,
        );
      }
      continue;
    }

    if (/^dialogue\s*:/i.test(raw)) {
      if (!formatFields || startCol === -1) {
        throw new Error(`第 ${lineNo} 行：Dialogue 之前缺少 Format 定義`);
      }
      const body = raw.slice(raw.indexOf(':') + 1).trimStart();
      const parts: string[] = [];
      let cursor = 0;
      for (let col = 0; col < formatFields.length - 1; col++) {
        const commaIdx = body.indexOf(',', cursor);
        if (commaIdx === -1) {
          throw new Error(`第 ${lineNo} 行：ASS Dialogue 欄位數量不足`);
        }
        parts.push(body.slice(cursor, commaIdx).trim());
        cursor = commaIdx + 1;
      }
      const rawText = body.slice(cursor);

      if (!ASS_KARAOKE_ANY_RE.test(rawText)) {
        continue;
      }

      const startSec = parseAssTimestamp(parts[startCol]!, lineNo);
      const normalizedText = rawText.replace(/\\N|\\n|\\h/g, ' ');
      const cleanLineText = normalizedText
        .replace(/\{[^}]*\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanLineText.length > MAX_LYRIC_LINE_CHARS) {
        throw new Error(
          `第 ${lineNo} 行：單行字數超過上限（最多 ${MAX_LYRIC_LINE_CHARS} 字）`,
        );
      }
      if (lines.length >= MAX_LYRIC_LINES) {
        throw new Error(
          `第 ${lineNo} 行：字幕行數超過上限（最多 ${MAX_LYRIC_LINES} 行）`,
        );
      }

      const tokens: LyricToken[] = [];
      let timeCursor = startSec;
      let currentSegDur = 0;
      let textBuf = '';

      const flushBuf = () => {
        const segEnd = timeCursor + currentSegDur;
        if (textBuf) {
          tokens.push(...distributeTokensEvenly(textBuf, timeCursor, segEnd));
        }
        timeCursor = segEnd;
        currentSegDur = 0;
        textBuf = '';
      };

      ASS_TAG_BLOCK_RE.lastIndex = 0;
      let lastIdx = 0;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = ASS_TAG_BLOCK_RE.exec(normalizedText)) !== null) {
        textBuf += normalizedText.slice(lastIdx, tagMatch.index);
        const tagInner = tagMatch[1]!;
        let blockDur = 0;
        let hasKaraoke = false;
        ASS_KARAOKE_TAG_RE.lastIndex = 0;
        let km: RegExpExecArray | null;
        while ((km = ASS_KARAOKE_TAG_RE.exec(tagInner)) !== null) {
          hasKaraoke = true;
          blockDur += Number(km[1]) / 100;
        }
        if (hasKaraoke) {
          flushBuf();
          currentSegDur = blockDur;
        }
        lastIdx = tagMatch.index + tagMatch[0].length;
      }
      textBuf += normalizedText.slice(lastIdx);
      flushBuf();

      if (cleanLineText) {
        lines.push({
          time: startSec,
          text: cleanLineText,
          tokens,
        });
      }
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return { lines };
}

/** 解析 UltraStar .txt 格式（#BPM、#GAP、: * F、- 換行、E 結束、~ 延長） */
export function parseUltraStar(text: string): LyricDocument {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  let bpm: number | null = null;
  let gapMs = 0;
  let title: string | undefined;
  let artist: string | undefined;

  const lines: LyricLine[] = [];
  let currentTokens: LyricToken[] = [];
  let currentRawText = '';
  let currentStartTime: number | null = null;

  const flushLine = (lineNo: number) => {
    const cleanText = currentRawText.replace(/\s+/g, ' ').trim();
    if (cleanText.length > MAX_LYRIC_LINE_CHARS) {
      throw new Error(
        `第 ${lineNo} 行：單行字數超過上限（最多 ${MAX_LYRIC_LINE_CHARS} 字）`,
      );
    }
    if (cleanText || currentTokens.length > 0) {
      if (lines.length >= MAX_LYRIC_LINES) {
        throw new Error(
          `第 ${lineNo} 行：字幕行數超過上限（最多 ${MAX_LYRIC_LINES} 行）`,
        );
      }
      const lineTime = currentTokens[0]?.start ?? currentStartTime ?? 0;
      lines.push({
        time: lineTime,
        text: cleanText,
        tokens: currentTokens,
      });
    }
    currentTokens = [];
    currentRawText = '';
    currentStartTime = null;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i]!;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(1, colonIdx).trim().toUpperCase();
        const val = trimmed.slice(colonIdx + 1).trim();
        if (key === 'BPM') {
          const parsed = Number(val.replace(',', '.'));
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error(`第 ${lineNo} 行：#BPM 格式錯誤`);
          }
          bpm = parsed;
        } else if (key === 'GAP') {
          const parsed = Number(val.replace(',', '.'));
          if (!Number.isFinite(parsed)) {
            throw new Error(`第 ${lineNo} 行：#GAP 格式錯誤`);
          }
          gapMs = parsed;
        } else if (key === 'TITLE') {
          title = val;
        } else if (key === 'ARTIST') {
          artist = val;
        }
      }
      continue;
    }

    if (trimmed === 'E') {
      flushLine(lineNo);
      break;
    }

    if (trimmed === '-' || /^-\s+/.test(trimmed)) {
      flushLine(lineNo);
      continue;
    }

    const noteMatch =
      /^([:*FRG])\s+(-?\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(-?\d+)(?:\s(.*))?$/.exec(
        raw,
      );
    if (!noteMatch) {
      throw new Error(`第 ${lineNo} 行：UltraStar 音符行格式錯誤`);
    }
    const kind = noteMatch[1]!;
    if (kind !== ':' && kind !== '*' && kind !== 'F') {
      continue;
    }
    if (bpm === null) {
      throw new Error(`第 ${lineNo} 行：缺少 #BPM 設定`);
    }

    const startBeat = Number(noteMatch[2]!.replace(',', '.'));
    const lengthBeats = Number(noteMatch[3]!.replace(',', '.'));
    const lyricRaw = noteMatch[5] ?? '';

    const beatSec = 60 / (bpm * 4);
    const startSec = Math.max(0, gapMs / 1000 + startBeat * beatSec);
    const endSec = Math.max(
      startSec,
      gapMs / 1000 + (startBeat + lengthBeats) * beatSec,
    );

    if (currentStartTime === null) {
      currentStartTime = startSec;
    }

    if (lyricRaw.trimStart().startsWith('~')) {
      const prevToken =
        currentTokens[currentTokens.length - 1] ??
        lines[lines.length - 1]?.tokens[
          (lines[lines.length - 1]?.tokens.length ?? 0) - 1
        ];
      if (prevToken) {
        prevToken.end = Math.max(prevToken.end, endSec);
      }
      continue;
    }

    currentRawText += lyricRaw;
    if (currentRawText.trim().length > MAX_LYRIC_LINE_CHARS) {
      throw new Error(
        `第 ${lineNo} 行：單行字數超過上限（最多 ${MAX_LYRIC_LINE_CHARS} 字）`,
      );
    }

    const words = splitSingableTokens(lyricRaw);
    if (words.length > 0) {
      currentTokens.push(...distributeTokensEvenly(lyricRaw, startSec, endSec));
    }
  }

  flushLine(rawLines.length);

  return {
    lines,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  };
}

/** 解析 karoke-fun2young JSON 格式：{ version:1, lines:[{ time, text, tokens:[{ t, start, end }] }] } */
export function parseKarokeJson(text: string): LyricDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('第 1 行：JSON 格式錯誤');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('第 1 行：JSON 根物件格式錯誤');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.lines)) {
    throw new Error('第 1 行：JSON 必須包含 version: 1 與 lines 陣列');
  }

  if (obj.lines.length > MAX_LYRIC_LINES) {
    throw new Error(
      `第 ${MAX_LYRIC_LINES + 1} 行：字幕行數超過上限（最多 ${MAX_LYRIC_LINES} 行）`,
    );
  }

  const lines: LyricLine[] = [];
  for (let i = 0; i < obj.lines.length; i++) {
    const lineNo = i + 1;
    const rawLine = obj.lines[i];
    if (!rawLine || typeof rawLine !== 'object' || Array.isArray(rawLine)) {
      throw new Error(`第 ${lineNo} 行：JSON 行物件格式錯誤`);
    }
    const lineObj = rawLine as Record<string, unknown>;
    if (
      typeof lineObj.time !== 'number' ||
      !Number.isFinite(lineObj.time) ||
      typeof lineObj.text !== 'string'
    ) {
      throw new Error(`第 ${lineNo} 行：缺少有效的 time 或 text 欄位`);
    }
    if (lineObj.text.length > MAX_LYRIC_LINE_CHARS) {
      throw new Error(
        `第 ${lineNo} 行：單行字數超過上限（最多 ${MAX_LYRIC_LINE_CHARS} 字）`,
      );
    }

    let tokens: LyricToken[];
    if (lineObj.tokens !== undefined) {
      if (!Array.isArray(lineObj.tokens)) {
        throw new Error(`第 ${lineNo} 行：tokens 必須為陣列`);
      }
      tokens = [];
      for (const rawTok of lineObj.tokens) {
        if (!rawTok || typeof rawTok !== 'object' || Array.isArray(rawTok)) {
          throw new Error(`第 ${lineNo} 行：JSON token 格式錯誤`);
        }
        const tokObj = rawTok as Record<string, unknown>;
        if (
          typeof tokObj.t !== 'string' ||
          typeof tokObj.start !== 'number' ||
          !Number.isFinite(tokObj.start) ||
          typeof tokObj.end !== 'number' ||
          !Number.isFinite(tokObj.end)
        ) {
          throw new Error(`第 ${lineNo} 行：JSON token 格式錯誤`);
        }
        if (tokObj.t.trim().length > 0) {
          tokens.push({
            text: tokObj.t,
            start: Math.max(0, tokObj.start),
            end: Math.max(Math.max(0, tokObj.start), tokObj.end),
          });
        }
      }
    } else {
      const nextRaw = obj.lines[i + 1] as Record<string, unknown> | undefined;
      const nextTime =
        nextRaw && typeof nextRaw.time === 'number' && Number.isFinite(nextRaw.time)
          ? nextRaw.time
          : undefined;
      const lineEnd =
        nextTime !== undefined
          ? Math.max(lineObj.time, Math.min(nextTime, lineObj.time + 8))
          : lineObj.time + 8;
      tokens = distributeTokensEvenly(lineObj.text, lineObj.time, lineEnd);
    }

    lines.push({
      time: Math.max(0, lineObj.time),
      text: lineObj.text,
      tokens,
    });
  }

  return { lines };
}

/** 依副檔名與編碼自動解析匯入的字幕檔（.lrc / .ass / .txt / .json） */
export function parseSubtitleFile(
  bytes: Uint8Array,
  fileName: string,
): LyricDocument {
  const { text, encoding } = decodeTextBytes(bytes);
  const lower = fileName.trim().toLowerCase();

  let doc: LyricDocument;
  if (lower.endsWith('.lrc')) {
    doc = parseLrc(text);
  } else if (lower.endsWith('.ass')) {
    doc = parseAss(text);
  } else if (lower.endsWith('.txt')) {
    doc = parseUltraStar(text);
  } else if (lower.endsWith('.json')) {
    doc = parseKarokeJson(text);
  } else {
    throw new Error('不支援的字幕格式，請選擇 .lrc、.ass、.txt 或 .json 檔');
  }

  if (doc.lines.length === 0) {
    throw new Error('第 1 行：字幕檔沒有有效的歌詞內容');
  }

  return { ...doc, encoding };
}

function getBeatTicksAtTick(
  tick: number,
  ticksPerBeat: number,
  timeSignatures?: readonly MidiTimeSignatureEvent[],
): number {
  const safeTpb = ticksPerBeat > 0 ? ticksPerBeat : 480;
  if (!timeSignatures || timeSignatures.length === 0) {
    return safeTpb;
  }
  let denom = timeSignatures[0]!.denominator || 4;
  for (const ts of timeSignatures) {
    if (ts.tick <= tick) {
      denom = ts.denominator || 4;
    } else {
      break;
    }
  }
  return (safeTpb * 4) / denom;
}

function getBeatSecondsAtTime(
  timeSec: number,
  asset: Pick<MidiAsset, 'beats'>,
): number {
  if (asset.beats.length > 0) {
    let bpm = asset.beats[0]![2] || 120;
    for (const bt of asset.beats) {
      if (bt[0] <= timeSec + 1e-4) {
        bpm = bt[2] || 120;
      } else {
        break;
      }
    }
    if (bpm > 0 && Number.isFinite(bpm)) {
      return 60 / bpm;
    }
  }
  return 0.5;
}

/** 從 MidiAsset 選出應顯示的歌詞事件序列（優先主唱軌，否則第一個有歌詞的軌） */
export function selectMidiLyricEvents(
  asset: Pick<MidiAsset, 'lyrics'>,
  vocalTrackIndex?: number | null,
): MidiLyricEvent[] {
  const all = asset.lyrics;
  if (!all || all.length === 0) {
    return [];
  }

  const pickTrackEvents = (events: MidiLyricEvent[]): MidiLyricEvent[] => {
    const hasLyricMeta = events.some((e) => e.type === 0x05);
    return hasLyricMeta ? events.filter((e) => e.type === 0x05) : events;
  };

  if (vocalTrackIndex !== undefined && vocalTrackIndex !== null) {
    const onVocal = all.filter((e) => e.track === vocalTrackIndex);
    if (onVocal.length > 0) {
      return pickTrackEvents(onVocal);
    }
  }

  // 取全曲第一個有歌詞的軌（優先有 0x05 的第一軌，其次有 0x01 的第一軌）
  const firstLyric05 = all.find((e) => e.type === 0x05);
  if (firstLyric05) {
    return all.filter((e) => e.track === firstLyric05.track && e.type === 0x05);
  }
  const firstTrack = all[0]!.track;
  return all.filter((e) => e.track === firstTrack);
}

interface VocalSpanTick {
  startTick: number;
  endTick: number;
  startSec: number;
  endSec: number;
}

function mergeVocalNoteSpans(
  notes: readonly MidiNote[],
  ticksPerBeat: number,
): VocalSpanTick[] {
  const spans: VocalSpanTick[] = [];
  for (const n of notes) {
    const sTick = n.startTick ?? Math.round(n.start * ticksPerBeat * 2);
    const eTick = n.endTick ?? Math.round(n.end * ticksPerBeat * 2);
    if (eTick <= sTick && n.end <= n.start) continue;
    const prev = spans[spans.length - 1];
    if (prev && sTick <= prev.endTick + 2) {
      prev.endTick = Math.max(prev.endTick, eTick);
      prev.endSec = Math.max(prev.endSec, n.end);
    } else {
      spans.push({
        startTick: sTick,
        endTick: eTick,
        startSec: n.start,
        endSec: n.end,
      });
    }
  }
  return spans;
}

function maxSilenceTicksBetween(
  t1: number,
  t2: number,
  mergedSpans: readonly VocalSpanTick[],
): number {
  if (t2 <= t1) return 0;
  if (mergedSpans.length === 0) return t2 - t1;
  let cursor = t1;
  let maxGap = 0;
  for (const sp of mergedSpans) {
    if (sp.endTick <= t1) continue;
    if (sp.startTick >= t2) break;
    if (sp.startTick > cursor) {
      maxGap = Math.max(maxGap, sp.startTick - cursor);
    }
    cursor = Math.max(cursor, sp.endTick);
  }
  if (t2 > cursor) {
    maxGap = Math.max(maxGap, t2 - cursor);
  }
  return maxGap;
}

/** 計算 MIDI 歌詞單一事件在原曲中的結束秒數（若有主唱音符連唱延音則延伸至休止前） */
function resolveMidiTokenEndSec(
  evTime: number,
  nextEvTime: number | undefined,
  melodyNotes: readonly MidiNote[],
  beatSec: number,
): number {
  const eighthBeat = beatSec / 8;
  const maxEndCap = nextEvTime !== undefined ? nextEvTime : evTime + 8;

  if (melodyNotes.length === 0) {
    return nextEvTime !== undefined
      ? Math.max(evTime, Math.min(nextEvTime, evTime + 8))
      : evTime + 1;
  }

  // 尋找對上此字（或涵蓋到此字結束前）的連續主唱音符
  const limitStart =
    nextEvTime !== undefined ? nextEvTime - eighthBeat : Infinity;
  let matchedEnd = -1;
  for (const n of melodyNotes) {
    if (n.end <= evTime - eighthBeat) continue;
    if (n.start >= limitStart) break;
    if (matchedEnd < 0) {
      if (Math.abs(n.start - evTime) <= eighthBeat || (n.start <= evTime && n.end > evTime)) {
        matchedEnd = n.end;
      }
    } else {
      // 連續延音（相鄰音符間休止 < 1 拍）且在下一個歌詞之前
      if (n.start - matchedEnd < beatSec * 0.99) {
        matchedEnd = Math.max(matchedEnd, n.end);
      } else {
        break;
      }
    }
  }

  if (matchedEnd > evTime) {
    return Math.min(maxEndCap, matchedEnd);
  }
  return nextEvTime !== undefined
    ? Math.max(evTime, Math.min(nextEvTime, evTime + 8))
    : evTime + 1;
}

/**
 * 將 MIDI 內嵌歌詞事件依斷行規則整理成 LyricDocument：
 * - 有 `/`、`\`、CR、LF 則照著斷行
 * - 無斷行符號時，兩字間空白／主唱休止 >= 1 拍或滿 20 字換行
 */
export function buildMidiLyricsDocument(
  asset: MidiAsset,
  vocalTrackIndex?: number | null,
): LyricDocument {
  const rawEvents = selectMidiLyricEvents(asset, vocalTrackIndex);
  if (rawEvents.length === 0) {
    return { lines: [], ...(asset.lyricsEncoding ? { encoding: asset.lyricsEncoding } : {}) };
  }

  const vocalTrack =
    vocalTrackIndex !== undefined && vocalTrackIndex !== null
      ? asset.tracks.find((t) => t.index === vocalTrackIndex)
      : undefined;
  const melodyNotes = vocalTrack ? extractMelodyNotes(vocalTrack.notes) : [];
  const mergedSpans = mergeVocalNoteSpans(melodyNotes, asset.ticksPerBeat);

  const hasExplicitBreaks = rawEvents.some((ev) => /[\/\\\r\n]/.test(ev.text));

  interface RawMidiPiece {
    tick: number;
    time: number;
    endTime: number;
    text: string;
    breakBefore: boolean;
    breakAfter: boolean;
  }

  const pieces: RawMidiPiece[] = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const ev = rawEvents[i]!;
    const nextTime = rawEvents[i + 1]?.time;
    const beatSec = getBeatSecondsAtTime(ev.time, asset);
    const endTime = resolveMidiTokenEndSec(
      ev.time,
      nextTime,
      melodyNotes,
      beatSec,
    );

    if (hasExplicitBreaks) {
      const normalized = ev.text.replace(/\r\n?/g, '\n');
      const parts = normalized.split(/([\/\\\n])/);
      let pendingBreakBefore = false;
      const nonEmptyParts: Array<{ text: string; breakBefore: boolean; breakAfter: boolean }> = [];
      for (let pi = 0; pi < parts.length; pi++) {
        const part = parts[pi]!;
        if (part === '/' || part === '\\' || part === '\n') {
          if (nonEmptyParts.length > 0) {
            nonEmptyParts[nonEmptyParts.length - 1]!.breakAfter = true;
          } else {
            pendingBreakBefore = true;
          }
        } else if (part.length > 0) {
          nonEmptyParts.push({
            text: part,
            breakBefore: pendingBreakBefore,
            breakAfter: false,
          });
          pendingBreakBefore = false;
        }
      }
      if (nonEmptyParts.length === 0) {
        // 純換行事件（例如單獨的 "/" 或 "\"）
        if (pieces.length > 0) {
          pieces[pieces.length - 1]!.breakAfter = true;
        }
      } else {
        const span = Math.max(0, endTime - ev.time);
        for (let k = 0; k < nonEmptyParts.length; k++) {
          const seg = nonEmptyParts[k]!;
          const s = ev.time + (k / nonEmptyParts.length) * span;
          const e = ev.time + ((k + 1) / nonEmptyParts.length) * span;
          pieces.push({
            tick: ev.tick,
            time: s,
            endTime: e,
            text: seg.text,
            breakBefore: seg.breakBefore,
            breakAfter: seg.breakAfter,
          });
        }
      }
    } else {
      pieces.push({
        tick: ev.tick,
        time: ev.time,
        endTime,
        text: ev.text,
        breakBefore: false,
        breakAfter: false,
      });
    }
  }

  const lines: LyricLine[] = [];
  let curTokens: LyricToken[] = [];
  let curTextParts: string[] = [];
  let prevPiece: RawMidiPiece | null = null;

  const flushCurrentLine = () => {
    const joined = joinMidiTextParts(curTextParts);
    if (joined || curTokens.length > 0) {
      lines.push({
        time: curTokens[0]?.start ?? prevPiece?.time ?? 0,
        text: joined,
        tokens: curTokens,
      });
    }
    curTokens = [];
    curTextParts = [];
  };

  for (const piece of pieces) {
    if (piece.breakBefore && curTokens.length > 0) {
      flushCurrentLine();
    }

    if (!hasExplicitBreaks && prevPiece && curTokens.length > 0) {
      const beatTicks = getBeatTicksAtTick(
        prevPiece.tick,
        asset.ticksPerBeat,
        asset.timeSignatures,
      );
      const silenceTicks = maxSilenceTicksBetween(
        prevPiece.tick,
        piece.tick,
        mergedSpans,
      );
      if (
        silenceTicks >= beatTicks - 1 ||
        curTokens.length >= MAX_MIDI_AUTO_LINE_TOKENS
      ) {
        flushCurrentLine();
      }
    }

    const trimmed = piece.text.trim();
    if (trimmed) {
      const subTokens = extractMidiEventTokens(trimmed);
      if (subTokens.length > 0) {
        const span = Math.max(0, piece.endTime - piece.time);
        for (let ti = 0; ti < subTokens.length; ti++) {
          curTokens.push({
            text: subTokens[ti]!,
            start: piece.time + (ti / subTokens.length) * span,
            end: piece.time + ((ti + 1) / subTokens.length) * span,
          });
        }
      }
      curTextParts.push(piece.text);
    } else if (piece.text) {
      curTextParts.push(piece.text);
    }

    prevPiece = piece;
    if (piece.breakAfter && (curTokens.length > 0 || curTextParts.length > 0)) {
      flushCurrentLine();
    }
  }

  flushCurrentLine();

  return {
    lines,
    ...(asset.lyricsEncoding ? { encoding: asset.lyricsEncoding } : {}),
  };
}

function extractMidiEventTokens(trimmed: string): string[] {
  if (isPunctuationOrSpace(trimmed)) {
    return [];
  }
  const split = splitSingableTokens(trimmed);
  return split.length > 0 ? split : [trimmed];
}

function joinMidiTextParts(parts: readonly string[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (!out) {
      out = part;
      continue;
    }
    const prevLast = out[out.length - 1]!;
    const nextFirst = part[0]!;
    const needSpace =
      /[A-Za-z0-9]$/.test(prevLast) &&
      /^[A-Za-z0-9]/.test(nextFirst) &&
      !/\s$/.test(out) &&
      !/^\s/.test(part);
    out += (needSpace ? ' ' : '') + part;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * 將原曲秒數的歌詞文件換算至練唱單遍相對秒數：
 * 1. 先加上每首字幕位移（offsetSec）
 * 2. 減去 A–B 區間起點（regionStartOrigSec）
 * 3. 除以速度倍率（speedFactor）
 */
export function convertLyricsToPassTime(
  doc: LyricDocument,
  opts: {
    offsetSec?: number;
    regionStartOrigSec: number;
    regionEndOrigSec: number;
    speedPercent?: number;
  },
): LyricDocument {
  const offsetSec = opts.offsetSec ?? 0;
  const speedPercent = Math.max(50, Math.min(150, opts.speedPercent ?? 100));
  const speedFactor = speedPercent / 100;
  const regionDur = Math.max(0.05, opts.regionEndOrigSec - opts.regionStartOrigSec);
  const passDur = regionDur / speedFactor;

  const toPassSec = (origSec: number) =>
    (origSec + offsetSec - opts.regionStartOrigSec) / speedFactor;

  const convertedLines: LyricLine[] = [];
  for (const line of doc.lines) {
    const tokens: LyricToken[] = [];
    for (const tok of line.tokens) {
      const start = toPassSec(tok.start);
      const end = Math.max(start, toPassSec(tok.end));
      if (end > -0.25 && start < passDur + 0.25) {
        tokens.push({
          text: tok.text,
          start: Math.max(0, start),
          end: Math.min(passDur, Math.max(0, end)),
        });
      }
    }

    const lineTime = toPassSec(line.time);
    const lineEnd = tokens.length > 0 ? tokens[tokens.length - 1]!.end : lineTime;
    if (tokens.length > 0 || (lineEnd > 0 && lineTime < passDur)) {
      convertedLines.push({
        time: tokens[0]?.start ?? Math.max(0, lineTime),
        text: line.text,
        tokens,
      });
    }
  }

  return {
    lines: convertedLines,
    ...(doc.title ? { title: doc.title } : {}),
    ...(doc.artist ? { artist: doc.artist } : {}),
    ...(doc.encoding ? { encoding: doc.encoding } : {}),
  };
}

/** 依單遍相對秒數決定卡拉 OK 歌詞帶應顯示的目前這行與下一行 */
export function selectKaraokeDisplayLines(
  lines: readonly LyricLine[],
  effectivePassSec: number,
): { currentLine: LyricLine | null; nextLine: LyricLine | null } {
  if (lines.length === 0) {
    return { currentLine: null, nextLine: null };
  }
  if (effectivePassSec < lines[0]!.time) {
    return {
      currentLine: lines[0]!,
      nextLine: lines[1] ?? null,
    };
  }

  let activeIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.time <= effectivePassSec) {
      activeIdx = i;
    } else {
      break;
    }
  }

  const activeLine = lines[activeIdx]!;
  const lastTokEnd =
    activeLine.tokens.length > 0
      ? activeLine.tokens[activeLine.tokens.length - 1]!.end
      : activeLine.time;

  if (
    effectivePassSec > lastTokEnd + 1.5 &&
    activeIdx + 1 < lines.length
  ) {
    return {
      currentLine: lines[activeIdx + 1]!,
      nextLine: lines[activeIdx + 2] ?? null,
    };
  }

  return {
    currentLine: activeLine,
    nextLine: lines[activeIdx + 1] ?? null,
  };
}

/** 將單行歌詞文字與 tokens 對齊為卡拉 OK 逐段顯示資料（保留標點與空白） */
export function buildKaraokeSegments(line: LyricLine): KaraokeSegment[] {
  const { text, tokens } = line;
  if (tokens.length === 0) {
    return text ? [{ text, start: line.time, end: line.time, isTimed: false }] : [];
  }

  const segments: KaraokeSegment[] = [];
  let cursor = 0;
  let lastEnd = tokens[0]!.start;

  for (const tok of tokens) {
    if (!tok.text) continue;
    const foundIdx = text.indexOf(tok.text, cursor);
    if (foundIdx === -1) {
      // 無法直接對齊原文時退回純 token 序列
      return tokens.map((t, idx) => ({
        text:
          idx > 0 &&
          /^[A-Za-z0-9]/.test(t.text) &&
          /[A-Za-z0-9]$/.test(tokens[idx - 1]!.text)
            ? ` ${t.text}`
            : t.text,
        start: t.start,
        end: t.end,
        isTimed: true,
      }));
    }
    if (foundIdx > cursor) {
      segments.push({
        text: text.slice(cursor, foundIdx),
        start: lastEnd,
        end: tok.start,
        isTimed: false,
      });
    }
    segments.push({
      text: tok.text,
      start: tok.start,
      end: tok.end,
      isTimed: true,
    });
    cursor = foundIdx + tok.text.length;
    lastEnd = tok.end;
  }

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      start: lastEnd,
      end: lastEnd,
      isTimed: false,
    });
  }

  return segments;
}

const PURE_BOPOMOFO_RE = /^[\u3100-\u312F\u31A0-\u31BF]+$/u;

/** 判斷是否為需要直排疊成一格的多字元注音事件（例如 2–3 個注音符號） */
export function isVerticalBopomofoMark(text: string): boolean {
  const trimmed = text.trim();
  return [...trimmed].length >= 2 && PURE_BOPOMOFO_RE.test(trimmed);
}

/** 估計五線譜下方單字標籤寬度（px） */
export function estimateLyricWidthPx(
  text: string,
  fontSize: number,
  isVerticalStack = false,
): number {
  if (isVerticalStack) {
    return fontSize * 0.95;
  }
  let width = 0;
  for (const ch of text) {
    if (/[\u0020-\u007e]/.test(ch)) {
      width += fontSize * 0.6;
    } else {
      width += fontSize * 1.05;
    }
  }
  return Math.max(fontSize * 0.8, width);
}

/**
 * 將單遍相對時間的歌詞對齊到一頁五線譜的音符上：
 * - token 起點與音符起點相差 <= 1/8 拍即對上
 * - 一字跨多音時，後續音符畫延長線「—」
 * - 碰撞判斷以「小節」為單位（必要時細到「拍」）：先從基本字級降到最小 9 px，
 *   僅該小節／該拍真的放不下時才降級為每拍第一字，不影響其他小節。
 */
export function alignLyricsToStaffLine(opts: {
  glyphs: readonly NoteGlyph[];
  bars: readonly MidiScoreBar[];
  passStartSec: number;
  passLyrics: readonly LyricLine[];
  lyricsScale?: number;
  isTablet?: boolean;
}): StaffLyricLayout {
  const {
    glyphs,
    bars,
    passStartSec,
    passLyrics,
    lyricsScale = 100,
    isTablet = false,
  } = opts;

  const scaleFactor = Math.max(0.7, Math.min(1.6, lyricsScale / 100));
  const baseFontSize = (isTablet ? 12 : 10) * scaleFactor;
  const minReadableFontSize = Math.min(baseFontSize, 9);

  const allTokens: LyricToken[] = [];
  for (const line of passLyrics) {
    for (const tok of line.tokens) {
      if (!isPunctuationOrSpace(tok.text)) {
        allTokens.push(tok);
      }
    }
  }

  if (allTokens.length === 0 || glyphs.length === 0) {
    return { marks: [], fontSize: baseFontSize, beatOnlyFallback: false };
  }

  const barBeatDurMap = new Map<number, number>();
  for (const bar of bars) {
    const count = Math.max(1, bar.beatStartSecs.length || bar.numerator);
    barBeatDurMap.set(bar.barNumber, (bar.endSec - bar.startSec) / count);
  }
  const fallbackBeatDur = 0.5;

  const noteEntries: Array<{
    glyphIndex: number;
    glyph: NoteGlyph;
    relStart: number;
    tolerance: number;
  }> = [];
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]!;
    if (g.isRest) continue;
    const beatDur =
      (g.barNumber !== undefined ? barBeatDurMap.get(g.barNumber) : undefined) ??
      fallbackBeatDur;
    noteEntries.push({
      glyphIndex: i,
      glyph: g,
      relStart: g.start - passStartSec,
      tolerance: beatDur / 8 + 1e-4,
    });
  }

  if (noteEntries.length === 0) {
    return { marks: [], fontSize: baseFontSize, beatOnlyFallback: false };
  }

  const matchedTokenByNote = new Map<number, LyricToken>();
  let tokCursor = 0;

  for (let ni = 0; ni < noteEntries.length; ni++) {
    const entry = noteEntries[ni]!;
    while (
      tokCursor < allTokens.length &&
      allTokens[tokCursor]!.start < entry.relStart - entry.tolerance
    ) {
      tokCursor++;
    }
    if (tokCursor >= allTokens.length) break;

    const tok = allTokens[tokCursor]!;
    const diff = Math.abs(tok.start - entry.relStart);
    if (diff <= entry.tolerance) {
      // 檢查下一個音符是否更接近這個 token
      const nextEntry = noteEntries[ni + 1];
      if (
        nextEntry &&
        Math.abs(tok.start - nextEntry.relStart) < diff - 1e-5
      ) {
        continue;
      }
      matchedTokenByNote.set(ni, tok);
      tokCursor++;
    }
  }

  const rawMarks: StaffLyricMark[] = [];
  let activeToken: LyricToken | null = null;
  let lastMatchedNoteEntryIdx = -1;

  for (let ni = 0; ni < noteEntries.length; ni++) {
    const entry = noteEntries[ni]!;
    const matched = matchedTokenByNote.get(ni);
    if (matched) {
      const vertical = isVerticalBopomofoMark(matched.text);
      rawMarks.push({
        glyphIndex: entry.glyphIndex,
        x: entry.glyph.x,
        text: matched.text,
        isExtension: false,
        ...(vertical ? { isVerticalStack: true } : {}),
      });
      activeToken = matched;
      lastMatchedNoteEntryIdx = ni;
      continue;
    }

    if (activeToken && lastMatchedNoteEntryIdx >= 0) {
      const beatDur =
        (entry.glyph.barNumber !== undefined
          ? barBeatDurMap.get(entry.glyph.barNumber)
          : undefined) ?? fallbackBeatDur;
      const insideDuration =
        entry.relStart < activeToken.end - Math.min(0.015, beatDur / 16);
      const isDirectTieContinuation =
        Boolean(entry.glyph.tieFromPrev) && ni === lastMatchedNoteEntryIdx + 1;
      if (insideDuration || isDirectTieContinuation) {
        rawMarks.push({
          glyphIndex: entry.glyphIndex,
          x: entry.glyph.x,
          text: '—',
          isExtension: true,
        });
        if (isDirectTieContinuation) {
          lastMatchedNoteEntryIdx = ni;
        }
      }
    }
  }

  if (rawMarks.length === 0) {
    return { marks: [], fontSize: baseFontSize, beatOnlyFallback: false };
  }

  const markWidth = (m: StaffLyricMark, size: number) =>
    estimateLyricWidthPx(m.text, size, Boolean(m.isVerticalStack));

  const computeRequiredScale = (
    items: readonly StaffLyricMark[],
    size: number,
  ): number => {
    let maxRatio = 1;
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1]!;
      const b = items[i]!;
      const dx = b.x - a.x;
      const needed = (markWidth(a, size) + markWidth(b, size)) * 0.5 + 1.5;
      if (dx <= 0) return Infinity;
      const ratio = needed / dx;
      if (ratio > maxRatio) {
        maxRatio = ratio;
      }
    }
    return maxRatio;
  };

  const resolveFontForSequence = (
    items: readonly StaffLyricMark[],
  ): { fits: boolean; fontSize: number } => {
    if (items.length <= 1) {
      return { fits: true, fontSize: baseFontSize };
    }
    const ratio = computeRequiredScale(items, baseFontSize);
    if (ratio <= 1) {
      return { fits: true, fontSize: baseFontSize };
    }
    const shrunk = baseFontSize / ratio;
    if (shrunk >= minReadableFontSize) {
      return { fits: true, fontSize: shrunk };
    }
    return { fits: false, fontSize: minReadableFontSize };
  };

  // 依小節分組檢查碰撞（不讓單一小節過密影響同行的其他小節）
  const barGroups: StaffLyricMark[][] = [];
  let curBarNum: number | undefined;
  for (const m of rawMarks) {
    const bNum = glyphs[m.glyphIndex]?.barNumber ?? 0;
    if (barGroups.length === 0 || bNum !== curBarNum) {
      barGroups.push([m]);
      curBarNum = bNum;
    } else {
      barGroups[barGroups.length - 1]!.push(m);
    }
  }

  const finalMarks: StaffLyricMark[] = [];
  let anyFallback = false;

  for (const barMarks of barGroups) {
    const barFit = resolveFontForSequence(barMarks);
    if (barFit.fits) {
      for (const m of barMarks) {
        finalMarks.push({ ...m, fontSize: barFit.fontSize });
      }
      continue;
    }

    // 小節內整體放不下：細分到「拍」，只有真的放不下的拍才降級為每拍第一字
    const beatGroups: StaffLyricMark[][] = [];
    let curBeatIdx: number | undefined;
    for (const m of barMarks) {
      const beatIdx = glyphs[m.glyphIndex]?.beatIndex ?? 0;
      if (beatGroups.length === 0 || beatIdx !== curBeatIdx) {
        beatGroups.push([m]);
        curBeatIdx = beatIdx;
      } else {
        beatGroups[beatGroups.length - 1]!.push(m);
      }
    }

    const barReduced: StaffLyricMark[] = [];
    for (const beatMarks of beatGroups) {
      const beatFit = resolveFontForSequence(beatMarks);
      if (beatFit.fits) {
        for (const m of beatMarks) {
          barReduced.push({ ...m, fontSize: beatFit.fontSize });
        }
      } else {
        anyFallback = true;
        barReduced.push({ ...beatMarks[0]!, fontSize: baseFontSize });
      }
    }

    // 拍與拍邊界再檢查一次相鄰間距，確保無重疊
    for (let i = 0; i < barReduced.length; i++) {
      const curr = barReduced[i]!;
      const prev = i > 0 ? barReduced[i - 1]! : undefined;
      const next = i + 1 < barReduced.length ? barReduced[i + 1]! : undefined;
      let maxAllowed = curr.fontSize ?? baseFontSize;
      if (prev) {
        const dx = curr.x - prev.x;
        const neededAtCurr =
          (markWidth(prev, prev.fontSize ?? baseFontSize) +
            markWidth(curr, maxAllowed)) *
            0.5 +
          1.5;
        if (dx > 0 && neededAtCurr > dx) {
          const prevW = markWidth(prev, prev.fontSize ?? baseFontSize) * 0.5;
          const availHalf = Math.max(2, dx - 1.5 - prevW);
          const unitW = markWidth(curr, 1) * 0.5;
          maxAllowed = Math.min(maxAllowed, Math.max(minReadableFontSize, availHalf / unitW));
        }
      }
      if (next) {
        const dx = next.x - curr.x;
        const neededAtCurr =
          (markWidth(curr, maxAllowed) +
            markWidth(next, next.fontSize ?? baseFontSize)) *
            0.5 +
          1.5;
        if (dx > 0 && neededAtCurr > dx) {
          const nextW = markWidth(next, next.fontSize ?? baseFontSize) * 0.5;
          const availHalf = Math.max(2, dx - 1.5 - nextW);
          const unitW = markWidth(curr, 1) * 0.5;
          maxAllowed = Math.min(maxAllowed, Math.max(minReadableFontSize, availHalf / unitW));
        }
      }
      curr.fontSize = Math.max(minReadableFontSize, maxAllowed);
      finalMarks.push(curr);
    }
  }

  const minUsedFontSize = finalMarks.reduce(
    (min, m) => Math.min(min, m.fontSize ?? baseFontSize),
    baseFontSize,
  );

  return {
    marks: finalMarks,
    fontSize: minUsedFontSize,
    beatOnlyFallback: anyFallback,
  };
}
