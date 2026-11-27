import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { DEFAULT_SETTINGS } from '../../state/settings';
import { AudioProvider } from '../AudioContext';
import { SettingsPanel } from '../SettingsPanel';

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
    expect(html).toContain('換調前提示和弦');
    expect(html).toContain('開始練唱');
  });
});
