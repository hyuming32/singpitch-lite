/** 節拍器音效合成器（長度 35 ms，重拍 1700 Hz、其餘 1100 Hz） */

const CLICK_SEC = 0.035;
const CLICK_AMP = 0.3;
const CLICK_DECAY = 100;
const ACCENT_HZ = 1700;
const NORMAL_HZ = 1100;
const TWO_PI = Math.PI * 2;

function buildClickBuffer(rate: number, hz: number): Float32Array {
  const len = Math.max(1, Math.round(CLICK_SEC * rate));
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    buf[i] = CLICK_AMP * Math.sin(TWO_PI * hz * t) * Math.exp(-CLICK_DECAY * t);
  }
  return buf;
}

export class MetronomeClick {
  readonly rate: number;
  private readonly accentBuf: Float32Array;
  private readonly normalBuf: Float32Array;
  private activeBuf: Float32Array | null = null;
  private cursor = 0;

  constructor(rate: number) {
    this.rate = rate;
    this.accentBuf = buildClickBuffer(rate, ACCENT_HZ);
    this.normalBuf = buildClickBuffer(rate, NORMAL_HZ);
  }

  /** 觸發一次節拍聲 */
  trigger(accent: boolean): void {
    this.activeBuf = accent ? this.accentBuf : this.normalBuf;
    this.cursor = 0;
  }

  /** 停止目前播放中的節拍聲 */
  allOff(): void {
    this.activeBuf = null;
    this.cursor = 0;
  }

  /** 將節拍聲累加至 out[offset .. offset + frames) */
  render(out: Float32Array, offset: number, frames: number): void {
    const buf = this.activeBuf;
    if (!buf || frames <= 0) {
      return;
    }

    const remain = buf.length - this.cursor;
    const count = remain < frames ? remain : frames;
    for (let i = 0; i < count; i++) {
      out[offset + i] = out[offset + i]! + buf[this.cursor + i]!;
    }
    this.cursor += count;
    if (this.cursor >= buf.length) {
      this.activeBuf = null;
      this.cursor = 0;
    }
  }
}
