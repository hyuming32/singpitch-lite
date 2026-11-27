import type { SchedEvent } from '../audio/dsp/schedule.ts';
import { VOICE_CONFIG } from './voiceConfig.ts';

export type OutputBus = 'melody' | 'pad' | 'cadence' | 'metro' | 'keys';

export interface ActiveKey {
  hz: number;
  onsetSec: number;
}

export interface OutputSound {
  hz: number;
  onsetSec: number;
  bus: OutputBus;
  held: boolean;
}

export interface OutputAtOptions {
  /** 編譯 events 時使用的取樣率（Hz），預設 48000 */
  rate?: number;
  /** 對音鋼琴目前按下的琴鍵列表 */
  activeKeys?: readonly ActiveKey[];
}

const ACCENT_CLICK_HZ = 1700;
const NORMAL_CLICK_HZ = 1100;

/**
 * 查詢編譯後的排程事件表與即時對音鋼琴按鍵在 songSec 時刻正在發聲的所有聲音。
 */
export function outputAt(
  events: readonly SchedEvent[],
  songSec: number,
  opts?: OutputAtOptions | number,
): OutputSound[] {
  const rate =
    typeof opts === 'number'
      ? opts
      : opts?.rate !== undefined && opts.rate > 0
        ? opts.rate
        : 48000;
  const activeKeys = typeof opts === 'number' ? undefined : opts?.activeKeys;

  const active = new Map<string, OutputSound>();
  const clicks: OutputSound[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const evSec = ev.frame / rate;
    if (evSec > songSec) {
      break;
    }

    switch (ev.type) {
      case 'noteOn': {
        const bus: OutputBus = ev.bus === 'melodySing' ? 'melody' : ev.bus;
        active.set(ev.id, {
          hz: ev.hz,
          onsetSec: evSec,
          bus,
          held: ev.held,
        });
        break;
      }
      case 'glide': {
        const dur = Math.max(1e-4, ev.dur);
        const u = Math.max(0, Math.min(1, (songSec - evSec) / dur));
        const hz = ev.hzStart * Math.pow(ev.hzEnd / ev.hzStart, u);
        active.set(ev.id, {
          hz,
          onsetSec: evSec,
          bus: 'melody',
          held: false,
        });
        break;
      }
      case 'noteOff': {
        active.delete(ev.id);
        break;
      }
      case 'click': {
        if (songSec - evSec <= VOICE_CONFIG.METRO_WINDOW_SEC) {
          clicks.push({
            hz: ev.accent ? ACCENT_CLICK_HZ : NORMAL_CLICK_HZ,
            onsetSec: evSec,
            bus: 'metro',
            held: false,
          });
        }
        break;
      }
    }
  }

  const out: OutputSound[] = [...active.values(), ...clicks];
  if (activeKeys && activeKeys.length > 0) {
    for (const k of activeKeys) {
      if (k.hz > 0 && Number.isFinite(k.hz)) {
        out.push({
          hz: k.hz,
          onsetSec: k.onsetSec,
          bus: 'keys',
          held: false,
        });
      }
    }
  }
  return out;
}
