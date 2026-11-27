import {
  solfegeName,
  toJianpu,
  type JianpuMode,
} from '../../core/jianpu';
import type { Key } from '../../core/key';
import { tonicLabel, type NoteGlyph } from './layout';

interface JianpuStripProps {
  glyphs: NoteGlyph[];
  activeIndex: number;
  sec: number;
  activeKey: Key;
  tonicMidi: number;
  jianpuMode: JianpuMode;
  isTablet: boolean;
  /** 預讀行顯示的自訂標記（例：「下一調 E♭」、「第 2 遍」） */
  previewLabel?: string | null;
  /** 左上角覆寫標籤（例：「D 第 2/2 遍」、「D 第 2 遍」、「下一個 E♭」） */
  lineLabel?: string | null;
  /** 八度位移小標籤（例：「8va」、「15ma」、「8vb」） */
  octaveTag?: string | null;
  height?: number;
}

/** 簡譜帶：每個數字水平對齊下方五線譜音符的 x 座標 */
export function JianpuStrip({
  glyphs,
  activeIndex,
  sec,
  activeKey,
  tonicMidi,
  jianpuMode,
  isTablet,
  previewLabel,
  lineLabel,
  octaveTag,
  height,
}: JianpuStripProps) {
  const modeLabel =
    lineLabel !== undefined
      ? lineLabel
      : (previewLabel ??
        (jianpuMode === 'fixed' ? '固定調' : `1=${tonicLabel(activeKey)}`));
  const isPreviewStyled = Boolean(previewLabel);

  return (
    <div
      className={`jianpu-strip ${isTablet ? 'is-tablet' : ''}`}
      style={height !== undefined ? { height: `${height}px` } : undefined}
    >
      {((modeLabel !== null && modeLabel !== '') || octaveTag) && (
        <span className="jianpu-tag-row">
          {modeLabel !== null && modeLabel !== '' && (
            <span
              className={`jianpu-mode-tag ${isPreviewStyled ? 'is-preview-label' : ''}`}
            >
              {modeLabel}
            </span>
          )}
          {octaveTag && (
            <span className="jianpu-octave-tag" aria-label={`八度顯示 ${octaveTag}`}>
              {octaveTag}
            </span>
          )}
        </span>
      )}

      {glyphs.map((g, idx) => {
        const jp = toJianpu(g.midi, activeKey, jianpuMode, tonicMidi);
        const upDots = jp.octave > 0 ? jp.octave : 0;
        const downDots = jp.octave < 0 ? Math.abs(jp.octave) : 0;

        let statusClass = 'is-future';
        if (idx === activeIndex) {
          statusClass = 'is-current';
        } else if (
          (activeIndex >= 0 && idx < activeIndex) ||
          sec >= g.start + g.dur
        ) {
          statusClass = 'is-past';
        }

        const solfege = isTablet
          ? solfegeName(g.midi, activeKey, jianpuMode)
          : '';

        return (
          <div
            key={`${g.start}-${idx}`}
            className={`jianpu-strip-item ${statusClass}`}
            style={{ left: `${g.x}px` }}
          >
            {isTablet && solfege && (
              <span className="jianpu-strip-solfege">{solfege}</span>
            )}
            <span className="jianpu-strip-note">
              {upDots > 0 && (
                <span
                  className="jianpu-strip-dots is-up"
                  aria-hidden="true"
                >
                  {'•'.repeat(upDots)}
                </span>
              )}
              <span className="jianpu-strip-core">
                {jp.accidental && (
                  <span className="jianpu-strip-acc">{jp.accidental}</span>
                )}
                <span className="jianpu-strip-digit">{jp.digit}</span>
              </span>
              {downDots > 0 && (
                <span
                  className="jianpu-strip-dots is-down"
                  aria-hidden="true"
                >
                  {'•'.repeat(downDots)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
