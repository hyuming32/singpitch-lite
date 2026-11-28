import { describe, expect, it } from 'vitest';
import { buildExercise } from '../../core/exercise';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import {
  DEFAULT_SETTINGS,
  MALE_RANGES,
  MY_RANGE_NAME,
  NORMAL_RANGES,
  SETTINGS_STORAGE_KEY,
  clampBpm,
  clampStartTonic,
  filterBpmInputChars,
  findLowestFeasibleTonic,
  formatBpm,
  formatExerciseSummary,
  getRangeBounds,
  loadSettings,
  nextRepeatsPerKey,
  parseBpmInput,
  rangesForVoice,
  repeatsPerKeyToCount,
  resolveRangeForVoice,
  resolveVoiceDisplay,
  sanitizeSettings,
  saveSettings,
  stepBpm,
  switchVoiceSettings,
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
      repeatsPerKey: 99,
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
    expect(sanitized.repeatsPerKey).toBe(DEFAULT_SETTINGS.repeatsPerKey);
    expect('repeats' in sanitized).toBe(false);
    expect(sanitized.articulation).toBe(DEFAULT_SETTINGS.articulation);
    expect(sanitized.transpose).toBe(DEFAULT_SETTINGS.transpose);
    expect(sanitized.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(sanitized.pianoDuringSing).toBe(DEFAULT_SETTINGS.pianoDuringSing);
    expect(sanitized.pad).toBe(DEFAULT_SETTINGS.pad);
    expect(sanitized.cadence).toBe('off');
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
      startTonic: 48,
      voice: 'male',
      rangeName: '男中音',
      bpm: 120,
      noteBeats: 2,
      repeatsPerKey: 3,
      articulation: 'staccato',
      transpose: 'up',
      mode: 'listen-then-sing',
      pianoDuringSing: false,
      pad: false,
      cadence: 'single',
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

  it('cadence 預設為 leading，且舊值 double 與 true 皆相容轉為 leading', () => {
    expect(DEFAULT_SETTINGS.cadence).toBe('leading');
    expect(sanitizeSettings({ cadence: 'double' }).cadence).toBe('leading');
    expect(sanitizeSettings({ cadence: true }).cadence).toBe('leading');
    expect(sanitizeSettings({ cadence: false }).cadence).toBe('off');
    expect(sanitizeSettings({ cadence: 'direct' }).cadence).toBe('direct');
    expect(sanitizeSettings({ cadence: 'leading' }).cadence).toBe('leading');
    expect(sanitizeSettings({ cadence: 'single' }).cadence).toBe('single');

    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ cadence: 'double' }),
    });
    expect(loadSettings(storage).cadence).toBe('leading');
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
      repeatsPerKey: 2,
      articulation: 'staccato',
      transpose: 'up-down',
      cadence: 'off',
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
      cadence: 'off',
      countInBeats: 0,
      mode: 'follow',
      shadowGapMultiplier: 1,
    });

    // repeatsPerKey 統一映射到 ExerciseOptions.repeats（'inf' 時建立 1 遍）
    expect(toExerciseOptions({ ...settings, repeatsPerKey: 5 }).repeats).toBe(5);
    expect(toExerciseOptions({ ...settings, repeatsPerKey: 'inf' }).repeats).toBe(1);

    // 男高音 high=72，大三和弦分解最高音為 +12 半音，C4(60)+12=72 僅能容納 1 個調
    const ex = buildExercise(majorArpeggio, opts);
    expect(ex.keys).toHaveLength(1);
    expect(ex.keys[0]!.tonicMidi).toBe(60);

    const summary = formatExerciseSummary(ex, settings.transpose);
    expect(summary).toContain('1 個調');
    expect(summary).toContain('C4'); // 中央 Do 顯示為 C4
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

  it('預設為 1 且 mode 預設為 follow，讀取舊設定檔缺少 repeatsPerKey 時補預設 1，已有合法 mode 與 repeatsPerKey 則保留', () => {
    expect(DEFAULT_SETTINGS.repeatsPerKey).toBe(1);
    expect(DEFAULT_SETTINGS.mode).toBe('follow');

    const oldPayload = JSON.stringify({
      patternId: 'major-arpeggio',
      bpm: 100,
      repeats: 1,
    });
    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: oldPayload,
    });
    const loaded = loadSettings(storage);
    expect(loaded.repeatsPerKey).toBe(1);
    expect(loaded.mode).toBe('follow');
    expect('repeats' in loaded).toBe(false);
    expect(sanitizeSettings({ repeatsPerKey: 99 }).repeatsPerKey).toBe(1);
    expect(
      sanitizeSettings({ repeats: 4, repeatsPerKey: 5 }).repeatsPerKey,
    ).toBe(5);

    const savedListenStorage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        mode: 'listen-then-sing',
        repeatsPerKey: 2,
      }),
    });
    const loadedListen = loadSettings(savedListenStorage);
    expect(loadedListen.mode).toBe('listen-then-sing');
    expect(loadedListen.repeatsPerKey).toBe(2);
    expect(loadedListen.shadowGapMultiplier).toBe(1);

    // 影子模式與空拍倍率 2 存取，以及舊資料補齊預設倍率 1
    const shadowStorage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        mode: 'shadow',
        shadowGapMultiplier: 2,
      }),
    });
    const loadedShadow = loadSettings(shadowStorage);
    expect(loadedShadow.mode).toBe('shadow');
    expect(loadedShadow.shadowGapMultiplier).toBe(2);
  });
});

describe('聲部與譜號設定（voice / maleClef / resolveVoiceDisplay）', () => {
  it('預設為 normal + treble8va，讀取舊設定 singOctaveMode 時會忽略', () => {
    expect(DEFAULT_SETTINGS.voice).toBe('normal');
    expect(DEFAULT_SETTINGS.maleClef).toBe('treble8va');

    const migrated = sanitizeSettings({
      singOctaveMode: 'up',
      voice: 'invalid',
      maleClef: 'alto',
    });
    expect(migrated.voice).toBe('normal');
    expect(migrated.maleClef).toBe('treble8va');
    expect('singOctaveMode' in migrated).toBe(false);
  });

  it('舊設定 voice 與 rangeName 不一致時自動對齊（男聲音域 → male；女聲音域 → normal；完整 C2–C6 維持不變）', () => {
    expect(sanitizeSettings({ voice: 'normal', rangeName: '男高音' }).voice).toBe(
      'male',
    );
    expect(sanitizeSettings({ rangeName: '男低音' }).voice).toBe('male');
    expect(sanitizeSettings({ voice: 'male', rangeName: '女高音' }).voice).toBe(
      'normal',
    );
    expect(sanitizeSettings({ voice: 'male', rangeName: '女低音' }).voice).toBe(
      'normal',
    );
    expect(sanitizeSettings({ voice: 'male', rangeName: '完整 C2–C6' }).voice).toBe(
      'male',
    );
    expect(
      sanitizeSettings({ voice: 'normal', rangeName: '完整 C2–C6' }).voice,
    ).toBe('normal');

    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        rangeName: '男中音',
        bpm: 100,
      }),
    });
    const loaded = loadSettings(storage);
    expect(loaded.voice).toBe('male');
    expect(loaded.rangeName).toBe('男中音');
  });

  it('三種聲部模式的譜號、顯示位移與 8va 標籤正確', () => {
    const majorArp = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;

    // 1. 正常（女中音 [57, 81] → 高音譜、不位移）
    const normalDisplay = resolveVoiceDisplay({
      voice: 'normal',
      maleClef: 'treble8va',
      rangeName: '女中音',
    });
    expect(normalDisplay).toEqual({
      clef: 'treble',
      pitchShift: 0,
      octaveTag: null,
    });

    // 2. 男聲＋高音譜 8va（音高 +12、強制高音譜、顯示 8va）
    const male8vaSettings: PracticeSettings = {
      ...DEFAULT_SETTINGS,
      voice: 'male',
      maleClef: 'treble8va',
      rangeName: '男中音',
      startTonic: 48, // C3
      transpose: 'fixed',
      countIn: false,
      mode: 'follow',
    };
    const male8vaDisplay = resolveVoiceDisplay(male8vaSettings);
    expect(male8vaDisplay).toEqual({
      clef: 'treble',
      pitchShift: 12,
      octaveTag: '8va',
    });
    const ex8va = buildExercise(majorArp, {
      ...toExerciseOptions(male8vaSettings),
      displayTranspose: male8vaDisplay.pitchShift,
    });
    expect(ex8va.keys[0]!.tonicMidi).toBe(60); // 48 + 12
    expect(ex8va.notes[0]!.midi).toBe(60); // 鋼琴示範彈 +12 後的音

    // 3. 男聲＋低音譜（實際音高、強制低音譜、不顯示 8va）
    const maleBassSettings: PracticeSettings = {
      ...male8vaSettings,
      maleClef: 'bass',
      rangeName: '男高音', // 即便選男高音 [48, 72] 也強制低音譜
    };
    const maleBassDisplay = resolveVoiceDisplay(maleBassSettings);
    expect(maleBassDisplay).toEqual({
      clef: 'bass',
      pitchShift: 0,
      octaveTag: null,
    });
    const exBass = buildExercise(majorArp, {
      ...toExerciseOptions(maleBassSettings),
      displayTranspose: maleBassDisplay.pitchShift,
    });
    expect(exBass.keys[0]!.tonicMidi).toBe(48);
    expect(exBass.notes[0]!.midi).toBe(48);
  });

  it('音域清單依聲部過濾，且切換聲部時自動切換不屬於該聲部的音域', () => {
    expect(rangesForVoice('normal')).toEqual(NORMAL_RANGES);
    expect(rangesForVoice('male')).toEqual(MALE_RANGES);
    expect(rangesForVoice('normal')).toContain('完整 C2–C6');
    expect(rangesForVoice('male')).toContain('完整 C2–C6');
    expect(rangesForVoice('normal')).not.toContain('男中音');
    expect(rangesForVoice('male')).not.toContain('女中音');

    // 女中音 → 切換為男聲 → 自動換成男中音
    expect(resolveRangeForVoice('女中音', 'male')).toBe('男中音');
    // 男高音 → 切換為正常 → 自動換成女中音
    expect(resolveRangeForVoice('男高音', 'normal')).toBe('女中音');
    // 完整 C2–C6 兩邊皆保留
    expect(resolveRangeForVoice('完整 C2–C6', 'male')).toBe('完整 C2–C6');
    expect(resolveRangeForVoice('完整 C2–C6', 'normal')).toBe('完整 C2–C6');

    const majorArp = BUILTIN_PATTERNS.find((p) => p.id === 'major-arpeggio')!;
    const patch = switchVoiceSettings(
      { voice: 'normal', rangeName: '女中音', startTonic: 65 },
      'male',
      majorArp,
    );
    expect(patch.voice).toBe('male');
    expect(patch.rangeName).toBe('男中音');
    // 男中音 [45, 65] 搭配大三和弦分解 (0..12)，原 65 超出音域 → 自動調整為最低可行 startTonic 45
    expect(patch.startTonic).toBe(45);
  });
});

describe('myRange 序列化、舊設定相容與 getRangeBounds', () => {
  it('舊設定缺少 myRange 時為 null，且 getRangeBounds 在 myRange 為 null 時退回預設', () => {
    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        rangeName: '我的音域',
        bpm: 100,
      }),
    });
    const loaded = loadSettings(storage);
    expect(loaded.myRange).toBeNull();
    expect(loaded.rangeName).toBe(DEFAULT_SETTINGS.rangeName);
    expect(getRangeBounds(MY_RANGE_NAME, null)).toEqual([57, 81]);
  });

  it('myRange 存取來回一致，且過窄的 myRange 會被 sanitizeSettings 剔除', () => {
    const storage = createMemoryStorage();
    const myRange = {
      low: 45,
      high: 67,
      raw: [44, 68] as [number, number],
      method: 'twoNotes' as const,
      voice: 'male' as const,
      measuredAt: '2026-11-27T08:00:00.000Z',
    };
    saveSettings(
      {
        ...DEFAULT_SETTINGS,
        rangeName: MY_RANGE_NAME,
        voice: 'male',
        myRange,
      },
      storage,
    );
    const loaded = loadSettings(storage);
    expect(loaded.rangeName).toBe(MY_RANGE_NAME);
    expect(loaded.voice).toBe('male');
    expect(loaded.myRange).toEqual(myRange);
    expect(getRangeBounds(MY_RANGE_NAME, loaded.myRange)).toEqual([45, 67]);

    // 過窄（raw 僅 6 個半音 < 8）應被忽略
    const tooNarrow = sanitizeSettings({
      rangeName: MY_RANGE_NAME,
      myRange: {
        low: 51,
        high: 55,
        raw: [50, 56],
        method: 'glide',
        voice: 'normal',
        measuredAt: '2026-11-27T08:00:00.000Z',
      },
    });
    expect(tooNarrow.myRange).toBeNull();
    expect(tooNarrow.rangeName).toBe(DEFAULT_SETTINGS.rangeName);
  });
});

describe('BPM 小數存取、解析、格式化與 ±1 步進', () => {
  it('支援一位小數存取、四捨五入 0.1、夾住 40.0–208.0 與舊整數設定相容', () => {
    const storage = createMemoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, bpm: 72.55 }, storage);
    expect(loadSettings(storage).bpm).toBe(72.6);

    saveSettings({ ...DEFAULT_SETTINGS, bpm: 208 }, storage);
    expect(loadSettings(storage).bpm).toBe(208);

    expect(sanitizeSettings({ bpm: 72.5 }).bpm).toBe(72.5);
    expect(sanitizeSettings({ bpm: 72.54 }).bpm).toBe(72.5);
    expect(sanitizeSettings({ bpm: 72.55 }).bpm).toBe(72.6);
    expect(sanitizeSettings({ bpm: 300 }).bpm).toBe(208);
    expect(sanitizeSettings({ bpm: 10 }).bpm).toBe(40);
    // 舊整數設定維持相容
    expect(sanitizeSettings({ bpm: 96 }).bpm).toBe(96);
    expect(sanitizeSettings({ bpm: 200 }).bpm).toBe(200);
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_SETTINGS.bpm);
  });

  it('parseBpmInput 正確解析有效字串、四捨五入、夾住範圍與拒絕非法輸入', () => {
    expect(parseBpmInput('72.5')).toBe(72.5);
    expect(parseBpmInput('72.55')).toBe(72.6);
    expect(parseBpmInput('abc')).toBeNull();
    expect(parseBpmInput('300')).toBe(208);
    expect(parseBpmInput('30')).toBe(40);
    expect(parseBpmInput('')).toBeNull();
    expect(parseBpmInput('   ')).toBeNull();
    expect(parseBpmInput('.')).toBeNull();
    expect(parseBpmInput('72.5.1')).toBeNull();
    expect(parseBpmInput('-50')).toBeNull();
    expect(parseBpmInput('96.0')).toBe(96);
    expect(parseBpmInput(' 72.5 ')).toBe(72.5);
  });

  it('filterBpmInputChars 只保留數字與最多一個小數點', () => {
    expect(filterBpmInputChars('72.5')).toBe('72.5');
    expect(filterBpmInputChars('7a2.5.3b')).toBe('72.53');
    expect(filterBpmInputChars('abc')).toBe('');
    expect(filterBpmInputChars('..1')).toBe('.1');
  });

  it('formatBpm 整數不顯示小數點、非整數顯示一位小數', () => {
    expect(formatBpm(96)).toBe('96');
    expect(formatBpm(96.0)).toBe('96');
    expect(formatBpm(72.5)).toBe('72.5');
    expect(formatBpm(208.0)).toBe('208');
    expect(formatBpm(72.04)).toBe('72');
    expect(formatBpm(72.55)).toBe('72.6');
  });

  it('stepBpm ±1 時保留小數部分並夾在 40.0–208.0', () => {
    expect(stepBpm(72.5, 1)).toBe(73.5);
    expect(stepBpm(72.5, -1)).toBe(71.5);
    expect(stepBpm(72.3, 1)).toBe(73.3);
    expect(stepBpm(207.5, 1)).toBe(208);
    expect(stepBpm(40.5, -1)).toBe(40);
  });
});

describe('載入設定與選取修正超出音域的起始音', () => {
  it('舊設定 startTonic=55 搭配男中音 [45, 65] 與大三和弦分解時，loadSettings 自動修正為 45', () => {
    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        patternId: 'major-arpeggio', // 0..12
        rangeName: '男中音', // [45, 65]
        startTonic: 55, // 55+12=67 > 65 超界
      }),
    });
    const loaded = loadSettings(storage);
    expect(loaded.rangeName).toBe('男中音');
    expect(loaded.voice).toBe('male');
    expect(loaded.startTonic).toBe(45);
  });

  it('音型跨度大於音域（完全放不下）時，維持原起始音以便介面顯示超出音域', () => {
    const storage = createMemoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        patternId: 'ninth-scale', // 0..14
        rangeName: '我的音域',
        startTonic: 60,
        myRange: {
          low: 60,
          high: 70, // 僅 10 半音
          raw: [59, 71],
          method: 'twoNotes',
          voice: 'normal',
          measuredAt: '2026-11-27T00:00:00Z',
        },
      }),
    });
    const loaded = loadSettings(storage);
    expect(loaded.startTonic).toBe(60);
  });
});

describe('噪音校正狀態與音高線顏色設定', () => {
  it('預設值與舊存檔缺欄位時使用預設值', () => {
    expect(DEFAULT_SETTINGS.noiseCalibrated).toBe(false);
    expect(DEFAULT_SETTINGS.staffPitchColor).toBe('#e8b400');
    expect(DEFAULT_SETTINGS.pianoNeedleColor).toBe('#0047ff');

    const oldLoaded = sanitizeSettings({ bpm: 100 });
    expect(oldLoaded.noiseCalibrated).toBe(false);
    expect(oldLoaded.staffPitchColor).toBe('#e8b400');
    expect(oldLoaded.pianoNeedleColor).toBe('#0047ff');
  });

  it('noiseCalibrated 非布林時退回 false；合法 #rrggbb 保留、亂填回預設', () => {
    const valid = sanitizeSettings({
      noiseCalibrated: true,
      staffPitchColor: '#e5383b',
      pianoNeedleColor: '#1F9D55',
    });
    expect(valid.noiseCalibrated).toBe(true);
    expect(valid.staffPitchColor).toBe('#e5383b');
    expect(valid.pianoNeedleColor).toBe('#1F9D55');

    const invalid = sanitizeSettings({
      noiseCalibrated: 'yes',
      staffPitchColor: 'red',
      pianoNeedleColor: '#fff',
    });
    expect(invalid.noiseCalibrated).toBe(false);
    expect(invalid.staffPitchColor).toBe('#e8b400');
    expect(invalid.pianoNeedleColor).toBe('#0047ff');

    const invalid2 = sanitizeSettings({
      staffPitchColor: '#zzzzzz',
      pianoNeedleColor: '123456',
    });
    expect(invalid2.staffPitchColor).toBe('#e8b400');
    expect(invalid2.pianoNeedleColor).toBe('#0047ff');
  });
});
