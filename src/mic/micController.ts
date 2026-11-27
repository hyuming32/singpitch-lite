/// <reference types="vite/client" />
import type { AudioEngine } from '../audio/engine';
import captureWorkletUrl from './capture.worklet.ts?worker&url';
import { readTrackInputLatencySec } from './latency';
import type {
  PitchWorkerInMessage,
  PitchWorkerOutMessage,
} from './pitch.worker';
import PitchWorker from './pitch.worker.ts?worker';
import type { PitchFeatures } from './pitchTracker';

export interface MicPitchFrame {
  /** AudioContext 時間軸秒數 */
  t: number;
  /** 偵測到的基頻（Hz），0 表示無穩定音高 */
  hz: number;
  /** 音量（dBFS） */
  db: number;
  features: PitchFeatures;
}

export interface MicStartOptions {
  echoCancellation: boolean;
  gateDb: number;
  onFrame: (frame: MicPitchFrame) => void;
  onEnded?: () => void;
}

export class MicPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicPermissionError';
  }
}

const loadedWorkletCtx = new WeakSet<AudioContext>();

/**
 * 管理瀏覽器麥克風擷取管線：
 * getUserMedia → 共用 AudioContext → MediaStreamAudioSourceNode → capture.worklet → pitch.worker
 */
export class MicController {
  private readonly engine: AudioEngine;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private worker: Worker | null = null;
  private active = false;
  private _inputLatencySec = 0;
  private currentGateDb = -45;
  private onFrameCb: ((frame: MicPitchFrame) => void) | null = null;
  private onEndedCb: (() => void) | null = null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  get isActive(): boolean {
    return this.active;
  }

  get inputLatencySec(): number {
    return this._inputLatencySec;
  }

  setGateDb(gateDb: number): void {
    this.currentGateDb = gateDb;
    if (this.worker) {
      const msg: PitchWorkerInMessage = { type: 'gate', gateDb };
      this.worker.postMessage(msg);
    }
  }

  async start(opts: MicStartOptions): Promise<void> {
    if (this.active) {
      await this.stop();
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      throw new MicPermissionError('此瀏覽器不支援麥克風存取，請改用支援的現代瀏覽器');
    }

    this.onFrameCb = opts.onFrame;
    this.onEndedCb = opts.onEnded ?? null;
    this.currentGateDb = opts.gateDb;

    // 開麥克風時切換 iOS AudioSession 為 play-and-record
    this.engine.setAudioSession('play-and-record');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: opts.echoCancellation,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (err) {
      this.engine.setAudioSession('playback');
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' ||
          err.name === 'PermissionDeniedError' ||
          err.name === 'SecurityError')
      ) {
        throw new MicPermissionError('沒有麥克風權限，只能聽示範');
      }
      throw new Error(
        `無法開啟麥克風（${err instanceof Error ? err.message : String(err)}）`,
      );
    }

    try {
      await this.engine.init();
      await this.engine.unlock();
      const ctx = this.engine.audioContext;
      if (!ctx) {
        throw new Error('音訊引擎尚未初始化');
      }

      if (!loadedWorkletCtx.has(ctx)) {
        await ctx.audioWorklet.addModule(captureWorkletUrl);
        loadedWorkletCtx.add(ctx);
      }

      const track = stream.getAudioTracks()[0];
      this._inputLatencySec = readTrackInputLatencySec(track);

      if (track) {
        track.addEventListener('ended', () => {
          if (this.active) {
            void this.stop();
            this.onEndedCb?.();
          }
        });
      }

      const worker = new PitchWorker();
      const initMsg: PitchWorkerInMessage = {
        type: 'init',
        rate: ctx.sampleRate,
        gateDb: this.currentGateDb,
      };
      worker.postMessage(initMsg);
      worker.onmessage = (ev: MessageEvent<PitchWorkerOutMessage>) => {
        const msg = ev.data;
        if (msg?.type === 'frame' && this.active) {
          this.onFrameCb?.({
            t: msg.t,
            hz: msg.hz,
            db: msg.db,
            features: msg.features,
          });
        }
      };

      const source = ctx.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(ctx, 'singpitch-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      // 透過靜音節點連接至 destination，確保部分瀏覽器穩定驅動 worklet 且絕不產生回授
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      captureNode.port.onmessage = (
        ev: MessageEvent<{ type?: string; samples?: Float32Array; frame?: number }>,
      ) => {
        const data = ev.data;
        if (
          data?.type === 'audio' &&
          data.samples &&
          typeof data.frame === 'number' &&
          this.worker &&
          this.active
        ) {
          const msg: PitchWorkerInMessage = {
            type: 'audio',
            samples: data.samples,
            frame: data.frame,
          };
          this.worker.postMessage(msg, [data.samples.buffer]);
        }
      };

      source.connect(captureNode);
      captureNode.connect(silentGain);
      silentGain.connect(ctx.destination);

      this.stream = stream;
      this.source = source;
      this.captureNode = captureNode;
      this.silentGain = silentGain;
      this.worker = worker;
      this.active = true;
    } catch (err) {
      for (const tr of stream.getTracks()) {
        tr.stop();
      }
      this.engine.setAudioSession('playback');
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this._inputLatencySec = 0;

    if (this.captureNode) {
      try {
        this.captureNode.port.postMessage({ type: 'stop' });
      } catch {
        // 忽略已關閉的 port
      }
      this.captureNode.port.onmessage = null;
      this.captureNode.disconnect();
      this.captureNode = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.stream) {
      for (const tr of this.stream.getTracks()) {
        tr.stop();
      }
      this.stream = null;
    }

    this.engine.setAudioSession('playback');
  }
}
