import { GATE_DB } from '../core/pitchConfig.ts';
import { PitchTracker, type PitchFeatures } from './pitchTracker.ts';

export type PitchWorkerInMessage =
  | { type: 'init'; rate: number; gateDb: number }
  | { type: 'gate'; gateDb: number }
  | { type: 'reset' }
  | { type: 'audio'; samples: Float32Array; frame: number };

export type PitchWorkerOutMessage = {
  type: 'frame';
  t: number;
  hz: number;
  db: number;
  features: PitchFeatures;
};

let tracker = new PitchTracker(48000, GATE_DB);

self.onmessage = (ev: MessageEvent<PitchWorkerInMessage>) => {
  const msg = ev.data;
  if (!msg) return;

  switch (msg.type) {
    case 'init':
      tracker = new PitchTracker(msg.rate, msg.gateDb);
      break;
    case 'gate':
      tracker.setGateDb(msg.gateDb);
      break;
    case 'reset':
      tracker.reset();
      break;
    case 'audio': {
      const result = tracker.pushChunk(msg.samples, msg.frame);
      if (result) {
        const out: PitchWorkerOutMessage = {
          type: 'frame',
          t: result.t,
          hz: result.hz,
          db: result.db,
          features: result.features,
        };
        self.postMessage(out);
      }
      break;
    }
  }
};
