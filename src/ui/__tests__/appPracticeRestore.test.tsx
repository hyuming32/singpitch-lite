import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../state/settings';
import { AudioProvider } from '../AudioContext';
import {
  buildMidiSourceFromEntry,
  buildPracticePageKey,
  shouldRestoreMidiPractice,
  type ActivePracticeSession,
  type AppRoute,
} from '../appPracticeState';
import { PracticePage } from '../practice/PracticePage';

/** 建立標準 E♭ 大調單音旋律的 SMF Type-0 位元組（含 8 小節 4/4 拍） */
function makeEbMajorMidiBytes(): Uint8Array {
  const events: number[] = [];
  const pushVarLen = (val: number) => {
    const bytes: number[] = [val & 0x7f];
    let v = val >>> 7;
    while (v > 0) {
      bytes.unshift((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    events.push(...bytes);
  };

  // Tempo: 120 BPM (500000 us/quarter)
  events.push(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
  // 4/4 time signature
  events.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // 8 小節 E♭ 大調旋律音符（E♭4=63, F4=65, G4=67, A♭4=68, B♭4=70, C5=72, D5=74, E♭5=75）
  const scaleEb = [63, 65, 67, 68, 70, 72, 74, 75];
  for (let bar = 0; bar < 8; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const midi = scaleEb[(bar + beat) % scaleEb.length]!;
      pushVarLen(0);
      events.push(0x90, midi, 90);
      pushVarLen(480);
      events.push(0x80, midi, 0);
    }
  }
  events.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    0x01, 0xe0, // 480 TPQN
  ];
  const len = events.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
  ];
  return new Uint8Array([...header, ...trackHeader, ...events]);
}

describe('appPracticeState（紀錄頁 MIDI 再練一次與還原狀態機）', () => {
  it('從 log 路由呼叫 replay → 之後才觸發 hashchange，不清空還原旗標並以 E♭ 大調與非空白譜面掛載 PracticePage', () => {
    const midiBytes = makeEbMajorMidiBytes();
    const session: ActivePracticeSession = {
      mode: 'midi',
      id: 'cc1d8220',
      hash: 'cc1d8220',
      startBar: 1,
      endBar: 8,
    };

    // 步驟 1：在 #/log 按下「再練一次」後、hashchange 尚未觸發前
    let route: AppRoute = 'log';
    const practiceSource = 'midi' as const;
    let activeMidiSource = null as ReturnType<typeof buildMidiSourceFromEntry> | null;

    expect(
      shouldRestoreMidiPractice({
        route,
        practiceSource,
        activeMidiSource,
        session,
      }),
    ).toBe(false);

    // 步驟 2：hashchange 觸發，route 切至 practice，此時應立刻進入載入中狀態而非以 null 掛載 PracticePage
    route = 'practice';
    expect(
      shouldRestoreMidiPractice({
        route,
        practiceSource,
        activeMidiSource,
        session,
      }),
    ).toBe(true);

    // 步驟 3：IndexedDB 載入完成，建立 MidiPracticeSource
    activeMidiSource = buildMidiSourceFromEntry(
      {
        id: 'cc1d8220',
        hash: 'cc1d8220',
        name: 'SKY_SKY.MID',
        importedAt: '2026-11-28T01:00:00.000Z',
        bytes: midiBytes,
      },
      session,
    );

    expect(
      shouldRestoreMidiPractice({
        route,
        practiceSource,
        activeMidiSource,
        session,
      }),
    ).toBe(false);

    // 步驟 4：PracticePage 收到非 null 的 midiSource，顯示歌名、E♭ 大調與實際五線譜音符
    const html = renderToStaticMarkup(
      <AudioProvider>
        <PracticePage
          settings={{ ...DEFAULT_SETTINGS, mode: 'listen-then-sing' }}
          onUpdateSettings={vi.fn()}
          midiSource={activeMidiSource}
          onBack={vi.fn()}
        />
      </AudioProvider>,
    );

    expect(html).toContain('SKY_SKY');
    expect(html).toContain('E♭ 大調');
    expect(html).not.toContain('C 大調');
    expect(html).toContain('先聽再唱');
    expect(html).toContain('score-line');
  });

  it('不同區間或不同曲目會產生不同的 PracticePage key 以確保重建五線譜', () => {
    const midiBytes = makeEbMajorMidiBytes();
    const s1 = buildMidiSourceFromEntry(
      {
        id: 'cc1d8220',
        hash: 'cc1d8220',
        name: 'SKY_SKY.MID',
        importedAt: '2026-11-28T01:00:00.000Z',
        bytes: midiBytes,
      },
      { mode: 'midi', id: 'cc1d8220', startBar: 1, endBar: 4 },
    );
    const s2 = buildMidiSourceFromEntry(
      {
        id: 'cc1d8220',
        hash: 'cc1d8220',
        name: 'SKY_SKY.MID',
        importedAt: '2026-11-28T01:00:00.000Z',
        bytes: midiBytes,
      },
      { mode: 'midi', id: 'cc1d8220', startBar: 5, endBar: 8 },
    );

    const k1 = buildPracticePageKey({
      mountSeq: 1,
      practiceSource: 'midi',
      midiSource: s1,
      patternId: 'five-up-down',
    });
    const k2 = buildPracticePageKey({
      mountSeq: 2,
      practiceSource: 'midi',
      midiSource: s2,
      patternId: 'five-up-down',
    });
    expect(k1).not.toBe(k2);
    expect(k1).toContain('1-4');
    expect(k2).toContain('5-8');
  });
});
