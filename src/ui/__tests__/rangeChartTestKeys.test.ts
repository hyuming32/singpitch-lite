import { describe, expect, it } from 'vitest';
import { testKeyState } from '../RangeChart';

describe('試唱鍵盤變色 testKeyState', () => {
  it('還沒確認時只有目前唱的那一鍵是淡綠', () => {
    expect(testKeyState(50, null, null, 50)).toBe('live');
    expect(testKeyState(51, null, null, 50)).toBeNull();
    expect(testKeyState(50, null, null, null)).toBeNull();
  });

  it('最低音確認後，該鍵實心；往上唱時從最低音延伸到目前音是淡綠', () => {
    expect(testKeyState(48, 48, null, 55)).toBe('solid');
    expect(testKeyState(49, 48, null, 55)).toBe('live');
    expect(testKeyState(55, 48, null, 55)).toBe('live');
    expect(testKeyState(56, 48, null, 55)).toBeNull();
    expect(testKeyState(47, 48, null, 55)).toBeNull();
  });

  it('範圍確認後實心；唱到範圍外才往外延伸淡綠', () => {
    expect(testKeyState(60, 48, 69, 60)).toBe('solid');
    expect(testKeyState(70, 48, 69, 72)).toBe('live');
    expect(testKeyState(73, 48, 69, 72)).toBeNull();
    expect(testKeyState(46, 48, 69, 46)).toBe('live');
    expect(testKeyState(47, 48, 69, 46)).toBe('live');
    expect(testKeyState(45, 48, 69, 46)).toBeNull();
  });
});
