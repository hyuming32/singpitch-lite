import type { PracticeModeOption } from '../../state/settings';

export interface ModeToggleButtonProps {
  mode: PracticeModeOption;
  isCompact?: boolean;
  onToggle: (nextMode: PracticeModeOption) => void;
}

/** 取得切換後的下一個練習模式 */
export function nextPracticeMode(
  current: PracticeModeOption,
): PracticeModeOption {
  return current === 'follow' ? 'listen-then-sing' : 'follow';
}

/** 練唱頁標題列的練習模式切換藥丸按鈕（「跟唱」／「先聽再唱」） */
export function ModeToggleButton({
  mode,
  isCompact = false,
  onToggle,
}: ModeToggleButtonProps) {
  const isListenThenSing = mode === 'listen-then-sing';
  const label = isListenThenSing ? '先聽再唱' : '跟唱';
  const hint = `練習模式：${label}，按一下切換`;

  return (
    <button
      type="button"
      className={`practice-pill-btn practice-mode-btn ${isListenThenSing ? 'is-listen-then-sing' : 'is-follow'} ${isCompact ? 'is-compact' : ''}`}
      aria-label={hint}
      title={hint}
      aria-pressed={isListenThenSing}
      onClick={() => onToggle(nextPracticeMode(mode))}
    >
      {label}
    </button>
  );
}
