import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { DEFAULT_SETTINGS, MY_RANGE_NAME } from '../../state/settings';
import { VocalRangeCard, computeRangeBarLayout } from '../VocalRangeCard';

describe('VocalRangeCard 首頁音域卡片', () => {
  const pattern = BUILTIN_PATTERNS[0]!;

  it('收起狀態只顯示目前選定音域條，女聲不顯示譜號列，音名採國際標準（中央 Do = C4）', () => {
    const html = renderToStaticMarkup(
      <VocalRangeCard
        settings={{
          ...DEFAULT_SETTINGS,
          rangeName: '女中音',
          voice: 'normal',
        }}
        pattern={pattern}
        onUpdate={() => {}}
        onOpenRangeTest={() => {}}
      />,
    );

    expect(html).toContain('我的音域');
    expect(html).toContain('試唱測音域');
    expect(html).toContain('C4 中央 Do');
    expect(html).toContain('MEZZO SOPRANO');
    expect(html).toContain('女中音');
    expect(html).toContain('A3~A5');
    expect(html).not.toContain('BARITONE');
    expect(html).not.toContain('高音譜 8va');
    expect(html).toContain('#cfe2ff');
  });

  it('選男聲音域時卡片下方顯示譜號列，且男中音顯示 A2~F4', () => {
    const html = renderToStaticMarkup(
      <VocalRangeCard
        settings={{
          ...DEFAULT_SETTINGS,
          rangeName: '男中音',
          voice: 'male',
        }}
        pattern={pattern}
        onUpdate={() => {}}
        onOpenRangeTest={() => {}}
      />,
    );

    expect(html).toContain('BARITONE');
    expect(html).toContain('男中音');
    expect(html).toContain('A2~F4');
    expect(html).toContain('高音譜 8va');
    expect(html).toContain('低音譜');
  });

  it('選擇「我的音域」時顯示範圍與最接近聲部，男聲推薦亦顯示譜號列', () => {
    const html = renderToStaticMarkup(
      <VocalRangeCard
        settings={{
          ...DEFAULT_SETTINGS,
          rangeName: MY_RANGE_NAME,
          voice: 'male',
          myRange: {
            low: 43, // G2
            high: 65, // F4
            raw: [42, 66],
            method: 'twoNotes',
            voice: 'male',
            measuredAt: '2026-11-27T00:00:00Z',
          },
        }}
        pattern={pattern}
        onUpdate={() => {}}
        onOpenRangeTest={() => {}}
      />,
    );

    expect(html).toContain('G2~F4');
    expect(html).toContain('最接近 男中音');
    expect(html).toContain('高音譜 8va');
  });

  it('色條依中文 1em、英文 0.62em 計算最小寬且不截斷；極窄容器時英文字級縮至 10px', () => {
    const baritone = computeRangeBarLayout({
      leftSegments: ['男聲', 'BARITONE', '男中音'],
      rightSegments: ['A2~F4', '▼'],
      englishText: 'BARITONE',
      trackWidth: 332,
    });
    expect(baritone.compactEnglish).toBe(false);
    expect(baritone.minWidthPx).toBe(baritone.requiredWidth12);
    expect(baritone.minWidthPx).toBeLessThanOrEqual(332);

    const mezzo = computeRangeBarLayout({
      leftSegments: ['女聲', 'MEZZO SOPRANO', '女中音'],
      rightSegments: ['A3~A5'],
      englishText: 'MEZZO SOPRANO',
      trackWidth: 332,
    });
    expect(mezzo.compactEnglish).toBe(false);
    expect(mezzo.minWidthPx).toBe(mezzo.requiredWidth12);
    expect(mezzo.minWidthPx).toBeLessThanOrEqual(332);

    // 若軌道寬度小於 12px 需求寬度，英文字級縮至 10px
    const narrow = computeRangeBarLayout({
      leftSegments: ['女聲', 'MEZZO SOPRANO', '女中音'],
      rightSegments: ['A3~A5'],
      englishText: 'MEZZO SOPRANO',
      trackWidth: 210,
    });
    expect(narrow.compactEnglish).toBe(true);
    expect(narrow.minWidthPx).toBeLessThanOrEqual(210);
  });
});
