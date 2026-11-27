/// <reference types="vite/client" />
import type { Exercise } from '../core/exercise';
import { A4_DEFAULT, midiToHz } from '../core/notes';
import type { GainBus } from './dsp/mixer';
import {
  compileExercise,
  type CompileOptions,
  type SchedEvent,
} from './dsp/schedule';
import type { WorkletInMessage } from './worklet/engine.worklet';
import workletUrl from './worklet/engine.worklet.ts?worker&url';

export type PositionCallback = (
  sec: number,
  playing: boolean,
  ctxSec?: number,
) => void;
export type EndedCallback = () => void;

type WorkletOutMessage =
  | { type: 'pos'; frame: number; playing: boolean; ctxFrame?: number }
  | { type: 'ended' };

const UNSUPPORTED_MSG =
  '此瀏覽器不支援 AudioWorklet，請用 https 開啟或更新瀏覽器';

function isSuspendedOrInterrupted(state: string): boolean {
  return state === 'suspended' || state === 'interrupted';
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private initPromise: Promise<void> | null = null;
  private a4 = A4_DEFAULT;
  private exercise: Exercise | null = null;
  private compileOpts: CompileOptions = {};
  private lastCompiledEvents: readonly SchedEvent[] = [];
  private audioSessionType: 'playback' | 'play-and-record' = 'playback';
  private _ctxToSongOffsetSec: number | null = null;
  private readonly gains: Partial<Record<GainBus, number>> = {};
  private readonly posCallbacks = new Set<PositionCallback>();
  private readonly endedCallbacks = new Set<EndedCallback>();

  /** 初始化 AudioContext 與 AudioWorkletNode（可重複呼叫，closed 時自動重建） */
  async init(): Promise<void> {
    if (this.ctx && this.ctx.state === 'closed') {
      try {
        this.node?.disconnect();
      } catch {
        // 忽略已關閉節點的斷線錯誤
      }
      this.node = null;
      this.ctx = null;
      this.initPromise = null;
      this._ctxToSongOffsetSec = null;
    }
    if (this.node && this.ctx) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (
        typeof AudioContext === 'undefined' ||
        typeof AudioWorkletNode === 'undefined'
      ) {
        throw new Error(UNSUPPORTED_MSG);
      }

      const ctx = new AudioContext({ latencyHint: 'interactive' });
      if (!ctx.audioWorklet) {
        await ctx.close().catch(() => {});
        throw new Error(UNSUPPORTED_MSG);
      }

      try {
        await ctx.audioWorklet.addModule(workletUrl);
      } catch (err) {
        await ctx.close().catch(() => {});
        throw new Error(
          `${UNSUPPORTED_MSG}（${err instanceof Error ? err.message : String(err)}）`,
        );
      }

      const node = new AudioWorkletNode(ctx, 'singpitch-engine', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      node.port.onmessage = (ev: MessageEvent<WorkletOutMessage>) => {
        const msg = ev.data;
        if (msg.type === 'pos') {
          const sec = msg.frame / ctx.sampleRate;
          const ctxSec =
            msg.ctxFrame !== undefined
              ? msg.ctxFrame / ctx.sampleRate
              : ctx.currentTime;
          if (msg.playing) {
            this._ctxToSongOffsetSec = ctxSec - sec;
          } else {
            this._ctxToSongOffsetSec = null;
          }
          for (const cb of this.posCallbacks) {
            cb(sec, msg.playing, ctxSec);
          }
        } else if (msg.type === 'ended') {
          this._ctxToSongOffsetSec = null;
          for (const cb of this.endedCallbacks) {
            cb();
          }
        }
      };

      node.connect(ctx.destination);
      this.ctx = ctx;
      this.node = node;

      for (const [bus, value] of Object.entries(this.gains) as [
        GainBus,
        number,
      ][]) {
        this.post({ type: 'gain', bus, value });
      }

      if (this.exercise) {
        this.sendCompiledExercise();
      }
    })();

    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  /** 設定 iOS AudioSession 模式並於支援時立即套用 */
  setAudioSession(type: 'playback' | 'play-and-record'): void {
    this.audioSessionType = type;
    const nav = navigator as Navigator & {
      audioSession?: { type: string };
    };
    if (nav.audioSession) {
      nav.audioSession.type = type;
    }
  }

  /** 必須於使用者點擊手勢內呼叫：解除音訊鎖定並套用目前的 AudioSession 模式 */
  async unlock(): Promise<void> {
    const nav = navigator as Navigator & {
      audioSession?: { type: string };
    };
    if (nav.audioSession) {
      nav.audioSession.type = this.audioSessionType;
    }
    if (this.ctx && isSuspendedOrInterrupted(this.ctx.state)) {
      await this.ctx.resume().catch(() => {});
    }
  }

  private post(msg: WorkletInMessage): void {
    try {
      this.node?.port.postMessage(msg);
    } catch {
      // 忽略 worklet port 已關閉錯誤
    }
  }

  private sendCompiledExercise(): void {
    if (!this.exercise || !this.ctx || !this.node) {
      return;
    }
    const compiled = compileExercise(this.exercise, this.ctx.sampleRate, {
      ...this.compileOpts,
      a4: this.a4,
    });
    this.lastCompiledEvents = compiled.events;
    this.post({
      type: 'load',
      events: compiled.events,
      totalFrames: compiled.totalFrames,
    });
  }

  /** 載入練習時間表並編譯送入 worklet */
  load(ex: Exercise, opts: CompileOptions = {}): void {
    this.exercise = ex;
    this.compileOpts = opts;
    this.sendCompiledExercise();
  }

  play(): void {
    if (this.ctx && isSuspendedOrInterrupted(this.ctx.state)) {
      void this.ctx.resume().catch(() => {});
    }
    this.post({ type: 'play' });
  }

  pause(): void {
    this._ctxToSongOffsetSec = null;
    this.post({ type: 'pause' });
  }

  stop(): void {
    this._ctxToSongOffsetSec = null;
    this.post({ type: 'stop' });
  }

  /** 跳轉至指定秒數 */
  seek(sec: number): void {
    if (!this.ctx) {
      return;
    }
    const frame = Math.max(0, Math.round(sec * this.ctx.sampleRate));
    this.post({ type: 'seek', frame });
  }

  /** 跳轉至指定調性區塊的起始時間 */
  seekToKey(index: number): void {
    const keyBlock = this.exercise?.keys[index];
    if (!keyBlock || !this.ctx) {
      return;
    }
    this.seek(keyBlock.start);
  }

  /** 按下對音鋼琴琴鍵 */
  keyOn(midi: number): void {
    if (this.ctx && isSuspendedOrInterrupted(this.ctx.state)) {
      void this.ctx.resume().catch(() => {});
    }
    this.post({ type: 'keyOn', midi, hz: midiToHz(midi, this.a4) });
  }

  /** 放開對音鋼琴琴鍵 */
  keyOff(midi: number): void {
    this.post({ type: 'keyOff', midi });
  }

  /** 設定指定匯流排或主音量（0..1+） */
  setGain(bus: GainBus, value: number): void {
    this.gains[bus] = value;
    this.post({ type: 'gain', bus, value });
  }

  /** 設定是否靜音對音鋼琴（錄音時只亮不出聲用） */
  setMuteKeys(value: boolean): void {
    this.post({ type: 'muteKeys', value });
  }

  /** 設定標準音高 A4（Hz） */
  setA4(hz: number): void {
    if (this.a4 === hz) {
      return;
    }
    this.a4 = hz;
    if (this.exercise) {
      this.sendCompiledExercise();
    }
  }

  /** 訂閱播放位置更新（約每 25 ms） */
  onPosition(cb: PositionCallback): () => void {
    this.posCallbacks.add(cb);
    return () => {
      this.posCallbacks.delete(cb);
    };
  }

  /** 訂閱練習播放結束事件 */
  onEnded(cb: EndedCallback): () => void {
    this.endedCallbacks.add(cb);
    return () => {
      this.endedCallbacks.delete(cb);
    };
  }

  /** 取得共用的 AudioContext 實例 */
  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  /** 取得 AudioContext 取樣率（未初始化時預設 48000） */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** 取得最近一次編譯送入 worklet 的排程事件表 */
  get compiledEvents(): readonly SchedEvent[] {
    return this.lastCompiledEvents;
  }

  /** 取得播放中 AudioContext 時間減去歌曲時間的基準差（秒） */
  get ctxToSongOffsetSec(): number | null {
    return this._ctxToSongOffsetSec;
  }

  /** 取得音訊輸出延遲（秒） */
  get outputLatency(): number {
    if (!this.ctx) {
      return 0;
    }
    return this.ctx.outputLatency ?? this.ctx.baseLatency ?? 0;
  }

  /** 釋放所有音訊資源 */
  dispose(): void {
    this.posCallbacks.clear();
    this.endedCallbacks.clear();
    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initPromise = null;
  }
}
