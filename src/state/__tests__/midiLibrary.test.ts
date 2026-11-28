import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIDI_MIXER,
  fnv1aHash,
  loadMidiSongSettings,
  MemoryMidiStore,
  migrateMidiSongRange,
  resolveMidiMixer,
  sanitizeMidiSongSettings,
  saveMidiSongSettings,
  stripMidiExtension,
  type MidiSongSettings,
} from '../midiLibrary';
import type { StorageLike } from '../settings';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('fnv1aHash 與 stripMidiExtension', () => {
  it('相同內容產生相同雜湊，不同內容產生不同雜湊', () => {
    const a = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]);
    const b = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]);
    const c = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 7]);
    expect(fnv1aHash(a)).toBe(fnv1aHash(b));
    expect(fnv1aHash(a)).not.toBe(fnv1aHash(c));
    expect(fnv1aHash(a)).toHaveLength(8);
  });

  it('stripMidiExtension 正確去除 .mid 與 .midi 副檔名', () => {
    expect(stripMidiExtension('SKY_SKY.MID')).toBe('SKY_SKY');
    expect(stripMidiExtension('my-song.midi')).toBe('my-song');
    expect(stripMidiExtension('測試曲目')).toBe('測試曲目');
  });
});

describe('MemoryMidiStore（記憶體版 MIDI 曲庫）', () => {
  it('支援新增、列出（依匯入時間新到舊）、取得與刪除', async () => {
    const store = new MemoryMidiStore();
    expect(store.persistent).toBe(false);
    expect(await store.list()).toEqual([]);

    const bytes1 = new Uint8Array([1, 2, 3]);
    const bytes2 = new Uint8Array([4, 5, 6]);
    await store.put({
      id: 'h1',
      hash: 'h1',
      name: 'first.mid',
      importedAt: '2026-11-28T01:00:00.000Z',
      bytes: bytes1,
    });
    await store.put({
      id: 'h2',
      hash: 'h2',
      name: 'second.mid',
      importedAt: '2026-11-28T02:00:00.000Z',
      bytes: bytes2,
    });

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('second.mid');
    expect(list[1]!.name).toBe('first.mid');

    const loaded = await store.get('h1');
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!.bytes)).toEqual([1, 2, 3]);

    await store.delete('h1');
    expect(await store.get('h1')).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });
});

describe('MIDI 每首設定存取（localStorage）', () => {
  it('依檔案雜湊儲存與讀取設定，並對超範圍值進行夾限', () => {
    const storage = createMemoryStorage();
    const hash = fnv1aHash(new Uint8Array([10, 20, 30]));

    expect(loadMidiSongSettings(hash, storage)).toBeNull();

    const cfg: MidiSongSettings = {
      trackIndex: 2,
      startBar: 3,
      endBar: 8,
      transposeSemitones: -4,
      speedPercent: 85.4701,
      manualKey: { tonicPc: 7, mode: 'major' },
    };
    saveMidiSongSettings(hash, cfg, storage);

    const loaded = loadMidiSongSettings(hash, storage);
    expect(loaded).toEqual(cfg);

    // 另一首歌互不干擾
    expect(loadMidiSongSettings('deadbeef', storage)).toBeNull();
  });

  it('儲存與讀取分軌角色與混音器設定，並相容無新欄位的舊資料', () => {
    const storage = createMemoryStorage();
    const oldHash = '11223344';
    const newHash = '55667788';

    // 模擬舊資料格式（無 trackRoles 與 mixer）
    storage.setItem(
      'singpitch-lite.midi.v1',
      JSON.stringify({
        [oldHash]: {
          trackIndex: 3,
          startBar: 7,
          endBar: 32,
          transposeSemitones: 0,
          speedPercent: 100,
          manualKey: null,
        },
      }),
    );

    const oldLoaded = loadMidiSongSettings(oldHash, storage);
    expect(oldLoaded).not.toBeNull();
    expect(oldLoaded!.trackIndex).toBe(3);
    expect(oldLoaded!.trackRoles).toBeUndefined();
    expect(resolveMidiMixer(oldLoaded)).toEqual(DEFAULT_MIDI_MIXER);

    // 儲存含分軌與混音器的新設定（若意外傳入兩個 vocal，應自動正規化只留一個）
    const cfgWithMix: MidiSongSettings = {
      trackIndex: 2,
      startBar: 1,
      endBar: 16,
      transposeSemitones: 2,
      speedPercent: 90,
      manualKey: null,
      trackRoles: {
        1: 'vocal',
        2: 'vocal',
        3: 'accompaniment',
        11: 'rhythm',
        9: 'mute',
      },
      mixer: {
        vocalEnabled: true,
        vocalVolume: 75,
        accompEnabled: false,
        accompVolume: 40,
        rhythmEnabled: true,
        rhythmVolume: 65,
      },
    };
    saveMidiSongSettings(newHash, cfgWithMix, storage);

    const loadedNew = loadMidiSongSettings(newHash, storage);
    expect(loadedNew).not.toBeNull();
    expect(loadedNew!.trackRoles).toEqual({
      1: 'accompaniment',
      2: 'vocal',
      3: 'accompaniment',
      11: 'rhythm',
      9: 'mute',
    });
    expect(loadedNew!.mixer).toEqual(cfgWithMix.mixer);
    expect(resolveMidiMixer(loadedNew)).toEqual(cfgWithMix.mixer);
  });

  it('舊設定遷移規則：無 regionUserSet 且起點等於自動略過小節時重設為 1；有標記或不等於時不動', () => {
    const base: MidiSongSettings = {
      trackIndex: 0,
      startBar: 7,
      endBar: 32,
      transposeSemitones: 0,
      speedPercent: 100,
      manualKey: null,
    };

    // 1. 無 regionUserSet 且 startBar === legacyAutoStartBar (7) -> 重設回 1
    const migrated = migrateMidiSongRange(base, 7);
    expect(migrated.changed).toBe(true);
    expect(migrated.settings.startBar).toBe(1);
    expect(migrated.settings.endBar).toBe(32);

    // 2. 有 regionUserSet=true -> 即使等於 legacyAutoStartBar 也不動
    const userSetRes = migrateMidiSongRange(
      { ...base, regionUserSet: true },
      7,
    );
    expect(userSetRes.changed).toBe(false);
    expect(userSetRes.settings.startBar).toBe(7);

    // 3. 無 regionUserSet 但 startBar !== legacyAutoStartBar -> 不動
    const customStartRes = migrateMidiSongRange({ ...base, startBar: 5 }, 7);
    expect(customStartRes.changed).toBe(false);
    expect(customStartRes.settings.startBar).toBe(5);

    // 4. 儲存與讀取保留 regionUserSet
    const storage = createMemoryStorage();
    saveMidiSongSettings('abc12345', { ...base, regionUserSet: true }, storage);
    expect(loadMidiSongSettings('abc12345', storage)?.regionUserSet).toBe(true);
  });

  it('sanitizeMidiSongSettings 驗證 A–B 循環小節欄位（整數、在 startBar..endBar 內、B<A 自動對調、不合法丟棄）', () => {
    const valid = sanitizeMidiSongSettings({
      trackIndex: 0,
      startBar: 4,
      endBar: 12,
      loopStartBar: 6,
      loopEndBar: 10,
    });
    expect(valid?.loopStartBar).toBe(6);
    expect(valid?.loopEndBar).toBe(10);

    // B < A 自動對調
    const swapped = sanitizeMidiSongSettings({
      trackIndex: 0,
      startBar: 4,
      endBar: 12,
      loopStartBar: 10,
      loopEndBar: 5,
    });
    expect(swapped?.loopStartBar).toBe(5);
    expect(swapped?.loopEndBar).toBe(10);

    // 超出 startBar..endBar 或非整數時丟棄
    const invalid = sanitizeMidiSongSettings({
      trackIndex: 0,
      startBar: 4,
      endBar: 12,
      loopStartBar: 2,
      loopEndBar: 8.5,
    });
    expect(invalid?.loopStartBar).toBeUndefined();
    expect(invalid?.loopEndBar).toBeUndefined();

    // 只有 A 沒有 B 合法保留
    const onlyA = sanitizeMidiSongSettings({
      trackIndex: 0,
      startBar: 4,
      endBar: 12,
      loopStartBar: 7,
    });
    expect(onlyA?.loopStartBar).toBe(7);
    expect(onlyA?.loopEndBar).toBeUndefined();
  });
});
