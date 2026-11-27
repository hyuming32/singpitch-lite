import { useEffect, useRef, useState } from 'react';
import type { RepeatsPerKeyOption } from '../../state/settings';
import { computePatternTitleFontSize } from './layout';
import { MetronomeIcon } from './MetronomeIcon';

export const PIANO_HINT_STORAGE_KEY = 'singpitch-lite.piano-hint-seen.v1';
const LONG_PRESS_MS = 500;

interface TransportBarProps {
  playing: boolean;
  canPrevKey: boolean;
  canNextKey: boolean;
  hasExercise: boolean;
  patternName: string;
  repeatsPerKey: RepeatsPerKeyOption;
  currentPass: number;
  bpm: number;
  metronome: boolean;
  firstBeat: number;
  transposeOffset: number;
  canTransposeDown: boolean;
  canTransposeUp: boolean;
  boundaryToast: boolean;
  pianoDuringSing: boolean;
  isTablet: boolean;
  height?: number;
  getSec: () => number;
  onPrevKey: () => void;
  onPlayPause: () => void;
  onNextKey: () => void;
  onCycleRepeats: () => void;
  onToggleMetronome: () => void;
  onBpmStep: (delta: -4 | 4) => void;
  onBpmReset: () => void;
  onTransposeStep: (delta: -1 | 1) => void;
  onTogglePiano: () => void;
}

/** 格式化移調半音數：0 → "0"、正數加 "+"、負數加 "−" */
export function formatTransposeOffset(offset: number): string {
  if (offset === 0) {
    return '0';
  }
  if (offset > 0) {
    return `+${offset}`;
  }
  return `\u2212${Math.abs(offset)}`;
}

function readPianoHintSeen(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return true;
    }
    return localStorage.getItem(PIANO_HINT_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function markPianoHintSeen(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PIANO_HINT_STORAGE_KEY, '1');
    }
  } catch {
    // 忽略私密瀏覽或容量限制錯誤
  }
}

/** 底部播放與快捷控制列（v3） */
export function TransportBar({
  playing,
  canPrevKey,
  canNextKey,
  hasExercise,
  patternName,
  repeatsPerKey,
  currentPass,
  bpm,
  metronome,
  firstBeat,
  transposeOffset,
  canTransposeDown,
  canTransposeUp,
  boundaryToast,
  pianoDuringSing,
  isTablet,
  height,
  getSec,
  onPrevKey,
  onPlayPause,
  onNextKey,
  onCycleRepeats,
  onToggleMetronome,
  onBpmStep,
  onBpmReset,
  onTransposeStep,
  onTogglePiano,
}: TransportBarProps) {
  const [showTransposeTip, setShowTransposeTip] = useState(false);
  const [showPianoHint, setShowPianoHint] = useState(() => !readPianoHintSeen());
  const [centerWidth, setCenterWidth] = useState(0);

  const centerRef = useRef<HTMLDivElement | null>(null);
  const bpmPressTimerRef = useRef<number | null>(null);
  const transposePressTimerRef = useRef<number | null>(null);
  const transposeTipHideTimerRef = useRef<number | null>(null);

  // 量測播放列中間可用寬度，自動調整音型名稱字級
  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const measure = () => {
      setCenterWidth(Math.max(0, el.clientWidth - 8));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isTablet, patternName]);

  const barHeight = height ?? (isTablet ? 64 : 30);
  const titleFontSize = computePatternTitleFontSize(
    centerWidth,
    [...patternName].length,
    barHeight,
  );

  // 第一次進練唱畫面時顯示「唱的時候鋼琴是否一起彈」提示，4 秒後消失
  useEffect(() => {
    if (!showPianoHint) {
      return;
    }
    markPianoHintSeen();
    const timer = window.setTimeout(() => {
      setShowPianoHint(false);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [showPianoHint]);

  useEffect(() => {
    return () => {
      if (bpmPressTimerRef.current !== null) {
        window.clearTimeout(bpmPressTimerRef.current);
      }
      if (transposePressTimerRef.current !== null) {
        window.clearTimeout(transposePressTimerRef.current);
      }
      if (transposeTipHideTimerRef.current !== null) {
        window.clearTimeout(transposeTipHideTimerRef.current);
      }
    };
  }, []);

  function startBpmLongPress() {
    if (bpmPressTimerRef.current !== null) {
      window.clearTimeout(bpmPressTimerRef.current);
    }
    bpmPressTimerRef.current = window.setTimeout(() => {
      bpmPressTimerRef.current = null;
      onBpmReset();
    }, LONG_PRESS_MS);
  }

  function cancelBpmLongPress() {
    if (bpmPressTimerRef.current !== null) {
      window.clearTimeout(bpmPressTimerRef.current);
      bpmPressTimerRef.current = null;
    }
  }

  function startTransposeLongPress() {
    if (transposePressTimerRef.current !== null) {
      window.clearTimeout(transposePressTimerRef.current);
    }
    transposePressTimerRef.current = window.setTimeout(() => {
      transposePressTimerRef.current = null;
      setShowTransposeTip(true);
      if (transposeTipHideTimerRef.current !== null) {
        window.clearTimeout(transposeTipHideTimerRef.current);
      }
      transposeTipHideTimerRef.current = window.setTimeout(() => {
        setShowTransposeTip(false);
      }, 2000);
    }, LONG_PRESS_MS);
  }

  function cancelTransposeLongPress() {
    if (transposePressTimerRef.current !== null) {
      window.clearTimeout(transposePressTimerRef.current);
      transposePressTimerRef.current = null;
    }
  }

  const offsetText = formatTransposeOffset(transposeOffset);

  return (
    <footer
      className={`transport-bar ${isTablet ? 'is-tablet' : ''}`}
      style={{ height: `${barHeight}px` }}
    >
      <div className="transport-left">
        <button
          type="button"
          className="tb-btn tb-btn-nav"
          aria-label="上一調"
          disabled={!hasExercise || !canPrevKey}
          onClick={onPrevKey}
        >
          ⏮
        </button>
        <button
          type="button"
          className="tb-btn tb-btn-primary"
          aria-label={playing ? '暫停' : '播放'}
          disabled={!hasExercise}
          onClick={onPlayPause}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="tb-btn tb-btn-nav"
          aria-label="下一調"
          disabled={!hasExercise || !canNextKey}
          onClick={onNextKey}
        >
          ⏭
        </button>
        <button
          type="button"
          className="tb-btn tb-repeat-btn"
          aria-label={
            repeatsPerKey === 'inf'
              ? `每調重複無限次，目前第 ${currentPass} 遍`
              : `每調重複 ${repeatsPerKey} 遍，目前第 ${currentPass} 遍`
          }
          onClick={onCycleRepeats}
        >
          <span className="tb-repeat-icon" aria-hidden="true">
            🔁
          </span>
          <strong className="tb-repeat-count">
            {repeatsPerKey === 'inf' ? '∞' : `×${repeatsPerKey}`}
          </strong>
          <span className="tb-repeat-progress">
            {repeatsPerKey === 'inf'
              ? `第 ${currentPass} 遍`
              : `${currentPass}/${repeatsPerKey}`}
          </span>
        </button>
      </div>

      <div className="transport-center" ref={centerRef}>
        <span
          className="transport-pattern-title"
          style={{ fontSize: `${titleFontSize.toFixed(2)}px` }}
          title={patternName}
        >
          {patternName}
        </span>
      </div>

      <div className="transport-right">
        {boundaryToast && (
          <span className="transpose-toast" role="status">
            已到音域邊界
          </span>
        )}

        <MetronomeIcon
          enabled={metronome}
          playing={playing}
          bpm={bpm}
          firstBeat={firstBeat}
          isTablet={isTablet}
          getSec={getSec}
          onToggle={onToggleMetronome}
        />

        {/* 速度組 */}
        <div className="tb-pill-group tb-bpm-group">
          <button
            type="button"
            className="tb-btn tb-step-btn"
            aria-label="降低速度"
            disabled={bpm <= 40}
            onClick={() => onBpmStep(-4)}
          >
            −
          </button>
          <span
            className="tb-bpm-value"
            title="長按回到選單設定的速度"
            onPointerDown={startBpmLongPress}
            onPointerUp={cancelBpmLongPress}
            onPointerLeave={cancelBpmLongPress}
            onPointerCancel={cancelBpmLongPress}
          >
            <strong className="tb-bpm-num">{bpm}</strong>
            <span className="tb-bpm-unit">BPM</span>
          </span>
          <button
            type="button"
            className="tb-btn tb-step-btn"
            aria-label="提高速度"
            disabled={bpm >= 200}
            onClick={() => onBpmStep(4)}
          >
            ＋
          </button>
        </div>

        {/* 移調組 */}
        <div className="tb-pill-group tb-transpose-group">
          <button
            type="button"
            className={`tb-btn tb-step-btn ${
              !canTransposeDown ? 'is-boundary' : ''
            }`}
            aria-label="移調降半音"
            aria-disabled={!canTransposeDown}
            onClick={() => onTransposeStep(-1)}
          >
            −
          </button>
          <span
            className="tb-transpose-value"
            onPointerDown={startTransposeLongPress}
            onPointerUp={cancelTransposeLongPress}
            onPointerLeave={cancelTransposeLongPress}
            onPointerCancel={cancelTransposeLongPress}
          >
            {offsetText}
            {showTransposeTip && (
              <span className="tb-tooltip tb-transpose-tip" role="tooltip">
                移調（半音）
              </span>
            )}
          </span>
          <button
            type="button"
            className={`tb-btn tb-step-btn ${
              !canTransposeUp ? 'is-boundary' : ''
            }`}
            aria-label="移調升半音"
            aria-disabled={!canTransposeUp}
            onClick={() => onTransposeStep(1)}
          >
            ＋
          </button>
        </div>

        {/* 鋼琴指示燈開關 */}
        <div className="tb-piano-wrap">
          {showPianoHint && (
            <button
              type="button"
              className="tb-tooltip tb-piano-hint"
              onClick={() => setShowPianoHint(false)}
            >
              <span className="tb-hint-dot" aria-hidden="true" />
              唱的時候鋼琴是否一起彈
            </button>
          )}
          <button
            type="button"
            className={`tb-btn tb-piano-btn ${pianoDuringSing ? 'is-on' : ''}`}
            aria-label="唱的時候鋼琴一起彈"
            aria-pressed={pianoDuringSing}
            onClick={() => {
              if (showPianoHint) {
                setShowPianoHint(false);
              }
              onTogglePiano();
            }}
          >
            <span className="tb-piano-dot" aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
}
