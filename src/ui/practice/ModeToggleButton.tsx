import type { PracticeModeOption } from '../../state/settings';

export interface ModeToggleButtonProps {
  mode: PracticeModeOption;
  isCompact?: boolean;
  /** 是否允許切換至影子模式（MIDI 練唱為 false），預設 true */
  allowShadow?: boolean;
  onToggle: (nextMode: PracticeModeOption) => void;
}

/** 取得切換後的下一個練習模式 */
export function nextPracticeMode(
  current: PracticeModeOption,
  allowShadow = true,
): PracticeModeOption {
  if (current === 'follow') return 'listen-then-sing';
  if (current === 'listen-then-sing') return allowShadow ? 'shadow' : 'follow';
  return 'follow';
}

/** 練唱頁標題列的練習模式切換藥丸按鈕（「跟唱」／「先聽再唱」／「影子」） */
export function ModeToggleButton({
  mode,
  isCompact = false,
  allowShadow = true,
  onToggle,
}: ModeToggleButtonProps) {
  const effectiveMode: PracticeModeOption =
    !allowShadow && mode === 'shadow' ? 'follow' : mode;
  const label =
    effectiveMode === 'listen-then-sing'
      ? '先聽再唱'
      : effectiveMode === 'shadow'
        ? '影子'
        : '跟唱';
  const stateClass =
    effectiveMode === 'listen-then-sing'
      ? 'is-listen-then-sing'
      : effectiveMode === 'shadow'
        ? 'is-shadow'
        : 'is-follow';
  const hint = `練習模式：${label}，按一下切換`;

  return (
    <button
      type="button"
      className={`practice-pill-btn practice-mode-btn ${stateClass} ${isCompact ? 'is-compact' : ''}`}
      aria-label={hint}
      title={hint}
      aria-pressed={effectiveMode !== 'follow'}
      onClick={() => onToggle(nextPracticeMode(effectiveMode, allowShadow))}
    >
      {label}
    </button>
  );
}
