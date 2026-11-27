/**
 * 沒有播放時的「即時演唱音高線」：開麥克風就能看到自己唱的音，不必先按播放。
 *
 * 播放中的音高線依歌曲時間記錄（rawSungRef）；沒播放時沒有歌曲時間，
 * 改以牆上時間收集最近樣本，使用目前這一行的整個寬度（line.start ～ line.end），
 * 最新的點貼在行尾、由右往左捲動（1 秒譜面 = 1 秒實際時間）。
 */

export interface FreeSample {
  /** 收到這一幀時的牆上時間（秒，performance.now()/1000） */
  wall: number;
  /** 已依聲部位移後的浮點 MIDI；無聲為 NaN */
  midi: number;
}

export interface FreeSungPoint {
  t: number;
  midi: number;
}

/** 即時音高線預設保留的秒數（足夠覆蓋整行五線譜） */
export const FREE_WINDOW_SEC = 30;
/** 樣本數上限，避免長時間開麥克風時陣列無限成長 */
export const FREE_MAX_SAMPLES = 3600;

/** 丟掉超過視窗的舊點，並限制樣本總數上限 */
export function pruneFreeSamples(
  samples: FreeSample[],
  nowWall: number,
  windowSec = FREE_WINDOW_SEC,
  maxSamples = FREE_MAX_SAMPLES,
): FreeSample[] {
  let start = 0;
  while (start < samples.length && nowWall - samples[start]!.wall > windowSec) {
    start++;
  }
  const minStartForCap = Math.max(0, samples.length - maxSamples);
  if (minStartForCap > start) {
    start = minStartForCap;
  }
  return start === 0 ? samples : samples.slice(start);
}

/**
 * 決定即時音高線在這一行的時間範圍 [from, to]（歌曲秒數）。
 * 沒播放時使用目前這一行的整個寬度（lineStart ～ lineEnd）。
 */
export function freeSpan(
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const length = lineEnd - lineStart;
  if (!(length > 0)) return null;
  return { from: lineStart, to: lineEnd };
}

/**
 * 把牆上時間的樣本換成這一行的歌曲時間點。
 * 最新的樣本在 to，越舊越往左；超出 [from, to] 的丟掉。
 * 為了讓畫面以固定速度捲動，時間比例維持「1 秒譜面 = 1 秒實際時間」。
 */
export function freeSungPoints(
  samples: readonly FreeSample[],
  nowWall: number,
  span: { from: number; to: number },
): FreeSungPoint[] {
  const out: FreeSungPoint[] = [];
  const width = span.to - span.from;
  for (const s of samples) {
    if (!Number.isFinite(s.wall)) {
      // singingCurve 的斷線標記：保留成斷點
      if (out.length > 0) out.push({ t: NaN, midi: NaN });
      continue;
    }
    const age = nowWall - s.wall;
    if (age < 0 || age > width) continue;
    out.push({ t: span.to - age, midi: s.midi });
  }
  return out;
}
