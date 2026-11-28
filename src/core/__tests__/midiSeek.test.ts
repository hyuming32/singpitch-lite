import { describe, expect, it } from 'vitest';
import type { MidiAsset } from '../midi';
import { buildMidiExercise } from '../midiExercise';
import {
  applyScoreBarLongPressLoop,
  computeSeekLyricTicks,
  computeVocalStartSeekInfo,
  findBarAtPassSec,
  findLyricPreviewAtPassSec,
  findPassWindowForLoopCheck,
  formatSeekTime,
  normalizeMidiLoopBars,
  passSecToSeekRatio,
  resolveMidiLoopRangeSec,
  seekRatioToPassSec,
  shouldLoopBack,
  snapAbsSecToNearestBeat,
  snapPassSecToNearestBeat,
  toggleMidiLoopPoint,
} from '../midiSeek';
import {
  advanceSessionPlayback,
  pauseSession,
  startOrResumeSession,
  syncSessionPlayhead,
  toLogEntry,
  type PracticeSessionContext,
} from '../practiceLog';

function makeTwoBarMidiAsset(): MidiAsset {
  // 120 BPM (0.5s/拍), 4/4 -> 每小節 2.0s，共 2 小節 4.0s
  return {
    tracks: [
      {
        index: 0,
        name: 'Vocal',
        notes: [
          { start: 0, end: 1.0, midi: 60, velocity: 90, track: 0, startTick: 0, endTick: 960 },
          { start: 2.0, end: 3.0, midi: 64, velocity: 90, track: 0, startTick: 1920, endTick: 2880 },
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
  };
}

describe('midiSeek 進度拉桿小節／拍點換算與對齊', () => {
  it('比例與秒數雙向換算、小節查找與對齊最近一拍', () => {
    const asset = makeTwoBarMidiAsset();
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 2,
      speedPercent: 100,
      countIn: true,
    });
    const totalPassDur = res.scoreBars[res.scoreBars.length - 1]!.endSec;
    expect(totalPassDur).toBeCloseTo(4.0, 5);

    expect(seekRatioToPassSec(0.5, totalPassDur)).toBeCloseTo(2.0, 5);
    expect(passSecToSeekRatio(1.0, totalPassDur)).toBeCloseTo(0.25, 5);
    expect(findBarAtPassSec(res.scoreBars, 1.9)?.barNumber).toBe(1);
    expect(findBarAtPassSec(res.scoreBars, 2.0)?.barNumber).toBe(2);

    // 1.38s 最接近 1.5s（第 1 小節第 4 拍）
    expect(snapPassSecToNearestBeat(res.scoreBars, 1.38)).toBeCloseTo(1.5, 5);
    // 2.62s 最接近 2.5s（第 2 小節第 2 拍）
    expect(snapPassSecToNearestBeat(res.scoreBars, 2.62)).toBeCloseTo(2.5, 5);

    expect(formatSeekTime(0)).toBe('0:00');
    expect(formatSeekTime(83)).toBe('1:23');
  });

  it('計算歌詞預覽與拉桿歌詞行刻度', () => {
    const lines = [
      { time: 0.0, text: '第一行歌詞非常長會被截斷', tokens: [] },
      { time: 2.0, text: '第二行', tokens: [] },
    ];
    expect(findLyricPreviewAtPassSec(lines, 0.5, 6)).toBe('第一行歌詞非…');
    expect(findLyricPreviewAtPassSec(lines, 2.1, 10)).toBe('第二行');
    expect(computeSeekLyricTicks(lines, 4.0)).toEqual([0, 0.5]);
  });

  it('手動 seek 不算進練習紀錄播放秒數（向前跳轉與向後跳轉皆不計入）', () => {
    const ctx: PracticeSessionContext = {
      source: {
        kind: 'midi',
        midiId: 'm1',
        midiName: 'Test',
        midiHash: 'abcd',
        startBar: 1,
        endBar: 20,
      },
      mode: 'follow',
      bpm: 120,
      rangeName: '女中音',
      voice: 'normal',
      micActive: false,
    };

    const t0 = 1_700_000_000_000;
    let { state } = startOrResumeSession(null, ctx, t0, 'seek-sess');
    state = advanceSessionPlayback(state, 0, true, null, false, t0);
    // 實際播放 6 秒
    state = advanceSessionPlayback(state, 6, true, null, false, t0 + 6000);
    expect(state.durationSec).toBeCloseTo(6, 5);

    // 使用者拉桿向前跳到第 45 秒，重設 playhead 基準
    state = syncSessionPlayhead(state, 45);
    state = advanceSessionPlayback(state, 45, true, null, false, t0 + 6050);
    // 再實際播放 5 秒 -> 總秒數應為 6 + 5 = 11 秒（不含跳過的 39 秒）
    state = advanceSessionPlayback(state, 50, true, null, false, t0 + 11050);
    expect(state.durationSec).toBeCloseTo(11, 5);

    // 使用者再往回拖到第 10 秒並播放 2 秒 -> 總秒數 13 秒
    state = syncSessionPlayhead(state, 10);
    state = advanceSessionPlayback(state, 12, true, null, false, t0 + 13050);
    const entry = toLogEntry(pauseSession(state, t0 + 13050));
    expect(entry?.durationSec).toBe(13);
  });

  it('computeVocalStartSeekInfo 正確計算人聲起點小節、小節開頭秒數與拉桿標記比例', () => {
    // 4 小節 60 BPM 4/4（共 16 秒），前 2 小節休止，第 3 小節第 3 拍（10.0s）出現第一個主唱音
    const introAsset: MidiAsset = {
      tracks: [
        {
          index: 0,
          name: 'Vocal',
          notes: [
            {
              start: 10.0,
              end: 12.0,
              midi: 64,
              velocity: 90,
              track: 0,
              startTick: 4800,
              endTick: 5760,
            },
          ],
        },
      ],
      duration: 16.0,
      ticksPerBeat: 480,
      beats: Array.from({ length: 16 }, (_, i) => [i * 1.0, i % 4, 60]),
    };

    const res = buildMidiExercise(introAsset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 4,
      countIn: true,
    });
    const totalPassDur = res.scoreBars[res.scoreBars.length - 1]!.endSec;
    expect(totalPassDur).toBeCloseTo(16.0, 5);

    const info = computeVocalStartSeekInfo(res.scoreBars, totalPassDur);
    expect(info).not.toBeNull();
    expect(info!.barNumber).toBe(3);
    expect(info!.barStartPassSec).toBeCloseTo(8.0, 5);
    expect(info!.firstNotePassSec).toBeCloseTo(10.0, 5);
    expect(info!.ratio).toBeCloseTo(10.0 / 16.0, 5);
  });

  it('snapAbsSecToNearestBeat 跨多遍與預備拍對齊到最近一拍', () => {
    const asset = makeTwoBarMidiAsset();
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 2,
      speedPercent: 100,
      countIn: true,
      repeats: 2,
      mode: 'follow',
    });
    const windows = res.exercise.passWindows!;
    expect(windows).toHaveLength(2);
    // 第 1 遍 start = 2.0，第 2 遍 start = 6.0
    // 預備拍前段回 0，後半貼第 1 遍起點
    expect(
      snapAbsSecToNearestBeat({
        targetAbsSec: 0.4,
        totalSec: res.exercise.total,
        scoreBars: res.scoreBars,
        passWindows: windows,
      }),
    ).toBe(0);
    // 第 2 遍 6.0 + 2.62 = 8.62 -> 對齊第 2 遍第 2 小節第 2 拍（6.0 + 2.5 = 8.5）
    expect(
      snapAbsSecToNearestBeat({
        targetAbsSec: 8.62,
        totalSec: res.exercise.total,
        scoreBars: res.scoreBars,
        passWindows: windows,
      }),
    ).toBeCloseTo(8.5, 5);
  });

  it('A–B 小節正規化、對調、夾範圍、播放列切換與長按狀態轉移', () => {
    expect(normalizeMidiLoopBars(8, 3, 2, 10)).toEqual({
      loopStartBar: 3,
      loopEndBar: 8,
    });
    expect(normalizeMidiLoopBars(1, 15, 2, 10)).toEqual({});

    // 播放列按 A / B（未設->設、B<A->對調、再按一次->清除）
    let loop = toggleMidiLoopPoint({}, 'A', 6, 1, 10);
    expect(loop).toEqual({ loopStartBar: 6 });
    loop = toggleMidiLoopPoint(loop, 'B', 3, 1, 10);
    expect(loop).toEqual({ loopStartBar: 3, loopEndBar: 6 });
    loop = toggleMidiLoopPoint(loop, 'A', 5, 1, 10);
    expect(loop).toEqual({ loopEndBar: 6 });

    // 譜面長按：無 A→設 A；有 A 無 B→設 B（自動對調）；兩者都有→重設 A 並清 B
    let lp = applyScoreBarLongPressLoop({}, 5, 1, 10);
    expect(lp).toEqual({ loopStartBar: 5 });
    lp = applyScoreBarLongPressLoop(lp, 2, 1, 10);
    expect(lp).toEqual({ loopStartBar: 2, loopEndBar: 5 });
    lp = applyScoreBarLongPressLoop(lp, 7, 1, 10);
    expect(lp).toEqual({ loopStartBar: 7 });
  });

  it('resolveMidiLoopRangeSec 與 shouldLoopBack：提前 30ms 回跳、A 之前正常進場、B 之後手動 seek 不拉回、多遍套用目前遍', () => {
    // 4 小節 60 BPM 4/4（每小節 4 秒，共 16 秒）
    const fourBarAsset: MidiAsset = {
      tracks: [
        {
          index: 0,
          name: 'Vocal',
          notes: [
            { start: 0, end: 15, midi: 60, velocity: 90, track: 0, startTick: 0, endTick: 7200 },
          ],
        },
      ],
      duration: 16.0,
      ticksPerBeat: 480,
      beats: Array.from({ length: 16 }, (_, i) => [i * 1.0, i % 4, 60]),
    };
    const res = buildMidiExercise(fourBarAsset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 4,
      countIn: true,
      repeats: 2,
      mode: 'follow',
    });

    // 只有 A 沒有 B：不循環
    expect(resolveMidiLoopRangeSec(res.scoreBars, 2, undefined)).toBeNull();

    // A=第 2 小節（4..8s）、B=第 3 小節（8..12s）
    const range = resolveMidiLoopRangeSec(res.scoreBars, 2, 3);
    expect(range).not.toBeNull();
    expect(range!.startPassSec).toBeCloseTo(4.0, 5);
    expect(range!.endPassSec).toBeCloseTo(12.0, 5);

    const windows = res.exercise.passWindows!;
    // 第 1 遍 start = 4.0（A=8.0, B=16.0），第 2 遍 start = 20.0（A=24.0, B=32.0）
    const p1Start = windows[0]!.start;
    const p2Start = windows[1]!.start;
    expect(p1Start).toBeCloseTo(4.0, 5);
    expect(p2Start).toBeCloseTo(20.0, 5);

    // 1. 從 A 之前（5.0s）播到 A（8.0s）之前：不觸發
    expect(
      shouldLoopBack({ sec: 7.5, prevSec: 7.45, loopRange: range!, passStartSec: p1Start }),
    ).toEqual({ shouldLoop: false, targetAbsSec: 8.0 });

    // 2. 進到範圍內，抵達 B 結束前 30ms（15.97s）：觸發回跳到 8.0s
    expect(
      shouldLoopBack({ sec: 15.98, prevSec: 15.95, loopRange: range!, passStartSec: p1Start }),
    ).toEqual({ shouldLoop: true, targetAbsSec: 8.0 });

    // 3. 在 B 之後手動 seek 到 17.5s（handleMidiSeek 更新 prevSec = 17.5）：不強制拉回
    expect(
      shouldLoopBack({ sec: 17.53, prevSec: 17.5, loopRange: range!, passStartSec: p1Start }),
    ).toEqual({ shouldLoop: false, targetAbsSec: 8.0 });

    // 4. 進入第 2 遍後（20.0s），套用第 2 遍的 A–B（24.0s..32.0s）
    const win2 = findPassWindowForLoopCheck(windows, 31.95, 31.98)!;
    expect(win2.start).toBeCloseTo(p2Start, 5);
    expect(
      shouldLoopBack({ sec: 31.98, prevSec: 31.95, loopRange: range!, passStartSec: win2.start }),
    ).toEqual({ shouldLoop: true, targetAbsSec: 24.0 });
  });
});
