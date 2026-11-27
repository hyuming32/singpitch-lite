import { useMemo } from 'react';
import type { PatternDef } from '../core/patterns';
import { accidentalGlyph, Glyph, glyphScale, glyphScreenBBox } from './Glyph';
import { buildMiniStaffNotes } from './miniStaffData';
import { gClef } from './musicGlyphs';

interface MiniStaffProps {
  pattern: Pick<PatternDef, 'jianpu' | 'glide'>;
}

const SVG_WIDTH = 220;
const SVG_HEIGHT = 64;
// position 0 為最下線 E4，position 8 為最上線 F5，每半格 3.5 px（線距 7 px）
const HALF_STEP_Y = 3.5;
const LINE_SPACING = HALF_STEP_Y * 2;
const BASE_Y = 46; // position 0 的 y 座標
const CLEF_X = 11;

function yForPosition(position: number): number {
  return BASE_Y - position * HALF_STEP_Y;
}

/** 迷你五線譜 SVG（C 大調、高音譜號、黑色音符、加線、升降記號與滑音斜線） */
export function MiniStaff({ pattern }: MiniStaffProps) {
  const notes = useMemo(
    () =>
      buildMiniStaffNotes(pattern, {
        width: SVG_WIDTH,
        leftPad: 44,
        rightPad: 14,
        tonicMidi: 60,
      }),
    [pattern],
  );

  // 依最高與最低音微調垂直置中，避免極高/低音被裁切
  const { minPos, maxPos } = useMemo(() => {
    if (notes.length === 0) {
      return { minPos: 0, maxPos: 8 };
    }
    let min = 0;
    let max = 8;
    for (const n of notes) {
      if (n.position < min) min = n.position;
      if (n.position > max) max = n.position;
    }
    return { minPos: min, maxPos: max };
  }, [notes]);

  const clefY = yForPosition(2); // 第二線 G4
  const clefBBox = glyphScreenBBox(gClef, CLEF_X, clefY, LINE_SPACING);

  const viewTop = Math.min(0, yForPosition(maxPos) - 10, clefBBox.top - 4);
  const viewBottom = Math.max(
    SVG_HEIGHT,
    yForPosition(minPos) + 10,
    clefBBox.bottom + 4,
  );
  const viewHeight = viewBottom - viewTop;

  const staffLines = [0, 2, 4, 6, 8];

  return (
    <svg
      className="mini-staff-svg"
      viewBox={`0 ${viewTop} ${SVG_WIDTH} ${viewHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect
        x={0}
        y={viewTop}
        width={SVG_WIDTH}
        height={viewHeight}
        rx={6}
        fill="#e8edf5"
      />

      {/* 五線譜線 */}
      {staffLines.map((pos) => {
        const y = yForPosition(pos);
        return (
          <line
            key={pos}
            x1={8}
            y1={y}
            x2={SVG_WIDTH - 8}
            y2={y}
            stroke="#8a96a8"
            strokeWidth={1}
          />
        );
      })}

      {/* 高音譜號（Bravura SMuFL 字形，原點對齊第二線 G4） */}
      <Glyph
        glyph={gClef}
        x={CLEF_X}
        y={clefY}
        sp={LINE_SPACING}
        fill="#171b24"
        aria-hidden="true"
      />

      {/* 滑音斜線 */}
      {notes.map((n, idx) => {
        if (!n.glideToNext || idx >= notes.length - 1) {
          return null;
        }
        const next = notes[idx + 1]!;
        return (
          <line
            key={`glide-${idx}`}
            x1={n.x + 4}
            y1={yForPosition(n.position)}
            x2={next.x - 4}
            y2={yForPosition(next.position)}
            stroke="#171b24"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        );
      })}

      {/* 音符、加線與臨時升降記號 */}
      {notes.map((n, idx) => {
        const cy = yForPosition(n.position);
        return (
          <g key={`note-${idx}`}>
            {n.ledgerLines.map((lp) => {
              const ly = yForPosition(lp);
              return (
                <line
                  key={`ledger-${idx}-${lp}`}
                  x1={n.x - 7}
                  y1={ly}
                  x2={n.x + 7}
                  y2={ly}
                  stroke="#171b24"
                  strokeWidth={1.1}
                />
              );
            })}
            {(() => {
              const accG = n.accidental ? accidentalGlyph(n.accidental) : null;
              if (!accG) return null;
              const s = glyphScale(LINE_SPACING, accG.unitsPerEm);
              const accW = (accG.bbox.x2 - accG.bbox.x1) * s;
              const accX = n.x - 4.2 - 2 - accW - accG.bbox.x1 * s;
              return (
                <Glyph
                  glyph={accG}
                  x={accX}
                  y={cy}
                  sp={LINE_SPACING}
                  fill="#171b24"
                  aria-hidden="true"
                />
              );
            })()}
            <ellipse
              cx={n.x}
              cy={cy}
              rx={4.2}
              ry={3.1}
              transform={`rotate(-18 ${n.x} ${cy})`}
              fill="#171b24"
            />
          </g>
        );
      })}
    </svg>
  );
}
