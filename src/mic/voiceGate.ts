import {
  ATTACK,
  DECAY,
  PIANO_DECAY,
  SUSTAIN,
} from '../audio/dsp/piano.ts';
import type { OutputSound } from './outputAt.ts';
import { VOICE_CONFIG } from './voiceConfig.ts';

export type VoiceLabel = 'voice' | 'leak' | 'unknown' | 'silent';

export interface GateInputFrame {
  /** 已對齊至歌曲時間軸（或單調遞增時間軸）的秒數 */
  t: number;
  /** 偵測基頻（Hz），0 代表無穩定音高 */
  hz: number;
  /** 音量（dBFS） */
  db: number;
}

export interface VoiceGateOptions {
  mode: 'speaker' | 'headphone';
  gateDb: number;
  /** 額外延遲補償（秒），若 frame.t 已對齊歌曲時間則傳 0（預設） */
  latencySec?: number;
}

export interface VoiceGateResult {
  label: VoiceLabel;
  pitchStd: number | null;
  hasVibrato: boolean;
  dbRise150ms: number;
  score: number;
  isMetro: boolean;
  hasOutput: boolean;
}

interface StoredFrame {
  t: number;
  hz: number;
  db: number;
}

/** 計算與 AdditivePiano 相同的音符包絡幅度（0..1） */
export function pianoEnvelopeAt(tSinceOnset: number, held: boolean): number {
  const t = Math.max(0, tSinceOnset);
  const ads =
    t < ATTACK
      ? t / ATTACK
      : SUSTAIN + (1 - SUSTAIN) * Math.exp(-Math.max(t - ATTACK, 0) / DECAY);
  return ads * (held ? 1 : Math.exp(-t / PIANO_DECAY));
}

/** 計算偵測頻率與所有發聲輸出（含 2 倍、1/2 倍頻）的最小音分距離 */
export function minCentsToOutputs(
  hz: number,
  outputs: readonly OutputSound[],
): { minCents: number; matched: OutputSound | null } {
  if (!(hz > 0) || !Number.isFinite(hz)) {
    return { minCents: Infinity, matched: null };
  }
  let bestCents = Infinity;
  let matched: OutputSound | null = null;
  const multipliers = [0.5, 1, 2];

  for (const out of outputs) {
    if (out.bus === 'metro' || !(out.hz > 0)) continue;
    for (const m of multipliers) {
      const targetHz = out.hz * m;
      const cents = Math.abs(1200 * Math.log2(hz / targetHz));
      if (cents < bestCents) {
        bestCents = cents;
        matched = out;
      }
    }
  }
  return { minCents: bestCents, matched };
}

function computeStats(
  frames: readonly StoredFrame[],
  minDbAfterT = -Infinity,
): {
  pitchStd: number | null;
  minDb: number;
} {
  const validHz: number[] = [];
  let minDb = Infinity;
  for (const f of frames) {
    if (f.t >= minDbAfterT && f.db < minDb) minDb = f.db;
    if (f.hz > 0 && Number.isFinite(f.hz)) {
      validHz.push(f.hz);
    }
  }
  if (validHz.length < VOICE_CONFIG.MIN_STD_FRAMES) {
    return { pitchStd: null, minDb };
  }
  let logSum = 0;
  for (const hz of validHz) {
    logSum += Math.log2(hz);
  }
  const meanLog = logSum / validHz.length;
  let sqSum = 0;
  for (const hz of validHz) {
    const c = 1200 * (Math.log2(hz) - meanLog);
    sqSum += c * c;
  }
  return {
    pitchStd: Math.sqrt(sqSum / validHz.length),
    minDb,
  };
}

/**
 * 偵測最近視窗內是否有 4–7 Hz 的週期性顫音（結合零交越率與正規化自相關）。
 */
function detectVibrato(frames: readonly StoredFrame[]): boolean {
  const pitched = frames.filter((f) => f.hz > 0 && Number.isFinite(f.hz));
  if (pitched.length < 8) {
    return false;
  }

  const span = pitched[pitched.length - 1]!.t - pitched[0]!.t;
  if (span < 0.11) {
    return false;
  }

  let logSum = 0;
  for (const f of pitched) {
    logSum += Math.log2(f.hz);
  }
  const meanLog = logSum / pitched.length;

  const n = pitched.length;
  const cents = new Float64Array(n);
  let minC = Infinity;
  let maxC = -Infinity;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const c = 1200 * (Math.log2(pitched[i]!.hz) - meanLog);
    cents[i] = c;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    sqSum += c * c;
  }

  const std = Math.sqrt(sqSum / n);
  if (
    std < VOICE_CONFIG.VIBRATO_MIN_STD_CENTS ||
    maxC - minC < VOICE_CONFIG.VIBRATO_MIN_SPAN_CENTS
  ) {
    return false;
  }

  // 零交越次數（濾除極微小的符號抖動）
  let crossings = 0;
  let lastSign = 0;
  for (let i = 0; i < n; i++) {
    const v = cents[i]!;
    if (Math.abs(v) < 0.5) continue;
    const s = v > 0 ? 1 : -1;
    if (lastSign !== 0 && s !== lastSign) {
      crossings++;
    }
    lastSign = s;
  }
  const zcHz = crossings / 2 / span;
  const zcInRange =
    zcHz >= VOICE_CONFIG.VIBRATO_MIN_HZ - 0.8 &&
    zcHz <= VOICE_CONFIG.VIBRATO_MAX_HZ + 1.0;

  if (!zcInRange) {
    return false;
  }

  // 自相關：檢查半週期（71..125 ms）負相關，或完整週期（143..250 ms）正相關
  const dt = span / (n - 1);
  let hasPeriodicity = false;

  const halfMinLag = Math.max(2, Math.round(0.071 / dt));
  const halfMaxLag = Math.min(n - 3, Math.round(0.125 / dt));
  for (let lag = halfMinLag; lag <= halfMaxLag; lag++) {
    let num = 0;
    let d1 = 0;
    let d2 = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = cents[i]!;
      const b = cents[i + lag]!;
      num += a * b;
      d1 += a * a;
      d2 += b * b;
    }
    const denom = Math.sqrt(d1 * d2);
    if (denom > 1e-9 && num / denom <= VOICE_CONFIG.VIBRATO_HALF_NEG_AUTOCORR) {
      hasPeriodicity = true;
      break;
    }
  }

  if (!hasPeriodicity) {
    const fullMinLag = Math.max(3, Math.round(0.143 / dt));
    const fullMaxLag = Math.min(n - 3, Math.round(0.25 / dt));
    for (let lag = fullMinLag; lag <= fullMaxLag; lag++) {
      let num = 0;
      let d1 = 0;
      let d2 = 0;
      for (let i = 0; i + lag < n; i++) {
        const a = cents[i]!;
        const b = cents[i + lag]!;
        num += a * b;
        d1 += a * a;
        d2 += b * b;
      }
      const denom = Math.sqrt(d1 * d2);
      if (
        denom > 1e-9 &&
        num / denom >= VOICE_CONFIG.VIBRATO_FULL_POS_AUTOCORR
      ) {
        hasPeriodicity = true;
        break;
      }
    }
  }

  return hasPeriodicity;
}

/**
 * 人聲辨識閘門狀態機：區分「人聲」、「喇叭漏音」、「未知（含節拍器）」與「靜音」。
 */
export class VoiceGate {
  private readonly history: StoredFrame[] = [];
  private readonly vibratoHistory: StoredFrame[] = [];
  private micOnsetSec: number | null = null;
  private wasSilent = true;
  private prevDb = -120;
  private trackedNoteKey: string | null = null;
  private trackedBaseDb: number | null = null;

  reset(): void {
    this.history.length = 0;
    this.vibratoHistory.length = 0;
    this.micOnsetSec = null;
    this.wasSilent = true;
    this.prevDb = -120;
    this.trackedNoteKey = null;
    this.trackedBaseDb = null;
  }

  processFrame(
    rawFrame: GateInputFrame,
    outputs: readonly OutputSound[],
    opts: VoiceGateOptions,
  ): VoiceGateResult {
    const latencySec = opts.latencySec ?? 0;
    const t = rawFrame.t - latencySec;
    const { hz, db } = rawFrame;

    // 1. 噪音門檻
    if (db < opts.gateDb) {
      this.history.length = 0;
      this.vibratoHistory.length = 0;
      this.micOnsetSec = null;
      this.wasSilent = true;
      this.prevDb = db;
      this.trackedNoteKey = null;
      this.trackedBaseDb = null;
      return {
        label: 'silent',
        pitchStd: null,
        hasVibrato: false,
        dbRise150ms: 0,
        score: 0,
        isMetro: false,
        hasOutput: false,
      };
    }

    // 記錄麥克風起音（從靜音轉有聲，或音量驟升 > 8 dB）
    if (this.wasSilent || db - this.prevDb > 8) {
      this.micOnsetSec = t;
    }
    this.wasSilent = false;
    this.prevDb = db;

    // 更新滑動歷史
    this.history.push({ t, hz, db });
    const featCutoff = t - VOICE_CONFIG.FEATURE_WINDOW_SEC;
    while (this.history.length > 0 && this.history[0]!.t < featCutoff) {
      this.history.shift();
    }

    this.vibratoHistory.push({ t, hz, db });
    const vibCutoff = t - VOICE_CONFIG.VIBRATO_WINDOW_SEC;
    while (
      this.vibratoHistory.length > 0 &&
      this.vibratoHistory[0]!.t < vibCutoff
    ) {
      this.vibratoHistory.shift();
    }

    const { pitchStd, minDb } = computeStats(this.history);
    const dbRise150ms = db - minDb;
    const hasVibrato = detectVibrato(this.vibratoHistory);

    // 耳機模式：跳過步驟 2–4，所有有音高幀都算 voice
    if (opts.mode === 'headphone') {
      return {
        label: hz > 0 ? 'voice' : 'unknown',
        pitchStd,
        hasVibrato,
        dbRise150ms,
        score: hz > 0 ? 1 : 0,
        isMetro: false,
        hasOutput: false,
      };
    }

    // 2. 節拍聲遮蔽：任一 metro 事件在 [click, click + 60ms] 內 → unknown（不畫、也不算混亂）
    const hasMetro = outputs.some(
      (o) =>
        o.bus === 'metro' &&
        t >= o.onsetSec - 0.002 &&
        t <= o.onsetSec + VOICE_CONFIG.METRO_WINDOW_SEC,
    );
    if (hasMetro) {
      return {
        label: 'unknown',
        pitchStd,
        hasVibrato,
        dbRise150ms,
        score: 0,
        isMetro: true,
        hasOutput: true,
      };
    }

    const pitchedOutputs = outputs.filter((o) => o.bus !== 'metro' && o.hz > 0);
    const hasOutput = pitchedOutputs.length > 0;

    // 5. 無任何輸出在發聲且有音高 → voice
    if (!hasOutput) {
      return {
        label: hz > 0 ? 'voice' : 'unknown',
        pitchStd,
        hasVibrato,
        dbRise150ms,
        score: hz > 0 ? 1 : 0,
        isMetro: false,
        hasOutput: false,
      };
    }

    if (!(hz > 0)) {
      return {
        label: 'unknown',
        pitchStd,
        hasVibrato,
        dbRise150ms,
        score: 0,
        isMetro: false,
        hasOutput: true,
      };
    }

    // 3. 與所有發聲輸出（含 2 倍、1/2 倍頻）皆相差 > 35 cents → voice
    const { minCents, matched } = minCentsToOutputs(hz, pitchedOutputs);
    if (minCents > VOICE_CONFIG.PITCH_MATCH_CENTS || !matched) {
      return {
        label: 'voice',
        pitchStd,
        hasVibrato,
        dbRise150ms,
        score: 1,
        isMetro: false,
        hasOutput: true,
      };
    }

    // 4. 相差 <= 35 cents：依最近 150 ms 特徵加權判斷
    let score = 0;
    const tSinceOnset = t - matched.onsetSec;
    const noteKey = `${matched.bus}:${matched.onsetSec.toFixed(4)}:${matched.hz.toFixed(2)}`;
    if (this.trackedNoteKey !== noteKey) {
      this.trackedNoteKey = noteKey;
      this.trackedBaseDb = null;
    }

    // 4a. 音高穩定度 pitchStd
    if (pitchStd !== null) {
      if (pitchStd >= VOICE_CONFIG.VOICE_PITCH_STD_MIN) {
        score += VOICE_CONFIG.W_PITCH_STD_VOICE;
      } else if (pitchStd <= VOICE_CONFIG.PIANO_PITCH_STD_MAX) {
        score -= VOICE_CONFIG.W_PITCH_STD_LEAK;
      } else if (pitchStd <= VOICE_CONFIG.PIANO_PITCH_STD_MILD) {
        score -= VOICE_CONFIG.W_PITCH_STD_MILD_LEAK;
      }
    }

    // 4b. 4–7 Hz 顫音
    if (hasVibrato) {
      score += VOICE_CONFIG.W_VIBRATO_VOICE;
    }

    // 4c. 音量走勢（鋼琴包絡衰減 vs 上升／高於包絡）
    const env = pianoEnvelopeAt(tSinceOnset, matched.held);
    const envDb = 20 * Math.log10(Math.max(env, 1e-6));
    // 僅在看起來像鋼琴起音時記錄該音的參考基準音量
    if (
      this.trackedBaseDb === null &&
      tSinceOnset >= ATTACK &&
      tSinceOnset <= 0.12 &&
      (pitchStd === null || pitchStd <= VOICE_CONFIG.VOICE_PITCH_STD_MIN)
    ) {
      this.trackedBaseDb = db - envDb;
    }

    const postWindowStats = computeStats(
      this.history,
      matched.onsetSec + VOICE_CONFIG.POST_ATTACK_GUARD_SEC,
    );
    const postWindowRise =
      Number.isFinite(postWindowStats.minDb) ? db - postWindowStats.minDb : 0;

    let volumeVoiceEvidence = false;
    if (
      tSinceOnset > ATTACK + VOICE_CONFIG.POST_ATTACK_GUARD_SEC &&
      postWindowRise > VOICE_CONFIG.DB_RISE_150MS_THRESHOLD
    ) {
      volumeVoiceEvidence = true;
    }
    if (this.trackedBaseDb !== null) {
      const expectedDb = this.trackedBaseDb + envDb;
      if (db - expectedDb > VOICE_CONFIG.DB_ABOVE_ENVELOPE_THRESHOLD) {
        volumeVoiceEvidence = true;
      }
    }
    if (volumeVoiceEvidence) {
      score += VOICE_CONFIG.W_VOLUME_VOICE;
    }

    // 4d. 起音時間差 < 30 ms 且其他特徵像鋼琴 → leak
    const onsetClose =
      this.micOnsetSec !== null &&
      Math.abs(this.micOnsetSec - matched.onsetSec) <
        VOICE_CONFIG.ONSET_MATCH_SEC;
    if (
      onsetClose &&
      !hasVibrato &&
      !volumeVoiceEvidence &&
      (pitchStd === null || pitchStd <= VOICE_CONFIG.PIANO_PITCH_STD_MILD)
    ) {
      score -= VOICE_CONFIG.W_ONSET_LEAK;
    }

    let label: VoiceLabel = 'unknown';
    if (score >= VOICE_CONFIG.SCORE_VOICE_THRESHOLD) {
      label = 'voice';
    } else if (score <= VOICE_CONFIG.SCORE_LEAK_THRESHOLD) {
      label = 'leak';
    }

    return {
      label,
      pitchStd,
      hasVibrato,
      dbRise150ms,
      score,
      isMetro: false,
      hasOutput: true,
    };
  }
}

export interface ConfusionInput {
  t: number;
  label: VoiceLabel;
  /** 浮點 MIDI 音高（僅 voice 幀使用，無音高可傳 NaN） */
  midi: number;
  pitchStd: number | null;
  hasOutput: boolean;
  isMetro: boolean;
}

export interface ConfusionStatus {
  triggered: boolean;
  justTriggered: boolean;
  reason: 'non-voice-ratio' | 'leak-streak' | 'pitch-jumps' | null;
}

/**
 * 混亂偵測狀態機（同一次練習僅觸發一次）：
 * 1. 最近 8 秒有聲幀（非 silent、排除節拍器）中 unknown+leak > 70%
 * 2. 有輸出發聲時，幾乎全是 pitchStd < 1.5 cents 的 leak 持續 > 5 秒
 * 3. 演唱線每秒跳動 > 3 個半音的次數 > 6
 */
export class ConfusionDetector {
  private triggered = false;
  private reason: ConfusionStatus['reason'] = null;
  private readonly window8s: { t: number; isNonVoice: boolean }[] = [];
  private leakStreakStart: number | null = null;
  private nonLeakGraceCount = 0;
  private prevVoiceMidi: number | null = null;
  private readonly jumpTimes: number[] = [];

  reset(): void {
    this.triggered = false;
    this.reason = null;
    this.window8s.length = 0;
    this.leakStreakStart = null;
    this.nonLeakGraceCount = 0;
    this.prevVoiceMidi = null;
    this.jumpTimes.length = 0;
  }

  push(input: ConfusionInput): ConfusionStatus {
    if (this.triggered) {
      return {
        triggered: true,
        justTriggered: false,
        reason: this.reason,
      };
    }

    const { t, label, midi, pitchStd, hasOutput, isMetro } = input;
    if (label === 'silent' || isMetro) {
      return { triggered: false, justTriggered: false, reason: null };
    }

    // 1. 最近 8 秒有聲幀統計
    const isNonVoice = label === 'unknown' || label === 'leak';
    this.window8s.push({ t, isNonVoice });
    const cutoff8 = t - VOICE_CONFIG.CONFUSION_WINDOW_SEC;
    while (this.window8s.length > 0 && this.window8s[0]!.t < cutoff8) {
      this.window8s.shift();
    }
    if (this.window8s.length >= VOICE_CONFIG.CONFUSION_MIN_FRAMES) {
      let nonVoiceCount = 0;
      for (const item of this.window8s) {
        if (item.isNonVoice) nonVoiceCount++;
      }
      if (
        nonVoiceCount / this.window8s.length >
        VOICE_CONFIG.CONFUSION_NON_VOICE_RATIO
      ) {
        return this.trigger('non-voice-ratio');
      }
    }

    // 2. 有輸出發聲時，幾乎全是 pitchStd < 1.5 cents 的 leak 持續 > 5 秒
    const isSteadyLeak =
      hasOutput &&
      label === 'leak' &&
      (pitchStd === null ||
        pitchStd < VOICE_CONFIG.CONFUSION_LEAK_PITCH_STD_MAX);
    if (isSteadyLeak) {
      if (this.leakStreakStart === null) {
        this.leakStreakStart = t;
      }
      this.nonLeakGraceCount = 0;
      if (t - this.leakStreakStart > VOICE_CONFIG.CONFUSION_LEAK_STREAK_SEC) {
        return this.trigger('leak-streak');
      }
    } else if (label === 'voice') {
      this.leakStreakStart = null;
      this.nonLeakGraceCount = 0;
    } else if (hasOutput) {
      // 偶發 unknown 幀給予極小寬限（最多 2 幀）
      this.nonLeakGraceCount++;
      if (this.nonLeakGraceCount > 2) {
        this.leakStreakStart = null;
        this.nonLeakGraceCount = 0;
      } else if (
        this.leakStreakStart !== null &&
        t - this.leakStreakStart > VOICE_CONFIG.CONFUSION_LEAK_STREAK_SEC
      ) {
        return this.trigger('leak-streak');
      }
    }

    // 3. 演唱線每秒跳動 > 3 個半音的次數 > 6
    if (label === 'voice' && Number.isFinite(midi)) {
      if (
        this.prevVoiceMidi !== null &&
        Math.abs(midi - this.prevVoiceMidi) >
          VOICE_CONFIG.CONFUSION_JUMP_SEMITONES
      ) {
        this.jumpTimes.push(t);
      }
      this.prevVoiceMidi = midi;
      const cutoff1 = t - VOICE_CONFIG.CONFUSION_JUMP_WINDOW_SEC;
      while (this.jumpTimes.length > 0 && this.jumpTimes[0]! < cutoff1) {
        this.jumpTimes.shift();
      }
      if (this.jumpTimes.length > VOICE_CONFIG.CONFUSION_JUMP_MAX_COUNT) {
        return this.trigger('pitch-jumps');
      }
    }

    return { triggered: false, justTriggered: false, reason: null };
  }

  private trigger(reason: NonNullable<ConfusionStatus['reason']>): ConfusionStatus {
    this.triggered = true;
    this.reason = reason;
    return {
      triggered: true,
      justTriggered: true,
      reason,
    };
  }
}
