export type SingOctaveMode = 'auto' | 'up' | 'none';
export type OctaveShiftK = -1 | 0 | 1 | 2;

const CANDIDATE_KS: readonly OctaveShiftK[] = [-1, 0, 1, 2];
const LOCK_WINDOW_SEC = 0.15;

function computeMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if ((sorted.length & 1) === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

/**
 * 決定演唱音高的八度位移數 k ∈ {-1, 0, +1, +2}：
 * - 'none'：固定回傳 0（原音高）
 * - 'up'：固定回傳 +1（上移一個八度）
 * - 'auto'：依目前目標音與 voice 幀 MIDI 中位數，選擇使 |midi + 12k − target| 最小的 k；
 *   無目標音或無有效 voice 幀時沿用 prevK。
 */
export function resolveOctaveShift(
  mode: SingOctaveMode,
  sungMidiFrames: readonly number[],
  targetMidi: number | null,
  prevK: OctaveShiftK = 0,
): OctaveShiftK {
  if (mode === 'none') {
    return 0;
  }
  if (mode === 'up') {
    return 1;
  }

  if (targetMidi === null || !Number.isFinite(targetMidi)) {
    return prevK;
  }

  const valid = sungMidiFrames.filter((m) => Number.isFinite(m));
  if (valid.length === 0) {
    return prevK;
  }

  const medianMidi = computeMedian(valid);
  let bestK: OctaveShiftK = prevK;
  let bestDist = Infinity;

  for (const k of CANDIDATE_KS) {
    const dist = Math.abs(medianMidi + 12 * k - targetMidi);
    if (dist + 1e-6 < bestDist) {
      bestDist = dist;
      bestK = k;
    } else if (Math.abs(dist - bestDist) <= 1e-6) {
      if (k === prevK) {
        bestK = k;
      } else if (bestK !== prevK && Math.abs(k) < Math.abs(bestK)) {
        bestK = k;
      }
    }
  }

  return bestK;
}

/** 依八度位移 k 取得五線譜左上提示標籤文字 */
export function formatOctaveShiftBadge(
  k: OctaveShiftK,
): '8va' | '15ma' | '8vb' | null {
  if (k === 1) return '8va';
  if (k === 2) return '15ma';
  if (k === -1) return '8vb';
  return null;
}

/** 取得演唱八度模式的中文顯示名稱 */
export function formatSingOctaveModeLabel(mode: SingOctaveMode): string {
  switch (mode) {
    case 'auto':
      return '自動對齊';
    case 'up':
      return '上移一個八度（男聲）';
    case 'none':
      return '原音高';
  }
}

export interface OctaveShiftProcessInput {
  mode: SingOctaveMode;
  tSec: number;
  rawMidi: number | null;
  targetMidi: number | null;
  noteKey: string | null;
}

/**
 * 每個目標音前 150 ms 收集 voice 幀決定 k 後鎖定至該音結束，避免在兩個八度間來回跳動。
 * 沒有目標音（休息、示範段）時沿用上一個 k。
 */
export class OctaveShiftTracker {
  private currentNoteKey: string | null = null;
  private firstVoiceSec: number | null = null;
  private noteWindowMidis: number[] = [];
  private lockedK: OctaveShiftK | null = null;
  private lastK: OctaveShiftK = 0;

  get currentK(): OctaveShiftK {
    return this.lastK;
  }

  reset(): void {
    this.currentNoteKey = null;
    this.firstVoiceSec = null;
    this.noteWindowMidis = [];
    this.lockedK = null;
    this.lastK = 0;
  }

  process(input: OctaveShiftProcessInput): OctaveShiftK {
    const { mode, tSec, rawMidi, targetMidi, noteKey } = input;
    if (mode === 'none') {
      this.lastK = 0;
      return 0;
    }
    if (mode === 'up') {
      this.lastK = 1;
      return 1;
    }

    if (noteKey !== this.currentNoteKey) {
      this.currentNoteKey = noteKey;
      this.firstVoiceSec = null;
      this.noteWindowMidis = [];
      this.lockedK = null;
    }

    if (
      targetMidi === null ||
      !Number.isFinite(targetMidi) ||
      rawMidi === null ||
      !Number.isFinite(rawMidi)
    ) {
      return this.lastK;
    }

    if (this.lockedK !== null) {
      this.lastK = this.lockedK;
      return this.lockedK;
    }

    if (this.firstVoiceSec === null) {
      this.firstVoiceSec = tSec;
    }
    this.noteWindowMidis.push(rawMidi);
    const nextK = resolveOctaveShift(
      'auto',
      this.noteWindowMidis,
      targetMidi,
      this.lastK,
    );
    if (tSec - this.firstVoiceSec >= LOCK_WINDOW_SEC) {
      this.lockedK = nextK;
    }
    this.lastK = nextK;
    return nextK;
  }
}
