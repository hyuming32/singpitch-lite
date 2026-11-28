import {
  solfegeName,
  toJianpu,
  type JianpuMode,
} from '../../core/jianpu';
import type { Key } from '../../core/key';
import { tonicLabel, type NoteGlyph } from './layout';
import type {
  MidiJianpuMarker,
  MidiJianpuUnderlineSegment,
} from './midiLayout';

interface JianpuStripProps {
  glyphs: NoteGlyph[];
  activeIndex: number;
  sec: number;
  activeKey: Key;
  tonicMidi: number;
  jianpuMode: JianpuMode;
  isTablet: boolean;
  isPortrait?: boolean;
  /** 預讀行顯示的自訂標記（例：「下一調 E♭」、「第 2 遍」） */
  previewLabel?: string | null;
  /** 左上角覆寫標籤（例：「D 第 2/2 遍」、「D 第 2 遍」、「下一個 E♭」） */
  lineLabel?: string | null;
  /** 八度位移小標籤（例：「8va」、「15ma」、「8vb」） */
  octaveTag?: string | null;
  height?: number;
  /** MIDI 延長拍「–」與多拍休止「0」對齊標記 */
  extraMarkers?: readonly MidiJianpuMarker[];
  /** MIDI 同一拍相連減時線段（8 分 1 條、16 分 2 條） */
  underlineSegments?: readonly MidiJianpuUnderlineSegment[];
  /** 相鄰音符最小水平間距（px），決定 MIDI 簡譜字級與是否隱藏唱名 */
  minNoteSpacingPx?: number;
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
  isPortrait = false,
  previewLabel,
  lineLabel,
  octaveTag,
  height,
  extraMarkers,
  underlineSegments,
  minNoteSpacingPx,
}: JianpuStripProps) {
  const isMidi = Boolean(underlineSegments !== undefined || extraMarkers !== undefined);
  const safeSpacing = minNoteSpacingPx ?? 40;
  const midiDigitPx = isMidi
    ? Math.min(isTablet ? 24 : 16, Math.max(12, Math.floor(safeSpacing * 0.68)))
    : undefined;
  const midiAccPx =
    midiDigitPx !== undefined ? Math.max(9, Math.round(midiDigitPx * 0.62)) : undefined;
  const showSolfege = isTablet && (!isMidi || safeSpacing >= 38);

  const modeLabel =
    lineLabel !== undefined
      ? lineLabel
      : (previewLabel ??
        (jianpuMode === 'fixed' ? '固定調' : `1=${tonicLabel(activeKey)}`));
  const isPreviewStyled = Boolean(previewLabel);

  return (
    <div
      className={`jianpu-strip ${isTablet ? 'is-tablet' : isPortrait ? 'is-portrait' : ''} ${isMidi ? 'is-midi' : ''}`}
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
        const isRest = Boolean(g.isRest);
        const isDash = g.jianpuSymbol === '–';
        const jp =
          isRest || isDash
            ? null
            : toJianpu(g.midi, activeKey, jianpuMode, tonicMidi);
        const upDots = jp && jp.octave > 0 ? jp.octave : 0;
        const downDots = jp && jp.octave < 0 ? Math.abs(jp.octave) : 0;
        const underlines = g.jianpuUnderlines ?? 0;

        let statusClass = 'is-future';
        if (idx === activeIndex) {
          statusClass = 'is-current';
        } else if (
          (activeIndex >= 0 && idx < activeIndex) ||
          sec >= g.start + g.dur
        ) {
          statusClass = 'is-past';
        }

        const solfege =
          showSolfege && !isRest && !isDash
            ? solfegeName(g.midi, activeKey, jianpuMode)
            : '';

        const digitText = isRest ? '0' : isDash ? '–' : jp!.digit;

        return (
          <div
            key={`${g.start}-${idx}`}
            className={`jianpu-strip-item ${statusClass} ${g.silent ? 'is-shadow-gap' : ''} ${isRest ? 'is-rest' : ''}`}
            style={{ left: `${g.x}px` }}
          >
            {solfege && (
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
                {jp?.accidental && (
                  <span
                    className="jianpu-strip-acc"
                    style={
                      midiAccPx !== undefined
                        ? { fontSize: `${midiAccPx}px` }
                        : undefined
                    }
                  >
                    {jp.accidental}
                  </span>
                )}
                <span
                  className="jianpu-strip-digit"
                  style={
                    midiDigitPx !== undefined
                      ? { fontSize: `${midiDigitPx}px` }
                      : undefined
                  }
                >
                  {digitText}
                </span>
                {g.jianpuDot && (
                  <span
                    className="jianpu-strip-aug-dot"
                    style={
                      midiDigitPx !== undefined
                        ? { fontSize: `${Math.round(midiDigitPx * 0.78)}px` }
                        : undefined
                    }
                    aria-hidden="true"
                  >
                    ·
                  </span>
                )}
              </span>
              {!underlineSegments && underlines > 0 && (
                <span
                  className={`jianpu-strip-underlines has-${underlines}`}
                  aria-hidden="true"
                >
                  <span className="jianpu-underline" />
                  {underlines >= 2 && <span className="jianpu-underline" />}
                </span>
              )}
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

      {underlineSegments?.map((seg, idx) => (
        <span
          key={`ul-${idx}`}
          className={`jianpu-connected-underline is-level-${seg.level} ${sec >= seg.endSec ? 'is-past' : ''}`}
          style={{
            left: `${seg.x1}px`,
            width: `${Math.max(6, seg.x2 - seg.x1)}px`,
          }}
          aria-hidden="true"
        />
      ))}

      {extraMarkers?.map((m, idx) => (
        <div
          key={`extra-${m.t}-${idx}`}
          className={`jianpu-strip-item ${sec >= m.t ? 'is-past' : 'is-future'} jianpu-strip-ext`}
          style={{ left: `${m.x}px` }}
        >
          <span className="jianpu-strip-note">
            <span className="jianpu-strip-core">
              <span
                className="jianpu-strip-digit"
                style={
                  midiDigitPx !== undefined
                    ? { fontSize: `${midiDigitPx}px` }
                    : undefined
                }
              >
                {m.symbol}
              </span>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
