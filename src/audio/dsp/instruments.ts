import type { SynthTimbre } from '../../core/midiMix';

/** 伴奏同時發聲數上限（超過時偷最早觸發的音） */
export const MAX_ACCOMP_POLYPHONY = 48;

const TWO_PI = Math.PI * 2;
const CHUNK_SIZE = 32;
const MAX_HARMONICS = 8;

// 預先配置 16384 點正弦波查找表（含額外 1 點作線性內插）
const TABLE_SIZE = 16384;
const SIN_TABLE = new Float64Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) {
  SIN_TABLE[i] = Math.sin((TWO_PI * i) / TABLE_SIZE);
}

interface TimbreSpec {
  harmonics: readonly number[];
  harmonicDecayScale: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  naturalDecay: number; // <= 0 代表持續音（不自然衰減，直到 noteOff）
  gain: number;
}

const TIMBRE_SPECS: Record<Exclude<SynthTimbre, 'guitar'>, TimbreSpec> = {
  piano: {
    harmonics: [1, 0.44, 0.23, 0.12, 0.07, 0.045, 0.025, 0.015],
    harmonicDecayScale: 0.5,
    attack: 0.008,
    decay: 0.22,
    sustain: 0.48,
    release: 0.3,
    naturalDecay: 3.5,
    gain: 0.16,
  },
  organ: {
    // 音栓／手風琴風格：強化 8'、4'、2-2/3'、2' 泛音，起音快、持續不衰減
    harmonics: [0.9, 0.72, 0.82, 0.35, 0.5, 0.2, 0.28, 0.1],
    harmonicDecayScale: 0.05,
    attack: 0.014,
    decay: 0.08,
    sustain: 0.96,
    release: 0.08,
    naturalDecay: 0,
    gain: 0.13,
  },
  strings: {
    // 弦樂合奏：慢起音（0.14s）、鋸齒狀泛音比例、柔和收尾
    harmonics: [1, 0.62, 0.4, 0.26, 0.17, 0.11, 0.065, 0.035],
    harmonicDecayScale: 0.1,
    attack: 0.14,
    decay: 0.25,
    sustain: 0.88,
    release: 0.35,
    naturalDecay: 0,
    gain: 0.14,
  },
  bass: {
    // 貝斯：強化基音與二倍頻，高次泛音快衰減、低頻較厚
    harmonics: [1, 0.75, 0.34, 0.15, 0.06, 0.02, 0, 0],
    harmonicDecayScale: 0.85,
    attack: 0.006,
    decay: 0.24,
    sustain: 0.56,
    release: 0.12,
    naturalDecay: 2.4,
    gain: 0.22,
  },
};

const GUITAR_RELEASE = 0.14;
const GUITAR_GAIN = 0.24;

interface AdditiveVoice {
  kind: 'additive';
  id: string;
  timbre: Exclude<SynthTimbre, 'guitar'>;
  velocity: number;
  held: boolean;
  age: number;
  releaseAge: number;
  releaseLevel: number;
  releaseFrames: number;
  activeHarmonics: number;
  phases: Float64Array;
  phaseIncs: Float64Array;
}

interface GuitarVoice {
  kind: 'guitar';
  id: string;
  velocity: number;
  age: number;
  releaseAge: number;
  releaseFrames: number;
  buf: Float32Array;
  bufLen: number;
  writeIdx: number;
  delayInt: number;
  delayFrac: number;
  damp: number;
  prevOut: number;
}

type AccompVoice = AdditiveVoice | GuitarVoice;

function computeTimbreEnvelope(
  spec: TimbreSpec,
  t: number,
  held: boolean,
): number {
  const ads =
    t < spec.attack
      ? t / spec.attack
      : spec.sustain +
        (1 - spec.sustain) * Math.exp(-Math.max(t - spec.attack, 0) / spec.decay);
  if (held || spec.naturalDecay <= 0) {
    return ads;
  }
  return ads * Math.exp(-t / spec.naturalDecay);
}

/** 伴奏多音色合成器（鋼琴／風琴／弦樂／貝斯／Karplus-Strong 吉他，上限 48 聲） */
export class AccompSynth {
  readonly rate: number;
  readonly maxPolyphony: number;
  private readonly voices = new Map<string, AccompVoice>();
  private readonly chunkBuf = new Float64Array(CHUNK_SIZE);
  private readonly guitarBufferPool: Float32Array[] = [];
  private readonly maxGuitarDelayLen: number;
  private rngState = 0x13579bdf;

  constructor(rate: number, maxPolyphony = MAX_ACCOMP_POLYPHONY) {
    this.rate = rate;
    this.maxPolyphony = Math.max(1, maxPolyphony);
    this.maxGuitarDelayLen = Math.max(2048, Math.ceil(rate / 20) + 8);
  }

  private nextNoise(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState / 0xffffffff) * 2 - 1;
  }

  private acquireGuitarBuf(neededLen: number): Float32Array {
    const pooled = this.guitarBufferPool.pop();
    if (pooled && pooled.length >= neededLen) {
      return pooled;
    }
    return new Float32Array(Math.max(this.maxGuitarDelayLen, neededLen));
  }

  private releaseVoiceResources(voice: AccompVoice): void {
    if (voice.kind === 'guitar') {
      this.guitarBufferPool.push(voice.buf);
    }
  }

  private deleteVoice(id: string): void {
    const existing = this.voices.get(id);
    if (!existing) return;
    this.voices.delete(id);
    this.releaseVoiceResources(existing);
  }

  /** 觸發一個伴奏音符（超過最大發聲數時偷走最早觸發的音） */
  on(
    id: string,
    hz: number,
    timbre: SynthTimbre = 'piano',
    velocity = 1,
    held = false,
  ): void {
    if (!(hz > 0) || !Number.isFinite(hz)) {
      return;
    }
    const vel = Math.max(0.02, Math.min(1, Number.isFinite(velocity) ? velocity : 1));

    if (this.voices.has(id)) {
      this.deleteVoice(id);
    } else if (this.voices.size >= this.maxPolyphony) {
      const oldest = this.voices.keys().next().value;
      if (oldest !== undefined) {
        this.deleteVoice(oldest);
      }
    }

    // Karplus-Strong 吉他（極高音接近 Nyquist 時退回加法合成以免失準）
    const exactPeriod = this.rate / hz - 0.5;
    if (timbre === 'guitar' && exactPeriod >= 4) {
      const delayInt = Math.floor(exactPeriod);
      const delayFrac = exactPeriod - delayInt;
      const bufLen = delayInt + 4;
      const buf = this.acquireGuitarBuf(bufLen);

      // 以平滑化白噪音作為撥弦激發，產生溫暖吉他撥弦音色
      let prev = 0;
      for (let i = 0; i < bufLen; i++) {
        const raw = this.nextNoise();
        const smoothed = 0.55 * raw + 0.45 * prev;
        prev = smoothed;
        buf[i] = smoothed;
      }
      // 去除直流偏移避免低頻漂移
      let sum = 0;
      for (let i = 0; i < bufLen; i++) sum += buf[i]!;
      const mean = sum / bufLen;
      for (let i = 0; i < bufLen; i++) buf[i] = buf[i]! - mean;

      // 依音高調整每週期阻尼，使不同音域具有一致自然的衰減時間
      const damp = Math.max(0.96, Math.min(0.9975, Math.exp(-1 / (1.8 * hz))));
      this.voices.set(id, {
        kind: 'guitar',
        id,
        velocity: vel,
        age: 0,
        releaseAge: -1,
        releaseFrames: Math.max(1, Math.round(GUITAR_RELEASE * this.rate)),
        buf,
        bufLen,
        writeIdx: 0,
        delayInt,
        delayFrac,
        damp,
        prevOut: buf[0] ?? 0,
      });
      return;
    }

    const resolvedTimbre: Exclude<SynthTimbre, 'guitar'> =
      timbre === 'guitar' ? 'piano' : timbre;
    const spec = TIMBRE_SPECS[resolvedTimbre];
    const phases = new Float64Array(MAX_HARMONICS);
    const phaseIncs = new Float64Array(MAX_HARMONICS);
    const nyquistLimit = this.rate * 0.48;
    let activeHarmonics = 0;

    for (let h = 0; h < spec.harmonics.length; h++) {
      const freq = hz * (h + 1);
      if (freq >= nyquistLimit) {
        break;
      }
      phaseIncs[h] = freq / this.rate;
      activeHarmonics = h + 1;
    }

    this.voices.set(id, {
      kind: 'additive',
      id,
      timbre: resolvedTimbre,
      velocity: vel,
      held,
      age: 0,
      releaseAge: -1,
      releaseLevel: 0,
      releaseFrames: Math.max(1, Math.round(spec.release * this.rate)),
      activeHarmonics,
      phases,
      phaseIncs,
    });
  }

  /** 釋放指定音符進入收尾階段 */
  off(id: string): void {
    const voice = this.voices.get(id);
    if (!voice || voice.releaseAge >= 0) {
      return;
    }
    voice.releaseAge = voice.age;
    if (voice.kind === 'additive') {
      const spec = TIMBRE_SPECS[voice.timbre];
      voice.releaseLevel = computeTimbreEnvelope(
        spec,
        voice.age / this.rate,
        voice.held,
      );
    }
  }

  /** 立即清除所有發聲中的伴奏音符 */
  allOff(): void {
    for (const voice of this.voices.values()) {
      this.releaseVoiceResources(voice);
    }
    this.voices.clear();
  }

  /** 目前發聲中的伴奏音符數 */
  get voiceCount(): number {
    return this.voices.size;
  }

  /** 累加合成音訊至 out[offset .. offset + frames) */
  render(out: Float32Array, offset: number, frames: number): void {
    if (this.voices.size === 0 || frames <= 0) {
      return;
    }

    const invRate = 1 / this.rate;
    const chunkBuf = this.chunkBuf;

    for (const [id, voice] of this.voices) {
      if (voice.kind === 'guitar') {
        this.renderGuitarVoice(voice, out, offset, frames);
        if (
          voice.releaseAge >= 0 &&
          voice.age - voice.releaseAge >= voice.releaseFrames
        ) {
          this.deleteVoice(id);
        }
        continue;
      }

      const spec = TIMBRE_SPECS[voice.timbre];
      const invRelease = 1 / spec.release;
      const nHarm = voice.activeHarmonics;
      const phases = voice.phases;
      const phaseIncs = voice.phaseIncs;
      const voiceGain = spec.gain * voice.velocity;

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
          env0 = computeTimbreEnvelope(spec, t0, voice.held);
          env1 = computeTimbreEnvelope(spec, t1, voice.held);
        }
        const envStep = (env1 - env0) * invChunk;

        chunkBuf.fill(0, 0, chunkLen);

        for (let h = 0; h < nHarm; h++) {
          const strength = spec.harmonics[h]!;
          if (strength <= 0) continue;
          let amp: number;
          let ampStep: number;
          if (h === 0 || spec.harmonicDecayScale <= 0) {
            amp = strength;
            ampStep = 0;
          } else {
            const decayRate = h * spec.harmonicDecayScale;
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
            out[outBase + s]! + chunkBuf[s]! * env * voiceGain;
          env += envStep;
        }

        voice.age += chunkLen;
        pos += chunkLen;
      }

      if (
        voice.releaseAge >= 0 &&
        voice.age - voice.releaseAge >= voice.releaseFrames
      ) {
        this.deleteVoice(id);
      }
    }
  }

  private renderGuitarVoice(
    v: GuitarVoice,
    out: Float32Array,
    offset: number,
    frames: number,
  ): void {
    const buf = v.buf;
    const len = v.bufLen;
    const dInt = v.delayInt;
    const frac = v.delayFrac;
    const gain = GUITAR_GAIN * v.velocity;
    const invReleaseFrames = 1 / v.releaseFrames;

    for (let s = 0; s < frames; s++) {
      let idx0 = v.writeIdx - dInt;
      if (idx0 < 0) idx0 += len;
      let idx1 = idx0 - 1;
      if (idx1 < 0) idx1 += len;

      const s0 = buf[idx0]!;
      const s1 = buf[idx1]!;
      const delayed = s0 + (s1 - s0) * frac;
      const filtered = 0.5 * (delayed + v.prevOut) * v.damp;
      v.prevOut = delayed;

      buf[v.writeIdx] = filtered;
      v.writeIdx += 1;
      if (v.writeIdx >= len) {
        v.writeIdx = 0;
      }

      let relGain = 1;
      if (v.releaseAge >= 0) {
        const rem = 1 - (v.age - v.releaseAge) * invReleaseFrames;
        relGain = rem > 0 ? rem * rem : 0;
      }

      out[offset + s] = out[offset + s]! + filtered * gain * relGain;
      v.age += 1;
    }
  }
}
