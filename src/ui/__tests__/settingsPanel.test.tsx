import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { DEFAULT_SETTINGS } from '../../state/settings';
import { AudioProvider } from '../AudioContext';
import { resolvePreviewPad, SettingsPanel } from '../SettingsPanel';

describe('SettingsPanel', () => {
  it('已移除舊的「重複 1／2／3／4 次」欄位並保留其餘練習設定', () => {
    const pattern = BUILTIN_PATTERNS[0]!;
    const html = renderToStaticMarkup(
      <AudioProvider>
        <SettingsPanel
          pattern={pattern}
          settings={DEFAULT_SETTINGS}
          onUpdate={() => {}}
          onStartPractice={() => {}}
          onOpenRangeTest={() => {}}
        />
      </AudioProvider>,
    );

    expect(html).not.toContain('1 次');
    expect(html).not.toContain('2 次');
    expect(html).not.toContain('3 次');
    expect(html).not.toContain('4 次');
    expect(html).toContain('每音拍數');
    expect(html).toContain('提示和弦');
    expect(html).toContain('關閉');
    expect(html).toContain('直接升');
    expect(html).toContain('5/7 導音');
    expect(html).toContain('單和弦快切');
    expect(html).toContain('開始練唱');
  });

  it('cadence 非 off 時「和弦墊底」顯示停用並附提示文字，切回 off 時恢復可用', () => {
    const pattern = BUILTIN_PATTERNS[0]!;
    for (const cadence of ['direct', 'leading', 'single'] as const) {
      const html = renderToStaticMarkup(
        <AudioProvider>
          <SettingsPanel
            pattern={pattern}
            settings={{ ...DEFAULT_SETTINGS, cadence, pad: true }}
            onUpdate={() => {}}
            onStartPractice={() => {}}
            onOpenRangeTest={() => {}}
          />
        </AudioProvider>,
      );

      expect(html).toContain('有提示和弦時不墊底');
      expect(html).toContain('toggle-item is-disabled');
      expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    }

    const offHtml = renderToStaticMarkup(
      <AudioProvider>
        <SettingsPanel
          pattern={pattern}
          settings={{ ...DEFAULT_SETTINGS, cadence: 'off', pad: true }}
          onUpdate={() => {}}
          onStartPractice={() => {}}
          onOpenRangeTest={() => {}}
        />
      </AudioProvider>,
    );

    expect(offHtml).not.toContain('有提示和弦時不墊底');
    expect(offHtml).not.toContain('toggle-item is-disabled');
    expect(offHtml).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
  });

  it('試聽時 cadence 非 off 一律不彈墊底和弦，cadence 為 off 時依 settings.pad 決定', () => {
    for (const cadence of ['direct', 'leading', 'single'] as const) {
      expect(resolvePreviewPad({ cadence, pad: true })).toBe(false);
      expect(resolvePreviewPad({ cadence, pad: false })).toBe(false);
    }
    expect(resolvePreviewPad({ cadence: 'off', pad: true })).toBe(true);
    expect(resolvePreviewPad({ cadence: 'off', pad: false })).toBe(false);
  });
});
