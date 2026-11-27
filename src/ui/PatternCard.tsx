import { useMemo } from 'react';
import type { PatternDef } from '../core/patterns';
import { JianpuLine } from './JianpuLine';
import { MiniStaff } from './MiniStaff';
import { buildJianpuTokens } from './miniStaffData';

interface PatternCardProps {
  pattern: PatternDef;
  selected: boolean;
  onSelect: (patternId: string) => void;
}

/** 音階練習圖案卡片（顯示固定調簡譜、迷你五線譜與和弦標記） */
export function PatternCard({ pattern, selected, onSelect }: PatternCardProps) {
  const tokens = useMemo(() => buildJianpuTokens(pattern, 60), [pattern]);

  return (
    <button
      type="button"
      className={`pattern-card ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect(pattern.id)}
      aria-pressed={selected}
    >
      <div className="pattern-card-top">
        <span className="pattern-card-name">{pattern.name}</span>
        <span className="pattern-card-chord">和弦 {pattern.chords}</span>
      </div>
      <div className="pattern-card-jianpu">
        <JianpuLine tokens={tokens} />
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
