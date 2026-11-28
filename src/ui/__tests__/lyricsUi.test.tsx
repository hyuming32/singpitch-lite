import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LyricLine } from '../../core/lyrics';
import type { MidiAsset } from '../../core/midi';
import { buildMidiExercise } from '../../core/midiExercise';
import { MemoryLyricsStore } from '../../state/lyricsStore';
import {
  DEFAULT_MIDI_MIXER,
  loadMidiSongSettings,
  MemoryMidiStore,
  resolveMidiLyricsOffset,
  sanitizeMidiSongSettings,
  saveMidiSongSettings,
} from '../../state/midiLibrary';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  sanitizeSettings,
  SETTINGS_STORAGE_KEY,
  type StorageLike,
} from '../../state/settings';
import { AudioProvider } from '../AudioContext';
import { MidiPage } from '../midi/MidiPage';
import { LyricsStrip } from '../practice/LyricsStrip';
import { MidiSeekBar } from '../practice/MidiSeekBar';
import { PracticePage } from '../practice/PracticePage';
import { PracticeSettingsSheet } from '../practice/PracticeSettingsSheet';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function makeAssetWithLyrics(): MidiAsset {
  return {
    tracks: [
      {
        index: 0,
        name: 'Vocal',
        notes: [
          { start: 0, end: 0.5, midi: 60, velocity: 90, track: 0, startTick: 0, endTick: 240 },
          { start: 0.5, end: 1.0, midi: 62, velocity: 90, track: 0, startTick: 240, endTick: 480 },
          { start: 2.0, end: 2.5, midi: 64, velocity: 90, track: 0, startTick: 960, endTick: 1200 },
        ],
      },
    ],
    duration: 4.0,
    ticksPerBeat: 480,
    beats: [
      [0.0, 0, 120],
      [0.5, 1, 120],
      [1.0, 2, 120],
      [1.5, 3, 120],
      [2.0, 0, 120],
      [2.5, 1, 120],
      [3.0, 2, 120],
      [3.5, 3, 120],
    ],
    lyrics: [
      { tick: 0, time: 0.0, track: 0, type: 0x05, text: '一' },
      { tick: 240, time: 0.5, track: 0, type: 0x05, text: '二' },
      { tick: 960, time: 2.0, track: 0, type: 0x05, text: '三' },
    ],
    lyricsEncoding: 'utf-8',
  };
}

describe('LyricsStore 與設定舊資料相容性', () => {
  it('MemoryLyricsStore 支援儲存、讀取與刪除匯入字幕', async () => {
    const store = new MemoryLyricsStore();
    expect(await store.get('song1')).toBeNull();
    await store.put({
      id: 'song1',
      fileName: 'demo.lrc',
      importedAt: '2026-11-28T00:00:00.000Z',
      document: {
        lines: [
          {
            time: 0,
            text: '一二',
            tokens: [
              { text: '一', start: 0, end: 0.5 },
              { text: '二', start: 0.5, end: 1.0 },
            ],
          },
        ],
      },
    });
    const loaded = await store.get('song1');
    expect(loaded?.fileName).toBe('demo.lrc');
    expect(loaded?.document.lines).toHaveLength(1);
    await store.delete('song1');
    expect(await store.get('song1')).toBeNull();
  });

  it('PracticeSettings 與 MidiSongSettings 舊資料缺少歌詞欄位時補齊預設並正確夾限', () => {
    const oldSettings = loadSettings(
      createMemoryStorage({
        [SETTINGS_STORAGE_KEY]: JSON.stringify({ bpm: 100 }),
      }),
    );
    expect(oldSettings.lyricsVisible).toBe(true);
    expect(oldSettings.lyricsScale).toBe(100);
    expect(oldSettings.lyricsLeadSec).toBe(0);

    const clamped = sanitizeSettings({
      lyricsVisible: false,
      lyricsScale: 200,
      lyricsLeadSec: 0.23,
    });
    expect(clamped.lyricsVisible).toBe(false);
    expect(clamped.lyricsScale).toBe(160);
    expect(clamped.lyricsLeadSec).toBe(0.25);

    // 舊每首設定無 lyricsOffsetSec
    expect(resolveMidiLyricsOffset(sanitizeMidiSongSettings({
      trackIndex: 0,
      startBar: 1,
      endBar: 8,
    }))).toBe(0);

    const storage = createMemoryStorage();
    saveMidiSongSettings('abc', {
      trackIndex: 0,
      startBar: 1,
      endBar: 8,
      transposeSemitones: 0,
      speedPercent: 100,
      manualKey: null,
      lyricsOffsetSec: -1.33,
    }, storage);
    expect(loadMidiSongSettings('abc', storage)?.lyricsOffsetSec).toBe(-1.35);
  });
});

describe('歌詞與進度拉桿 UI 元件渲染', () => {
  it('LyricsStrip 逐字變色、支援字幕提前與單行／雙行模式', () => {
    const lines: LyricLine[] = [
      {
        time: 0,
        text: '一二',
        tokens: [
          { text: '一', start: 0, end: 1 },
          { text: '二', start: 1, end: 2 },
        ],
      },
      {
        time: 2,
        text: '三四',
        tokens: [
          { text: '三', start: 2, end: 3 },
          { text: '四', start: 3, end: 4 },
        ],
      },
    ];

    // passSec=0.5, leadSec=0.5 -> effectiveTime=1.0 -> '一' 已唱完 (is-sung), '二' 尚未唱
    const html2 = renderToStaticMarkup(
      createElement(LyricsStrip, {
        lines,
        passSec: 0.5,
        leadSec: 0.5,
        lyricsScale: 100,
        twoLines: true,
        isTablet: true,
        height: 54,
      }),
    );
    expect(html2).toContain('is-sung');
    expect(html2).toContain('三四');

    const html1 = renderToStaticMarkup(
      createElement(LyricsStrip, {
        lines,
        passSec: 0.5,
        leadSec: 0,
        lyricsScale: 100,
        twoLines: false,
        isTablet: false,
        height: 26,
      }),
    );
    expect(html1).toContain('is-singing');
    expect(html1).not.toContain('三四');
  });

  it('MidiSeekBar 顯示小節進度、時間、歌詞刻度且觸控高度 >= 30px', () => {
    const asset = makeAssetWithLyrics();
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 2,
      countIn: false,
    });
    const html = renderToStaticMarkup(
      createElement(MidiSeekBar, {
        scoreBars: res.scoreBars,
        startBar: 1,
        endBar: 2,
        activePassStart: 0,
        totalPassDur: 4,
        sec: 2.1,
        passLyrics: [{ time: 0, text: '一二', tokens: [] }, { time: 2, text: '三', tokens: [] }],
        isTablet: false,
        height: 34,
        onSeek: vi.fn(),
      }),
    );
    expect(html).toContain('第 2／2 小節');
    expect(html).toContain('0:02 / 0:04');
    expect(html).toContain('midi-seek-lyric-tick');
    expect(html).toContain('midi-seek-vocal-marker');
    expect(html).toContain('人聲：第 1 小節');
  });

  it('MidiPage 顯示歌詞區（來源、匯入字幕檔、移除按鈕與字幕位移滑桿）', () => {
    const asset = makeAssetWithLyrics();
    const html = renderToStaticMarkup(
      <MidiPage
        settings={DEFAULT_SETTINGS}
        onUpdateSettings={vi.fn()}
        onStartMidiPractice={vi.fn()}
        store={new MemoryMidiStore()}
        lyricsStore={new MemoryLyricsStore()}
        initialSource={{
          id: 'h1',
          hash: 'h1',
          name: 'DEMO.MID',
          asset,
          songSettings: {
            trackIndex: 0,
            startBar: 1,
            endBar: 2,
            transposeSemitones: 0,
            speedPercent: 100,
            manualKey: null,
            mixer: DEFAULT_MIDI_MIXER,
            lyricsOffsetSec: 0.5,
          },
          importedLyrics: {
            id: 'h1',
            fileName: 'custom.lrc',
            importedAt: '2026-11-28T00:00:00.000Z',
            document: { lines: [{ time: 0, text: 'la', tokens: [] }] },
          },
        }}
      />,
    );
    expect(html).toContain('custom.lrc');
    expect(html).toContain('匯入字幕檔');
    expect(html).toContain('移除匯入的字幕');
    expect(html).toContain('字幕位移');
    expect(html).toContain('+0.50 秒');
    expect(html).toContain('人聲從第 1 小節開始');
    expect(html).toContain('從人聲開始');
    expect(html).not.toContain('已略過前奏');
  });

  it('PracticeSettingsSheet 顯示歌詞開關、歌詞大小與字幕提前設定', () => {
    const html = renderToStaticMarkup(
      <PracticeSettingsSheet
        open={true}
        isTablet={true}
        settings={DEFAULT_SETTINGS}
        micActive={false}
        liveDb={null}
        onUpdateSettings={vi.fn()}
        onEnsureMicForCalibration={vi.fn(async () => true)}
        getDiagnostics={() => ({
          mic: {
            ctxSampleRate: null,
            trackSampleRate: null,
            workletSampleRate: null,
            measuredSamplesPerSec: null,
            effectiveRate: 48000,
            rateCorrected: false,
            inputLatencySec: 0,
          },
          outputLatencySec: 0,
          recentHz: null,
          recentMidi: null,
          standalone: false,
        })}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain('顯示歌詞');
    expect(html).toContain('歌詞大小');
    expect(html).toContain('100%');
    expect(html).toContain('字幕提前');
    expect(html).toContain('0.00 秒');
  });

  it('PracticePage：有歌詞時顯示卡拉 OK 歌詞帶、五線譜下方歌詞與進度桿；無歌詞時不顯示歌詞帶', () => {
    const withLyricsAsset = makeAssetWithLyrics();
    const withLyricsHtml = renderToStaticMarkup(
      <AudioProvider>
        <PracticePage
          settings={DEFAULT_SETTINGS}
          onUpdateSettings={vi.fn()}
          midiSource={{
            id: 'h1',
            hash: 'h1',
            name: 'LYRICS.MID',
            asset: withLyricsAsset,
            songSettings: {
              trackIndex: 0,
              startBar: 1,
              endBar: 2,
              transposeSemitones: 0,
              speedPercent: 100,
              manualKey: null,
              mixer: DEFAULT_MIDI_MIXER,
            },
          }}
          onBack={vi.fn()}
        />
      </AudioProvider>,
    );
    expect(withLyricsHtml).toContain('lyrics-strip');
    expect(withLyricsHtml).toContain('staff-lyric');
    expect(withLyricsHtml).toContain('midi-seek-bar');

    const noLyricsAsset: MidiAsset = {
      ...withLyricsAsset,
      lyrics: undefined,
    };
    const noLyricsHtml = renderToStaticMarkup(
      <AudioProvider>
        <PracticePage
          settings={DEFAULT_SETTINGS}
          onUpdateSettings={vi.fn()}
          midiSource={{
            id: 'h2',
            hash: 'h2',
            name: 'NOLYRICS.MID',
            asset: noLyricsAsset,
            songSettings: {
              trackIndex: 0,
              startBar: 1,
              endBar: 2,
              transposeSemitones: 0,
              speedPercent: 100,
              manualKey: null,
              mixer: DEFAULT_MIDI_MIXER,
            },
          }}
          onBack={vi.fn()}
        />
      </AudioProvider>,
    );
    expect(noLyricsHtml).not.toContain('lyrics-strip');
    expect(noLyricsHtml).not.toContain('staff-lyric');
    expect(noLyricsHtml).toContain('midi-seek-bar');
  });
});
