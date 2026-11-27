import { useMemo } from 'react';
import type { ChordEvent } from '../../core/exercise';
import type { Key } from '../../core/key';
import {
  keySignaturePositions,
  sungStaffPosition,
  type Clef,
} from '../../core/staff';
import { accidentalGlyph, Glyph, glyphScale } from '../Glyph';
import { fClef, gClef } from '../musicGlyphs';
import {
  staffHeaderLayout,
  timeToX,
  type NoteGlyph,
  type PassWindow,
  type StaffVerticalMetrics,
} from './layout';

export interface SungPoint {
  t: number;
  /** 浮點 MIDI 音高，NaN 代表斷線 */
  midi: number;
}

interface StaffViewProps {
  width: number;
  height: number;
  clef: Clef;
  activeKey: Key;
  window: PassWindow | null;
  glyphs: NoteGlyph[];
  activeIndex: number;
  chords: ChordEvent[];
  leftPad: number;
  rightPad?: number;
  metrics: StaffVerticalMetrics;
  sung: SungPoint[];
  /** 沒播放時的即時演唱黃線（開麥克風就顯示）；畫法與 sung 相同，稍淡 */
  liveSung?: SungPoint[];
  countIn: { active: boolean; dots: boolean[] };
  isTablet: boolean;
}

const STAFF_LINES = [0, 2, 4, 6, 8];

/** 五線譜 SVG：含 Bravura SMuFL 譜號、調號、和弦標記、音符、滑音斜線、演唱黃線與預備拍倒數 */
export function StaffView({
  width,
  height,
  clef,
  activeKey,
  window: win,
  glyphs,
  activeIndex,
  chords,
  leftPad,
  rightPad = 18,
  metrics,
  sung,
  liveSung,
  countIn,
  isTablet,
}: StaffViewProps) {
  const safeWidth = Math.max(120, width);
  const safeHeight = Math.max(40, height);
  const rightEdge = Math.max(leftPad + 1, safeWidth - rightPad);

  const { stepY, lineSpacing, baseY, chordY } = metrics;
  const yForPos = (pos: number) => baseY - pos * stepY;

  const { clefX, keySigStart, keySigStep } = useMemo(
    () => staffHeaderLayout(lineSpacing, clef),
    [lineSpacing, clef],
  );

  const keySig = useMemo(
    () => keySignaturePositions(activeKey, clef),
    [activeKey, clef],
  );

  const visibleChords = useMemo(() => {
    if (!win) return [];
    return chords.filter(
      (c) =>
        c.role === 'pad' &&
        c.keyIndex === win.keyIndex &&
        c.start >= win.start - 0.001 &&
        c.start < win.end - 0.001,
    );
  }, [chords, win]);

  // 演唱黃線 SVG path（遇到 NaN 斷開成新段落）
  const buildSungPath = (points: SungPoint[] | undefined): string => {
    if (!win || !points || points.length === 0) return '';
    const segments: string[] = [];
    let drawing = false;

    for (const pt of points) {
      if (!Number.isFinite(pt.midi)) {
        drawing = false;
        continue;
      }
      if (pt.t < win.start || pt.t > win.end) {
        drawing = false;
        continue;
      }
      const x = timeToX(pt.t, win.start, win.end, leftPad, rightEdge);
      const pos = sungStaffPosition(pt.midi, activeKey, clef);
      const y = yForPos(pos);
      segments.push(
        `${drawing ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`,
      );
      drawing = true;
    }

    return segments.join(' ');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sungPath = useMemo(() => buildSungPath(sung), [win, sung, leftPad, rightEdge, activeKey, clef, baseY, stepY]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveSungPath = useMemo(() => buildSungPath(liveSung), [win, liveSung, leftPad, rightEdge, activeKey, clef, baseY, stepY]);

  // 音符幾何比例（依線距計算）
  const rx = 0.65 * lineSpacing; // 寬約 1.3 × 線距
  const ry = 0.45 * lineSpacing; // 高約 0.9 × 線距
  const stemLen = 3.5 * lineSpacing;
  const stemStroke = Math.max(1.2, 0.12 * lineSpacing);
  const ledgerHalf = 1.3 * lineSpacing; // 加線總長約 2 倍符頭寬

  return (
    <svg
      className="staff-svg"
      width={safeWidth}
      height={safeHeight}
      viewBox={`0 0 ${safeWidth} ${safeHeight}`}
      aria-label="五線譜"
    >
      {/* 五線譜線 */}
      {STAFF_LINES.map((pos) => {
        const y = yForPos(pos);
        return (
          <line
            key={pos}
            x1={8}
            y1={y}
            x2={safeWidth - 10}
            y2={y}
            stroke="#b5b1a6"
            strokeWidth={1}
          />
        );
      })}

      {/* 譜號（Bravura SMuFL 字形：高音對齊第二線 G4、低音對齊第四線 F3） */}
      {clef === 'treble' ? (
        <Glyph
          glyph={gClef}
          x={clefX}
          y={yForPos(2)}
          sp={lineSpacing}
          fill="#2c2c2a"
          aria-hidden="true"
        />
      ) : (
        <Glyph
          glyph={fClef}
          x={clefX}
          y={yForPos(6)}
          sp={lineSpacing}
          fill="#2c2c2a"
          aria-hidden="true"
        />
      )}

      {/* 調號：自譜號右邊依序往右排開 */}
      {keySig.map((ks, idx) => {
        const g = accidentalGlyph(ks.accidental);
        if (!g) return null;
        return (
          <Glyph
            key={`ks-${idx}`}
            glyph={g}
            x={keySigStart + idx * keySigStep}
            y={yForPos(ks.position)}
            sp={lineSpacing}
            fill="#2c2c2a"
            aria-hidden="true"
          />
        );
      })}

      {/* 和弦標記：置於 SVG 內第五線上方空間 */}
      {win &&
        visibleChords.map((c, idx) => {
          const cx = timeToX(c.start, win.start, win.end, leftPad, rightEdge);
          return (
            <text
              key={`chord-${idx}`}
              x={cx}
              y={chordY}
              fontSize={isTablet ? 13 : 10}
              fontWeight="700"
              fill="#854f0b"
            >
              {c.name} {c.roman}
            </text>
          );
        })}

      {/* 預備拍倒數（僅預備拍期間顯示於左上角） */}
      {countIn.active && (
        <g transform={`translate(${leftPad}, ${chordY})`}>
          <text
            x={0}
            y={0}
            fontSize={isTablet ? 13 : 10}
            fontWeight="700"
            fill="#185fa5"
          >
            倒數
          </text>
          {countIn.dots.map((passed, di) => (
            <circle
              key={`dot-${di}`}
              cx={(isTablet ? 36 : 28) + di * (isTablet ? 14 : 10)}
              cy={isTablet ? -4 : -3}
              r={isTablet ? 4.5 : 3.2}
              fill={passed ? '#97c459' : '#c8c4b8'}
            />
          ))}
        </g>
      )}

      {/* 滑音斜線 */}
      {glyphs.map((g, idx) => {
        if (g.endPosition === undefined) return null;
        const next = glyphs[idx + 1];
        const x2 = next ? next.x - rx - 2 : g.x + 2.5 * lineSpacing;
        return (
          <line
            key={`glide-${idx}`}
            x1={g.x + rx + 2}
            y1={yForPos(g.position)}
            x2={x2}
            y2={yForPos(g.endPosition)}
            stroke="#5f5e5a"
            strokeWidth={Math.max(1.4, 0.14 * lineSpacing)}
            strokeLinecap="round"
          />
        );
      })}

      {/* 音符、加線、臨時記號與符桿 */}
      {glyphs.map((g, idx) => {
        const cy = yForPos(g.position);
        const isCurrent = idx === activeIndex;
        const color = isCurrent ? '#185fa5' : '#2c2c2a';
        const stemX = g.stemUp ? g.x + rx - stemStroke * 0.5 : g.x - rx + stemStroke * 0.5;
        const stemY2 = g.stemUp ? cy - stemLen : cy + stemLen;

        return (
          <g key={`note-${idx}`}>
            {g.ledgerLines.map((lp) => {
              const ly = yForPos(lp);
              return (
                <line
                  key={`ledger-${idx}-${lp}`}
                  x1={g.x - ledgerHalf}
                  y1={ly}
                  x2={g.x + ledgerHalf}
                  y2={ly}
                  stroke="#5f5e5a"
                  strokeWidth={Math.max(1, 0.1 * lineSpacing)}
                />
              );
            })}
            {(() => {
              const accG = g.accidental ? accidentalGlyph(g.accidental) : null;
              if (!accG) return null;
              const s = glyphScale(lineSpacing, accG.unitsPerEm);
              const accW = (accG.bbox.x2 - accG.bbox.x1) * s;
              const accX = g.x - rx - 0.25 * lineSpacing - accW - accG.bbox.x1 * s;
              return (
                <Glyph
                  glyph={accG}
                  x={accX}
                  y={cy}
                  sp={lineSpacing}
                  fill={color}
                  aria-hidden="true"
                />
              );
            })()}
            <line
              x1={stemX}
              y1={cy}
              x2={stemX}
              y2={stemY2}
              stroke={color}
              strokeWidth={stemStroke}
            />
            <ellipse
              cx={g.x}
              cy={cy}
              rx={rx}
              ry={ry}
              transform={`rotate(-20 ${g.x} ${cy})`}
              fill={color}
            />
          </g>
        );
      })}

      {/* 演唱黃線 */}
      {sungPath && (
        <path
          d={sungPath}
          stroke="#e8b400"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}

      {/* 即時演唱黃線（沒播放時） */}
      {liveSungPath && (
        <path
          className="staff-live-sung"
          d={liveSungPath}
          stroke="#e8b400"
          strokeOpacity={0.85}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
}
