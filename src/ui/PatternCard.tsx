import { useMemo } from 'react';
import type { PatternDef } from '../core/patterns';
import type { PatternFitResult } from '../state/vocalRange';
import { JianpuLine } from './JianpuLine';
import { MiniStaff } from './MiniStaff';
import { buildJianpuTokens } from './miniStaffData';

interface PatternCardProps {
  pattern: PatternDef;
  selected: boolean;
  fit: PatternFitResult;
  onSelect: (patternId: string) => void;
}

/** 音階練習圖案卡片（顯示固定調簡譜、迷你五線譜、可練調數標籤與和弦標記） */
export function PatternCard({
  pattern,
  selected,
  fit,
  onSelect,
}: PatternCardProps) {
  const tokens = useMemo(() => buildJianpuTokens(pattern, 60), [pattern]);
  const badgeText = fit.fits ? `${fit.keys} 個調` : '超出音域';

  return (
    <button
      type="button"
      className={`pattern-card ${selected ? 'is-selected' : ''} ${!fit.fits ? 'is-out-of-range' : ''}`}
      onClick={() => onSelect(pattern.id)}
      aria-pressed={selected}
    >
      <div className="pattern-card-top">
        <span className="pattern-card-name">{pattern.name}</span>
        <span className="pattern-card-top-right">
          <span className="pattern-card-chord">和弦 {pattern.chords}</span>
          <span className={`pattern-fit-badge ${fit.fits ? '' : 'is-out'}`}>
            {badgeText}
          </span>
        </span>
      </div>
      <div className="pattern-card-jianpu-row">
        <div className="pattern-card-jianpu">
          <JianpuLine tokens={tokens} />
        </div>
        <span
          className={`pattern-fit-badge pattern-fit-badge-desktop ${fit.fits ? '' : 'is-out'}`}
        >
          {badgeText}
        </span>
      </div>
      <div className="pattern-card-staff">
        <MiniStaff pattern={pattern} />
      </div>
      <div className="pattern-card-bottom">
        <span className="pattern-card-name">{pattern.name}</span>
        <span className="pattern-card-chord">和弦 {pattern.chords}</span>
      </div>
    </button>
  );
}
