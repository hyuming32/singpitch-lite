/** 加法合成鋼琴（移植自桌面版，使用相位累加、查表內插與 32 樣本包絡內插優化） */

export const MAX_POLYPHONY = 32;
export const ATTACK = 0.008;
export const DECAY = 0.22;
export const SUSTAIN = 0.48;
export const RELEASE = 0.3;
export const PIANO_DECAY = 3.5;
export const HARMONICS = [
  1, 0.44, 0.23, 0.12, 0.07, 0.045, 0.025, 0.015,
] as const;
export const PIANO_GAIN = 0.16;

const TWO_PI = Math.PI * 2;
const CHUNK_SIZE = 32;
const NUM_HARMONICS = HARMONICS.length;

// 預先配置 16384 點正弦波查找表（含額外 1 點方便線性內插）
const TABLE_SIZE = 16384;
const SIN_TABLE = new Float64Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) {
  SIN_TABLE[i] = Math.sin((TWO_PI * i) / TABLE_SIZE);
}

interface PianoVoice {
  id: string;
  hz: number;
  held: boolean;
  age: number;
  releaseAge: number;
  releaseLevel: number;
  activeHarmonics: number;
  phases: Float64Array;
  phaseIncs: Float64Array;
}

function computeEnvelope(t: number, held: boolean): number {
  const ads =
    t < ATTACK
      ? t / ATTACK
      : SUSTAIN + (1 - SUSTAIN) * Math.exp(-Math.max(t - ATTACK, 0) / DECAY);
  return ads * (held ? 1 : Math.exp(-t / PIANO_DECAY));
}

export class AdditivePiano {
  readonly rate: number;
  private readonly voices = new Map<string, PianoVoice>();
  private readonly releaseFrames: number;
  private readonly chunkBuf = new Float64Array(CHUNK_SIZE);

  constructor(rate: number) {
    this.rate = rate;
    this.releaseFrames = RELEASE * rate;
  }

  /** 觸發一個鋼琴音符（若同 id 已存在則取代，超過最大複音數時移除最舊者） */
  on(id: string, hz: number, held = false): void {
    if (this.voices.has(id)) {
      this.voices.delete(id);
    } else if (this.voices.size >= MAX_POLYPHONY) {
      const oldest = this.voices.keys().next().value;
      if (oldest !== undefined) {
        this.voices.delete(oldest);
      }
    }

    const phases = new Float64Array(NUM_HARMONICS);
    const phaseIncs = new Float64Array(NUM_HARMONICS);
    const nyquistLimit = this.rate * 0.48;
    let activeHarmonics = 0;

    for (let h = 0; h < NUM_HARMONICS; h++) {
      const freq = hz * (h + 1);
      if (freq >= nyquistLimit) {
        break;
      }
      phaseIncs[h] = freq / this.rate;
      activeHarmonics = h + 1;
    }

    this.voices.set(id, {
      id,
      hz,
      held,
      age: 0,
      releaseAge: -1,
      releaseLevel: 0,
      activeHarmonics,
      phases,
      phaseIncs,
    });
  }

  /** 釋放指定 id 的音符進入收音階段 */
  off(id: string): void {
    const voice = this.voices.get(id);
    if (voice && voice.releaseAge < 0) {
      voice.releaseAge = voice.age;
      voice.releaseLevel = computeEnvelope(voice.age / this.rate, voice.held);
    }
  }

  /** 立即清除所有發聲中的音符 */
  allOff(): void {
    this.voices.clear();
  }

  /** 目前發聲中的音符數量 */
  get voiceCount(): number {
    return this.voices.size;
  }

  /** 將合成音訊累加至 out[offset .. offset + frames) */
  render(out: Float32Array, offset: number, frames: number): void {
    if (this.voices.size === 0 || frames <= 0) {
      return;
    }

    const invRate = 1 / this.rate;
    const invRelease = 1 / RELEASE;
    const chunkBuf = this.chunkBuf;

    for (const [id, voice] of this.voices) {
      const nHarm = voice.activeHarmonics;
      const phases = voice.phases;
      const phaseIncs = voice.phaseIncs;

      let pos = 0;
      while (pos < frames) {
        const chunkLen =
          frames - pos < CHUNK_SIZE ? frames - pos : CHUNK_SIZE;
        const invChunk = 1 / chunkLen;
        const t0 = voice.age * invRate;
        const t1 = (voice.age + chunkLen) * invRate;

        let env0: number;
        let env1: number;
        if (voice.releaseAge >= 0) {
          const relTime = voice.releaseAge * invRate;
          const e0 = 1 - (t0 - relTime) * invRelease;
          const e1 = 1 - (t1 - relTime) * invRelease;
          env0 = e0 > 0 ? voice.releaseLevel * e0 * e0 : 0;
          env1 = e1 > 0 ? voice.releaseLevel * e1 * e1 : 0;
        } else {
          env0 = computeEnvelope(t0, voice.held);
          env1 = computeEnvelope(t1, voice.held);
        }
        const envStep = (env1 - env0) * invChunk;

        chunkBuf.fill(0, 0, chunkLen);

        for (let h = 0; h < nHarm; h++) {
          const strength = HARMONICS[h]!;
          let amp: number;
          let ampStep: number;
          if (h === 0) {
            amp = strength;
            ampStep = 0;
          } else {
            const decayRate = h * 0.5;
            const d0 = strength * Math.exp(-t0 * decayRate);
            const d1 = strength * Math.exp(-t1 * decayRate);
            amp = d0;
            ampStep = (d1 - d0) * invChunk;
          }

          let ph = phases[h]!;
          const inc = phaseIncs[h]!;
          for (let s = 0; s < chunkLen; s++) {
            const f = ph * TABLE_SIZE;
            const idx = f | 0;
            const frac = f - idx;
            const s0 = SIN_TABLE[idx]!;
            const sinVal = s0 + (SIN_TABLE[idx + 1]! - s0) * frac;
            chunkBuf[s] = chunkBuf[s]! + amp * sinVal;
            amp += ampStep;
            ph += inc;
            if (ph >= 1) {
              ph -= 1;
            }
          }
          phases[h] = ph;
        }

        let env = env0;
        const outBase = offset + pos;
        for (let s = 0; s < chunkLen; s++) {
          out[outBase + s] =
            out[outBase + s]! + chunkBuf[s]! * env * PIANO_GAIN;
          env += envStep;
        }

        voice.age += chunkLen;
        pos += chunkLen;
      }

      if (
        voice.releaseAge >= 0 &&
        voice.age - voice.releaseAge >= this.releaseFrames
      ) {
        this.voices.delete(id);
      }
    }
  }
}
