import { useEffect, useMemo, useRef, useState } from 'react';
import { buildExercise } from '../core/exercise';
import { displayNoteName } from './noteLabel';
import { BUILTIN_PATTERNS, type PatternDef } from '../core/patterns';
import {
  MY_RANGE_NAME,
  formatBpm,
  getRangeBounds,
  toExerciseOptions,
  type PracticeSettings,
} from '../state/settings';
import { patternFit, type PatternFitResult } from '../state/vocalRange';
import { PatternCard } from './PatternCard';
import { RangeTestSheet } from './RangeTestSheet';
import { SettingsPanel } from './SettingsPanel';
import { VoiceClefControls } from './VoiceClefControls';

export interface CategoryInfo {
  id: string;
  label: string;
  description: string;
}

export const PATTERN_CATEGORIES: readonly CategoryInfo[] = [
  { id: '五聲', label: '五聲', description: '適合暖聲與音準起步' },
  { id: '大調', label: '大調', description: '建立調性與音程距離感' },
  { id: '小調', label: '小調', description: '熟悉小調色彩與半音變化' },
  { id: '跳音／琶音', label: '跳音／琶音', description: '訓練大音程跳唱與音域靈活度' },
  { id: '滑音／警笛', label: '滑音／警笛', description: '暖身與換聲過渡' },
  { id: '基礎', label: '基礎', description: '長音與半音' },
  { id: '我的', label: '我的', description: '自訂的練習' },
];

const TRANSPOSE_LABELS: Record<PracticeSettings['transpose'], string> = {
  fixed: '固定',
  up: '逐半音上',
  'up-down': '上去再下來',
};

interface PatternMenuProps {
  settings: PracticeSettings;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onStartPractice: () => void;
  customNoticeOpen: boolean;
  onShowCustomNotice: () => void;
}

/** 音階練習圖案選單（支援 iPad 橫放三欄與 iPhone 直立單欄版面） */
export function PatternMenu({
  settings,
  onUpdateSettings,
  onStartPractice,
  customNoticeOpen,
  onShowCustomNotice,
}: PatternMenuProps) {
  const selectedPattern: PatternDef = useMemo(
    () =>
      BUILTIN_PATTERNS.find((p) => p.id === settings.patternId) ??
      BUILTIN_PATTERNS[0]!,
    [settings.patternId],
  );

  const [activeCategory, setActiveCategory] = useState<string>(
    selectedPattern.category,
  );
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [rangeTestOpen, setRangeTestOpen] = useState(false);
  const [outOfRangeNotice, setOutOfRangeNotice] = useState(false);
  const outNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (outNoticeTimerRef.current !== null) {
        window.clearTimeout(outNoticeTimerRef.current);
      }
    };
  }, []);

  const activeRangeBounds = useMemo(
    () => getRangeBounds(settings.rangeName, settings.myRange),
    [settings.rangeName, settings.myRange],
  );

  function handleSelectPattern(pat: PatternDef, fit: PatternFitResult) {
    onUpdateSettings({ patternId: pat.id });
    if (!fit.fits) {
      setOutOfRangeNotice(true);
      if (outNoticeTimerRef.current !== null) {
        window.clearTimeout(outNoticeTimerRef.current);
      }
      outNoticeTimerRef.current = window.setTimeout(() => {
        setOutOfRangeNotice(false);
      }, 2800);
    } else {
      setOutOfRangeNotice(false);
    }
  }

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of PATTERN_CATEGORIES) {
      counts[cat.id] = 0;
    }
    for (const p of BUILTIN_PATTERNS) {
      counts[p.category] = (counts[p.category] ?? 0) + 1;
    }
    return counts;
  }, []);

  const currentCategoryInfo =
    PATTERN_CATEGORIES.find((c) => c.id === activeCategory) ??
    PATTERN_CATEGORIES[0]!;

  const visiblePatterns = useMemo(
    () => BUILTIN_PATTERNS.filter((p) => p.category === activeCategory),
    [activeCategory],
  );

  const hasRangeError = useMemo(() => {
    try {
      buildExercise(selectedPattern, toExerciseOptions(settings));
      return false;
    } catch {
      return true;
    }
  }, [selectedPattern, settings]);

  const rangeSummaryLabel =
    settings.rangeName === MY_RANGE_NAME && settings.myRange
      ? `我的音域（${displayNoteName(settings.myRange.low)}–${displayNoteName(settings.myRange.high)}）`
      : settings.rangeName;
  const mobileSummary = `${displayNoteName(settings.startTonic)} 起 · ${rangeSummaryLabel} · ${formatBpm(settings.bpm)} BPM · ${TRANSPOSE_LABELS[settings.transpose]}`;

  return (
    <div
      className={`pattern-menu ${settings.voice === 'male' ? 'has-male-clef' : ''}`}
    >
      {/* 手機版橫向膠囊分類列 */}
      <nav className="mobile-cat-pills" aria-label="練習分類">
        {PATTERN_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`cat-pill ${activeCategory === cat.id ? 'is-active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            <span>{cat.label}</span>
            <span className="cat-pill-count">{categoryCounts[cat.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      {/* 平板／桌面左側分類欄 */}
      <aside className="cat-sidebar" aria-label="練習分類">
        <div className="cat-list">
          {PATTERN_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`cat-item ${activeCategory === cat.id ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span className="cat-item-label">{cat.label}</span>
              <span className="cat-item-count">{categoryCounts[cat.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="custom-pattern-btn"
          onClick={onShowCustomNotice}
        >
          ＋ 自訂圖案
        </button>
        {customNoticeOpen && (
          <div className="custom-notice-pill" role="status">
            第 6 步開放
          </div>
        )}
      </aside>

      {/* 中間圖案卡片區 */}
      <section className="pattern-main">
        <header className="pattern-main-header">
          <h2 className="pattern-cat-title">{currentCategoryInfo.label}</h2>
          <p className="pattern-cat-desc">{currentCategoryInfo.description}</p>
        </header>

        {outOfRangeNotice && (
          <div className="pattern-out-toast" role="status">
            這個音型超出目前音域
          </div>
        )}

        {visiblePatterns.length === 0 ? (
          <div className="pattern-empty-state">
            <p>尚無自訂圖案（第 6 步開放）</p>
          </div>
        ) : (
          <div className="pattern-grid">
            {visiblePatterns.map((pat) => {
              const fit = patternFit(pat, activeRangeBounds);
              return (
                <PatternCard
                  key={pat.id}
                  pattern={pat}
                  selected={pat.id === selectedPattern.id}
                  fit={fit}
                  onSelect={() => handleSelectPattern(pat, fit)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* 平板／桌面右側設定欄 */}
      <aside className="settings-sidebar" aria-label="練習設定">
        <SettingsPanel
          pattern={selectedPattern}
          settings={settings}
          onUpdate={onUpdateSettings}
          onStartPractice={onStartPractice}
          onOpenRangeTest={() => setRangeTestOpen(true)}
        />
      </aside>

      {/* 手機版底部固定區（聲部／譜號 + 摘要 + 開始練唱） */}
      <div className="mobile-bottom-bar">
        <VoiceClefControls
          settings={settings}
          pattern={selectedPattern}
          onUpdate={onUpdateSettings}
        />
        <button
          type="button"
          className="mobile-summary-btn"
          onClick={() => setMobileSheetOpen(true)}
        >
          <span className="mobile-summary-text">{mobileSummary}</span>
          <span className="mobile-summary-action">調整 ›</span>
        </button>
        <button
          type="button"
          className="start-btn mobile-start-btn"
          disabled={hasRangeError}
          onClick={onStartPractice}
        >
          {hasRangeError ? '請先調整設定（超出音域）' : '開始練唱（建議橫放）'}
        </button>
      </div>

      {/* 手機版全螢幕設定 Sheet */}
      {mobileSheetOpen && (
        <div
          className="mobile-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="練習設定"
        >
          <div className="mobile-sheet">
            <div className="mobile-sheet-header">
              <h3>練習設定</h3>
              <button
                type="button"
                className="sheet-close-btn"
                onClick={() => setMobileSheetOpen(false)}
              >
                完成
              </button>
            </div>
            <div className="mobile-sheet-body">
              <SettingsPanel
                pattern={selectedPattern}
                settings={settings}
                onUpdate={onUpdateSettings}
                onStartPractice={() => {
                  setMobileSheetOpen(false);
                  onStartPractice();
                }}
                onOpenRangeTest={() => setRangeTestOpen(true)}
                hideStartButton
              />
            </div>
          </div>
        </div>
      )}

      {/* 試唱測音域全螢幕 Sheet */}
      <RangeTestSheet
        open={rangeTestOpen}
        settings={settings}
        currentPattern={selectedPattern}
        onApplySettings={onUpdateSettings}
        onClose={() => setRangeTestOpen(false)}
      />
    </div>
  );
}
