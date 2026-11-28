import { describe, expect, it } from 'vitest';
import { buildExercise } from '../exercise';
import { BUILTIN_PATTERNS } from '../patterns';
import {
  advanceSessionPlayback,
  buildWeekBar,
  completeSessionAtEnd,
  exportPracticeLogCsv,
  formatDayHeader,
  formatKeyRangeSummary,
  groupEntriesByDate,
  localDateKey,
  MIN_LOG_DURATION_SEC,
  pauseSession,
  SESSION_MERGE_WINDOW_MS,
  startOrResumeSession,
  toLogEntry,
  type PracticeLogEntry,
  type PracticeSessionContext,
} from '../practiceLog';

const SCALE_CTX: PracticeSessionContext = {
  source: {
    kind: 'scale',
    patternId: BUILTIN_PATTERNS[0]!.id,
    patternName: BUILTIN_PATTERNS[0]!.name,
  },
  mode: 'follow',
  bpm: 120,
  rangeName: '女中音',
  voice: 'normal',
  micActive: false,
};

describe('practiceLog session 累積與合併', () => {
  it('播放累計少於 10 秒時不產生紀錄', () => {
    const t0 = 1_700_000_000_000;
    const { state: s0 } = startOrResumeSession(null, SCALE_CTX, t0, 'sess-1');
    const s1 = advanceSessionPlayback(s0, 0, true, null, false, t0);
    const s2 = advanceSessionPlayback(
      s1,
      MIN_LOG_DURATION_SEC - 1,
      true,
      null,
      false,
      t0 + (MIN_LOG_DURATION_SEC - 1) * 1000,
    );
    const s3 = pauseSession(s2, t0 + (MIN_LOG_DURATION_SEC - 1) * 1000);
    expect(toLogEntry(s3)).toBeNull();
  });

  it('播放位置不前進時不累計秒數（例如背景分頁或 AudioContext 停住）', () => {
    const t0 = 1_700_000_000_000;
    const { state: s0 } = startOrResumeSession(null, SCALE_CTX, t0, 'sess-stall');
    const s1 = advanceSessionPlayback(s0, 0, true, null, true, t0);
    // 牆上時鐘經過 18 秒，但播放頭仍停在 0 秒
    const s2 = advanceSessionPlayback(s1, 0, true, null, true, t0 + 9_000);
    const s3 = advanceSessionPlayback(s2, 0, true, null, true, t0 + 18_000);
    const s4 = pauseSession(s3, t0 + 18_000);
    expect(s4.durationSec).toBe(0);
    expect(toLogEntry(s4)).toBeNull();
  });

  it('播放累計滿 10 秒以上會產生完整紀錄', () => {
    const t0 = 1_700_000_000_000;
    const { state: s0 } = startOrResumeSession(null, SCALE_CTX, t0, 'sess-1');
    const s1 = advanceSessionPlayback(s0, 0, true, null, false, t0);
    const s2 = advanceSessionPlayback(s1, 12, true, null, true, t0 + 12_000);
    const s3 = pauseSession(s2, t0 + 12_000);
    const entry = toLogEntry(s3);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe('sess-1');
    expect(entry!.durationSec).toBe(12);
    expect(entry!.usedMic).toBe(true);
  });

  it('暫停後 5 分鐘內同一來源續播會合併成同一筆，超過 5 分鐘則開新筆', () => {
    const t0 = 1_700_000_000_000;
    const { state: s0 } = startOrResumeSession(null, SCALE_CTX, t0, 'sess-a');
    const s1 = advanceSessionPlayback(s0, 0, true, null, false, t0);
    const s2 = advanceSessionPlayback(s1, 6, true, null, false, t0 + 6_000);
    const paused = pauseSession(s2, t0 + 6_000);

    // 4 分鐘後續播 7 秒 -> 合計 13 秒，同一筆 id
    const resumeAt = t0 + 6_000 + 4 * 60 * 1000;
    const res1 = startOrResumeSession(paused, SCALE_CTX, resumeAt, 'sess-b');
    expect(res1.finalizedPrev).toBeNull();
    expect(res1.state.id).toBe('sess-a');

    const s3 = advanceSessionPlayback(res1.state, 6, true, null, false, resumeAt);
    const s4 = advanceSessionPlayback(
      s3,
      13,
      true,
      null,
      false,
      resumeAt + 7_000,
    );
    const paused2 = pauseSession(s4, resumeAt + 7_000);
    expect(toLogEntry(paused2)?.durationSec).toBe(13);

    // 超過 5 分鐘後再按播放 -> 結算舊筆並開新筆
    const after5m = resumeAt + 7_000 + SESSION_MERGE_WINDOW_MS + 1000;
    const res2 = startOrResumeSession(paused2, SCALE_CTX, after5m, 'sess-c');
    expect(res2.finalizedPrev?.id).toBe('sess-a');
    expect(res2.finalizedPrev?.durationSec).toBe(13);
    expect(res2.state.id).toBe('sess-c');
  });

  it('跨調紀錄依播放到的 KeyBlock 順序且不重複，並計算最低／最高調', () => {
    const ex = buildExercise(BUILTIN_PATTERNS[0]!, {
      startTonic: 60, // C4
      low: 48,
      high: 84,
      bpm: 120,
      repeats: 1,
      transpose: 'up-down',
      tonicList: [60, 61, 62, 61, 60],
      cadence: 'off',
      countInBeats: 0,
      restBeats: 0,
    });
    // C4 -> D♭4 -> D4 -> D♭4 -> C4
    expect(ex.keys.length).toBe(5);

    const t0 = 1_700_000_000_000;
    let { state } = startOrResumeSession(null, SCALE_CTX, t0, 'sess-keys');

    let wall = t0;
    for (const kb of ex.keys) {
      wall += 3000;
      state = advanceSessionPlayback(
        state,
        kb.notesStart + 0.05,
        true,
        ex,
        false,
        wall,
      );
    }
    const entry = toLogEntry(pauseSession(state, wall));
    expect(entry).not.toBeNull();
    // 應依序且不重複：C4, D♭4, D4
    expect(entry!.keys).toEqual(['C4', 'D♭4', 'D4']);
    expect(entry!.lowestKey).toBe('C4');
    expect(entry!.highestKey).toBe('D4');
    expect(formatKeyRangeSummary(entry!)).toBe('C4 → D4，共 3 調');
  });

  it('遍數計算：跑完 sing 唱段才算一遍，listen 不計，∞ 循環也照實累計', () => {
    const ex = buildExercise(BUILTIN_PATTERNS[0]!, {
      startTonic: 60,
      low: 48,
      high: 84,
      bpm: 120,
      repeats: 1,
      transpose: 'fixed',
      mode: 'listen-then-sing',
      cadence: 'off',
      countInBeats: 0,
      restBeats: 0,
    });

    const listenNotes = ex.notes.filter((n) => n.phase === 'listen');
    const singNotes = ex.notes.filter((n) => n.phase === 'sing');
    const listenStart = listenNotes[0]!.start;
    const singStart = singNotes[0]!.start;
    const singEnd =
      singNotes[singNotes.length - 1]!.start +
      singNotes[singNotes.length - 1]!.dur;

    const t0 = 1_700_000_000_000;
    let { state } = startOrResumeSession(null, SCALE_CTX, t0, 'sess-pass');

    // 只跑示範段不算一遍
    state = advanceSessionPlayback(
      state,
      listenStart + 0.1,
      true,
      ex,
      false,
      t0 + 2000,
    );
    expect(state.completedPasses).toBe(0);

    // 進入第 1 遍唱段並播到結尾
    state = advanceSessionPlayback(
      state,
      singStart + 0.02,
      true,
      ex,
      false,
      t0 + 5000,
    );
    state = completeSessionAtEnd(state, ex, t0 + 8000, true);
    expect(state.completedPasses).toBe(1);

    // ∞ 循環重播第 2 遍
    state = advanceSessionPlayback(
      state,
      singStart + 0.02,
      true,
      ex,
      false,
      t0 + 10_000,
    );
    state = completeSessionAtEnd(state, ex, t0 + 13_000, false);
    expect(state.completedPasses).toBe(2);

    // 若直接跳到結尾前一點點（沒從頭唱），不應計算遍數
    state = advanceSessionPlayback(
      state,
      singEnd - 0.05,
      true,
      ex,
      false,
      t0 + 14_000,
    );
    state = completeSessionAtEnd(state, ex, t0 + 15_000, false);
    expect(state.completedPasses).toBe(2);
  });
});

describe('日期分組、本週彙總與 CSV 匯出', () => {
  it('依本地日期由新到舊分組，跨本地午夜會分到不同天', () => {
    const beforeMidnight = new Date(2026, 10, 27, 23, 55, 0).getTime();
    const afterMidnight = new Date(2026, 10, 28, 0, 5, 0).getTime();

    const entries: PracticeLogEntry[] = [
      {
        id: '1',
        startedAtMs: beforeMidnight,
        durationSec: 600,
        source: { kind: 'scale', patternId: 'five-up-down', patternName: '五音上下行' },
        mode: 'follow',
        bpm: 96,
        rangeName: '女中音',
        voice: 'normal',
        keys: ['C4'],
        lowestKey: 'C4',
        highestKey: 'C4',
        completedPasses: 2,
        usedMic: true,
      },
      {
        id: '2',
        startedAtMs: afterMidnight,
        durationSec: 780,
        source: { kind: 'scale', patternId: 'five-up-down', patternName: '五音上下行' },
        mode: 'follow',
        bpm: 96,
        rangeName: '女中音',
        voice: 'normal',
        keys: ['C4', 'D♭4'],
        lowestKey: 'C4',
        highestKey: 'D♭4',
        completedPasses: 3,
        usedMic: false,
      },
      {
        id: '3',
        startedAtMs: afterMidnight + 3600_000,
        durationSec: 600,
        source: {
          kind: 'midi',
          midiId: 'm1',
          midiName: 'Song, "A"',
          midiHash: 'abcd1234',
          startBar: 1,
          endBar: 8,
        },
        mode: 'listen-then-sing',
        bpm: 110,
        rangeName: '女中音',
        voice: 'male',
        keys: ['G3'],
        lowestKey: 'G3',
        highestKey: 'G3',
        completedPasses: 4,
        usedMic: true,
      },
    ];

    const groups = groupEntriesByDate(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.dateKey).toBe(localDateKey(afterMidnight));
    expect(groups[0]!.totalMinutes).toBe(23); // (780 + 600) / 60 = 23
    expect(formatDayHeader('2026-11-28', 23)).toBe('11 月 28 日（六）· 共 23 分鐘');
    expect(groups[1]!.dateKey).toBe(localDateKey(beforeMidnight));
    expect(groups[1]!.totalMinutes).toBe(10);

    const week = buildWeekBar(entries, afterMidnight);
    expect(week).toHaveLength(7);
    const sat = week.find((d) => d.dateKey === '2026-11-28');
    const fri = week.find((d) => d.dateKey === '2026-11-27');
    expect(sat?.minutes).toBe(23);
    expect(sat?.isToday).toBe(true);
    expect(fri?.minutes).toBe(10);
  });

  it('exportPracticeLogCsv 含 UTF-8 BOM、中文標題，並正確跳脫逗號與引號', () => {
    const entries: PracticeLogEntry[] = [
      {
        id: 'csv-1',
        startedAtMs: new Date(2026, 10, 28, 14, 5, 0).getTime(),
        durationSec: 180,
        source: {
          kind: 'midi',
          midiId: 'm1',
          midiName: 'Hello, "World"',
          midiHash: '12345678',
          startBar: 2,
          endBar: 9,
        },
        mode: 'follow',
        bpm: 100,
        rangeName: '女中音',
        voice: 'normal',
        keys: ['C4', 'D4'],
        lowestKey: 'C4',
        highestKey: 'D4',
        completedPasses: 2,
        usedMic: true,
      },
    ];

    const csv = exportPracticeLogCsv(entries);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toContain('日期,開始時間,類型,名稱');
    expect(lines[1]).toContain('"Hello, ""World"""');
    expect(lines[1]).toContain('C4 → D4');
    expect(lines[1]).toContain('MIDI 練唱');
  });

  it('影子練習 mode shadow 的顯示文字與 CSV 匯出正確', () => {
    const shadowEntry: PracticeLogEntry = {
      id: 'shadow-1',
      startedAtMs: new Date(2026, 10, 28, 15, 0, 0).getTime(),
      durationSec: 120,
      source: {
        kind: 'scale',
        patternId: 'major-arpeggio',
        patternName: '大三和弦琶音',
      },
      mode: 'shadow',
      bpm: 96,
      rangeName: '女中音',
      voice: 'normal',
      keys: ['C4'],
      lowestKey: 'C4',
      highestKey: 'C4',
      completedPasses: 2,
      usedMic: true,
    };

    const csv = exportPracticeLogCsv([shadowEntry]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toContain('影子練習');
  });
});
