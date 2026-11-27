import { describe, expect, it } from 'vitest';
import {
  micCtxSecToSongSec,
  readTrackInputLatencySec,
  songSecToSpeakerCtxSec,
} from '../latency';

describe('latency conversion', () => {
  it('將 AudioContext 麥克風時間扣除 inputLatency、outputLatency 與基準差換算為歌曲時間', () => {
    // 情境：ctxSec=10.0 開始播放 songSec=0（ctxToSongOffsetSec=10.0）
    // 喇叭延遲 50ms、麥克風輸入延遲 20ms
    // 歌曲 1.000s 的聲音於 ctxSec=11.050 離開喇叭，於 ctxSec=11.070 被麥克風收到
    const songSec = micCtxSecToSongSec({
      micCtxSec: 11.07,
      ctxToSongOffsetSec: 10.0,
      inputLatencySec: 0.02,
      outputLatencySec: 0.05,
      manualOffsetMs: 0,
    });
    expect(songSec).toBeCloseTo(1.0, 6);
  });

  it('手動延遲校正（ms）直接平移換算後的歌曲時間', () => {
    const base = micCtxSecToSongSec({
      micCtxSec: 5.1,
      ctxToSongOffsetSec: 4.0,
      inputLatencySec: 0.03,
      outputLatencySec: 0.07,
      manualOffsetMs: 0,
    });
    expect(base).toBeCloseTo(1.0, 6);

    const plus50 = micCtxSecToSongSec({
      micCtxSec: 5.1,
      ctxToSongOffsetSec: 4.0,
      inputLatencySec: 0.03,
      outputLatencySec: 0.07,
      manualOffsetMs: 50,
    });
    expect(plus50).toBeCloseTo(1.05, 6);

    const minus120 = micCtxSecToSongSec({
      micCtxSec: 5.1,
      ctxToSongOffsetSec: 4.0,
      inputLatencySec: 0.03,
      outputLatencySec: 0.07,
      manualOffsetMs: -120,
    });
    expect(minus120).toBeCloseTo(0.88, 6);
  });

  it('songSecToSpeakerCtxSec 正確反向換算', () => {
    expect(songSecToSpeakerCtxSec(1.0, 10.0, 0.05)).toBeCloseTo(11.05, 6);
  });

  it('readTrackInputLatencySec 可得時回傳數值，否則回傳 0', () => {
    expect(
      readTrackInputLatencySec({
        getSettings: () => ({ latency: 0.015 }) as MediaTrackSettings,
      }),
    ).toBeCloseTo(0.015, 6);

    expect(
      readTrackInputLatencySec({
        getSettings: () => ({}) as MediaTrackSettings,
      }),
    ).toBe(0);

    expect(readTrackInputLatencySec(null)).toBe(0);
  });
});
