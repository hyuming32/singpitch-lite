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
import { resolveEffectiveSampleRate } from './sampleRate';

export interface MicPitchFrame {
  /** AudioContext 時間軸秒數 */
  t: number;
  /** 偵測到的基頻（Hz），0 表示無穩定音高 */
  hz: number;
  /** 音量（dBFS） */
  db: number;
  features: PitchFeatures;
}

export interface MicDiagnostics {
  ctxSampleRate: number | null;
  trackSampleRate: number | null;
  workletSampleRate: number | null;
  measuredSamplesPerSec: number | null;
  effectiveRate: number | null;
  rateCorrected: boolean;
  inputLatencySec: number;
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
  private track: MediaStreamTrack | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private worker: Worker | null = null;
  private active = false;
  private _inputLatencySec = 0;
  private currentGateDb = -45;
  private activeRate = 48000;
  private rateWindowStartMs: number | null = null;
  private rateWindowSamples = 0;
  private diagnostics: MicDiagnostics = {
    ctxSampleRate: null,
    trackSampleRate: null,
    workletSampleRate: null,
    measuredSamplesPerSec: null,
    effectiveRate: null,
    rateCorrected: false,
    inputLatencySec: 0,
  };
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

  /** 取得麥克風取樣率與延遲診斷資訊 */
  getDiagnostics(): MicDiagnostics {
    return { ...this.diagnostics };
  }

  /** 檢查麥克風 track 是否已被系統關閉 */
  isTrackEnded(): boolean {
    return Boolean(this.track && this.track.readyState === 'ended');
  }

  /** 若 track 已結束但尚未觸發回呼，安全地清理並通知上層 */
  notifyEndedIfNeeded(): boolean {
    if (this.active && this.isTrackEnded()) {
      const cb = this.onEndedCb;
      void this.stop();
      cb?.();
      return true;
    }
    return false;
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

      const track = stream.getAudioTracks()[0] ?? null;
      this._inputLatencySec = readTrackInputLatencySec(track);
      const trackSettings = track?.getSettings?.() as
        | (MediaTrackSettings & { sampleRate?: unknown })
        | undefined;
      const trackSampleRate =
        typeof trackSettings?.sampleRate === 'number' &&
        Number.isFinite(trackSettings.sampleRate)
          ? trackSettings.sampleRate
          : null;

      this.activeRate = ctx.sampleRate;
      this.rateWindowStartMs = null;
      this.rateWindowSamples = 0;
      this.diagnostics = {
        ctxSampleRate: ctx.sampleRate,
        trackSampleRate,
        workletSampleRate: null,
        measuredSamplesPerSec: null,
        effectiveRate: ctx.sampleRate,
        rateCorrected: false,
        inputLatencySec: this._inputLatencySec,
      };

      if (track) {
        track.addEventListener('ended', () => {
          if (this.active) {
            const cb = this.onEndedCb;
            void this.stop();
            cb?.();
          }
        });
      }

      const worker = new PitchWorker();
      const initMsg: PitchWorkerInMessage = {
        type: 'init',
        rate: this.activeRate,
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
        ev: MessageEvent<{
          type?: string;
          samples?: Float32Array;
          frame?: number;
          sampleRate?: number;
        }>,
      ) => {
        const data = ev.data;
        if (
          data?.type === 'audio' &&
          data.samples &&
          typeof data.frame === 'number' &&
          this.worker &&
          this.active
        ) {
          if (
            typeof data.sampleRate === 'number' &&
            Number.isFinite(data.sampleRate)
          ) {
            this.diagnostics.workletSampleRate = data.sampleRate;
          }

          const nowMs = performance.now();
          if (this.rateWindowStartMs === null) {
            this.rateWindowStartMs = nowMs;
            this.rateWindowSamples = 0;
          }
          this.rateWindowSamples += data.samples.length;
          const elapsedMs = nowMs - this.rateWindowStartMs;
          if (elapsedMs >= 1000) {
            const measured = Math.round((this.rateWindowSamples * 1000) / elapsedMs);
            this.rateWindowStartMs = nowMs;
            this.rateWindowSamples = 0;
            this.diagnostics.measuredSamplesPerSec = measured;

            const resolution = resolveEffectiveSampleRate(this.activeRate, measured);
            if (resolution.corrected) {
              this.activeRate = resolution.effectiveRate;
              this.diagnostics.effectiveRate = resolution.effectiveRate;
              this.diagnostics.rateCorrected = true;
              const rateMsg: PitchWorkerInMessage = {
                type: 'rate',
                rate: resolution.effectiveRate,
              };
              this.worker.postMessage(rateMsg);
            }
          }

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
      this.track = track;
      this.source = source;
      this.captureNode = captureNode;
      this.silentGain = silentGain;
      this.worker = worker;
      this.active = true;
    } catch (err) {
      for (const tr of stream.getTracks()) {
        try {
          tr.stop();
        } catch {
          // 忽略錯誤
        }
      }
      this.engine.setAudioSession('playback');
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this._inputLatencySec = 0;
    this.track = null;

    if (this.captureNode) {
      try {
        this.captureNode.port.postMessage({ type: 'stop' });
      } catch {
        // 忽略已關閉的 port
      }
      this.captureNode.port.onmessage = null;
      try {
        this.captureNode.disconnect();
      } catch {
        // 忽略斷線錯誤
      }
      this.captureNode = null;
    }

    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // 忽略斷線錯誤
      }
      this.source = null;
    }

    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {
        // 忽略斷線錯誤
      }
      this.silentGain = null;
    }

    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // 忽略 worker 終止錯誤
      }
      this.worker = null;
    }

    if (this.stream) {
      for (const tr of this.stream.getTracks()) {
        try {
          tr.stop();
        } catch {
          // 忽略 track 停止錯誤
        }
      }
      this.stream = null;
    }

    this.engine.setAudioSession('playback');
  }
}
