interface CentsBarProps {
  cents: number | null;
  isTablet: boolean;
}

/** 音準偏離色條（−50 至 +50 cents）與即時指針 */
export function CentsBar({ cents, isTablet }: CentsBarProps) {
  const showPointer = cents !== null && Number.isFinite(cents);
  const clamped = showPointer ? Math.max(-50, Math.min(50, cents)) : 0;
  const pointerPercent = ((clamped + 50) / 100) * 100;

  return (
    <div
      className={`cents-bar ${isTablet ? 'is-tablet' : ''}`}
      aria-label="音準偏差條"
    >
      <div className="cents-track-wrap">
        <div className="cents-track">
          <span className="cents-seg cents-seg-red" style={{ width: '20%' }} />
          <span className="cents-seg cents-seg-orange" style={{ width: '15%' }} />
          <span className="cents-seg cents-seg-green" style={{ width: '30%' }} />
          <span className="cents-seg cents-seg-orange" style={{ width: '15%' }} />
          <span className="cents-seg cents-seg-red" style={{ width: '20%' }} />
        </div>
        {showPointer && (
          <div
            className="cents-pointer"
            style={{ left: `${pointerPercent}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="cents-labels">
        <span>−50 偏低</span>
        <span>0 目標</span>
        <span>偏高 +50</span>
      </div>
    </div>
  );
}
