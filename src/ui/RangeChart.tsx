import { useMemo } from 'react';
import { RANGES } from '../core/notes';
import { MY_RANGE_NAME, type MyRangeData } from '../state/settings';
import { VOCAL_RANGE_PARTS } from '../state/vocalRange';
import { displayNoteName } from './noteLabel';
import {
  isBlackMidi,
  layoutKeyboard,
  needleXForMidi,
  type KeyboardLayout,
} from './piano/pianoGeometry';

export const RANGE_CHART_LOW_MIDI = 36;
export const RANGE_CHART_HIGH_MIDI = 86;

const KEY_UNIT_W = 100;
const KEYBOARD_LAYOUT: KeyboardLayout = layoutKeyboard({
  lowMidi: RANGE_CHART_LOW_MIDI,
  highMidi: RANGE_CHART_HIGH_MIDI,
  W: KEY_UNIT_W,
  preset: 'korg',
  height: 220,
});

function keyBoundsX(midi: number, layout: KeyboardLayout): [number, number] {
  const clamped = Math.max(
    layout.lowMidi,
    Math.min(layout.highMidi, Math.round(midi)),
  );
  if (!isBlackMidi(clamped)) {
    const wk = layout.whites.find((w) => w.midi === clamped);
    if (wk) return [wk.x, wk.x + wk.w];
  } else {
    const bk = layout.blacks.find((b) => b.midi === clamped);
    if (bk) return [bk.x, bk.x + bk.w];
  }
  return [0, 0];
}

function rangeBoundsPct(
  lowMidi: number,
  highMidi: number,
  layout: KeyboardLayout = KEYBOARD_LAYOUT,
): { leftPct: number; widthPct: number } {
  const lo = Math.max(layout.lowMidi, Math.min(layout.highMidi, Math.min(lowMidi, highMidi)));
  const hi = Math.max(layout.lowMidi, Math.min(layout.highMidi, Math.max(lowMidi, highMidi)));
  const [x0] = keyBoundsX(lo, layout);
  const [, x1] = keyBoundsX(hi, layout);
  const leftPct = (x0 / layout.totalWidth) * 100;
  const widthPct = Math.max(1.5, ((x1 - x0) / layout.totalWidth) * 100);
  return { leftPct, widthPct };
}

function keyCenterPct(midi: number, layout: KeyboardLayout = KEYBOARD_LAYOUT): number {
  const [x0, x1] = keyBoundsX(midi, layout);
  return (((x0 + x1) * 0.5) / layout.totalWidth) * 100;
}

export interface RangeChartProps {
  /** 目前選定的音域名稱（或 null 表示不反白） */
  selectedRangeName: string | null;
  /** 我的音域（若已測量） */
  myRange: MyRangeData | null;
  /** 點選某個色塊時的回呼；未傳入則為唯讀預覽 */
  onSelectRange?: (rangeName: string) => void;
  /** 試唱時的即時音高（浮點 MIDI） */
  liveSungMidi?: number | null;
  /** 僅顯示上方鋼琴鍵盤與黃色指針（試唱測音域中用） */
  keyboardOnly?: boolean;
  /** 是否顯示「完整 (C2–C6)」切換鈕 */
  showFullRangeOption?: boolean;
  /** 結果頁標記的推薦聲部名稱 */
  recommendedRangeName?: string | null;
  /** 試唱中已確認（穩定）的最低音：此音到 confirmedHighMidi 的鍵塗實心綠 */
  confirmedLowMidi?: number | null;
  /** 試唱中已確認的最高音；null 時只塗最低音那一鍵 */
  confirmedHighMidi?: number | null;
  /** 試唱第 2 步：最高音至少要到的音（此音以上鍵盤頂端標藍條＋「X 以上」） */
  highTargetMinMidi?: number | null;
}

/** 試唱時鍵盤每個鍵的狀態：已確認（實心綠）、正在唱（淡綠，跟著音高移動） */
type TestKeyState = 'solid' | 'live' | null;

const KEY_FILL = {
  white: { solid: '#6fd69b', live: '#c6f0d6', base: '#f2f1ed' },
  black: { solid: '#1f8f52', live: '#5fae83', base: '#1b1e25' },
} as const;

/**
 * 算出某鍵在試唱時的狀態。
 * - 已確認範圍 [low, high ?? low] 內 → solid
 * - 目前唱的音在範圍外 → 從範圍邊緣延伸到目前音的鍵 → live
 * - 還沒有確認任何音 → 只有目前唱的那一鍵 → live
 */
export function testKeyState(
  midi: number,
  confirmedLow: number | null,
  confirmedHigh: number | null,
  liveMidi: number | null,
): TestKeyState {
  const lo = confirmedLow;
  const hi = confirmedLow === null ? null : (confirmedHigh ?? confirmedLow);
  if (lo !== null && hi !== null && midi >= lo && midi <= hi) return 'solid';
  if (liveMidi === null) return null;
  if (lo === null || hi === null) return midi === liveMidi ? 'live' : null;
  if (liveMidi < lo) return midi >= liveMidi && midi < lo ? 'live' : null;
  if (liveMidi > hi) return midi > hi && midi <= liveMidi ? 'live' : null;
  return null;
}

/** 音域圖元件：上方 MIDI 36–86 鋼琴鍵盤，下方聲部與我的音域對齊色塊條 */
export function RangeChart({
  selectedRangeName,
  myRange,
  onSelectRange,
  liveSungMidi = null,
  keyboardOnly = false,
  showFullRangeOption = false,
  recommendedRangeName = null,
  confirmedLowMidi = null,
  confirmedHighMidi = null,
  highTargetMinMidi = null,
}: RangeChartProps) {
  const layout = KEYBOARD_LAYOUT;

  const cKeys = useMemo(
    () =>
      layout.whites
        .filter((wk) => wk.midi % 12 === 0)
        .map((wk) => ({
          midi: wk.midi,
          label: displayNoteName(wk.midi),
          centerPct: ((wk.x + wk.w * 0.5) / layout.totalWidth) * 100,
          isMiddleC: wk.midi === 60,
        })),
    [layout],
  );

  const middleCPct = useMemo(() => keyCenterPct(60, layout), [layout]);

  const selectedBounds = useMemo(() => {
    if (!selectedRangeName) return null;
    if (selectedRangeName === MY_RANGE_NAME) {
      return myRange ? ([myRange.low, myRange.high] as const) : null;
    }
    return RANGES[selectedRangeName] ?? null;
  }, [selectedRangeName, myRange]);

  const selectedBandPct = useMemo(
    () =>
      selectedBounds
        ? rangeBoundsPct(selectedBounds[0], selectedBounds[1], layout)
        : null,
    [selectedBounds, layout],
  );

  const myBandPct = useMemo(
    () =>
      myRange ? rangeBoundsPct(myRange.low, myRange.high, layout) : null,
    [myRange, layout],
  );

  const needlePct = useMemo(() => {
    if (liveSungMidi === null || !Number.isFinite(liveSungMidi)) return null;
    const clamped = Math.max(
      RANGE_CHART_LOW_MIDI,
      Math.min(RANGE_CHART_HIGH_MIDI, liveSungMidi),
    );
    const nx = needleXForMidi(clamped, layout);
    if (nx === null) return null;
    return (nx / layout.totalWidth) * 100;
  }, [liveSungMidi, layout]);

  const testLow =
    confirmedLowMidi !== null && Number.isFinite(confirmedLowMidi)
      ? Math.round(confirmedLowMidi)
      : null;
  const testHigh =
    testLow !== null && confirmedHighMidi !== null && Number.isFinite(confirmedHighMidi)
      ? Math.round(confirmedHighMidi)
      : null;
  const liveKey =
    liveSungMidi !== null && Number.isFinite(liveSungMidi)
      ? Math.max(layout.lowMidi, Math.min(layout.highMidi, Math.round(liveSungMidi)))
      : null;
  const testMode = testLow !== null || (keyboardOnly && liveKey !== null);

  const keyFill = (midi: number, black: boolean): string => {
    const palette = black ? KEY_FILL.black : KEY_FILL.white;
    if (!testMode) return palette.base;
    const st = testKeyState(midi, testLow, testHigh, liveKey);
    return st ? palette[st] : palette.base;
  };

  /** 標籤錨點：靠左邊緣時往右長、靠右邊緣時往左長，避免被裁掉 */
  const tagFor = (midi: number, side: 'low' | 'high') => {
    const [x0, x1] = keyBoundsX(midi, layout);
    const leftPct = (x0 / layout.totalWidth) * 100;
    const rightPct = (x1 / layout.totalWidth) * 100;
    if (side === 'low') {
      return leftPct < 14
        ? { left: `${leftPct}%` }
        : { left: `${rightPct}%`, transform: 'translateX(-100%)' };
    }
    return rightPct > 86
      ? { left: `${rightPct}%`, transform: 'translateX(-100%)' }
      : { left: `${leftPct}%` };
  };

  const targetMin =
    testLow !== null && highTargetMinMidi !== null && Number.isFinite(highTargetMinMidi)
      ? Math.round(highTargetMinMidi)
      : null;
  const goalPct =
    targetMin !== null && targetMin <= layout.highMidi
      ? rangeBoundsPct(targetMin, layout.highMidi, layout)
      : null;

  const maleParts = VOCAL_RANGE_PARTS.filter((p) => p.group === 'male');
  const femaleParts = VOCAL_RANGE_PARTS.filter((p) => p.group === 'normal');
  const hasSelection = selectedRangeName !== null;
  const interactive = typeof onSelectRange === 'function';

  const renderKeyboardBlock = () => (
    <div className="range-kbd-col">
      <div className="range-kbd-middlec-row">
        <span
          className="range-kbd-middlec-label"
          style={{ left: `${middleCPct}%` }}
        >
          中央 Do
        </span>
      </div>
      <div className="range-kbd-wrap" aria-label="MIDI 36 至 86 鋼琴鍵盤">
        <svg
          className="range-kbd-svg"
          viewBox={`0 0 ${layout.totalWidth} ${layout.whiteLen}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {layout.whites.map((wk) => (
            <rect
              key={wk.midi}
              x={wk.x}
              y={0}
              width={wk.w}
              height={wk.len}
              rx={10}
              fill={keyFill(wk.midi, false)}
              stroke="#cbd5e1"
              strokeWidth={4}
            />
          ))}
          {layout.blacks.map((bk) => (
            <rect
              key={bk.midi}
              x={bk.x}
              y={0}
              width={bk.w}
              height={bk.len}
              rx={8}
              fill={keyFill(bk.midi, true)}
            />
          ))}
        </svg>

        {/* 半透明黃色帶（我的音域） */}
        {myBandPct && !keyboardOnly && (
          <div
            className="range-kbd-band range-kbd-band-my"
            style={{
              left: `${myBandPct.leftPct}%`,
              width: `${myBandPct.widthPct}%`,
            }}
            aria-hidden="true"
          />
        )}

        {/* 半透明藍色帶（目前選定範圍） */}
        {selectedBandPct && !keyboardOnly && (
          <div
            className="range-kbd-band range-kbd-band-selected"
            style={{
              left: `${selectedBandPct.leftPct}%`,
              width: `${selectedBandPct.widthPct}%`,
            }}
            aria-hidden="true"
          />
        )}

        {/* 試唱第 2 步：最高音目標區（頂端藍條） */}
        {goalPct && (
          <div
            className="range-kbd-goal-strip"
            style={{ left: `${goalPct.leftPct}%`, width: `${goalPct.widthPct}%` }}
            aria-hidden="true"
          />
        )}
        {targetMin !== null && goalPct && (
          <span className="range-kbd-tag range-kbd-tag-target" style={tagFor(targetMin, 'high')}>
            {displayNoteName(targetMin)} 以上
          </span>
        )}
        {testLow !== null && (
          <span className="range-kbd-tag range-kbd-tag-low" style={tagFor(testLow, 'low')}>
            ✓ 最低 {displayNoteName(testLow)}
          </span>
        )}
        {testHigh !== null && testHigh !== testLow && (
          <span className="range-kbd-tag range-kbd-tag-high" style={tagFor(testHigh, 'high')}>
            ✓ 最高 {displayNoteName(testHigh)}
          </span>
        )}

        {/* C2..C6 標記 */}
        <div className="range-kbd-c-labels" aria-hidden="true">
          {cKeys.map((c) => (
            <span
              key={c.midi}
              className={`range-kbd-c-label ${c.isMiddleC ? 'is-middle-c' : ''}`}
              style={{ left: `${c.centerPct}%` }}
            >
              {c.label}
            </span>
          ))}
        </div>

        {/* 即時演唱黃色指針 */}
        {needlePct !== null && (
          <div
            className="range-kbd-needle"
            style={{ left: `${needlePct}%` }}
            aria-hidden="true"
          >
            <span className="range-kbd-needle-head" />
          </div>
        )}
      </div>
    </div>
  );

  if (keyboardOnly) {
    return (
      <div className="range-chart-keyboard-only">
        {renderKeyboardBlock()}
      </div>
    );
  }

  const fullBounds = RANGES['完整 C2–C6']!;

  const renderBarRow = (
    name: string,
    low: number,
    high: number,
    color: string,
    darkText: boolean,
    labelPrefix?: string,
  ) => {
    const isSelected = selectedRangeName === name;
    const isRecommended = recommendedRangeName === name;
    const dimmed = hasSelection && !isSelected;
    const { leftPct, widthPct } = rangeBoundsPct(low, high, layout);
    const rangeText = `${displayNoteName(low)}–${displayNoteName(high)}`;
    const displayLabel = labelPrefix ?? name;

    const barStyle = {
      left: `${leftPct}%`,
      width: `${widthPct}%`,
      backgroundColor: color,
      opacity: dimmed ? 0.55 : 1,
    };

    const content = (
      <>
        <span className="range-bar-name">
          {displayLabel}
          {isRecommended && !isSelected ? ' ★' : ''}
        </span>
        <span className="range-bar-notes">{rangeText}</span>
      </>
    );

    return (
      <div key={name} className="range-bar-track">
        {interactive ? (
          <button
            type="button"
            className={`range-bar ${isSelected ? 'is-selected' : ''} ${darkText ? 'is-dark-text' : 'is-light-text'}`}
            style={barStyle}
            aria-pressed={isSelected}
            aria-label={`${displayLabel} ${rangeText}`}
            onClick={() => onSelectRange(name)}
          >
            {content}
          </button>
        ) : (
          <div
            className={`range-bar is-readonly ${isSelected ? 'is-selected' : ''} ${darkText ? 'is-dark-text' : 'is-light-text'}`}
            style={barStyle}
            aria-label={`${displayLabel} ${rangeText}`}
          >
            {content}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="range-chart-root">
      {showFullRangeOption && (
        <div className="range-chart-head">
          <span className="setting-label">音域</span>
          <button
            type="button"
            className={`range-full-pill ${selectedRangeName === '完整 C2–C6' ? 'is-selected' : ''}`}
            aria-pressed={selectedRangeName === '完整 C2–C6'}
            onClick={() => onSelectRange?.('完整 C2–C6')}
          >
            完整 {displayNoteName(fullBounds[0])}–{displayNoteName(fullBounds[1])}
          </button>
        </div>
      )}

      <div className="range-chart-scroll">
        <div className="range-chart-inner">
          {/* 上方鍵盤列（左側預留與群組標籤同寬的空白欄） */}
          <div className="range-chart-row range-chart-kbd-row">
            <div className="range-group-spacer" aria-hidden="true" />
            {renderKeyboardBlock()}
          </div>

          {/* 我的音域列（置頂亮黃 #e8b400） */}
          {myRange && (
            <div className="range-chart-group range-chart-group-my">
              <div className="range-group-label is-my">我的</div>
              <div className="range-group-bars">
                {renderBarRow(
                  MY_RANGE_NAME,
                  myRange.low,
                  myRange.high,
                  '#e8b400',
                  true,
                  '我的音域',
                )}
              </div>
            </div>
          )}

          {/* 男聲群組 */}
          <div className="range-chart-group">
            <div className="range-group-label">男聲</div>
            <div className="range-group-bars">
              {maleParts.map((part) => {
                const [lo, hi] = RANGES[part.name]!;
                return renderBarRow(part.name, lo, hi, part.color, part.darkText);
              })}
            </div>
          </div>

          {/* 女聲群組 */}
          <div className="range-chart-group">
            <div className="range-group-label">女聲</div>
            <div className="range-group-bars">
              {femaleParts.map((part) => {
                const [lo, hi] = RANGES[part.name]!;
                return renderBarRow(part.name, lo, hi, part.color, part.darkText);
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
