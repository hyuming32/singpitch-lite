import {
  createMixerState,
  renderBlock,
  stopExerciseVoices,
  type GainBus,
  type MixerState,
} from '../dsp/mixer';
import type { SchedEvent } from '../dsp/schedule';

// AudioWorklet 全域型別宣告（不依賴額外套件）
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

export type WorkletInMessage =
  | { type: 'load'; events: SchedEvent[]; totalFrames: number; generation?: number }
  | { type: 'append'; events: SchedEvent[]; generation: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; frame: number }
  | { type: 'keyOn'; midi: number; hz: number }
  | { type: 'keyOff'; midi: number }
  | { type: 'gain'; bus: GainBus; value: number }
  | { type: 'muteKeys'; value: boolean };

class SingPitchEngineProcessor extends AudioWorkletProcessor {
  private readonly state: MixerState;
  private monoBuf: Float32Array;
  private readonly reportIntervalFrames: number;
  private framesSinceReport = 0;
  private generation = 0;

  constructor() {
    super();
    this.state = createMixerState(sampleRate, 128);
    this.monoBuf = new Float32Array(128);
    this.reportIntervalFrames = Math.max(1, Math.round(sampleRate * 0.025));

    this.port.onmessage = (ev: MessageEvent<WorkletInMessage>) => {
      this.handleMessage(ev.data);
    };
  }

  private getCtxFrame(): number {
    return typeof currentFrame === 'number' ? currentFrame : 0;
  }

  private handleMessage(msg: WorkletInMessage): void {
    switch (msg.type) {
      case 'load':
        stopExerciseVoices(this.state);
        this.state.playing = false;
        this.generation = msg.generation ?? this.generation + 1;
        this.state.events = msg.events;
        this.state.totalFrames = msg.totalFrames;
        this.state.frame = 0;
        this.state.cursor = 0;
        this.port.postMessage({
          type: 'pos',
          frame: 0,
          playing: false,
          ctxFrame: this.getCtxFrame(),
        });
        break;
      case 'append':
        if (msg.generation === this.generation && msg.events.length > 0) {
          for (let i = 0; i < msg.events.length; i++) {
            this.state.events.push(msg.events[i]!);
          }
        }
        break;
      case 'play':
        if (
          this.state.totalFrames > 0 &&
          this.state.frame >= this.state.totalFrames
        ) {
          this.state.frame = 0;
          this.state.cursor = 0;
        }
        this.state.playing = true;
        this.port.postMessage({
          type: 'pos',
          frame: this.state.frame,
          playing: true,
          ctxFrame: this.getCtxFrame(),
        });
        break;
      case 'pause':
        this.state.playing = false;
        stopExerciseVoices(this.state);
        this.port.postMessage({
          type: 'pos',
          frame: this.state.frame,
          playing: false,
          ctxFrame: this.getCtxFrame(),
        });
        break;
      case 'stop':
        this.state.playing = false;
        this.state.frame = 0;
        this.state.cursor = 0;
        stopExerciseVoices(this.state);
        this.port.postMessage({
          type: 'pos',
          frame: 0,
          playing: false,
          ctxFrame: this.getCtxFrame(),
        });
        break;
      case 'seek': {
        stopExerciseVoices(this.state);
        const target = Math.max(
          0,
          Math.min(Math.round(msg.frame), this.state.totalFrames),
        );
        this.state.frame = target;
        let cur = 0;
        const events = this.state.events;
        while (cur < events.length && events[cur]!.frame < target) {
          cur++;
        }
        this.state.cursor = cur;
        this.port.postMessage({
          type: 'pos',
          frame: this.state.frame,
          playing: this.state.playing,
          ctxFrame: this.getCtxFrame(),
        });
        break;
      }
      case 'keyOn':
        this.state.keysPiano.on(`key:${msg.midi}`, msg.hz, false);
        break;
      case 'keyOff':
        this.state.keysPiano.off(`key:${msg.midi}`);
        break;
      case 'gain':
        this.state.gains[msg.bus] = msg.value;
        break;
      case 'muteKeys':
        this.state.muteKeys = msg.value;
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const outChannels = outputs[0];
    if (!outChannels || outChannels.length === 0) {
      return true;
    }
    const frames = outChannels[0]!.length;
    if (frames > this.monoBuf.length) {
      this.monoBuf = new Float32Array(frames);
    }

    renderBlock(this.state, this.monoBuf, frames);

    // 單聲道複製到所有輸出聲道
    for (let ch = 0; ch < outChannels.length; ch++) {
      outChannels[ch]!.set(this.monoBuf.subarray(0, frames));
    }

    if (
      this.state.playing &&
      this.state.totalFrames > 0 &&
      this.state.frame >= this.state.totalFrames
    ) {
      this.state.playing = false;
      stopExerciseVoices(this.state);
      this.framesSinceReport = 0;
      this.port.postMessage({
        type: 'pos',
        frame: this.state.frame,
        playing: false,
        ctxFrame: this.getCtxFrame() + frames,
      });
      this.port.postMessage({ type: 'ended' });
      return true;
    }

    this.framesSinceReport += frames;
    if (this.framesSinceReport >= this.reportIntervalFrames) {
      this.framesSinceReport = 0;
      this.port.postMessage({
        type: 'pos',
        frame: this.state.frame,
        playing: this.state.playing,
        ctxFrame: this.getCtxFrame() + frames,
      });
    }

    return true;
  }
}

registerProcessor('singpitch-engine', SingPitchEngineProcessor);
