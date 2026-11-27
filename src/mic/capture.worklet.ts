/** 麥克風擷取 AudioWorklet：每 512 樣本傳送一塊 Float32Array 與對應的 context frame 位置 */

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

const HOP_SIZE = 512;

class SingPitchCaptureProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(HOP_SIZE);
  private offset = 0;
  private chunkStartFrame = 0;
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type === 'stop') {
        this.stopped = true;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.stopped) {
      return false;
    }

    // 確保輸出保持靜音，避免任何回授
    const out = outputs[0];
    if (out) {
      for (let ch = 0; ch < out.length; ch++) {
        out[ch]?.fill(0);
      }
    }

    const inputChannel = inputs[0]?.[0];
    if (!inputChannel || inputChannel.length === 0) {
      return true;
    }

    const baseFrame = typeof currentFrame === 'number' ? currentFrame : 0;
    let srcIdx = 0;
    const len = inputChannel.length;

    while (srcIdx < len) {
      if (this.offset === 0) {
        this.chunkStartFrame = baseFrame + srcIdx;
      }
      const need = HOP_SIZE - this.offset;
      const take = Math.min(need, len - srcIdx);
      this.buf.set(inputChannel.subarray(srcIdx, srcIdx + take), this.offset);
      this.offset += take;
      srcIdx += take;

      if (this.offset >= HOP_SIZE) {
        const chunk = this.buf;
        this.port.postMessage(
          {
            type: 'audio',
            samples: chunk,
            frame: this.chunkStartFrame,
            sampleRate,
          },
          [chunk.buffer],
        );
        this.buf = new Float32Array(HOP_SIZE);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor('singpitch-capture', SingPitchCaptureProcessor);
