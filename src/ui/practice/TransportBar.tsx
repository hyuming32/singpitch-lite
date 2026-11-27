import { useEffect, useRef, useState } from 'react';
import {
  BPM_MAX,
  BPM_MIN,
  formatBpm,
  type RepeatsPerKeyOption,
} from '../../state/settings';
import { useBpmEdit } from '../useBpmEdit';
import { useHoldRepeat } from '../useHoldRepeat';
import { computePatternTitleLayout } from './layout';
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
  isPortrait?: boolean;
  titleHeight?: number;
  height?: number;
  getSec: () => number;
  onPrevKey: () => void;
  onPlayPause: () => void;
  onNextKey: () => void;
  onCycleRepeats: () => void;
  onToggleMetronome: () => void;
  onBpmStep: (delta: -1 | 1) => void;
  onBpmChange: (bpm: number) => void;
  onBpmReset: () => void;
  onBpmEditingChange?: (editing: boolean) => void;
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
  isPortrait = false,
  titleHeight = 32,
  height,
  getSec,
  onPrevKey,
  onPlayPause,
  onNextKey,
  onCycleRepeats,
  onToggleMetronome,
  onBpmStep,
  onBpmChange,
  onBpmReset,
  onBpmEditingChange,
  onTransposeStep,
  onTogglePiano,
}: TransportBarProps) {
  const [showTransposeTip, setShowTransposeTip] = useState(false);
  const [showPianoHint, setShowPianoHint] = useState(() => !readPianoHintSeen());
  const [centerWidth, setCenterWidth] = useState(0);

  const centerRef = useRef<HTMLDivElement | null>(null);
  const bpmPressTimerRef = useRef<number | null>(null);
  const bpmLongPressedRef = useRef(false);
  const transposePressTimerRef = useRef<number | null>(null);
  const transposeTipHideTimerRef = useRef<number | null>(null);

  const bpmEdit = useBpmEdit({
    bpm,
    onCommit: onBpmChange,
    onEditingChange: onBpmEditingChange,
  });
  const minusBpmHold = useHoldRepeat({
    onStep: () => onBpmStep(-1),
    disabled: bpm <= BPM_MIN,
  });
  const plusBpmHold = useHoldRepeat({
    onStep: () => onBpmStep(1),
    disabled: bpm >= BPM_MAX,
  });

  // 量測播放列中間實際可用寬度（扣除左右 padding），自動調整音型名稱字級
  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const measure = () => {
      const cs =
        typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      const padX = cs
        ? (parseFloat(cs.paddingLeft) || 0) +
          (parseFloat(cs.paddingRight) || 0)
        : 8;
      setCenterWidth(Math.max(0, el.clientWidth - padX));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isTablet, isPortrait, patternName]);

  const barHeight = height ?? (isTablet ? 64 : isPortrait ? 96 : 30);
  const effectiveTitleBarH = isPortrait ? titleHeight : barHeight;
  const titleLayout = computePatternTitleLayout(
    centerWidth,
    patternName,
    effectiveTitleBarH,
    0.08,
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
    if (bpmEdit.editing) return;
    bpmLongPressedRef.current = false;
    if (bpmPressTimerRef.current !== null) {
      window.clearTimeout(bpmPressTimerRef.current);
    }
    bpmPressTimerRef.current = window.setTimeout(() => {
      bpmPressTimerRef.current = null;
      bpmLongPressedRef.current = true;
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

  const primaryButtons = (
    <>
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
    </>
  );

  const secondaryControls = (
    <>
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
          disabled={bpm <= BPM_MIN}
          onContextMenu={(e) => e.preventDefault()}
          {...minusBpmHold}
        >
          −
        </button>
        <span
          className={`tb-bpm-value ${bpmEdit.editing ? 'is-editing' : ''}`}
          title="點此輸入速度，長按回到選單設定的速度"
          role={bpmEdit.editing ? undefined : 'button'}
          tabIndex={bpmEdit.editing ? undefined : 0}
          aria-label={
            bpmEdit.editing
              ? undefined
              : `速度 ${formatBpm(bpm)} BPM，點此直接輸入`
          }
          onPointerDown={startBpmLongPress}
          onPointerUp={cancelBpmLongPress}
          onPointerLeave={cancelBpmLongPress}
          onPointerCancel={cancelBpmLongPress}
          onClick={() => {
            if (bpmEdit.editing) return;
            if (bpmLongPressedRef.current) {
              bpmLongPressedRef.current = false;
              return;
            }
            bpmEdit.startEdit();
          }}
          onKeyDown={(e) => {
            if (!bpmEdit.editing && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              bpmEdit.startEdit();
            }
          }}
        >
          {bpmEdit.editing ? (
            <input {...bpmEdit.inputProps} className="tb-bpm-input" />
          ) : (
            <strong className="tb-bpm-num">{formatBpm(bpm)}</strong>
          )}
          <span className="tb-bpm-unit">BPM</span>
        </span>
        <button
          type="button"
          className="tb-btn tb-step-btn"
          aria-label="提高速度"
          disabled={bpm >= BPM_MAX}
          onContextMenu={(e) => e.preventDefault()}
          {...plusBpmHold}
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
    </>
  );

  if (isPortrait) {
    return (
      <>
        {/* 5. 音型名稱大字列 32px（自動字級，pointer-events:none） */}
        <div
          className="transport-portrait-title"
          ref={centerRef}
          style={{ height: `${titleHeight}px` }}
        >
          <span
            className={`transport-pattern-title ${titleLayout.ellipsis ? 'is-ellipsis' : ''}`}
            style={{ fontSize: `${titleLayout.fontSize.toFixed(2)}px` }}
            title={patternName}
          >
            {patternName}
          </span>
        </div>

        {/* 6. 直放兩排播放列（48px + 44px） */}
        <footer
          className="transport-bar is-portrait"
          style={{ height: `${barHeight}px` }}
        >
          <div className="transport-portrait-row1">{primaryButtons}</div>
          <div className="transport-portrait-row2">{secondaryControls}</div>
        </footer>
      </>
    );
  }

  return (
    <footer
      className={`transport-bar ${isTablet ? 'is-tablet' : ''}`}
      style={{ height: `${barHeight}px` }}
    >
      <div className="transport-left">{primaryButtons}</div>

      <div className="transport-center" ref={centerRef}>
        <span
          className={`transport-pattern-title ${titleLayout.ellipsis ? 'is-ellipsis' : ''}`}
          style={{ fontSize: `${titleLayout.fontSize.toFixed(2)}px` }}
          title={patternName}
        >
          {patternName}
        </span>
      </div>

      <div className="transport-right">{secondaryControls}</div>
    </footer>
  );
}
