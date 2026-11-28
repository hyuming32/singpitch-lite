import type { DrumSound } from '../../core/midiMix';

/** 鼓組同時發聲數上限 */
export const MAX_DRUM_POLYPHONY = 16;

const TWO_PI = Math.PI * 2;
const DRUM_MASTER_GAIN = 0.36;

interface DrumVoice {
  drum: DrumSound;
  velocity: number;
  age: number;
  totalFrames: number;
  phase: number;
  phase2: number;
  phase3: number;
  hpPrevX: number;
  hpPrevY: number;
  baseHz: number;
}

const DRUM_DURATION_SEC: Record<DrumSound, number> = {
  kick: 0.35,
  snare: 0.25,
  closedHat: 0.07,
  openHat: 0.45,
  cymbal: 1.2,
  tom: 0.38,
};

function tomBaseHz(midiNote: number): number {
  const clamped = Math.max(41, Math.min(68, midiNote));
  return 75 * Math.pow(2, (clamped - 41) / 16);
}

/** 合成鼓組（大鼓、小鼓、閉合／開放 hi-hat、銅鈸、通鼓） */
export class DrumSynth {
  readonly rate: number;
  readonly maxPolyphony: number;
  private readonly voices: DrumVoice[] = [];
  private rngState = 0x2468ace1;

  constructor(rate: number, maxPolyphony = MAX_DRUM_POLYPHONY) {
    this.rate = rate;
    this.maxPolyphony = Math.max(1, maxPolyphony);
  }

  private nextNoise(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState / 0xffffffff) * 2 - 1;
  }

  /** 觸發一次鼓聲（閉合 hi-hat 會自動截斷正在響的開放 hi-hat） */
  trigger(drum: DrumSound, velocity = 1, midiNote = 45): void {
    const vel = Math.max(
      0.05,
      Math.min(1, Number.isFinite(velocity) ? velocity : 1),
    );

    if (drum === 'closedHat') {
      for (let i = this.voices.length - 1; i >= 0; i--) {
        if (this.voices[i]!.drum === 'openHat') {
          this.voices.splice(i, 1);
        }
      }
    }

    if (this.voices.length >= this.maxPolyphony) {
      this.voices.shift();
    }

    const durSec = DRUM_DURATION_SEC[drum];
    this.voices.push({
      drum,
      velocity: vel,
      age: 0,
      totalFrames: Math.max(1, Math.round(durSec * this.rate)),
      phase: 0,
      phase2: 0,
      phase3: 0,
      hpPrevX: 0,
      hpPrevY: 0,
      baseHz: drum === 'tom' ? tomBaseHz(midiNote) : 0,
    });
  }

  /** 立即停止所有鼓聲 */
  allOff(): void {
    this.voices.length = 0;
  }

  /** 目前發聲中的鼓聲數量 */
  get voiceCount(): number {
    return this.voices.length;
  }

  /** 累加鼓組音訊至 out[offset .. offset + frames) */
  render(out: Float32Array, offset: number, frames: number): void {
    if (this.voices.length === 0 || frames <= 0) {
      return;
    }

    const invRate = 1 / this.rate;
    // 一階高通係數（約 5500 Hz 截止，適合 hi-hat 與銅鈸）
    const hpAlpha = Math.exp((-TWO_PI * 5500) / this.rate);

    for (let vi = this.voices.length - 1; vi >= 0; vi--) {
      const v = this.voices[vi]!;
      const remain = v.totalFrames - v.age;
      const count = remain < frames ? remain : frames;
      const gain = DRUM_MASTER_GAIN * v.velocity;

      for (let s = 0; s < count; s++) {
        const t = v.age * invRate;
        let sample = 0;

        switch (v.drum) {
          case 'kick': {
            const hz = 48 + 98 * Math.exp(-t / 0.032);
            v.phase += hz * invRate;
            if (v.phase >= 1) v.phase -= 1;
            const body = Math.sin(TWO_PI * v.phase) * Math.exp(-t / 0.13);
            const click = t < 0.004 ? (1 - t / 0.004) * 0.35 : 0;
            sample = (body + click) * 1.1;
            break;
          }
          case 'snare': {
            v.phase += 185 * invRate;
            if (v.phase >= 1) v.phase -= 1;
            const body = Math.sin(TWO_PI * v.phase) * Math.exp(-t / 0.045) * 0.55;
            const n = this.nextNoise();
            const hp = hpAlpha * (v.hpPrevY + n - v.hpPrevX);
            v.hpPrevX = n;
            v.hpPrevY = hp;
            const wires = hp * Math.exp(-t / 0.095) * 0.85;
            sample = body + wires;
            break;
          }
          case 'closedHat': {
            const n = this.nextNoise();
            const hp = hpAlpha * (v.hpPrevY + n - v.hpPrevX);
            v.hpPrevX = n;
            v.hpPrevY = hp;
            v.phase += 6340 * invRate;
            if (v.phase >= 1) v.phase -= 1;
            const metal = Math.sin(TWO_PI * v.phase) * 0.25;
            sample = (hp * 0.8 + metal) * Math.exp(-t / 0.022);
            break;
          }
          case 'openHat': {
            const n = this.nextNoise();
            const hp = hpAlpha * (v.hpPrevY + n - v.hpPrevX);
            v.hpPrevX = n;
            v.hpPrevY = hp;
            v.phase += 5870 * invRate;
            if (v.phase >= 1) v.phase -= 1;
            const metal = Math.sin(TWO_PI * v.phase) * 0.22;
            sample = (hp * 0.8 + metal) * Math.exp(-t / 0.17);
            break;
          }
          case 'cymbal': {
            const n = this.nextNoise();
            const hp = hpAlpha * (v.hpPrevY + n - v.hpPrevX);
            v.hpPrevX = n;
            v.hpPrevY = hp;
            v.phase += 3420 * invRate;
            v.phase2 += 4910 * invRate;
            v.phase3 += 6820 * invRate;
            if (v.phase >= 1) v.phase -= 1;
            if (v.phase2 >= 1) v.phase2 -= 1;
            if (v.phase3 >= 1) v.phase3 -= 1;
            const shimmer =
              (Math.sin(TWO_PI * v.phase) +
                Math.sin(TWO_PI * v.phase2) * 0.7 +
                Math.sin(TWO_PI * v.phase3) * 0.5) *
              0.14;
            sample = (hp * 0.65 + shimmer) * Math.exp(-t / 0.5);
            break;
          }
          case 'tom': {
            const hz = v.baseHz * (1 + 0.38 * Math.exp(-t / 0.038));
            v.phase += hz * invRate;
            if (v.phase >= 1) v.phase -= 1;
            sample = Math.sin(TWO_PI * v.phase) * Math.exp(-t / 0.14) * 0.95;
            break;
          }
        }

        out[offset + s] = out[offset + s]! + sample * gain;
        v.age += 1;
      }

      if (v.age >= v.totalFrames) {
        this.voices.splice(vi, 1);
      }
    }
  }
}
