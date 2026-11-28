import type { CSSProperties } from 'react';
import {
  buildKaraokeSegments,
  selectKaraokeDisplayLines,
  type LyricLine,
} from '../../core/lyrics';

interface LyricsStripProps {
  lines: readonly LyricLine[];
  passSec: number;
  leadSec: number;
  lyricsScale: number;
  twoLines: boolean;
  isTablet: boolean;
  height: number;
}

/** 卡拉 OK 歌詞帶：顯示目前這行（逐字由左到右變色）與下一行預告 */
export function LyricsStrip({
  lines,
  passSec,
  leadSec,
  lyricsScale,
  twoLines,
  isTablet,
  height,
}: LyricsStripProps) {
  if (lines.length === 0 || height <= 0) {
    return null;
  }

  const effectiveTime = passSec + leadSec;
  const { currentLine, nextLine } = selectKaraokeDisplayLines(
    lines,
    effectiveTime,
  );
  if (!currentLine) {
    return null;
  }

  const scaleFactor = Math.max(0.7, Math.min(1.6, lyricsScale / 100));
  const currentFontSize = (isTablet ? 17 : 13) * scaleFactor;
  const nextFontSize = Math.max(10, currentFontSize * 0.82);
  const segments = buildKaraokeSegments(currentLine);

  return (
    <div
      className={`lyrics-strip ${isTablet ? 'is-tablet' : 'is-phone'} ${twoLines ? 'is-two-lines' : 'is-one-line'}`}
      style={{ height: `${height}px` }}
      aria-label="卡拉 OK 歌詞"
    >
      <div
        className="lyrics-line is-current"
        style={{ fontSize: `${currentFontSize.toFixed(1)}px` }}
      >
        {segments.map((seg, idx) => {
          let cls = 'lyrics-seg is-unsung';
          let inlineStyle: CSSProperties | undefined;

          if (effectiveTime >= seg.end && (seg.end > seg.start || effectiveTime >= seg.start)) {
            if (effectiveTime >= seg.start) {
              cls = 'lyrics-seg is-sung';
            }
          } else if (effectiveTime > seg.start && seg.end > seg.start) {
            const ratio = Math.max(
              0,
              Math.min(1, (effectiveTime - seg.start) / (seg.end - seg.start)),
            );
            cls = 'lyrics-seg is-singing';
            inlineStyle = {
              '--lyric-fill': `${(ratio * 100).toFixed(1)}%`,
            } as CSSProperties;
          }

          return (
            <span key={`seg-${idx}`} className={cls} style={inlineStyle}>
              {seg.text}
            </span>
          );
        })}
      </div>

      {twoLines && (
        <div
          className="lyrics-line is-next"
          style={{ fontSize: `${nextFontSize.toFixed(1)}px` }}
        >
          {nextLine ? nextLine.text : ''}
        </div>
      )}
    </div>
  );
}
