import type { Exercise, KeyBlock } from './exercise';
import { displayNoteNameInKey } from '../ui/noteLabel';

/** 最短有效練習秒數（未滿此秒數不列入紀錄） */
export const MIN_LOG_DURATION_SEC = 10;

/** 暫停後可合併為同一筆紀錄的最大間隔（5 分鐘） */
export const SESSION_MERGE_WINDOW_MS = 5 * 60 * 1000;

export type PracticeLogSource =
  | {
      kind: 'scale';
      patternId: string;
      patternName: string;
    }
  | {
      kind: 'midi';
      midiId: string;
      midiName: string;
      midiHash: string;
      startBar: number;
      endBar: number;
    };

export interface PracticeLogEntry {
  id: string;
  /** 開始時間（UTC epoch 毫秒，顯示與分組依裝置本地時區轉換） */
  startedAtMs: number;
  /** 實際播放累計秒數 */
  durationSec: number;
  source: PracticeLogSource;
  mode: 'follow' | 'listen-then-sing' | 'shadow';
  bpm: number;
  rangeName: string;
  voice: 'normal' | 'male';
  /** 依實際播放到的 KeyBlock 順序記錄主音音名（不重複） */
  keys: string[];
  lowestKey: string | null;
  highestKey: string | null;
  lowestTonicMidi?: number | null;
  highestTonicMidi?: number | null;
  /** 播放頭完整跑完唱段的遍數（含 ∞ 循環） */
  completedPasses: number;
  /** 本次練唱期間是否曾開啟麥克風 */
  usedMic: boolean;
}

export interface PracticeSessionContext {
  source: PracticeLogSource;
  mode: 'follow' | 'listen-then-sing' | 'shadow';
  bpm: number;
  rangeName: string;
  voice: 'normal' | 'male';
  micActive: boolean;
}

export interface SingPassSpan {
  keyIndex: number;
  pass: number;
  start: number;
  end: number;
}

export interface PracticeSessionState {
  id: string;
  startedAtMs: number;
  source: PracticeLogSource;
  sourceKey: string;
  mode: 'follow' | 'listen-then-sing' | 'shadow';
  bpm: number;
  rangeName: string;
  voice: 'normal' | 'male';
  durationSec: number;
  isPlaying: boolean;
  lastPlaySec: number | null;
  lastPausedAtMs: number | null;
  keys: string[];
  lowestKey: string | null;
  highestKey: string | null;
  lowestTonicMidi: number | null;
  highestTonicMidi: number | null;
  completedPasses: number;
  usedMic: boolean;
  activePassKey: string | null;
  activePassMinSec: number | null;
}

export interface PracticeDayGroup {
  /** 本地日期鍵值 YYYY-MM-DD */
  dateKey: string;
  totalSec: number;
  totalMinutes: number;
  entries: PracticeLogEntry[];
}

export interface WeekDayBar {
  dateKey: string;
  weekdayLabel: string;
  dayNumber: number;
  totalSec: number;
  minutes: number;
  hasEntries: boolean;
  isToday: boolean;
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function generateSessionId(nowMs: number): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `log-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 產生來源識別鍵，用於判斷暫停續播是否屬於同一音型／歌曲 */
export function sourceToKey(source: PracticeLogSource): string {
  if (source.kind === 'scale') {
    return `scale:${source.patternId}`;
  }
  return `midi:${source.midiHash}:${source.startBar}-${source.endBar}`;
}

/** 從 Exercise 擷取所有唱段（phase === 'sing'）的起訖秒數 */
export function extractSingPassSpans(ex: Exercise): SingPassSpan[] {
  if (ex.passWindows && ex.passWindows.length > 0) {
    return ex.passWindows
      .filter((w) => w.phase === 'sing')
      .map((w) => ({
        keyIndex: w.keyIndex,
        pass: w.pass,
        start: w.start,
        end: w.end,
      }))
      .sort((a, b) => a.start - b.start);
  }
  const map = new Map<string, SingPassSpan>();
  for (const n of ex.notes) {
    if (n.phase !== 'sing') continue;
    const key = `${n.keyIndex}:${n.pass}`;
    const existing = map.get(key);
    const noteEnd = n.start + n.dur;
    if (!existing) {
      map.set(key, {
        keyIndex: n.keyIndex,
        pass: n.pass,
        start: n.start,
        end: noteEnd,
      });
    } else {
      existing.start = Math.min(existing.start, n.start);
      existing.end = Math.max(existing.end, noteEnd);
    }
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}

/** 建立新的練唱 session 狀態 */
export function createSessionState(
  ctx: PracticeSessionContext,
  nowMs: number,
  id?: string,
): PracticeSessionState {
  return {
    id: id ?? generateSessionId(nowMs),
    startedAtMs: nowMs,
    source: ctx.source,
    sourceKey: sourceToKey(ctx.source),
    mode: ctx.mode,
    bpm: Math.round(ctx.bpm),
    rangeName: ctx.rangeName,
    voice: ctx.voice,
    durationSec: 0,
    isPlaying: true,
    lastPlaySec: null,
    lastPausedAtMs: null,
    keys: [],
    lowestKey: null,
    highestKey: null,
    lowestTonicMidi: null,
    highestTonicMidi: null,
    completedPasses: 0,
    usedMic: ctx.micActive,
    activePassKey: null,
    activePassMinSec: null,
  };
}

/** 判斷暫停後的 session 是否可在 5 分鐘內接續合併 */
export function canResumeSession(
  state: PracticeSessionState,
  source: PracticeLogSource,
  nowMs: number,
): boolean {
  if (state.isPlaying) return false;
  if (state.sourceKey !== sourceToKey(source)) return false;
  if (state.lastPausedAtMs === null) return false;
  const gap = nowMs - state.lastPausedAtMs;
  return gap >= 0 && gap <= SESSION_MERGE_WINDOW_MS;
}

/** 開始或續播 session；若無法合併則先結算前一段 */
export function startOrResumeSession(
  prev: PracticeSessionState | null,
  ctx: PracticeSessionContext,
  nowMs: number,
  newId?: string,
): { state: PracticeSessionState; finalizedPrev: PracticeLogEntry | null } {
  if (prev && canResumeSession(prev, ctx.source, nowMs)) {
      return {
      state: {
        ...prev,
        mode: ctx.mode,
        bpm: Math.round(ctx.bpm),
        rangeName: ctx.rangeName,
        voice: ctx.voice,
        isPlaying: true,
        lastPlaySec: null,
        lastPausedAtMs: null,
        usedMic: prev.usedMic || ctx.micActive,
        activePassKey: null,
        activePassMinSec: null,
      },
      finalizedPrev: null,
    };
  }

  const finalizedPrev = prev ? toLogEntry(pauseSession(prev, nowMs)) : null;
  return {
    state: createSessionState(ctx, nowMs, newId),
    finalizedPrev,
  };
}

function accumulatePlayheadDelta(
  state: PracticeSessionState,
  sec: number,
  isPlaying: boolean,
): number {
  if (!isPlaying || !state.isPlaying || state.lastPlaySec === null) {
    return state.durationSec;
  }
  const deltaSec = sec - state.lastPlaySec;
  if (deltaSec <= 0) {
    return state.durationSec;
  }
  return state.durationSec + deltaSec;
}

function recordKeyBlock(
  state: PracticeSessionState,
  kb: KeyBlock,
): Pick<
  PracticeSessionState,
  'keys' | 'lowestKey' | 'highestKey' | 'lowestTonicMidi' | 'highestTonicMidi'
> {
  const label = displayNoteNameInKey(kb.tonicMidi, kb.key);
  const keys = state.keys.includes(label) ? state.keys : [...state.keys, label];

  let lowestKey = state.lowestKey;
  let lowestTonicMidi = state.lowestTonicMidi;
  if (lowestTonicMidi === null || kb.tonicMidi < lowestTonicMidi) {
    lowestTonicMidi = kb.tonicMidi;
    lowestKey = label;
  }

  let highestKey = state.highestKey;
  let highestTonicMidi = state.highestTonicMidi;
  if (highestTonicMidi === null || kb.tonicMidi > highestTonicMidi) {
    highestTonicMidi = kb.tonicMidi;
    highestKey = label;
  }

  return {
    keys,
    lowestKey,
    highestKey,
    lowestTonicMidi,
    highestTonicMidi,
  };
}

function isPassEntryValid(minSec: number | null, span: SingPassSpan): boolean {
  if (minSec === null) return false;
  const dur = Math.max(0, span.end - span.start);
  const tolerance = Math.max(0.25, dur * 0.35);
  return minSec <= span.start + tolerance;
}

/** 手動跳轉播放位置時重設基準秒數，避免把跳轉區間計入播放秒數 */
export function syncSessionPlayhead(
  state: PracticeSessionState,
  targetSec: number,
): PracticeSessionState {
  return {
    ...state,
    lastPlaySec: state.isPlaying ? targetSec : null,
    activePassKey: null,
    activePassMinSec: null,
  };
}

/** 依播放位置更新累計秒數、練過的調與完成遍數 */
export function advanceSessionPlayback(
  state: PracticeSessionState,
  sec: number,
  isPlaying: boolean,
  exercise: Exercise | null,
  micActive: boolean,
  nowMs: number,
): PracticeSessionState {
  const durationSec = accumulatePlayheadDelta(state, sec, isPlaying);
  let next: PracticeSessionState = {
    ...state,
    durationSec,
    isPlaying,
    lastPlaySec: isPlaying ? sec : null,
    lastPausedAtMs:
      !isPlaying && state.isPlaying ? nowMs : state.lastPausedAtMs,
    usedMic: state.usedMic || micActive,
  };

  if (!isPlaying || !exercise) {
    return next;
  }

  // 記錄實際播放到的 KeyBlock（依序且不重複）
  const activeKb = exercise.keys.find(
    (k) => sec >= k.start && sec < k.end - 0.01,
  );
  if (activeKb) {
    next = {
      ...next,
      ...recordKeyBlock(next, activeKb),
    };
  }

  // 追蹤唱段遍數
  const spans = extractSingPassSpans(exercise);
  if (next.activePassKey) {
    const activeSpan = spans.find(
      (s) => `${s.keyIndex}:${s.pass}` === next.activePassKey,
    );
    if (!activeSpan) {
      next.activePassKey = null;
      next.activePassMinSec = null;
    } else if (sec >= activeSpan.end - 0.03) {
      if (isPassEntryValid(next.activePassMinSec, activeSpan)) {
        next.completedPasses += 1;
      }
      next.activePassKey = null;
      next.activePassMinSec = null;
    } else if (sec < activeSpan.start - 0.2) {
      // 向後跳轉（例如 ∞ 循環重播或手動拉回）
      next.activePassKey = null;
      next.activePassMinSec = null;
    }
  }

  const currentSpan = spans.find(
    (s) => sec >= s.start - 0.05 && sec < s.end - 0.03,
  );
  if (currentSpan) {
    const key = `${currentSpan.keyIndex}:${currentSpan.pass}`;
    if (next.activePassKey !== key) {
      next.activePassKey = key;
      next.activePassMinSec = sec;
    } else {
      next.activePassMinSec = Math.min(next.activePassMinSec ?? sec, sec);
    }
  }

  return next;
}

/** 播放到達結尾或 ∞ 循環觸發換回開頭時結算當前唱段 */
export function completeSessionAtEnd(
  state: PracticeSessionState,
  exercise: Exercise | null,
  nowMs: number,
  keepPlaying = false,
  endSec?: number,
): PracticeSessionState {
  const durationSec =
    typeof endSec === 'number'
      ? accumulatePlayheadDelta(state, endSec, true)
      : state.durationSec;
  let completedPasses = state.completedPasses;

  if (state.activePassKey && exercise) {
    const spans = extractSingPassSpans(exercise);
    const activeSpan = spans.find(
      (s) => `${s.keyIndex}:${s.pass}` === state.activePassKey,
    );
    if (activeSpan && isPassEntryValid(state.activePassMinSec, activeSpan)) {
      completedPasses += 1;
    }
  }

  return {
    ...state,
    durationSec,
    completedPasses,
    activePassKey: null,
    activePassMinSec: null,
    isPlaying: keepPlaying,
    lastPlaySec: null,
    lastPausedAtMs: keepPlaying ? null : nowMs,
  };
}

/** 暫停或停止 session */
export function pauseSession(
  state: PracticeSessionState,
  nowMs: number,
): PracticeSessionState {
  return {
    ...state,
    isPlaying: false,
    lastPlaySec: null,
    lastPausedAtMs: state.isPlaying ? nowMs : (state.lastPausedAtMs ?? nowMs),
  };
}

/** 轉為可儲存的練習紀錄（播放累計未滿 10 秒回傳 null） */
export function toLogEntry(
  state: PracticeSessionState,
): PracticeLogEntry | null {
  if (state.durationSec < MIN_LOG_DURATION_SEC) {
    return null;
  }
  return {
    id: state.id,
    startedAtMs: state.startedAtMs,
    durationSec: Math.round(state.durationSec),
    source: state.source,
    mode: state.mode,
    bpm: state.bpm,
    rangeName: state.rangeName,
    voice: state.voice,
    keys: [...state.keys],
    lowestKey: state.lowestKey,
    highestKey: state.highestKey,
    lowestTonicMidi: state.lowestTonicMidi,
    highestTonicMidi: state.highestTonicMidi,
    completedPasses: state.completedPasses,
    usedMic: state.usedMic,
  };
}

/** 依使用者裝置本地時區產生 YYYY-MM-DD 日期鍵值（以本地午夜為界） */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 格式化本地時間 HH:MM */
export function formatTimeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 格式化日期標題，例如「11 月 28 日（六）· 共 23 分鐘」 */
export function formatDayHeader(dateKey: string, totalMinutes: number): string {
  const [yStr, mStr, dStr] = dateKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const date = new Date(year, month - 1, day);
  const weekday = WEEKDAY_LABELS[date.getDay()] ?? '';
  return `${month} 月 ${day} 日（${weekday}）· 共 ${totalMinutes} 分鐘`;
}

/** 依本地日期由新到舊分組，每天內依開始時間由新到舊排列 */
export function groupEntriesByDate(
  entries: readonly PracticeLogEntry[],
): PracticeDayGroup[] {
  const map = new Map<string, PracticeLogEntry[]>();
  for (const entry of entries) {
    const key = localDateKey(entry.startedAtMs);
    const list = map.get(key);
    if (list) {
      list.push(entry);
    } else {
      map.set(key, [entry]);
    }
  }

  const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
  return keys.map((dateKey) => {
    const dayEntries = map
      .get(dateKey)!
      .slice()
      .sort((a, b) => b.startedAtMs - a.startedAtMs);
    const totalSec = dayEntries.reduce((sum, e) => sum + e.durationSec, 0);
    return {
      dateKey,
      totalSec,
      totalMinutes: Math.round(totalSec / 60),
      entries: dayEntries,
    };
  });
}

/** 計算本週（週一至週日）每日練習分鐘彙總 */
export function buildWeekBar(
  entries: readonly PracticeLogEntry[],
  referenceMs = Date.now(),
): WeekDayBar[] {
  const ref = new Date(referenceMs);
  const todayKey = localDateKey(referenceMs);
  // 週一為一週第一天（getDay(): 0=日, 1=一 ... 6=六）
  const dayOfWeek = ref.getDay();
  const offsetFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(
    ref.getFullYear(),
    ref.getMonth(),
    ref.getDate() - offsetFromMonday,
  );

  const secByDate = new Map<string, number>();
  for (const e of entries) {
    const k = localDateKey(e.startedAtMs);
    secByDate.set(k, (secByDate.get(k) ?? 0) + e.durationSec);
  }

  const bars: WeekDayBar[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + i,
    );
    const dateKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const totalSec = secByDate.get(dateKey) ?? 0;
    bars.push({
      dateKey,
      weekdayLabel: WEEKDAY_LABELS[d.getDay()] ?? '',
      dayNumber: d.getDate(),
      totalSec,
      minutes: Math.round(totalSec / 60),
      hasEntries: totalSec > 0,
      isToday: dateKey === todayKey,
    });
  }
  return bars;
}

/** 格式化調性範圍摘要（例：「C4 → E4，共 5 調」） */
export function formatKeyRangeSummary(
  entry: Pick<PracticeLogEntry, 'keys' | 'lowestKey' | 'highestKey'>,
): string {
  const count = entry.keys.length;
  if (count === 0) {
    return '未記錄調性';
  }
  const low = entry.lowestKey ?? entry.keys[0]!;
  const high = entry.highestKey ?? entry.keys[count - 1]!;
  if (count === 1 || low === high) {
    return `${low}，共 ${count} 調`;
  }
  return `${low} → ${high}，共 ${count} 調`;
}

/** 取得練唱模式的繁體中文顯示名稱 */
export function formatPracticeModeLabel(
  mode: 'follow' | 'listen-then-sing' | 'shadow',
): string {
  if (mode === 'follow') return '跟唱';
  if (mode === 'shadow') return '影子練習';
  return '先聽再唱';
}

/** 取得來源顯示名稱 */
export function formatSourceTitle(source: PracticeLogSource): string {
  if (source.kind === 'scale') {
    return source.patternName;
  }
  return `${source.midiName}（第 ${source.startBar}–${source.endBar} 小節）`;
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_HEADERS = [
  '日期',
  '開始時間',
  '類型',
  '名稱',
  '區間',
  '練唱模式',
  'BPM',
  '音域',
  '聲部',
  '練習分鐘',
  '播放秒數',
  '完成遍數',
  '最低調',
  '最高調',
  '練過的調',
  '使用麥克風',
] as const;

/** 匯出 UTF-8（含 BOM）CSV 字串，欄位使用中文標題並正確跳脫逗號與引號 */
export function exportPracticeLogCsv(
  entries: readonly PracticeLogEntry[],
): string {
  const sorted = entries
    .slice()
    .sort((a, b) => b.startedAtMs - a.startedAtMs);

  const lines: string[] = [CSV_HEADERS.map(escapeCsvCell).join(',')];

  for (const e of sorted) {
    const dateStr = localDateKey(e.startedAtMs);
    const timeStr = formatTimeOfDay(e.startedAtMs);
    const kindStr = e.source.kind === 'scale' ? '音階練習' : 'MIDI 練唱';
    const nameStr =
      e.source.kind === 'scale' ? e.source.patternName : e.source.midiName;
    const rangeBarStr =
      e.source.kind === 'midi'
        ? `第 ${e.source.startBar}–${e.source.endBar} 小節`
        : '';
    const modeStr = formatPracticeModeLabel(e.mode);
    const voiceStr = e.voice === 'male' ? '男聲' : '一般';
    const minutesStr = Math.round(e.durationSec / 60);
    const keysStr = e.keys.join(' → ');
    const micStr = e.usedMic ? '是' : '否';

    const row = [
      dateStr,
      timeStr,
      kindStr,
      nameStr,
      rangeBarStr,
      modeStr,
      e.bpm,
      e.rangeName,
      voiceStr,
      minutesStr,
      e.durationSec,
      e.completedPasses,
      e.lowestKey ?? '',
      e.highestKey ?? '',
      keysStr,
      micStr,
    ];
    lines.push(row.map(escapeCsvCell).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}`;
}
