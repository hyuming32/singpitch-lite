import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ModeToggleButton,
  nextPracticeMode,
} from '../practice/ModeToggleButton';

describe('ModeToggleButton 練習模式切換按鈕', () => {
  it('依目前 mode 顯示對應文字、樣式類別與 aria-label', () => {
    const followHtml = renderToStaticMarkup(
      <ModeToggleButton mode="follow" onToggle={() => {}} />,
    );
    expect(followHtml).toContain('>跟唱<');
    expect(followHtml).not.toContain('先聽再唱');
    expect(followHtml).toContain('is-follow');
    expect(followHtml).not.toContain('is-listen-then-sing');
    expect(followHtml).toContain('練習模式：跟唱，按一下切換');

    const listenHtml = renderToStaticMarkup(
      <ModeToggleButton
        mode="listen-then-sing"
        isCompact
        onToggle={() => {}}
      />,
    );
    expect(listenHtml).toContain('>先聽再唱<');
    expect(listenHtml).toContain('is-listen-then-sing');
    expect(listenHtml).toContain('is-compact');
    expect(listenHtml).toContain('練習模式：先聽再唱，按一下切換');
  });

  it('點擊按鈕時呼叫 onToggle 並切換至另一種練習模式', () => {
    expect(nextPracticeMode('follow')).toBe('listen-then-sing');
    expect(nextPracticeMode('listen-then-sing')).toBe('follow');

    const onToggle = vi.fn();
    const followEl = ModeToggleButton({ mode: 'follow', onToggle });
    followEl.props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenLastCalledWith('listen-then-sing');

    const listenEl = ModeToggleButton({ mode: 'listen-then-sing', onToggle });
    listenEl.props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith('follow');
  });
});
