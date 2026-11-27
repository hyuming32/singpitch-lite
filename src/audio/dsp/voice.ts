/** 滑音合成人聲（母音「啊」：鋸齒波聲源 + 三共振峰帶通濾波器 + 顫音） */

const TWO_PI = Math.PI * 2;
const ATTACK_SEC = 0.04;
const RELEASE_SEC = 0.12;
const VIBRATO_HZ = 5.0;
const VIBRATO_CENTS = 15;
const VIBRATO_RATIO = Math.pow(2, VIBRATO_CENTS / 1200) - 1;
const VOICE_GAIN = 0.14;

interface FormantSpec {
  freq: number;
  bw: number;
  weight: number;
}

const FORMANTS: readonly FormantSpec[] = [
  { freq: 800, bw: 80, weight: 1.0 },
  { freq: 1150, bw: 90, weight: 0.7 },
  { freq: 2900, bw: 120, weight: 0.35 },
];

interface BiquadBP {
  b0: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

function createBandpass(freq: number, bw: number, rate: number): BiquadBP {
  const w0 = (TWO_PI * freq) / rate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const q = freq / bw;
  const alpha = sinW0 / (2 * q);
  const a0 = 1 + alpha;
  // 定峰值增益（0 dB 峰值）帶通濾波器
  return {
    b0: alpha / a0,
    b2: -alpha / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

interface VoiceInstance {
  id: string;
  hzStart: number;
  hzRatio: number;
  durSec: number;
  age: number;
  releaseAge: number;
  releaseLevel: number;
  phase: number;
  vibPhase: number;
  filters: [BiquadBP, BiquadBP, BiquadBP];
}

/** PolyBLEP 抗混疊修正項 */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export class GlideVoice {
  readonly rate: number;
  private readonly voices = new Map<string, VoiceInstance>();
  private readonly attackFrames: number;
  private readonly releaseFrames: number;
  private readonly vibPhaseInc: number;

  constructor(rate: number) {
    this.rate = rate;
    this.attackFrames = Math.max(1, ATTACK_SEC * rate);
    this.releaseFrames = Math.max(1, RELEASE_SEC * rate);
    this.vibPhaseInc = (TWO_PI * VIBRATO_HZ) / rate;
  }

  /** 啟動滑音人聲，在 durSec 秒內以對數線性從 hzStart 滑至 hzEnd */
  start(id: string, hzStart: number, hzEnd: number, durSec: number): void {
    const f0 = createBandpass(FORMANTS[0]!.freq, FORMANTS[0]!.bw, this.rate);
    const f1 = createBandpass(FORMANTS[1]!.freq, FORMANTS[1]!.bw, this.rate);
    const f2 = createBandpass(FORMANTS[2]!.freq, FORMANTS[2]!.bw, this.rate);

    this.voices.set(id, {
      id,
      hzStart,
      hzRatio: hzEnd / hzStart,
      durSec: Math.max(1e-4, durSec),
      age: 0,
      releaseAge: -1,
      releaseLevel: 0,
      phase: 0,
      vibPhase: 0,
      filters: [f0, f1, f2],
    });
  }

  /** 停止指定 id 的人聲並進入收音階段 */
  stop(id: string): void {
    const v = this.voices.get(id);
    if (v && v.releaseAge < 0) {
      v.releaseAge = v.age;
      v.releaseLevel = Math.min(1, v.age / this.attackFrames);
    }
  }

  /** 立即清除所有發聲中的人聲 */
  allOff(): void {
    this.voices.clear();
  }

  /** 目前發聲中的人聲數量 */
  get voiceCount(): number {
    return this.voices.size;
  }

  /** 將合成人聲累加至 out[offset .. offset + frames) */
  render(out: Float32Array, offset: number, frames: number): void {
    if (this.voices.size === 0 || frames <= 0) {
      return;
    }

    const invRate = 1 / this.rate;
    const w0 = FORMANTS[0]!.weight;
    const w1 = FORMANTS[1]!.weight;
    const w2 = FORMANTS[2]!.weight;

    for (const [id, v] of this.voices) {
      const f0 = v.filters[0];
      const f1 = v.filters[1];
      const f2 = v.filters[2];

      for (let s = 0; s < frames; s++) {
        let env: number;
        if (v.releaseAge >= 0) {
          const relElapsed = v.age - v.releaseAge;
          const rem = 1 - relElapsed / this.releaseFrames;
          env = rem > 0 ? v.releaseLevel * rem : 0;
        } else {
          env = v.age < this.attackFrames ? v.age / this.attackFrames : 1;
        }

        const t = v.age * invRate;
        const u = t >= v.durSec ? 1 : t / v.durSec;
        const baseHz = v.hzStart * Math.pow(v.hzRatio, u);
        const vib = 1 + VIBRATO_RATIO * Math.sin(v.vibPhase);
        const dt = (baseHz * vib) * invRate;

        // PolyBLEP 鋸齒波
        let saw = 2 * v.phase - 1;
        saw -= polyBlep(v.phase, dt);

        v.phase += dt;
        if (v.phase >= 1) {
          v.phase -= 1;
        }
        v.vibPhase += this.vibPhaseInc;
        if (v.vibPhase >= TWO_PI) {
          v.vibPhase -= TWO_PI;
        }

        // 三個共振峰帶通濾波器並聯輸出
        const y0 =
          f0.b0 * saw + f0.b2 * f0.x2 - f0.a1 * f0.y1 - f0.a2 * f0.y2;
        f0.x2 = f0.x1;
        f0.x1 = saw;
        f0.y2 = f0.y1;
        f0.y1 = y0;

        const y1 =
          f1.b0 * saw + f1.b2 * f1.x2 - f1.a1 * f1.y1 - f1.a2 * f1.y2;
        f1.x2 = f1.x1;
        f1.x1 = saw;
        f1.y2 = f1.y1;
        f1.y1 = y1;

        const y2 =
          f2.b0 * saw + f2.b2 * f2.x2 - f2.a1 * f2.y1 - f2.a2 * f2.y2;
        f2.x2 = f2.x1;
        f2.x1 = saw;
        f2.y2 = f2.y1;
        f2.y1 = y2;

        const sample = (y0 * w0 + y1 * w1 + y2 * w2) * env * VOICE_GAIN;
        out[offset + s] = out[offset + s]! + sample;
        v.age += 1;
      }

      if (
        v.releaseAge >= 0 &&
        v.age - v.releaseAge >= this.releaseFrames
      ) {
        this.voices.delete(id);
      }
    }
  }
}
