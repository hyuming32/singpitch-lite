import { describe, expect, it } from 'vitest';
import type { SchedEvent } from '../../audio/dsp/schedule';
import { outputAt } from '../outputAt';

describe('outputAt', () => {
  const rate = 48000;
  const events: SchedEvent[] = [
    { frame: 0, type: 'click', accent: true, bus: 'metro' },
    {
      frame: 48000, // 1.0 s
      type: 'noteOn',
      id: 'mel:1',
      hz: 440,
      held: false,
      bus: 'melodySing',
    },
    {
      frame: 48000, // 1.0 s
      type: 'noteOn',
      id: 'pad:1',
      hz: 261.63,
      held: true,
      bus: 'pad',
    },
    {
      frame: 72000, // 1.5 s
      type: 'noteOff',
      id: 'mel:1',
      bus: 'melodySing',
    },
    {
      frame: 96000, // 2.0 s
      type: 'noteOff',
      id: 'pad:1',
      bus: 'pad',
    },
  ];

  it('在 onset 前不回傳音符，click 時刻在 60ms 內回傳 metro', () => {
    const at0 = outputAt(events, 0.0, rate);
    expect(at0).toHaveLength(1);
    expect(at0[0]).toMatchObject({ bus: 'metro', hz: 1700, onsetSec: 0 });

    const at50ms = outputAt(events, 0.05, rate);
    expect(at50ms).toHaveLength(1);
    expect(at50ms[0]!.bus).toBe('metro');

    const at100ms = outputAt(events, 0.1, rate);
    expect(at100ms).toHaveLength(0);

    const beforeNote = outputAt(events, 0.99, rate);
    expect(beforeNote).toHaveLength(0);
  });

  it('在 onset 後與 noteOff 前回傳 melody（含 melodySing）與 pad', () => {
    const at12 = outputAt(events, 1.2, rate);
    expect(at12).toHaveLength(2);
    const mel = at12.find((o) => o.bus === 'melody');
    const pad = at12.find((o) => o.bus === 'pad');
    expect(mel).toEqual({
      hz: 440,
      onsetSec: 1.0,
      bus: 'melody',
      held: false,
    });
    expect(pad).toEqual({
      hz: 261.63,
      onsetSec: 1.0,
      bus: 'pad',
      held: true,
    });
  });

  it('在 noteOff 後正確移除對應音符', () => {
    const at16 = outputAt(events, 1.6, rate);
    expect(at16).toHaveLength(1);
    expect(at16[0]!.bus).toBe('pad');

    const at20 = outputAt(events, 2.0, rate);
    expect(at20).toHaveLength(0);
  });

  it('納入對音鋼琴即時按鍵與滑音插值', () => {
    const glideEvents: SchedEvent[] = [
      {
        frame: 0,
        type: 'glide',
        id: 'g:1',
        hzStart: 220,
        hzEnd: 440,
        dur: 1.0,
        bus: 'melody',
      },
      { frame: 48000, type: 'noteOff', id: 'g:1', bus: 'melody' },
    ];
    const out = outputAt(glideEvents, 0.5, {
      rate,
      activeKeys: [{ hz: 330, onsetSec: 0.4 }],
    });
    expect(out).toHaveLength(2);
    const g = out.find((o) => o.bus === 'melody');
    const k = out.find((o) => o.bus === 'keys');
    expect(g!.hz).toBeCloseTo(220 * Math.SQRT2, 3);
    expect(k).toEqual({
      hz: 330,
      onsetSec: 0.4,
      bus: 'keys',
      held: false,
    });
  });
});
