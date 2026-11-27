export interface LatencyAlignmentParams {
  /** 麥克風音訊幀在 AudioContext 時間軸上的時間（秒） */
  micCtxSec: number;
  /** AudioContext 時間減去歌曲時間的基準差（ctxSec - songSec） */
  ctxToSongOffsetSec: number;
  /** 麥克風輸入延遲（秒），預設 0 */
  inputLatencySec?: number;
  /** 喇叭輸出延遲（秒），預設 0 */
  outputLatencySec?: number;
  /** 使用者手動延遲校正（毫秒，預設 0，範圍 −300..+300） */
  manualOffsetMs?: number;
}

/**
 * 將麥克風 AudioContext 時間換算為「歌曲時間」（秒）。
 * 麥克風實體收音時刻為 micCtxSec - inputLatencySec；
 * 該實體時刻喇叭正在播放的歌曲位置需再扣除 outputLatencySec 與 ctxToSongOffsetSec。
 */
export function micCtxSecToSongSec(params: LatencyAlignmentParams): number {
  const {
    micCtxSec,
    ctxToSongOffsetSec,
    inputLatencySec = 0,
    outputLatencySec = 0,
    manualOffsetMs = 0,
  } = params;

  const micPhysicalSec = micCtxSec - Math.max(0, inputLatencySec);
  const totalLatencyAdjusted =
    micPhysicalSec - ctxToSongOffsetSec - Math.max(0, outputLatencySec);
  return totalLatencyAdjusted + manualOffsetMs / 1000;
}

/**
 * 將歌曲時間換算為喇叭實際發聲的 AudioContext 時間（秒）。
 */
export function songSecToSpeakerCtxSec(
  songSec: number,
  ctxToSongOffsetSec: number,
  outputLatencySec = 0,
): number {
  return songSec + ctxToSongOffsetSec + Math.max(0, outputLatencySec);
}

/**
 * 從 MediaStreamTrack 讀取輸入延遲（秒）；不可得時回傳 0。
 */
export function readTrackInputLatencySec(
  track: Pick<MediaStreamTrack, 'getSettings'> | null | undefined,
): number {
  if (!track || typeof track.getSettings !== 'function') {
    return 0;
  }
  const settings = track.getSettings() as MediaTrackSettings & {
    latency?: unknown;
  };
  const lat = settings.latency;
  if (typeof lat === 'number' && Number.isFinite(lat) && lat >= 0) {
    return lat;
  }
  return 0;
}
