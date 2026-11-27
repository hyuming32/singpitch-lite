import { describe, expect, it } from 'vitest';
import { ConfusionDetector } from '../voiceGate';

describe('ConfusionDetector', () => {
  it('餵入全是 leak 的 6 秒 → 觸發一次，之後不重複', () => {
    const detector = new ConfusionDetector();
    let triggerCount = 0;
    let triggerTime: number | null = null;

    // 模擬約 94 fps（每幀 ~10.67 ms）共 6 秒
    const dt = 512 / 48000;
    const totalFrames = Math.ceil(6.0 / dt);

    for (let i = 0; i < totalFrames; i++) {
      const t = i * dt;
      const status = detector.push({
        t,
        label: 'leak',
        midi: 69,
        pitchStd: 0.5,
        hasOutput: true,
        isMetro: false,
      });
      if (status.justTriggered) {
        triggerCount++;
        triggerTime = t;
      }
      if (i > 0 && status.triggered) {
        expect(status.triggered).toBe(true);
      }
    }

    expect(triggerCount).toBe(1);
    expect(triggerTime).not.toBeNull();
  });

  it('有輸出且 pitchStd < 1.5 的低幀率 leak 持續超過 5 秒也會觸發一次', () => {
    const detector = new ConfusionDetector();
    let triggerCount = 0;

    for (let t = 0; t <= 6.0; t += 0.2) {
      const status = detector.push({
        t,
        label: 'leak',
        midi: 60,
        pitchStd: 0.8,
        hasOutput: true,
        isMetro: false,
      });
      if (status.justTriggered) {
        triggerCount++;
      }
    }

    expect(triggerCount).toBe(1);
  });

  it('節拍器 unknown 不算混亂', () => {
    const detector = new ConfusionDetector();
    let triggerCount = 0;

    for (let i = 0; i < 600; i++) {
      const status = detector.push({
        t: i * 0.01,
        label: 'unknown',
        midi: NaN,
        pitchStd: null,
        hasOutput: true,
        isMetro: true,
      });
      if (status.justTriggered) triggerCount++;
    }

    expect(triggerCount).toBe(0);
  });

  it('每秒跳動超過 3 個半音的次數 > 6 會觸發一次', () => {
    const detector = new ConfusionDetector();
    let triggerCount = 0;

    // 在 0.5 秒內連續跳動 8 次（每次 5 個半音）
    for (let i = 0; i < 10; i++) {
      const status = detector.push({
        t: i * 0.05,
        label: 'voice',
        midi: i % 2 === 0 ? 60 : 65,
        pitchStd: 20,
        hasOutput: true,
        isMetro: false,
      });
      if (status.justTriggered) triggerCount++;
    }

    expect(triggerCount).toBe(1);
  });
});
