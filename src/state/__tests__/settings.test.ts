import { describe, expect, it } from 'vitest';
import { buildExercise } from '../../core/exercise';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  clampStartTonic,
  findLowestFeasibleTonic,
  formatExerciseSummary,
  loadSettings,
  nextRepeatsPerKey,
  repeatsPerKeyToCount,
  sanitizeSettings,
  saveSettings,
  toExerciseOptions,
  type PracticeSettings,
  type StorageLike,
} from '../settings';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('settings', () => {
  it('空儲存空間時回傳預設值', () => {
    const storage = createMemoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('壞 JSON 不會拋錯並回傳預設值', () => {
    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: '{not valid json!!!',
    });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);

    const storageNull = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: 'null',
    });
    expect(loadSettings(storageNull)).toEqual(DEFAULT_SETTINGS);
  });

  it('超出範圍的數值與無效欄位會被修正', () => {
    const sanitized = sanitizeSettings({
      patternId: 'non-existent-id',
      startTonic: 999,
      rangeName: '不存在的音域',
      bpm: 10,
      noteBeats: 3,
      repeats: 9,
      articulation: 'marcato',
      transpose: 'down',
      mode: 'karaoke',
      pianoDuringSing: 'yes',
      pad: 1,
      cadence: false,
      countIn: false,
      metronome: 'no',
      jianpuMode: 'movable',
      a4: 500,
    });

    expect(sanitized.patternId).toBe(DEFAULT_SETTINGS.patternId);
    expect(sanitized.startTonic).toBe(96);
    expect(sanitized.rangeName).toBe(DEFAULT_SETTINGS.rangeName);
    expect(sanitized.bpm).toBe(40);
    expect(sanitized.noteBeats).toBe(DEFAULT_SETTINGS.noteBeats);
    expect(sanitized.repeats).toBe(4);
    expect(sanitized.articulation).toBe(DEFAULT_SETTINGS.articulation);
    expect(sanitized.transpose).toBe(DEFAULT_SETTINGS.transpose);
    expect(sanitized.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(sanitized.pianoDuringSing).toBe(DEFAULT_SETTINGS.pianoDuringSing);
    expect(sanitized.pad).toBe(DEFAULT_SETTINGS.pad);
    expect(sanitized.cadence).toBe(false);
    expect(sanitized.countIn).toBe(false);
    expect(sanitized.metronome).toBe(DEFAULT_SETTINGS.metronome);
    expect(sanitized.jianpuMode).toBe('movable');
    expect(sanitized.a4).toBe(465);
  });

  it('存取來回一致', () => {
    const storage = createMemoryStorage();
    const custom: PracticeSettings = {
      ...DEFAULT_SETTINGS,
      patternId: 'major-arpeggio',
      startTonic: 55,
      rangeName: '男中音',
      bpm: 120,
      noteBeats: 2,
      repeats: 3,
      articulation: 'staccato',
      transpose: 'up',
      mode: 'follow',
      pianoDuringSing: false,
      pad: false,
      cadence: false,
      countIn: false,
      metronome: false,
      jianpuMode: 'movable',
      a4: 442,
      micMode: 'headphone',
      singPianoVolume: 50,
      echoCancellation: true,
      noiseGateDb: -52,
      latencyOffsetMs: -40,
      hideSpeakerHint: true,
    };

    saveSettings(custom, storage);
    expect(loadSettings(storage)).toEqual(custom);
  });
});

describe('toExerciseOptions 與摘要', () => {
  it('各欄位正確對應至 ExerciseOptions，並計算大三和弦分解在男高音 C4 上去再下來的實際調數', () => {
    const majorArpeggio = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const settings: PracticeSettings = {
      ...DEFAULT_SETTINGS,
      patternId: majorArpeggio.id,
      rangeName: '男高音', // [48, 72]
      startTonic: 60, // C4
      bpm: 100,
      noteBeats: 0.5,
      repeats: 2,
      articulation: 'staccato',
      transpose: 'up-down',
      cadence: false,
      countIn: false,
      mode: 'follow',
    };

    const opts = toExerciseOptions(settings);
    expect(opts).toEqual({
      startTonic: 60,
      low: 48,
      high: 72,
      bpm: 100,
      noteBeats: 0.5,
      repeats: 2,
      articulation: 'staccato',
      transpose: 'up-down',
      cadence: false,
      countInBeats: 0,
      mode: 'follow',
    });

    // 男高音 high=72，大三和弦分解最高音為 +12 半音，C4(60)+12=72 僅能容納 1 個調
    const ex = buildExercise(majorArpeggio, opts);
    expect(ex.keys).toHaveLength(1);
    expect(ex.keys[0]!.tonicMidi).toBe(60);

    const summary = formatExerciseSummary(ex, settings.transpose);
    expect(summary).toContain('1 個調');
    expect(summary).toContain('C3') // 中央 Do 顯示為 C3;
  });
});

describe('自動調整起始音', () => {
  it('起始音超出音域時回傳可行的最低起始音', () => {
    const majorArpeggio = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    // 男高音 [48, 72]，大三和弦分解 span 為 0..12，最低可行起始音為 48
    expect(findLowestFeasibleTonic(majorArpeggio, 48, 72)).toBe(48);
    expect(clampStartTonic(majorArpeggio, 65, 48, 72)).toBe(60);
    expect(clampStartTonic(majorArpeggio, 40, 48, 72)).toBe(48);
  });

  it('圖案跨度大於音域時回傳 null', () => {
    const ninthScale = BUILTIN_PATTERNS.find((p) => p.id === 'ninth-scale')!; // 0..14 半音
    // 假設極窄音域只有 10 個半音（60..70）
    expect(findLowestFeasibleTonic(ninthScale, 60, 70)).toBeNull();
    expect(clampStartTonic(ninthScale, 60, 60, 70)).toBeNull();
  });
});

describe('每調重複次數循環與舊設定相容', () => {
  it('依序循環 ×1 → ×2 → ×3 → ×5 → ∞ → ×1', () => {
    expect(nextRepeatsPerKey(1)).toBe(2);
    expect(nextRepeatsPerKey(2)).toBe(3);
    expect(nextRepeatsPerKey(3)).toBe(5);
    expect(nextRepeatsPerKey(5)).toBe('inf');
    expect(nextRepeatsPerKey('inf')).toBe(1);

    expect(repeatsPerKeyToCount(2)).toBe(2);
    expect(repeatsPerKeyToCount('inf')).toBe(1);
  });

  it('預設為 2，且讀取舊設定檔缺少 repeatsPerKey 時補預設 2', () => {
    expect(DEFAULT_SETTINGS.repeatsPerKey).toBe(2);
    const oldPayload = JSON.stringify({
      patternId: 'major-arpeggio',
      bpm: 100,
      repeats: 1,
    });
    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: oldPayload,
    });
    const loaded = loadSettings(storage);
    expect(loaded.repeatsPerKey).toBe(2);
    expect(sanitizeSettings({ repeatsPerKey: 99 }).repeatsPerKey).toBe(2);
  });
});
