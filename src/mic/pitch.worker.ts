import { GATE_DB } from '../core/pitchConfig.ts';
import { PitchTracker, type PitchFeatures } from './pitchTracker.ts';

export type PitchWorkerInMessage =
  | { type: 'init'; rate: number; gateDb: number }
  | { type: 'rate'; rate: number }
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

let currentGateDb = GATE_DB;
let tracker = new PitchTracker(48000, currentGateDb);

self.onmessage = (ev: MessageEvent<PitchWorkerInMessage>) => {
  const msg = ev.data;
  if (!msg) return;

  switch (msg.type) {
    case 'init':
      currentGateDb = msg.gateDb;
      tracker = new PitchTracker(msg.rate, currentGateDb);
      break;
    case 'rate':
      tracker = new PitchTracker(msg.rate, currentGateDb);
      break;
    case 'gate':
      currentGateDb = msg.gateDb;
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
