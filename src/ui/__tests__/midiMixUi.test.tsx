import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MidiAsset } from '../../core/midi';
import { DEFAULT_MIDI_MIXER } from '../../state/midiLibrary';
import { DEFAULT_SETTINGS } from '../../state/settings';
import { AudioProvider } from '../AudioContext';
import { TrackMixModal } from '../midi/TrackMixModal';
import { MidiMixerPopover } from '../practice/MidiMixerPopover';
import { PracticePage } from '../practice/PracticePage';

const SAMPLE_ASSET: MidiAsset = {
  tracks: [
    {
      index: 1,
      name: 'Piano',
      channel: 0,
      program: 1,
      notes: [{ start: 0, end: 1, midi: 60, velocity: 90, track: 1 }],
    },
    {
      index: 2,
      name: 'Vocal',
      channel: 1,
      program: 75,
      notes: [{ start: 0, end: 1, midi: 67, velocity: 100, track: 2 }],
    },
    {
      index: 3,
      name: 'Drum',
      channel: 9,
      notes: [{ start: 0, end: 0.2, midi: 36, velocity: 110, track: 3 }],
    },
  ],
  duration: 2,
  ticksPerBeat: 120,
  beats: [
    [0, 0, 120],
    [0.5, 1, 120],
    [1.0, 2, 120],
    [1.5, 3, 120],
  ],
};

describe('TrackMixModal、MidiMixerPopover 與 PracticePage 混音 UI', () => {
  it('TrackMixModal 列出軌道資訊、GM 樂器中文名、試聽鈕與四選一角色', () => {
    const html = renderToStaticMarkup(
      <TrackMixModal
        open={true}
        songTitle="SHARE"
        asset={SAMPLE_ASSET}
        bars={[{ barNumber: 1, start: 0, end: 2, bpm: 120, beatsInBar: 4 }]}
        roles={{ 1: 'accompaniment', 2: 'vocal', 3: 'rhythm' }}
        originalKey={{ tonicPc: 0, mode: 'major' }}
        a4={440}
        onChangeRole={vi.fn()}
        onDone={vi.fn()}
      />,
    );

    expect(html).toContain('分軌設定：SHARE');
    expect(html).toContain('第 2 軌 Piano');
    expect(html).toContain('明亮鋼琴');
    expect(html).toContain('第 3 軌 Vocal');
    expect(html).toContain('排笛');
    expect(html).toContain('第 4 軌 Drum');
    expect(html).toContain('鼓組');
    expect(html).toContain('試聽');
    expect(html).toContain('主唱');
    expect(html).toContain('伴奏');
    expect(html).toContain('節奏組');
    expect(html).toContain('不播');
    expect(html).toContain('完成');
  });

  it('MidiMixerPopover 顯示主唱示範 80%、伴奏 60%、節奏組 50%', () => {
    const html = renderToStaticMarkup(
      <MidiMixerPopover
        open={true}
        mixer={DEFAULT_MIDI_MIXER}
        hasAccompTracks={true}
        hasRhythmTracks={true}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain('主唱示範');
    expect(html).toContain('80%');
    expect(html).toContain('伴奏');
    expect(html).toContain('60%');
    expect(html).toContain('節奏組');
    expect(html).toContain('50%');
  });

  it('PracticePage 僅在 MIDI 模式播放列顯示「混音」鈕，音階模式不顯示', () => {
    const scaleHtml = renderToStaticMarkup(
      <AudioProvider>
        <PracticePage
          settings={DEFAULT_SETTINGS}
          onUpdateSettings={vi.fn()}
          onBack={vi.fn()}
        />
      </AudioProvider>,
    );
    expect(scaleHtml).not.toContain('aria-label="混音"');
    expect(scaleHtml).not.toContain('aria-label="A–B 段落重複"');
    expect(scaleHtml).not.toContain('sheet-score-area is-midi');

    const midiHtml = renderToStaticMarkup(
      <AudioProvider>
        <PracticePage
          settings={DEFAULT_SETTINGS}
          onUpdateSettings={vi.fn()}
          midiSource={{
            id: 'h1',
            hash: 'h1',
            name: 'SHARE.MID',
            asset: SAMPLE_ASSET,
            songSettings: {
              trackIndex: 2,
              startBar: 1,
              endBar: 1,
              transposeSemitones: 0,
              speedPercent: 100,
              manualKey: null,
              trackRoles: { 1: 'accompaniment', 2: 'vocal', 3: 'rhythm' },
              mixer: DEFAULT_MIDI_MIXER,
              loopStartBar: 1,
              loopEndBar: 1,
            },
          }}
          onBack={vi.fn()}
        />
      </AudioProvider>,
    );
    expect(midiHtml).toContain('aria-label="混音"');
    expect(midiHtml).toContain('aria-label="A–B 段落重複"');
    expect(midiHtml).toContain('aria-label="清除 A–B"');
    expect(midiHtml).toContain('midi-seek-ab-range');
    expect(midiHtml).toContain('sheet-score-area is-midi');
  });
});
