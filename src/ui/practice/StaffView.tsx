import { useMemo } from 'react';
import type { ShadowNoteResult } from '../../core/analysis';
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
import {
  midiLineTimeToX,
  type MidiLineRenderData,
} from './midiLayout';

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
  /** 沒播放時的即時演唱音高線（開麥克風就顯示）；畫法與 sung 相同，稍淡 */
  liveSung?: SungPoint[];
  /** 演唱音高線顏色（預設 #e8b400） */
  pitchColor?: string;
  countIn: { active: boolean; dots: boolean[] };
  /** 影子模式各音符對應的即時音準標記（僅空拍結束後有值） */
  shadowResults?: readonly (ShadowNoteResult | null)[];
  isTablet: boolean;
  /** MIDI 樂譜專屬繪製資料（含小節線、拍號、拍點刻度、符槓與小節號） */
  midiData?: MidiLineRenderData;
  /** 目前播放秒數（供拍點高亮使用） */
  sec?: number;
  /** 若選了含前奏的區間且第一音距開頭 > 1 小節，顯示「再 N 小節開唱」 */
  introCountdownBars?: number | null;
  /** 是否為目前正在播放的那一行 */
  isCurrentLine?: boolean;
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
  pitchColor = '#e8b400',
  countIn,
  shadowResults,
  isTablet,
  midiData,
  sec,
  introCountdownBars,
  isCurrentLine = true,
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
      const x = midiData
        ? midiLineTimeToX(pt.t, midiData.segments, leftPad, rightEdge)
        : timeToX(pt.t, win.start, win.end, leftPad, rightEdge);
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
  const sungPath = useMemo(() => buildSungPath(sung), [win, sung, leftPad, rightEdge, activeKey, clef, baseY, stepY, midiData]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveSungPath = useMemo(() => buildSungPath(liveSung), [win, liveSung, leftPad, rightEdge, activeKey, clef, baseY, stepY, midiData]);

  // 音符幾何比例（依線距計算）
  const rx = 0.65 * lineSpacing; // 寬約 1.3 × 線距
  const ry = 0.45 * lineSpacing; // 高約 0.9 × 線距
  const stemLen = 3.5 * lineSpacing;
  const stemStroke = Math.max(1.2, 0.12 * lineSpacing);
  const ledgerHalf = 1.3 * lineSpacing; // 加線總長約 2 倍符頭寬

  const activeBeatIdx = useMemo(() => {
    if (!midiData || !isCurrentLine || sec === undefined || !win) return -1;
    if (sec < win.start - 0.001 || sec > win.end + 0.001) return -1;
    const ticks = midiData.beatTicks;
    for (let i = ticks.length - 1; i >= 0; i--) {
      if (sec >= ticks[i]!.t - 0.001) {
        return i;
      }
    }
    return -1;
  }, [midiData, isCurrentLine, sec, win]);

  const beamYByGroup = useMemo(() => {
    if (!midiData) return new Map<number, number>();
    const map = new Map<number, number>();
    midiData.beamGroups.forEach((bg, idx) => {
      const extY = yForPos(bg.extremePosition);
      map.set(idx, bg.stemUp ? extY - stemLen : extY + stemLen);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midiData, baseY, stepY, stemLen]);

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

      {/* MIDI 拍號（行首或變拍號處） */}
      {midiData?.timeSigs.map((ts, idx) => (
        <g key={`ts-${idx}`} className="staff-time-sig" aria-label={`${ts.numerator}/${ts.denominator} 拍`}>
          <text
            x={ts.x}
            y={yForPos(6)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.max(10, 1.85 * lineSpacing)}
            fontWeight="700"
            fill="#2c2c2a"
          >
            {ts.numerator}
          </text>
          <text
            x={ts.x}
            y={yForPos(2)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.max(10, 1.85 * lineSpacing)}
            fontWeight="700"
            fill="#2c2c2a"
          >
            {ts.denominator}
          </text>
        </g>
      ))}

      {/* MIDI 小節線與小節號 */}
      {midiData && (
        <text
          className="staff-bar-number"
          x={leftPad}
          y={chordY}
          fontSize={isTablet ? 12 : 10}
          fontWeight="700"
          fill="#2c2c2a"
        >
          {midiData.lineBarNumber}
        </text>
      )}
      {midiData?.barlines.map((bl, idx) =>
        bl.isFinal ? (
          <g key={`bl-${idx}`} className="staff-barline is-final">
            <line
              x1={bl.x - 4}
              y1={yForPos(8)}
              x2={bl.x - 4}
              y2={yForPos(0)}
              stroke="#2c2c2a"
              strokeWidth={1.2}
            />
            <line
              x1={bl.x}
              y1={yForPos(8)}
              x2={bl.x}
              y2={yForPos(0)}
              stroke="#2c2c2a"
              strokeWidth={2.6}
            />
          </g>
        ) : (
          <g key={`bl-${idx}`} className="staff-barline">
            <line
              x1={bl.x}
              y1={yForPos(8)}
              x2={bl.x}
              y2={yForPos(0)}
              stroke="#2c2c2a"
              strokeWidth={1.6}
            />
            {bl.isStart && (
              <text
                className="staff-bar-number"
                x={bl.x + 4}
                y={chordY}
                fontSize={isTablet ? 11 : 9.5}
                fontWeight="600"
                fill="#5f5e5a"
              >
                {bl.barNumber}
              </text>
            )}
          </g>
        ),
      )}

      {/* MIDI 五線譜下方拍點小刻度（強拍較長；播放時所在拍亮起） */}
      {midiData?.beatTicks.map((bt, idx) => {
        const isActiveBeat = idx === activeBeatIdx;
        const tickBottom = safeHeight - 1;
        const tickLen = isActiveBeat
          ? isTablet ? 12 : 8
          : bt.isDownbeat
            ? isTablet ? 9 : 6.5
            : isTablet ? 5.5 : 4;
        const tickTop = tickBottom - tickLen;
        return (
          <g
            key={`beat-tick-${idx}`}
            className={`staff-beat-tick ${bt.isDownbeat ? 'is-downbeat' : ''} ${isActiveBeat ? 'is-active' : ''}`}
          >
            <line
              x1={bt.x}
              y1={tickTop}
              x2={bt.x}
              y2={tickBottom}
              stroke={isActiveBeat ? '#185fa5' : bt.isDownbeat ? '#5f5e5a' : '#a8a498'}
              strokeWidth={isActiveBeat ? 3 : bt.isDownbeat ? 1.8 : 1.1}
            />
            {isActiveBeat && (
              <circle
                cx={bt.x}
                cy={tickTop - 2}
                r={isTablet ? 3 : 2.2}
                fill="#185fa5"
              />
            )}
          </g>
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
        <g transform={`translate(${midiData ? leftPad + 28 : leftPad}, ${chordY})`}>
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

      {/* MIDI 含前奏區間時的前奏剩餘小節倒數 */}
      {!countIn.active && introCountdownBars != null && introCountdownBars >= 1 && (
        <text
          className="staff-intro-countdown"
          x={leftPad + 28}
          y={chordY}
          fontSize={isTablet ? 13 : 10.5}
          fontWeight="700"
          fill="#854f0b"
        >
          再 {introCountdownBars} 小節開唱
        </text>
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

      {/* MIDI 同拍 8/16 分音符符槓（beam） */}
      {midiData?.beamGroups.map((bg, groupIdx) => {
        const beamY = beamYByGroup.get(groupIdx);
        if (beamY === undefined || bg.notes.length < 2) return null;
        const firstNote = bg.notes[0]!;
        const lastNote = bg.notes[bg.notes.length - 1]!;
        const stemOffset = bg.stemUp ? rx - stemStroke * 0.5 : -rx + stemStroke * 0.5;
        const x1 = firstNote.x + stemOffset;
        const x2 = lastNote.x + stemOffset;
        const beamThick = Math.max(2.2, 0.34 * lineSpacing);
        const dir = bg.stemUp ? 1 : -1;
        const secY = beamY + dir * 0.68 * lineSpacing;
        const stubLen = 0.85 * lineSpacing;

        // 計算 16 分音符第二條符槓（連續 16 分相連，單獨 16 分畫短槓）
        const secSegments: Array<{ x1: number; x2: number }> = [];
        let ni = 0;
        while (ni < bg.notes.length) {
          if (bg.notes[ni]!.durationType !== 'sixteenth') {
            ni++;
            continue;
          }
          let nj = ni;
          while (
            nj + 1 < bg.notes.length &&
            bg.notes[nj + 1]!.durationType === 'sixteenth'
          ) {
            nj++;
          }
          if (nj > ni) {
            secSegments.push({
              x1: bg.notes[ni]!.x + stemOffset,
              x2: bg.notes[nj]!.x + stemOffset,
            });
          } else {
            const sx = bg.notes[ni]!.x + stemOffset;
            const pointRight = ni === 0;
            secSegments.push({
              x1: pointRight ? sx : sx - stubLen,
              x2: pointRight ? sx + stubLen : sx,
            });
          }
          ni = nj + 1;
        }

        return (
          <g key={`beam-grp-${groupIdx}`} className="staff-beam-group">
            <line
              x1={x1}
              y1={beamY}
              x2={x2}
              y2={beamY}
              stroke="#2c2c2a"
              strokeWidth={beamThick}
              strokeLinecap="butt"
            />
            {secSegments.map((seg, si) => (
              <line
                key={`beam2-${si}`}
                x1={seg.x1}
                y1={secY}
                x2={seg.x2}
                y2={secY}
                stroke="#2c2c2a"
                strokeWidth={Math.max(1.8, 0.3 * lineSpacing)}
                strokeLinecap="butt"
              />
            ))}
          </g>
        );
      })}

      {/* 音符、休止符、加線、臨時記號、符桿、符尾、連結線與影子空拍標記 */}
      {glyphs.map((g, idx) => {
        if (g.isRest) {
          const restColor = '#5f5e5a';
          const sp = lineSpacing;
          const restType = g.durationType ?? 'quarter';
          return (
            <g key={`rest-${idx}`} className="staff-rest">
              {restType === 'whole' && (
                <rect
                  x={g.x - 0.55 * sp}
                  y={yForPos(6)}
                  width={1.1 * sp}
                  height={0.46 * sp}
                  fill={restColor}
                />
              )}
              {restType === 'half' && (
                <rect
                  x={g.x - 0.55 * sp}
                  y={yForPos(5)}
                  width={1.1 * sp}
                  height={0.46 * sp}
                  fill={restColor}
                />
              )}
              {restType === 'quarter' && (
                <path
                  d={`M${g.x - 0.28 * sp},${yForPos(6.6)} L${g.x + 0.32 * sp},${yForPos(5.2)} L${g.x - 0.25 * sp},${yForPos(3.8)} L${g.x + 0.28 * sp},${yForPos(2.6)} Q${g.x - 0.2 * sp},${yForPos(2.3)} ${g.x - 0.12 * sp},${yForPos(1.5)}`}
                  fill="none"
                  stroke={restColor}
                  strokeWidth={Math.max(1.6, 0.22 * sp)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {(restType === 'eighth' || restType === 'sixteenth') && (
                <g>
                  <line
                    x1={g.x + 0.25 * sp}
                    y1={yForPos(5.6)}
                    x2={g.x - 0.22 * sp}
                    y2={yForPos(2.0)}
                    stroke={restColor}
                    strokeWidth={Math.max(1.4, 0.16 * sp)}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={g.x - 0.05 * sp}
                    cy={yForPos(5.3)}
                    r={0.22 * sp}
                    fill={restColor}
                  />
                  <path
                    d={`M${g.x - 0.05 * sp},${yForPos(5.3)} Q${g.x + 0.2 * sp},${yForPos(4.7)} ${g.x + 0.25 * sp},${yForPos(5.6)}`}
                    fill="none"
                    stroke={restColor}
                    strokeWidth={Math.max(1.2, 0.14 * sp)}
                  />
                  {restType === 'sixteenth' && (
                    <>
                      <circle
                        cx={g.x - 0.22 * sp}
                        cy={yForPos(3.6)}
                        r={0.22 * sp}
                        fill={restColor}
                      />
                      <path
                        d={`M${g.x - 0.22 * sp},${yForPos(3.6)} Q${g.x + 0.04 * sp},${yForPos(3.0)} ${g.x + 0.09 * sp},${yForPos(3.9)}`}
                        fill="none"
                        stroke={restColor}
                        strokeWidth={Math.max(1.2, 0.14 * sp)}
                      />
                    </>
                  )}
                </g>
              )}
              {g.dotted && (
                <circle
                  cx={g.x + 0.78 * sp}
                  cy={yForPos(5)}
                  r={Math.max(1.4, 0.16 * sp)}
                  fill={restColor}
                />
              )}
            </g>
          );
        }

        const cy = yForPos(g.position);
        const isCurrent = idx === activeIndex;
        const isSilent = Boolean(g.silent);
        const color = isCurrent ? '#185fa5' : isSilent ? '#5f5e5a' : '#2c2c2a';
        const stemX = g.stemUp ? g.x + rx - stemStroke * 0.5 : g.x - rx + stemStroke * 0.5;
        const beamedY2 =
          g.beamed && g.beamGroupId !== undefined
            ? beamYByGroup.get(g.beamGroupId)
            : undefined;
        const stemY2 = beamedY2 ?? (g.stemUp ? cy - stemLen : cy + stemLen);
        const isWhole = g.durationType === 'whole';
        const isHollow = isSilent || isWhole || g.durationType === 'half';
        const shadowRes = isSilent ? shadowResults?.[idx] ?? null : null;
        const noteTopY = g.stemUp ? stemY2 : cy - ry;
        const badgeY = Math.max(
          chordY + (isTablet ? 14 : 11),
          noteTopY - (isTablet ? 9 : 7),
        );
        const badgeColor =
          shadowRes?.status === 'ok'
            ? '#15803d'
            : shadowRes?.status === 'high' || shadowRes?.status === 'low'
              ? '#dc2626'
              : '#6b7280';

        const showFlag =
          !g.beamed &&
          (g.durationType === 'eighth' || g.durationType === 'sixteenth');
        const flagDir = g.stemUp ? 1 : -1;
        const flagW = 0.85 * lineSpacing;
        const flagH = 1.45 * lineSpacing;

        // 連結線（tie）計算
        const nextGlyph = glyphs[idx + 1];
        const tieYOffset = g.stemUp ? ry + 0.3 * lineSpacing : -ry - 0.3 * lineSpacing;
        const tieCtrlOffset = g.stemUp ? 0.8 * lineSpacing : -0.8 * lineSpacing;

        return (
          <g key={`note-${idx}`} className={isSilent ? 'staff-note-shadow-gap' : undefined}>
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
            {!isWhole && (
              <line
                x1={stemX}
                y1={cy}
                x2={stemX}
                y2={stemY2}
                stroke={color}
                strokeWidth={stemStroke}
                strokeOpacity={isSilent ? 0.78 : 1}
              />
            )}
            {showFlag && (
              <g className="staff-flag">
                <path
                  d={`M${stemX},${stemY2} Q${stemX + flagW},${stemY2 + flagDir * flagH * 0.55} ${stemX + flagW * 0.6},${stemY2 + flagDir * flagH}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.max(1.6, 0.2 * lineSpacing)}
                  strokeLinecap="round"
                />
                {g.durationType === 'sixteenth' && (
                  <path
                    d={`M${stemX},${stemY2 + flagDir * 0.65 * lineSpacing} Q${stemX + flagW},${stemY2 + flagDir * (0.65 * lineSpacing + flagH * 0.55)} ${stemX + flagW * 0.6},${stemY2 + flagDir * (0.65 * lineSpacing + flagH)}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={Math.max(1.6, 0.2 * lineSpacing)}
                    strokeLinecap="round"
                  />
                )}
              </g>
            )}
            <ellipse
              cx={g.x}
              cy={cy}
              rx={isWhole ? rx * 1.08 : rx}
              ry={ry}
              transform={isWhole ? undefined : `rotate(-20 ${g.x} ${cy})`}
              fill={
                isHollow
                  ? isSilent && isCurrent
                    ? 'rgba(24, 95, 165, 0.12)'
                    : '#faf8f2'
                  : color
              }
              stroke={isHollow ? color : undefined}
              strokeWidth={
                isHollow ? Math.max(1.5, 0.18 * lineSpacing) : undefined
              }
            />
            {g.dotted && (
              <circle
                cx={g.x + rx + 0.36 * lineSpacing}
                cy={yForPos(g.position % 2 === 0 ? g.position + 1 : g.position)}
                r={Math.max(1.5, 0.17 * lineSpacing)}
                fill={color}
              />
            )}
            {g.tieToNext && (
              <path
                className="staff-tie"
                d={(() => {
                  const x1 = g.x + rx * 0.45;
                  const x2 =
                    nextGlyph && !nextGlyph.isRest
                      ? nextGlyph.x - rx * 0.45
                      : Math.min(rightEdge, g.x + 1.5 * lineSpacing);
                  const yBase = cy + tieYOffset;
                  const mx = (x1 + x2) / 2;
                  return `M${x1},${yBase} Q${mx},${yBase + tieCtrlOffset} ${x2},${yBase}`;
                })()}
                fill="none"
                stroke={color}
                strokeWidth={Math.max(1.2, 0.12 * lineSpacing)}
                strokeLinecap="round"
              />
            )}
            {idx === 0 && g.tieFromPrev && (
              <path
                className="staff-tie is-incoming"
                d={(() => {
                  const x2 = g.x - rx * 0.45;
                  const x1 = Math.max(leftPad, g.x - 1.5 * lineSpacing);
                  const yBase = cy + tieYOffset;
                  const mx = (x1 + x2) / 2;
                  return `M${x1},${yBase} Q${mx},${yBase + tieCtrlOffset} ${x2},${yBase}`;
                })()}
                fill="none"
                stroke={color}
                strokeWidth={Math.max(1.2, 0.12 * lineSpacing)}
                strokeLinecap="round"
              />
            )}
            {shadowRes && (
              <text
                x={g.x}
                y={badgeY}
                textAnchor="middle"
                fontSize={isTablet ? 12 : 10}
                fontWeight="700"
                fill={badgeColor}
                className={`shadow-note-badge is-${shadowRes.status}`}
              >
                {shadowRes.badgeText}
              </text>
            )}
          </g>
        );
      })}

      {/* 演唱音高線 */}
      {sungPath && (
        <path
          d={sungPath}
          stroke={pitchColor}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}

      {/* 即時演唱音高線（沒播放時） */}
      {liveSungPath && (
        <path
          className="staff-live-sung"
          d={liveSungPath}
          stroke={pitchColor}
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
