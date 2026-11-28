import { useRef, useState } from 'react';
import type { LyricLine } from '../../core/lyrics';
import {
  computeSeekLyricTicks,
  computeVocalStartSeekInfo,
  findBarAtPassSec,
  findLyricPreviewAtPassSec,
  formatSeekTime,
  passSecToSeekRatio,
  resolveMidiLoopRangeSec,
  seekRatioToPassSec,
  snapPassSecToNearestBeat,
} from '../../core/midiSeek';
import type { MidiScoreBar } from '../../core/midiScore';

interface MidiSeekBarProps {
  scoreBars: readonly MidiScoreBar[];
  startBar: number;
  endBar: number;
  activePassStart: number;
  totalPassDur: number;
  sec: number;
  passLyrics: readonly LyricLine[];
  isTablet: boolean;
  height: number;
  loopStartBar?: number;
  loopEndBar?: number;
  onSeek: (targetAbsSec: number) => void;
}

/** MIDI 練唱進度拉桿：支援拖曳即時預覽小節與歌詞開頭、放開對齊最近一拍並同步所有畫面 */
export function MidiSeekBar({
  scoreBars,
  startBar,
  endBar,
  activePassStart,
  totalPassDur,
  sec,
  passLyrics,
  isTablet,
  height,
  loopStartBar,
  loopEndBar,
  onSeek,
}: MidiSeekBarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragRatioRef = useRef<number | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  if (scoreBars.length === 0 || totalPassDur <= 0) {
    return null;
  }

  const livePassSec = Math.max(0, Math.min(totalPassDur, sec - activePassStart));
  const liveRatio = passSecToSeekRatio(livePassSec, totalPassDur);
  const effectiveRatio = dragRatio ?? liveRatio;
  const displayPassSec = seekRatioToPassSec(effectiveRatio, totalPassDur);

  const displayBar = findBarAtPassSec(scoreBars, displayPassSec);
  const currentBarNum = displayBar?.barNumber ?? startBar;

  const previewSnappedSec =
    dragRatio !== null
      ? snapPassSecToNearestBeat(scoreBars, displayPassSec)
      : displayPassSec;
  const previewBar =
    dragRatio !== null
      ? findBarAtPassSec(scoreBars, previewSnappedSec)
      : displayBar;
  const previewLyric =
    dragRatio !== null
      ? findLyricPreviewAtPassSec(passLyrics, previewSnappedSec)
      : '';

  const lyricTicks = computeSeekLyricTicks(passLyrics, totalPassDur);
  const vocalStartInfo = computeVocalStartSeekInfo(scoreBars, totalPassDur);
  const loopRange = resolveMidiLoopRangeSec(
    scoreBars,
    loopStartBar,
    loopEndBar,
  );
  const loopStartBarObj =
    loopStartBar !== undefined
      ? scoreBars.find((b) => b.barNumber === loopStartBar)
      : undefined;
  const loopEndBarObj =
    loopEndBar !== undefined
      ? scoreBars.find((b) => b.barNumber === loopEndBar)
      : undefined;
  const abLeftRatio = loopRange
    ? passSecToSeekRatio(loopRange.startPassSec, totalPassDur)
    : loopStartBarObj
      ? passSecToSeekRatio(loopStartBarObj.startSec, totalPassDur)
      : null;
  const abRightRatio = loopRange
    ? passSecToSeekRatio(loopRange.endPassSec, totalPassDur)
    : loopEndBarObj
      ? passSecToSeekRatio(loopEndBarObj.endSec, totalPassDur)
      : null;

  function jumpToVocalStart() {
    if (!vocalStartInfo) return;
    onSeek(activePassStart + vocalStartInfo.barStartPassSec);
  }

  function computeRatioFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el) return effectiveRatio;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略部分環境不支援 setPointerCapture
    }
    dragPointerIdRef.current = e.pointerId;
    const nextRatio = computeRatioFromClientX(e.clientX);
    dragRatioRef.current = nextRatio;
    setDragRatio(nextRatio);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== e.pointerId) return;
    const nextRatio = computeRatioFromClientX(e.clientX);
    dragRatioRef.current = nextRatio;
    setDragRatio(nextRatio);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== e.pointerId) return;
    dragPointerIdRef.current = null;
    const finalRatio =
      dragRatioRef.current ?? computeRatioFromClientX(e.clientX);
    dragRatioRef.current = null;
    setDragRatio(null);

    const rawPassSec = seekRatioToPassSec(finalRatio, totalPassDur);
    const snappedPassSec = snapPassSecToNearestBeat(scoreBars, rawPassSec);
    onSeek(activePassStart + snappedPassSec);
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== e.pointerId) return;
    dragPointerIdRef.current = null;
    dragRatioRef.current = null;
    setDragRatio(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const allBeats: number[] = [];
    for (const bar of scoreBars) {
      for (const bt of bar.beatStartSecs) {
        allBeats.push(bt);
      }
    }
    if (allBeats.length === 0) return;
    let nearestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < allBeats.length; i++) {
      const d = Math.abs(allBeats[i]! - livePassSec);
      if (d < bestDist) {
        bestDist = d;
        nearestIdx = i;
      }
    }
    const nextIdx = Math.max(
      0,
      Math.min(allBeats.length - 1, nearestIdx + delta),
    );
    onSeek(activePassStart + allBeats[nextIdx]!);
  }

  return (
    <div
      className={`midi-seek-bar ${isTablet ? 'is-tablet' : 'is-phone'} ${dragRatio !== null ? 'is-dragging' : ''}`}
      style={{ height: `${height}px` }}
    >
      <span className="midi-seek-bars-label">
        第 {currentBarNum}／{endBar} 小節
      </span>

      <div
        ref={trackRef}
        className="midi-seek-track-wrap"
        role="slider"
        tabIndex={0}
        aria-label="MIDI 練唱進度"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalPassDur)}
        aria-valuenow={Math.round(displayPassSec)}
        aria-valuetext={`第 ${currentBarNum}／${endBar} 小節，${formatSeekTime(displayPassSec)}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
      >
        {dragRatio !== null && (
          <div
            className="midi-seek-tooltip"
            style={{ left: `${(effectiveRatio * 100).toFixed(2)}%` }}
            role="status"
          >
            <span>第 {previewBar?.barNumber ?? currentBarNum} 小節</span>
            {previewLyric && (
              <span className="midi-seek-tooltip-lyric"> · {previewLyric}</span>
            )}
          </div>
        )}

        <div className="midi-seek-rail">
          {loopRange && abLeftRatio !== null && abRightRatio !== null && (
            <div
              className="midi-seek-ab-range"
              style={{
                left: `${(abLeftRatio * 100).toFixed(2)}%`,
                width: `${Math.max(0.5, (abRightRatio - abLeftRatio) * 100).toFixed(2)}%`,
              }}
              aria-hidden="true"
            />
          )}
          <div
            className="midi-seek-fill"
            style={{ width: `${(effectiveRatio * 100).toFixed(2)}%` }}
          />
          {abLeftRatio !== null && (
            <span
              className="midi-seek-ab-mark is-a"
              style={{ left: `${(abLeftRatio * 100).toFixed(2)}%` }}
              aria-hidden="true"
            />
          )}
          {abRightRatio !== null && (
            <span
              className="midi-seek-ab-mark is-b"
              style={{ left: `${(abRightRatio * 100).toFixed(2)}%` }}
              aria-hidden="true"
            />
          )}
          {lyricTicks.map((tickRatio, idx) => (
            <span
              key={`ltick-${idx}`}
              className="midi-seek-lyric-tick"
              style={{ left: `${(tickRatio * 100).toFixed(2)}%` }}
              aria-hidden="true"
            />
          ))}
          {vocalStartInfo && (
            <button
              type="button"
              className="midi-seek-vocal-marker"
              style={{ left: `${(vocalStartInfo.ratio * 100).toFixed(2)}%` }}
              aria-label={`跳至人聲第 ${vocalStartInfo.barNumber} 小節`}
              title={`跳至第 ${vocalStartInfo.barNumber} 小節開頭`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                jumpToVocalStart();
              }}
            >
              <span className="midi-seek-vocal-flag" aria-hidden="true" />
              <span className="midi-seek-vocal-tag">人聲</span>
            </button>
          )}
        </div>

        <div
          className="midi-seek-thumb"
          style={{ left: `${(effectiveRatio * 100).toFixed(2)}%` }}
          aria-hidden="true"
        />
      </div>

      <span className="midi-seek-time-label">
        {formatSeekTime(displayPassSec)} / {formatSeekTime(totalPassDur)}
      </span>

      {vocalStartInfo && (
        <button
          type="button"
          className="midi-seek-vocal-jump"
          onClick={jumpToVocalStart}
          title={`跳至第 ${vocalStartInfo.barNumber} 小節開頭`}
        >
          人聲：第 {vocalStartInfo.barNumber} 小節
        </button>
      )}
    </div>
  );
}
