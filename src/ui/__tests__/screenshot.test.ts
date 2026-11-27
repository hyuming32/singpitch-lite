import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canScreenshot,
  formatScreenshotHeader,
  formatScreenshotTimestamp,
  prepareSvgForScreenshot,
  screenshotFileName,
  shareOrDownloadFile,
} from '../practice/screenshot';

describe('canScreenshot', () => {
  it('只在未播放且秒數大於 0 時回傳 true', () => {
    expect(canScreenshot(false, 0)).toBe(false);
    expect(canScreenshot(true, 0)).toBe(false);
    expect(canScreenshot(true, 3.5)).toBe(false);
    expect(canScreenshot(false, 0.1)).toBe(true);
    expect(canScreenshot(false, 12.4)).toBe(true);
  });

  it('對無效或負數秒數回傳 false', () => {
    expect(canScreenshot(false, -1)).toBe(false);
    expect(canScreenshot(false, Number.NaN)).toBe(false);
    expect(canScreenshot(false, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('screenshotFileName', () => {
  it('產生含中文圖案名、調名與本地時間戳的 PNG 檔名', () => {
    const date = new Date(2026, 10, 27, 8, 5, 9);
    expect(screenshotFileName('五度音階', 'E♭', date)).toBe(
      'SingPitch_五度音階_E♭_20261127-080509.png',
    );
  });

  it('移除檔名不允許的字元並保留中文與升降記號', () => {
    const date = new Date(2026, 0, 2, 14, 30, 0);
    expect(screenshotFileName('音階/滑音:*?"<>|\\', 'F♯', date)).toBe(
      'SingPitch_音階滑音_F♯_20260102-143000.png',
    );
  });

  it('圖案名或調名清空時使用預設名稱', () => {
    const date = new Date(2026, 4, 6, 9, 10, 11);
    expect(screenshotFileName('///', '  ', date)).toBe(
      'SingPitch_練習_C_20260506-091011.png',
    );
  });
});

describe('formatScreenshotHeader / formatScreenshotTimestamp', () => {
  it('格式化資訊列文字與時間戳', () => {
    const date = new Date(2026, 10, 27, 18, 4, 0);
    expect(formatScreenshotTimestamp(date)).toBe('2026/11/27 18:04');
    expect(
      formatScreenshotHeader({
        patternName: '三度跳進',
        keyLabel: 'D',
        keyIndex: 1,
        totalKeys: 5,
        passNum: 2,
        repeatsPerKey: 3,
        phase: 'sing',
      }),
    ).toBe('三度跳進 · D 調 · 第 2/5 調 · 第 2/3 遍');
  });

  it('支援無限重複與示範階段格式', () => {
    expect(
      formatScreenshotHeader({
        patternName: '長音',
        keyLabel: 'C',
        keyIndex: 0,
        totalKeys: 3,
        passNum: 4,
        repeatsPerKey: 'inf',
        phase: 'sing',
      }),
    ).toBe('長音 · C 調 · 第 1/3 調 · 第 4 遍');

    expect(
      formatScreenshotHeader({
        patternName: '長音',
        keyLabel: 'C',
        keyIndex: 0,
        totalKeys: 3,
        passNum: 1,
        repeatsPerKey: 2,
        phase: 'listen',
      }),
    ).toBe('長音 · C 調 · 第 1/3 調 · 示範');
  });
});

describe('prepareSvgForScreenshot', () => {
  it('補上 xmlns、更新寬高並展開 CSS 變數與 currentColor', () => {
    const raw =
      '<svg class="staff-svg" width="100" height="50" viewBox="0 0 600 120"><line stroke="var(--text-muted)" /><path fill="currentColor" /></svg>';
    const prepared = prepareSvgForScreenshot(raw, 600, 120, {
      defaultFill: '#2c2c2a',
    });

    expect(prepared).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(prepared).toContain('width="600"');
    expect(prepared).toContain('height="120"');
    expect(prepared).toContain('viewBox="0 0 600 120"');
    expect(prepared).toContain('stroke="#5f5e5a"');
    expect(prepared).toContain('fill="#2c2c2a"');
    expect(prepared).toContain('font-family:');
  });

  it('不重複加入已存在的 xmlns 與 style', () => {
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" style="color: red"><circle cx="10" cy="10" r="5" fill="#e8b400" /></svg>';
    const prepared = prepareSvgForScreenshot(raw, 320, 96);

    expect(prepared.match(/xmlns=/g)?.length).toBe(1);
    expect(prepared.match(/style=/g)?.length).toBe(1);
    expect(prepared).toContain('width="320"');
    expect(prepared).toContain('height="96"');
    expect(prepared).toContain('fill="#e8b400"');
  });
});

describe('shareOrDownloadFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeTestFile(): File {
    return new File(['png-bytes'], 'SingPitch_測試_C_20261127-180000.png', {
      type: 'image/png',
    });
  }

  it('navigator.share 拋出 NotAllowedError 時回傳 needs-tap 與已產生的 File', async () => {
    const file = makeTestFile();
    const notAllowed = Object.assign(new Error('Not allowed'), {
      name: 'NotAllowedError',
    });

    vi.stubGlobal('navigator', {
      canShare: vi.fn(() => true),
      share: vi.fn(async () => {
        throw notAllowed;
      }),
    });

    const result = await shareOrDownloadFile(file, '測試 (C)');
    expect(result).toEqual({
      status: 'needs-tap',
      file,
      title: '測試 (C)',
    });
  });

  it('navigator.share 拋出 AbortError 時回傳 cancelled', async () => {
    const file = makeTestFile();
    const aborted = Object.assign(new Error('User cancelled'), {
      name: 'AbortError',
    });

    vi.stubGlobal('navigator', {
      canShare: vi.fn(() => true),
      share: vi.fn(async () => {
        throw aborted;
      }),
    });

    const result = await shareOrDownloadFile(file, '測試 (C)');
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('canShare 不存在時退回 <a download> 並回傳 downloaded', async () => {
    const file = makeTestFile();
    const click = vi.fn();
    const link = {
      href: '',
      download: '',
      style: { display: '' },
      click,
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();

    vi.stubGlobal('navigator', {});
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => link),
      body: {
        appendChild,
        removeChild,
      },
    });

    const result = await shareOrDownloadFile(file, '測試 (C)');
    expect(result).toEqual({ status: 'downloaded' });
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(link.download).toBe(file.name);
    expect(click).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(removeChild).toHaveBeenCalledWith(link);
  });

  it('navigator.share 拋出其他錯誤時維持拋出', async () => {
    const file = makeTestFile();
    const otherErr = new TypeError('Share failed');

    vi.stubGlobal('navigator', {
      canShare: vi.fn(() => true),
      share: vi.fn(async () => {
        throw otherErr;
      }),
    });

    await expect(shareOrDownloadFile(file, '測試 (C)')).rejects.toThrow(
      'Share failed',
    );
  });
});
