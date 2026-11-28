import { describe, expect, it } from 'vitest';
import { compileExercise } from '../../audio/dsp/schedule';
import type { MidiAsset, MidiNote } from '../midi';
import {
  autoAssignTrackRoles,
  buildMidiMixLayers,
  buildTrackPreviewEvents,
  classifyProgramTimbre,
  getGmInstrumentName,
  mapGmDrumNote,
  resolveTrackRoles,
  setTrackRole,
  shouldShowAccompSpeakerHint,
} from '../midiMix';

function makeNote(
  start: number,
  end: number,
  midi: number,
  velocity = 96,
  track = 0,
): MidiNote {
  return { start, end, midi, velocity, track };
}

function makeMultiTrackAsset(): MidiAsset {
  // 120 BPM, 4/4（每小節 2 秒，共 4 小節）
  const beats: [number, number, number][] = Array.from({ length: 16 }, (_, i) => [
    i * 0.5,
    i % 4,
    120,
  ]);
  return {
    tracks: [
      {
        index: 0,
        name: 'EmptyMeta',
        notes: [],
      },
      {
        index: 1,
        name: 'Piano',
        channel: 0,
        program: 0,
        notes: [
          makeNote(0.0, 1.0, 60, 100, 1),
          makeNote(0.0, 1.0, 64, 90, 1),
          makeNote(2.0, 3.0, 67, 80, 1),
        ],
      },
      {
        index: 2,
        name: 'Vocal',
        channel: 1,
        program: 75,
        notes: [
          makeNote(2.0, 2.5, 64, 110, 2),
          makeNote(2.5, 3.0, 67, 110, 2),
        ],
      },
      {
        index: 3,
        name: 'Guitar',
        channel: 2,
        program: 25,
        notes: [
          makeNote(2.0, 2.5, 48, 70, 3),
          makeNote(2.5, 3.0, 55, 85, 3),
        ],
      },
      {
        index: 4,
        name: 'Drum',
        channel: 9,
        notes: [
          makeNote(2.0, 2.1, 36, 120, 4), // kick
          makeNote(2.5, 2.6, 38, 105, 4), // snare
        ],
      },
      {
        index: 5,
        name: 'WoodblockPerc',
        channel: 3,
        program: 115, // GM 打擊類（112–119）
        notes: [makeNote(2.0, 2.2, 60, 88, 5)],
      },
    ],
    duration: 8.0,
    ticksPerBeat: 120,
    beats,
  };
}

describe('autoAssignTrackRoles 與 setTrackRole（自動預分與主唱唯一）', () => {
  it('自動預分：Vocal→主唱、channel 10 與 GM 打擊類→節奏組、其他→伴奏、空軌不列', () => {
    const asset = makeMultiTrackAsset();
    const roles = autoAssignTrackRoles(asset);

    expect(0 in roles).toBe(false); // 空軌不列
    expect(roles[2]).toBe('vocal');
    expect(roles[4]).toBe('rhythm');
    expect(roles[5]).toBe('rhythm');
    expect(roles[1]).toBe('accompaniment');
    expect(roles[3]).toBe('accompaniment');
  });

  it('主唱只能一軌：選另一軌為主唱時，原主唱自動改成伴奏', () => {
    const asset = makeMultiTrackAsset();
    const initial = autoAssignTrackRoles(asset);
    expect(initial[2]).toBe('vocal');
    expect(initial[1]).toBe('accompaniment');

    const updated = setTrackRole(initial, 1, 'vocal');
    expect(updated[1]).toBe('vocal');
    expect(updated[2]).toBe('accompaniment');
    expect(
      Object.values(updated).filter((r) => r === 'vocal'),
    ).toHaveLength(1);
  });

  it('舊設定無 trackRoles 時 resolveTrackRoles 使用自動預分', () => {
    const asset = makeMultiTrackAsset();
    const resolved = resolveTrackRoles(asset, null);
    expect(resolved[2]).toBe('vocal');
    expect(resolved[4]).toBe('rhythm');
    expect(resolved[1]).toBe('accompaniment');
  });
});

describe('classifyProgramTimbre 與 getGmInstrumentName（GM program 分類）', () => {
  it('依 GM program 分類到鋼琴／風琴／弦樂／貝斯／吉他，不確定用鋼琴', () => {
    expect(classifyProgramTimbre(0)).toBe('piano');
    expect(classifyProgramTimbre(10)).toBe('piano'); // 音樂盒
    expect(classifyProgramTimbre(19)).toBe('organ'); // 管風琴
    expect(classifyProgramTimbre(21)).toBe('organ'); // 手風琴
    expect(classifyProgramTimbre(25)).toBe('guitar'); // 鋼弦吉他
    expect(classifyProgramTimbre(34)).toBe('bass'); // 撥片電貝斯
    expect(classifyProgramTimbre(40)).toBe('strings'); // 小提琴
    expect(classifyProgramTimbre(48)).toBe('strings'); // 弦樂合奏
    expect(classifyProgramTimbre(89)).toBe('strings'); // 合成襯底溫暖
    expect(classifyProgramTimbre(undefined)).toBe('piano');
    expect(classifyProgramTimbre(999)).toBe('piano');

    expect(getGmInstrumentName({ channel: 9 })).toBe('鼓組');
    expect(getGmInstrumentName({ channel: 0, program: 40 })).toBe('小提琴');
    expect(getGmInstrumentName({ channel: 0, program: 34 })).toBe('撥片電貝斯');
    expect(getGmInstrumentName({ channel: 0, program: 25 })).toBe('鋼弦吉他');
  });
});

describe('mapGmDrumNote（GM 鼓號對應）', () => {
  it('將常見 GM 鼓號與邊界鼓號對應至 6 種鼓聲類別', () => {
    expect(mapGmDrumNote(35)).toBe('kick');
    expect(mapGmDrumNote(36)).toBe('kick');
    expect(mapGmDrumNote(38)).toBe('snare');
    expect(mapGmDrumNote(40)).toBe('snare');
    expect(mapGmDrumNote(42)).toBe('closedHat');
    expect(mapGmDrumNote(44)).toBe('closedHat');
    expect(mapGmDrumNote(46)).toBe('openHat');
    expect(mapGmDrumNote(49)).toBe('cymbal');
    expect(mapGmDrumNote(51)).toBe('cymbal');
    expect(mapGmDrumNote(41)).toBe('tom');
    expect(mapGmDrumNote(48)).toBe('tom');
    // 未直接列出的鼓號落在最接近類別
    expect(mapGmDrumNote(20)).toBe('kick');
    expect(mapGmDrumNote(90)).toBe('closedHat');
  });
});

describe('buildMidiMixLayers 與排程套用（移調／變速／A–B／先聽再唱／混音開關）', () => {
  it('伴奏跟著移調、變速、A–B 區間與先聽再唱兩遍都播，節奏組不移調', () => {
    const asset = makeMultiTrackAsset();
    const roles = autoAssignTrackRoles(asset);

    // 選第 2 小節（2.0s–4.0s），移調 +3，變速 50%（時間×2），先聽再唱 1 遍（共 2 遍），開預備拍
    const layers = buildMidiMixLayers(asset, {
      trackRoles: roles,
      startBar: 2,
      endBar: 2,
      transposeSemitones: 3,
      speedPercent: 50,
      mode: 'listen-then-sing',
      repeats: 1,
      countIn: true,
    });

    // 120 BPM * 0.5 = 60 BPM -> 預備拍 4 拍 = 4.0s，單遍長 2.0 / 0.5 = 4.0s
    // 第 2 小節伴奏有 Piano 1 音(67) + Guitar 2 音(48, 55) = 3 音/遍 × 2 遍 = 6 音
    expect(layers.accompNotes).toHaveLength(6);
    // 節奏組有 Drum 2 音(36, 38) + Woodblock 1 音(60) = 3 音/遍 × 2 遍 = 6 音
    expect(layers.rhythmHits).toHaveLength(6);

    // 伴奏第 1 遍（示範）從 4.0s 起、第 2 遍（唱）從 8.0s 起；音高已移調 +3
    const guitarPass1 = layers.accompNotes.filter((n) => n.trackIndex === 3);
    expect(guitarPass1).toHaveLength(4);
    expect(guitarPass1[0]!.midi).toBe(48 + 3);
    expect(guitarPass1[0]!.start).toBeCloseTo(4.0, 5);
    expect(guitarPass1[0]!.dur).toBeCloseTo(1.0, 5); // 0.5 / 0.5
    expect(guitarPass1[0]!.timbre).toBe('guitar');
    expect(guitarPass1[0]!.velocity).toBeCloseTo(70 / 127, 4);
    expect(guitarPass1[2]!.start).toBeCloseTo(8.0, 5); // 第 2 遍

    // 節奏組不移調
    const drumHits = layers.rhythmHits.filter((h) => h.trackIndex === 4);
    expect(drumHits).toHaveLength(4);
    expect(drumHits[0]!.midi).toBe(36); // 未加 +3
    expect(drumHits[0]!.drum).toBe('kick');
    expect(drumHits[0]!.start).toBeCloseTo(4.0, 5);
    expect(drumHits[2]!.start).toBeCloseTo(8.0, 5);
  });

  it('混音開關關閉的組不產生事件（buildMidiMixLayers 與 compileExercise）', () => {
    const asset = makeMultiTrackAsset();
    const roles = autoAssignTrackRoles(asset);

    const noAccomp = buildMidiMixLayers(asset, {
      trackRoles: roles,
      startBar: 1,
      endBar: 4,
      mixer: { accompEnabled: false, rhythmEnabled: true },
    });
    expect(noAccomp.accompNotes).toHaveLength(0);
    expect(noAccomp.rhythmHits.length).toBeGreaterThan(0);

    const full = buildMidiMixLayers(asset, {
      trackRoles: roles,
      startBar: 1,
      endBar: 4,
    });
    const compiledMuted = compileExercise(
      { keys: [], notes: [], chords: [], clicks: [], total: 8 },
      48000,
      {
        accompNotes: full.accompNotes,
        rhythmHits: full.rhythmHits,
        accompEnabled: false,
        rhythmEnabled: false,
        click: false,
      },
    );
    expect(compiledMuted.events).toHaveLength(0);
  });

  it('buildTrackPreviewEvents 從該軌第一個有音小節起截取約 8 秒', () => {
    const asset = makeMultiTrackAsset();
    // Vocal 第 1 個音在 2.0s（第 2 小節）
    const preview = buildTrackPreviewEvents({
      track: asset.tracks[2]!,
      bars: [
        { barNumber: 1, start: 0, end: 2, bpm: 120, beatsInBar: 4 },
        { barNumber: 2, start: 2, end: 4, bpm: 120, beatsInBar: 4 },
      ],
      role: 'vocal',
      rate: 48000,
      maxDurationSec: 8,
    });
    expect(preview.events.length).toBeGreaterThan(0);
    expect(preview.events[0]!.frame).toBe(0);
    expect(preview.durationSec).toBeLessThanOrEqual(8);
  });
});

describe('shouldShowAccompSpeakerHint（喇叭干擾提示出現條件）', () => {
  it('只在 MIDI 模式、伴奏或節奏組有開、麥克風開、非耳機且本次未顯示過時觸發', () => {
    expect(
      shouldShowAccompSpeakerHint({
        isMidiMode: true,
        hasAccompOrRhythmEnabled: true,
        micActive: true,
        micMode: 'speaker',
        alreadyShownThisVisit: false,
      }),
    ).toBe(true);

    // 耳機模式不顯示
    expect(
      shouldShowAccompSpeakerHint({
        isMidiMode: true,
        hasAccompOrRhythmEnabled: true,
        micActive: true,
        micMode: 'headphone',
        alreadyShownThisVisit: false,
      }),
    ).toBe(false);

    // 麥克風未開不顯示
    expect(
      shouldShowAccompSpeakerHint({
        isMidiMode: true,
        hasAccompOrRhythmEnabled: true,
        micActive: false,
        micMode: 'speaker',
        alreadyShownThisVisit: false,
      }),
    ).toBe(false);

    // 伴奏與節奏組皆關不顯示
    expect(
      shouldShowAccompSpeakerHint({
        isMidiMode: true,
        hasAccompOrRhythmEnabled: false,
        micActive: true,
        micMode: 'speaker',
        alreadyShownThisVisit: false,
      }),
    ).toBe(false);

    // 非 MIDI 模式不顯示
    expect(
      shouldShowAccompSpeakerHint({
        isMidiMode: false,
        hasAccompOrRhythmEnabled: true,
        micActive: true,
        micMode: 'speaker',
        alreadyShownThisVisit: false,
      }),
    ).toBe(false);

    // 本次進入練唱頁已顯示過則不再顯示
    expect(
      shouldShowAccompSpeakerHint({
        isMidiMode: true,
        hasAccompOrRhythmEnabled: true,
        micActive: true,
        micMode: 'speaker',
        alreadyShownThisVisit: true,
      }),
    ).toBe(false);
  });
});
