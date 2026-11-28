import { describe, expect, it } from 'vitest';
import { midiToHz } from '../../core/notes';
import { SteadyNoteDetector, analyzeGlideFrames } from '../rangeMeasure';

describe('SteadyNoteDetector 穩定音判定', () => {
  it('連續 1.5 秒音高穩定（std < 40 cents）即鎖定並回傳中位數', () => {
    const detector = new SteadyNoteDetector(440);
    const baseHz = midiToHz(60); // C4 (261.63 Hz)

    // 每 50 ms 一幀，小幅自然抖動（±10 cents）
    let lockedResult = null;
    for (let i = 0; i <= 35; i++) {
      const t = i * 0.05;
      const centsOffset = i % 2 === 0 ? 8 : -8;
      const hz = baseHz * Math.pow(2, centsOffset / 1200);
      const res = detector.push({ t, hz });
      if (t < 1.49) {
        expect(res.locked).toBe(false);
      } else if (res.locked && !lockedResult) {
        lockedResult = res;
      }
    }

    expect(lockedResult).not.toBeNull();
    expect(lockedResult!.midi).toBe(60);
    expect(lockedResult!.stdCents!).toBeLessThan(40);
    expect(lockedResult!.progress).toBe(1);
  });

  it('音高標準差 >= 40 cents 時不鎖定，待新音高穩定滿 1.5 秒後才鎖定', () => {
    const detector = new SteadyNoteDetector(440);
    // 前 1.0 秒大幅震盪（±150 cents）
    for (let i = 0; i < 20; i++) {
      const t = i * 0.05;
      const cents = i % 2 === 0 ? 150 : -150;
      const hz = midiToHz(60) * Math.pow(2, cents / 1200);
      const res = detector.push({ t, hz });
      expect(res.locked).toBe(false);
    }

    // 之後穩定唱 MIDI 55 持續 1.6 秒
    let lockedMidi: number | null = null;
    for (let i = 20; i <= 55; i++) {
      const t = i * 0.05;
      const res = detector.push({ t, hz: midiToHz(55) });
      if (res.locked) {
        lockedMidi = res.midi;
        break;
      }
    }
    expect(lockedMidi).toBe(55);
  });

  it('靜音超過 150 ms 會重置累計時間', () => {
    const detector = new SteadyNoteDetector(440);
    for (let i = 0; i < 20; i++) {
      // 0..0.95s
      detector.push({ t: i * 0.05, hz: midiToHz(64) });
    }
    // 0.3s 靜音
    detector.push({ t: 1.25, hz: 0 });
    // 再唱 0.7s（合計不到連續 1.5s）
    let locked = false;
    for (let i = 0; i < 15; i++) {
      const res = detector.push({ t: 1.3 + i * 0.05, hz: midiToHz(64) });
      if (res.locked) locked = true;
    }
    expect(locked).toBe(false);
  });
});

describe('analyzeGlideFrames 滑音百分位與孤立幀排除', () => {
  it('計算有聲幀第 5／95 百分位，並排除 < 80 ms 的孤立幀', () => {
    const frames: { t: number; hz: number }[] = [];

    // 孤立雜訊片段：僅 40 ms（t = 0.00, 0.02, 0.04）的超高音 MIDI 96，應被排除
    frames.push({ t: 0.0, hz: midiToHz(96) });
    frames.push({ t: 0.02, hz: midiToHz(96) });
    frames.push({ t: 0.04, hz: midiToHz(96) });
    frames.push({ t: 0.06, hz: 0 });

    // 主滑音段（t = 0.50 .. 2.50，共 101 幀，從 MIDI 45 線性滑到 MIDI 69）
    for (let i = 0; i <= 100; i++) {
      const t = 0.5 + i * 0.02;
      const midi = 45 + (24 * i) / 100;
      frames.push({ t, hz: midiToHz(midi) });
    }
    frames.push({ t: 2.52, hz: 0 });

    // 結尾 20 ms 的極低音雜訊 MIDI 24，應被排除
    frames.push({ t: 2.8, hz: midiToHz(24) });
    frames.push({ t: 2.82, hz: midiToHz(24) });

    const res = analyzeGlideFrames(frames, 440);
    expect(res).not.toBeNull();
    expect(res!.validFrameCount).toBe(101);
    expect(res!.excludedFrameCount).toBe(5);
    // 45..69 線性分布的 5% ≈ 46.2 -> 46；95% ≈ 67.8 -> 68
    expect(res!.p5Midi).toBeCloseTo(46.2, 1);
    expect(res!.p95Midi).toBeCloseTo(67.8, 1);
    expect(res!.rawLow).toBe(46);
    expect(res!.rawHigh).toBe(68);
  });

  it('全部都是 < 80 ms 孤立幀時回傳 null', () => {
    const res = analyzeGlideFrames([
      { t: 0, hz: midiToHz(60) },
      { t: 0.03, hz: midiToHz(62) },
      { t: 0.1, hz: 0 },
      { t: 0.3, hz: midiToHz(72) },
    ]);
    expect(res).toBeNull();
  });
});

describe('SteadyNoteDetector.peekStable 候選音', () => {
  it('穩定 0.5 秒以上但未滿 1.5 秒時回傳候選音', () => {
    const det = new SteadyNoteDetector();
    const hz = midiToHz(48);
    for (let i = 0; i <= 8; i++) det.push({ t: i * 0.08, hz });
    expect(det.peekStable(0.5)).toBe(48);
  });

  it('太短或跳動大時回傳 null', () => {
    const det = new SteadyNoteDetector();
    det.push({ t: 0, hz: midiToHz(48) });
    det.push({ t: 0.1, hz: midiToHz(48) });
    det.push({ t: 0.2, hz: midiToHz(48) });
    expect(det.peekStable(0.5)).toBeNull();

    const jumpy = new SteadyNoteDetector();
    for (let i = 0; i <= 8; i++) jumpy.push({ t: i * 0.08, hz: midiToHz(i % 2 ? 48 : 52) });
    expect(jumpy.peekStable(0.5)).toBeNull();
  });
});
