import type { Exercise, ExerciseOptions } from '../core/exercise';
import type { JianpuMode } from '../core/jianpu';
import { RANGES } from '../core/notes';
import { clefForRange, type Clef } from '../core/staff';
import { displayNoteName } from '../ui/noteLabel';
import { BUILTIN_PATTERNS, parseJianpu, type PatternDef } from '../core/patterns';

export const SETTINGS_STORAGE_KEY = 'singpitch-lite.settings.v1';

export type NoteBeatsOption = 0.5 | 1 | 2;
export type ArticulationOption = 'legato' | 'staccato';
export type TransposeOption = 'fixed' | 'up' | 'up-down';
export type PracticeModeOption = 'follow' | 'listen-then-sing';
export type MicInputMode = 'speaker' | 'headphone';
export type RepeatsPerKeyOption = 1 | 2 | 3 | 5 | 'inf';
export type VoiceOption = 'normal' | 'male';
export type MaleClefOption = 'treble8va' | 'bass';

export const NORMAL_RANGES = [
  '女低音',
  '女中音',
  '女高音',
  '完整 C2–C6',
] as const;

export const MALE_RANGES = [
  '男低音',
  '男中音',
  '男高音',
  '完整 C2–C6',
] as const;

/** 自訂測量音域名稱與最低有效半音跨度 */
export const MY_RANGE_NAME = '我的音域';
export const MIN_MY_RANGE_SEMITONES = 8;

const MALE_ONLY_RANGES = new Set<string>(['男低音', '男中音', '男高音']);
const FEMALE_ONLY_RANGES = new Set<string>(['女低音', '女中音', '女高音']);

export interface MyRangeData {
  low: number;
  high: number;
  raw: [number, number];
  method: 'twoNotes' | 'glide';
  voice: VoiceOption;
  measuredAt: string;
}

export const REPEATS_PER_KEY_CYCLE: readonly RepeatsPerKeyOption[] = [
  1,
  2,
  3,
  5,
  'inf',
];

/** 切換下一個每調重複次數：×1 → ×2 → ×3 → ×5 → ∞ → ×1 */
export function nextRepeatsPerKey(
  current: RepeatsPerKeyOption,
): RepeatsPerKeyOption {
  const idx = REPEATS_PER_KEY_CYCLE.indexOf(current);
  if (idx === -1) {
    return 2;
  }
  return REPEATS_PER_KEY_CYCLE[(idx + 1) % REPEATS_PER_KEY_CYCLE.length]!;
}

/** 將每調重複次數轉為 ExerciseOptions.repeats 數值（∞ 時為 1 並由播放器循環該調） */
export function repeatsPerKeyToCount(value: RepeatsPerKeyOption): number {
  return value === 'inf' ? 1 : value;
}

export interface PracticeSettings {
  patternId: string;
  startTonic: number;
  rangeName: string;
  bpm: number;
  noteBeats: NoteBeatsOption;
  repeatsPerKey: RepeatsPerKeyOption;
  articulation: ArticulationOption;
  transpose: TransposeOption;
  mode: PracticeModeOption;
  pianoDuringSing: boolean;
  pad: boolean;
  cadence: boolean;
  countIn: boolean;
  metronome: boolean;
  jianpuMode: JianpuMode;
  a4: number;
  pianoHeight: number | null;
  pianoCollapsed: boolean;
  micMode: MicInputMode;
  singPianoVolume: number;
  echoCancellation: boolean;
  noiseGateDb: number;
  latencyOffsetMs: number;
  hideSpeakerHint: boolean;
  voice: VoiceOption;
  maleClef: MaleClefOption;
  myRange: MyRangeData | null;
}

export const DEFAULT_SETTINGS: PracticeSettings = {
  patternId: BUILTIN_PATTERNS[0]!.id,
  startTonic: 60, // C4
  rangeName: '女中音',
  bpm: 96,
  noteBeats: 1,
  repeatsPerKey: 2,
  articulation: 'legato',
  transpose: 'up-down',
  mode: 'listen-then-sing',
  pianoDuringSing: true,
  pad: true,
  cadence: true,
  countIn: true,
  metronome: true,
  jianpuMode: 'fixed',
  a4: 440,
  pianoHeight: null,
  pianoCollapsed: false,
  micMode: 'speaker',
  singPianoVolume: 70,
  echoCancellation: false,
  noiseGateDb: -45,
  latencyOffsetMs: 0,
  hideSpeakerHint: false,
  voice: 'normal',
  maleClef: 'treble8va',
  myRange: null,
};

export const BPM_MIN = 40;
export const BPM_MAX = 208;

/** 將 BPM 四捨五入至 0.1 並夾在 40.0–208.0 範圍內 */
export function clampBpm(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.bpm;
  }
  const rounded = Math.round(value * 10) / 10;
  return Math.max(BPM_MIN, Math.min(BPM_MAX, rounded));
}

/** 依 delta（如 ±1）加減 BPM，保留小數部分並夾在允許範圍內 */
export function stepBpm(current: number, delta: number): number {
  return clampBpm(current + delta);
}

/** 過濾 BPM 輸入框字元，只保留數字與最多一個小數點 */
export function filterBpmInputChars(raw: string): string {
  let out = '';
  let hasDot = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (ch === '.' && !hasDot) {
      out += '.';
      hasDot = true;
    }
  }
  return out;
}

/** 解析 BPM 輸入字串：有效數字回傳四捨五入至 0.1 並夾住範圍的值，非法輸入回傳 null */
export function parseBpmInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return null;
  }
  return clampBpm(num);
}

/** 格式化 BPM 顯示字串：整數不顯示小數點，非整數顯示一位小數 */
export function formatBpm(bpm: number): string {
  if (!Number.isFinite(bpm)) {
    return String(DEFAULT_SETTINGS.bpm);
  }
  const rounded = Math.round(bpm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sanitizeBpm(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return clampBpm(value);
}

function validateBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeMyRange(value: unknown): MyRangeData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.low !== 'number' ||
    !Number.isFinite(obj.low) ||
    typeof obj.high !== 'number' ||
    !Number.isFinite(obj.high)
  ) {
    return null;
  }
  const low = Math.round(obj.low);
  const high = Math.round(obj.high);
  if (low < 21 || high > 108 || low > high) {
    return null;
  }

  if (!Array.isArray(obj.raw) || obj.raw.length !== 2) {
    return null;
  }
  const r0 = obj.raw[0];
  const r1 = obj.raw[1];
  if (
    typeof r0 !== 'number' ||
    !Number.isFinite(r0) ||
    typeof r1 !== 'number' ||
    !Number.isFinite(r1)
  ) {
    return null;
  }
  const rawLow = Math.round(r0);
  const rawHigh = Math.round(r1);
  if (
    rawLow < 21 ||
    rawHigh > 108 ||
    rawHigh - rawLow < MIN_MY_RANGE_SEMITONES ||
    high - low < MIN_MY_RANGE_SEMITONES - 2
  ) {
    return null;
  }

  const method =
    obj.method === 'twoNotes' || obj.method === 'glide' ? obj.method : null;
  const voice: VoiceOption | null =
    obj.voice === 'male' || obj.voice === 'normal' ? obj.voice : null;
  const measuredAt = typeof obj.measuredAt === 'string' ? obj.measuredAt : null;

  if (!method || !voice || !measuredAt) {
    return null;
  }

  return {
    low,
    high,
    raw: [rawLow, rawHigh],
    method,
    voice,
    measuredAt,
  };
}

/** 驗證並正規化練習設定，確保壞資料或超範圍數值不影響執行 */
export function sanitizeSettings(raw: unknown): PracticeSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;

  const patternId =
    typeof obj.patternId === 'string' &&
    BUILTIN_PATTERNS.some((p) => p.id === obj.patternId)
      ? obj.patternId
      : DEFAULT_SETTINGS.patternId;

  const myRange = sanitizeMyRange(obj.myRange);

  const rangeName =
    typeof obj.rangeName === 'string' &&
    (obj.rangeName in RANGES ||
      (obj.rangeName === MY_RANGE_NAME && myRange !== null))
      ? obj.rangeName
      : DEFAULT_SETTINGS.rangeName;

  const noteBeats: NoteBeatsOption =
    obj.noteBeats === 0.5 || obj.noteBeats === 1 || obj.noteBeats === 2
      ? obj.noteBeats
      : DEFAULT_SETTINGS.noteBeats;

  const articulation: ArticulationOption =
    obj.articulation === 'legato' || obj.articulation === 'staccato'
      ? obj.articulation
      : DEFAULT_SETTINGS.articulation;

  const transpose: TransposeOption =
    obj.transpose === 'fixed' || obj.transpose === 'up' || obj.transpose === 'up-down'
      ? obj.transpose
      : DEFAULT_SETTINGS.transpose;

  const mode: PracticeModeOption =
    obj.mode === 'follow' || obj.mode === 'listen-then-sing'
      ? obj.mode
      : DEFAULT_SETTINGS.mode;

  const jianpuMode: JianpuMode =
    obj.jianpuMode === 'fixed' || obj.jianpuMode === 'movable'
      ? obj.jianpuMode
      : DEFAULT_SETTINGS.jianpuMode;

  const micMode: MicInputMode =
    obj.micMode === 'speaker' || obj.micMode === 'headphone'
      ? obj.micMode
      : DEFAULT_SETTINGS.micMode;

  const repeatsPerKey: RepeatsPerKeyOption =
    obj.repeatsPerKey === 1 ||
    obj.repeatsPerKey === 2 ||
    obj.repeatsPerKey === 3 ||
    obj.repeatsPerKey === 5 ||
    obj.repeatsPerKey === 'inf'
      ? obj.repeatsPerKey
      : DEFAULT_SETTINGS.repeatsPerKey;

  let voice: VoiceOption =
    obj.voice === 'normal' || obj.voice === 'male'
      ? obj.voice
      : DEFAULT_SETTINGS.voice;

  if (MALE_ONLY_RANGES.has(rangeName)) {
    voice = 'male';
  } else if (FEMALE_ONLY_RANGES.has(rangeName)) {
    voice = 'normal';
  } else if (
    rangeName === MY_RANGE_NAME &&
    myRange &&
    obj.voice !== 'normal' &&
    obj.voice !== 'male'
  ) {
    voice = myRange.voice;
  }

  const maleClef: MaleClefOption =
    obj.maleClef === 'treble8va' || obj.maleClef === 'bass'
      ? obj.maleClef
      : DEFAULT_SETTINGS.maleClef;

  return {
    patternId,
    startTonic: clampInt(obj.startTonic, 24, 96, DEFAULT_SETTINGS.startTonic),
    rangeName,
    bpm: sanitizeBpm(obj.bpm, DEFAULT_SETTINGS.bpm),
    noteBeats,
    repeatsPerKey,
    articulation,
    transpose,
    mode,
    pianoDuringSing: validateBoolean(obj.pianoDuringSing, DEFAULT_SETTINGS.pianoDuringSing),
    pad: validateBoolean(obj.pad, DEFAULT_SETTINGS.pad),
    cadence: validateBoolean(obj.cadence, DEFAULT_SETTINGS.cadence),
    countIn: validateBoolean(obj.countIn, DEFAULT_SETTINGS.countIn),
    metronome: validateBoolean(obj.metronome, DEFAULT_SETTINGS.metronome),
    jianpuMode,
    a4: clampInt(obj.a4, 415, 465, DEFAULT_SETTINGS.a4),
    pianoHeight:
      typeof obj.pianoHeight === 'number' && Number.isFinite(obj.pianoHeight)
        ? Math.max(40, Math.min(600, Math.round(obj.pianoHeight)))
        : null,
    pianoCollapsed: validateBoolean(
      obj.pianoCollapsed,
      DEFAULT_SETTINGS.pianoCollapsed,
    ),
    micMode,
    singPianoVolume: clampInt(
      obj.singPianoVolume,
      0,
      100,
      DEFAULT_SETTINGS.singPianoVolume,
    ),
    echoCancellation: validateBoolean(
      obj.echoCancellation,
      DEFAULT_SETTINGS.echoCancellation,
    ),
    noiseGateDb: clampInt(
      obj.noiseGateDb,
      -80,
      -20,
      DEFAULT_SETTINGS.noiseGateDb,
    ),
    latencyOffsetMs: clampInt(
      obj.latencyOffsetMs,
      -300,
      300,
      DEFAULT_SETTINGS.latencyOffsetMs,
    ),
    hideSpeakerHint: validateBoolean(
      obj.hideSpeakerHint,
      DEFAULT_SETTINGS.hideSpeakerHint,
    ),
    voice,
    maleClef,
    myRange,
  };
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function getDefaultStorage(): StorageLike | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/** 若目前起始音使音型超出音域（但音域本身可容納該音型），自動改為最低可行起始音 */
export function ensureFeasibleStartTonic(
  settings: PracticeSettings,
): PracticeSettings {
  const pat =
    BUILTIN_PATTERNS.find((p) => p.id === settings.patternId) ??
    BUILTIN_PATTERNS[0];
  if (!pat) {
    return settings;
  }
  const [low, high] = getRangeBounds(settings.rangeName, settings.myRange);
  const { minSemi, maxSemi } = getPatternSpan(pat);
  if (
    settings.startTonic + minSemi >= low &&
    settings.startTonic + maxSemi <= high
  ) {
    return settings;
  }
  const lowest = findLowestFeasibleTonic(pat, low, high);
  if (lowest === null || lowest === settings.startTonic) {
    return settings;
  }
  return { ...settings, startTonic: lowest };
}

/** 從 localStorage 讀取設定；若格式錯誤或損毀則回傳預設值，並自動修正超界起始音 */
export function loadSettings(storage: StorageLike | undefined = getDefaultStorage()): PracticeSettings {
  if (!storage) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed: unknown = JSON.parse(raw);
    return ensureFeasibleStartTonic(sanitizeSettings(parsed));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 將設定儲存至 localStorage */
export function saveSettings(
  settings: PracticeSettings,
  storage: StorageLike | undefined = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
  } catch {
    // 忽略私密瀏覽或容量限制錯誤
  }
}

/** 取得音域名稱對應的 [low, high] MIDI 範圍；若為我的音域但未測量則退回預設 */
export function getRangeBounds(
  rangeName: string,
  myRange?: MyRangeData | null,
): readonly [number, number] {
  if (rangeName === MY_RANGE_NAME) {
    if (
      myRange &&
      Number.isFinite(myRange.low) &&
      Number.isFinite(myRange.high) &&
      myRange.high >= myRange.low
    ) {
      return [myRange.low, myRange.high];
    }
    return RANGES[DEFAULT_SETTINGS.rangeName] ?? [57, 81];
  }
  return RANGES[rangeName] ?? RANGES[DEFAULT_SETTINGS.rangeName] ?? [57, 81];
}

/** 取得指定聲部可用的音域名稱清單（含完整 C2–C6） */
export function rangesForVoice(voice: VoiceOption): readonly string[] {
  return voice === 'male' ? MALE_RANGES : NORMAL_RANGES;
}

/** 取得指定聲部的預設音域名稱 */
export function defaultRangeForVoice(voice: VoiceOption): string {
  return voice === 'male' ? '男中音' : '女中音';
}

/** 若目前音域不屬於目標聲部，自動切換至該聲部的預設音域（我的音域與完整範圍保留） */
export function resolveRangeForVoice(
  currentRangeName: string,
  voice: VoiceOption,
): string {
  if (currentRangeName === MY_RANGE_NAME) {
    return MY_RANGE_NAME;
  }
  const allowed = rangesForVoice(voice);
  return allowed.includes(currentRangeName)
    ? currentRangeName
    : defaultRangeForVoice(voice);
}

/** 切換聲部時產生需更新的設定欄位（含音域與起始音自動夾限） */
export function switchVoiceSettings(
  settings: Pick<PracticeSettings, 'voice' | 'rangeName' | 'startTonic'> & {
    myRange?: MyRangeData | null;
  },
  nextVoice: VoiceOption,
  pattern?: Pick<PatternDef, 'jianpu'>,
): Partial<PracticeSettings> {
  const nextRange = resolveRangeForVoice(settings.rangeName, nextVoice);
  const patch: Partial<PracticeSettings> = { voice: nextVoice };
  if (nextRange !== settings.rangeName) {
    patch.rangeName = nextRange;
  }
  if (pattern) {
    const [newLow, newHigh] = getRangeBounds(nextRange, settings.myRange);
    const clamped = clampStartTonic(
      pattern,
      settings.startTonic,
      newLow,
      newHigh,
    );
    if (clamped !== null && clamped !== settings.startTonic) {
      const { minSemi, maxSemi } = getPatternSpan(pattern);
      const outOfRange =
        settings.startTonic + minSemi < newLow ||
        settings.startTonic + maxSemi > newHigh;
      const lowest = outOfRange
        ? findLowestFeasibleTonic(pattern, newLow, newHigh)
        : clamped;
      if (lowest !== null && lowest !== settings.startTonic) {
        patch.startTonic = lowest;
      }
    }
  }
  return patch;
}

export interface VoiceDisplayConfig {
  clef: Clef;
  /** 譜面與示範鋼琴的半音平移（男聲＋高音譜 8va 為 +12，其餘為 0） */
  pitchShift: 0 | 12;
  /** 五線譜左上標籤旁的八度標記 */
  octaveTag: '8va' | null;
}

/** 依聲部與譜號設定計算練唱頁的譜號、音高顯示位移與 8va 標籤 */
export function resolveVoiceDisplay(
  settings: Pick<PracticeSettings, 'voice' | 'maleClef' | 'rangeName'> & {
    myRange?: MyRangeData | null;
  },
): VoiceDisplayConfig {
  if (settings.voice === 'male') {
    if (settings.maleClef === 'treble8va') {
      return { clef: 'treble', pitchShift: 12, octaveTag: '8va' };
    }
    return { clef: 'bass', pitchShift: 0, octaveTag: null };
  }
  const [low, high] = getRangeBounds(settings.rangeName, settings.myRange);
  return {
    clef: clefForRange(low, high),
    pitchShift: 0,
    octaveTag: null,
  };
}

/** 將 PracticeSettings 轉換為 buildExercise 所需的 ExerciseOptions */
export function toExerciseOptions(settings: PracticeSettings): ExerciseOptions {
  const [low, high] = getRangeBounds(settings.rangeName, settings.myRange);
  return {
    startTonic: settings.startTonic,
    low,
    high,
    bpm: settings.bpm,
    noteBeats: settings.noteBeats,
    repeats: repeatsPerKeyToCount(settings.repeatsPerKey),
    articulation: settings.articulation,
    transpose: settings.transpose,
    cadence: settings.cadence,
    countInBeats: settings.countIn ? 4 : 0,
    mode: settings.mode,
  };
}

/** 計算圖案相對主音的最低與最高半音偏移 */
export function getPatternSpan(pattern: Pick<PatternDef, 'jianpu'>): {
  minSemi: number;
  maxSemi: number;
} {
  const parsed = parseJianpu(pattern.jianpu);
  const semitones = parsed.events
    .map((e) => e.semitone)
    .filter((s): s is number => s !== null);
  if (semitones.length === 0) {
    return { minSemi: 0, maxSemi: 0 };
  }
  return {
    minSemi: Math.min(...semitones),
    maxSemi: Math.max(...semitones),
  };
}

/** 尋找音域內可行的最低起始音；若圖案跨度大於音域則回傳 null */
export function findLowestFeasibleTonic(
  pattern: Pick<PatternDef, 'jianpu'>,
  low: number,
  high: number,
): number | null {
  const { minSemi, maxSemi } = getPatternSpan(pattern);
  const feasibleLow = low - minSemi;
  const feasibleHigh = high - maxSemi;
  if (feasibleLow > feasibleHigh) {
    return null;
  }
  return feasibleLow;
}

/** 將起始音夾在圖案與音域允許的可行範圍內；若完全不可行則回傳 null */
export function clampStartTonic(
  pattern: Pick<PatternDef, 'jianpu'>,
  startTonic: number,
  low: number,
  high: number,
): number | null {
  const { minSemi, maxSemi } = getPatternSpan(pattern);
  const feasibleLow = low - minSemi;
  const feasibleHigh = high - maxSemi;
  if (feasibleLow > feasibleHigh) {
    return null;
  }
  return Math.max(feasibleLow, Math.min(feasibleHigh, startTonic));
}

/** 格式化練習摘要文字，例：「C4 → G4 → C4，共 15 個調 · 約 3 分 05 秒」 */
export function formatExerciseSummary(
  exercise: Exercise,
  transpose: TransposeOption,
): string {
  const keys = exercise.keys;
  let keyPart: string;
  if (keys.length <= 1) {
    const first = keys[0]?.tonicMidi ?? 60;
    keyPart = `${displayNoteName(first)}，共 ${keys.length} 個調`;
  } else {
    const first = keys[0]!.tonicMidi;
    const last = keys[keys.length - 1]!.tonicMidi;
    if (transpose === 'up-down') {
      const peak = Math.max(...keys.map((k) => k.tonicMidi));
      keyPart = `${displayNoteName(first)} → ${displayNoteName(peak)} → ${displayNoteName(last)}，共 ${keys.length} 個調`;
    } else {
      keyPart = `${displayNoteName(first)} → ${displayNoteName(last)}，共 ${keys.length} 個調`;
    }
  }

  const totalSec = Math.max(0, Math.round(exercise.total));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const durPart = `約 ${mins} 分 ${String(secs).padStart(2, '0')} 秒`;

  return `${keyPart} · ${durPart}`;
}
