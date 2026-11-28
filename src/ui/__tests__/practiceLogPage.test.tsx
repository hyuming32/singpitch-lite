import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MemoryMidiStore } from '../../state/midiLibrary';
import { MemoryPracticeLogStore } from '../../state/practiceLogStore';
import { PracticeLogPage } from '../log/PracticeLogPage';

describe('PracticeLogPage（練習紀錄頁面）', () => {
  it('初始渲染顯示標題、匯出按鈕、本週練習與記憶體警告提示', () => {
    const logStore = new MemoryPracticeLogStore();
    const midiStore = new MemoryMidiStore();

    const html = renderToStaticMarkup(
      <PracticeLogPage
        logStore={logStore}
        midiStore={midiStore}
        onReplayEntry={vi.fn()}
      />,
    );

    expect(html).toContain('練習紀錄');
    expect(html).toContain('匯出 CSV');
    expect(html).toContain('本週練習');
    expect(html).toContain('此瀏覽器無法保存紀錄');
  });
});
