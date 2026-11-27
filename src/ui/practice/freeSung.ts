/**
 * 沒有播放時的「即時演唱黃線」：開麥克風就能看到自己唱的音，不必先按播放。
 *
 * 播放中的黃線依歌曲時間記錄（rawSungRef）；沒播放時沒有歌曲時間，
 * 改以牆上時間收集最近幾秒，畫在目前這一行「播放位置右側的空白處」，
 * 最新的點貼在行尾、往左捲動（跟 Studio 清唱圖一樣由右往左流動），
 * 不會蓋到暫停前已經唱過、記錄在播放位置左側的黃線。
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

/** 即時黃線最多保留的秒數 */
export const FREE_WINDOW_SEC = 3;
/** 播放位置右側空間太小時，至少用這麼長的時間寬度（會往左蓋到一點） */
export const FREE_MIN_SPAN_SEC = 1.5;

/** 丟掉超過視窗的舊點 */
export function pruneFreeSamples(
  samples: FreeSample[],
  nowWall: number,
  windowSec = FREE_WINDOW_SEC,
): FreeSample[] {
  let i = 0;
  while (i < samples.length && nowWall - samples[i]!.wall > windowSec) i++;
  return i === 0 ? samples : samples.slice(i);
}

/**
 * 決定即時黃線在這一行的時間範圍 [from, to]（歌曲秒數）。
 * to 固定在行尾；from 從播放位置開始，但寬度介於 FREE_MIN_SPAN_SEC 與 windowSec 之間。
 */
export function freeSpan(
  lineStart: number,
  lineEnd: number,
  cursorSec: number,
  windowSec = FREE_WINDOW_SEC,
): { from: number; to: number } | null {
  const length = lineEnd - lineStart;
  if (!(length > 0)) return null;
  const to = lineEnd;
  const cursor = Math.min(Math.max(cursorSec, lineStart), lineEnd);
  let span = Math.min(to - cursor, windowSec);
  span = Math.max(span, Math.min(FREE_MIN_SPAN_SEC, length));
  return { from: to - span, to };
}

/**
 * 把牆上時間的樣本換成這一行的歌曲時間點。
 * 最新的樣本在 to，越舊越往左；超出 [from, to] 的丟掉。
 * 為了讓畫面以固定速度捲動，時間比例縮放成「span 秒的譜面 = span 秒的實際時間」。
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
