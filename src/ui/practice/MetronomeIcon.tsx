import { useEffect, useRef } from 'react';

export interface MetronomeIconProps {
  enabled: boolean;
  playing: boolean;
  bpm: number;
  firstBeat: number;
  isTablet: boolean;
  /** 取得目前外插播放秒數 */
  getSec: () => number;
  onToggle: () => void;
}

const OFF_COLOR = '#4b5870';
const FRAME_COLOR = '#a5afc1';
const ROD_COLOR = '#edf0f7';
const ACCENT_COLOR = '#4ca4ff';
const FLASH_COLOR = '#93c5fd';

/** 計算節拍器擺桿角度（度）：每拍整數點為 ±26°、半拍為 0° */
export function metronomeAngle(
  sec: number,
  firstBeat: number,
  bpm: number,
): number {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return 0;
  }
  const beatDur = 60 / bpm;
  const beatPos = (sec - firstBeat) / beatDur;
  return 26 * Math.cos(Math.PI * beatPos);
}

/** 依 BPM 計算藍色砝碼垂直位置（越慢越高，40 BPM → 6、208 BPM → 16） */
export function weightY(bpm: number): number {
  return 6 + ((bpm - 40) / 168) * 10;
}

/** 判斷目前秒數是否處於每 4 拍重拍後 120 ms 的閃亮期間 */
function isDownbeatFlash(sec: number, firstBeat: number, bpm: number): boolean {
  if (bpm <= 0 || sec < firstBeat - 1e-4) {
    return false;
  }
  const beatDur = 60 / bpm;
  const elapsed = sec - firstBeat;
  const beatIdx = Math.floor((elapsed + 1e-4) / beatDur);
  if (beatIdx < 0 || beatIdx % 4 !== 0) {
    return false;
  }
  const sinceBeat = elapsed - beatIdx * beatDur;
  return sinceBeat >= -1e-4 && sinceBeat < 0.12;
}

/** 極簡線條發條節拍器按鈕（擺動與音訊播放位置同步） */
export function MetronomeIcon({
  enabled,
  playing,
  bpm,
  firstBeat,
  isTablet,
  getSec,
  onToggle,
}: MetronomeIconProps) {
  const pendulumRef = useRef<SVGGElement | null>(null);
  const topDotRef = useRef<SVGCircleElement | null>(null);

  useEffect(() => {
    const applyVisual = (angle: number, flash: boolean) => {
      if (pendulumRef.current) {
        pendulumRef.current.setAttribute('transform', `rotate(${angle} 12 26)`);
      }
      if (topDotRef.current) {
        if (!enabled) {
          topDotRef.current.setAttribute('r', '1.4');
          topDotRef.current.setAttribute('fill', OFF_COLOR);
        } else if (flash) {
          topDotRef.current.setAttribute('r', '2.3');
          topDotRef.current.setAttribute('fill', FLASH_COLOR);
        } else {
          topDotRef.current.setAttribute('r', '1.4');
          topDotRef.current.setAttribute('fill', ACCENT_COLOR);
        }
      }
    };

    if (!enabled) {
      applyVisual(0, false);
      return;
    }

    if (!playing) {
      applyVisual(metronomeAngle(getSec(), firstBeat, bpm), false);
      return;
    }

    let rafId = 0;
    const tick = () => {
      const s = getSec();
      applyVisual(
        metronomeAngle(s, firstBeat, bpm),
        isDownbeatFlash(s, firstBeat, bpm),
      );
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [enabled, playing, bpm, firstBeat, getSec]);

  const frameStroke = enabled ? FRAME_COLOR : OFF_COLOR;
  const rodStroke = enabled ? ROD_COLOR : OFF_COLOR;
  const weightFill = enabled ? ACCENT_COLOR : OFF_COLOR;
  const wY = weightY(bpm);

  const initialAngle = enabled ? metronomeAngle(getSec(), firstBeat, bpm) : 0;

  return (
    <button
      type="button"
      className={`metro-btn ${enabled ? 'is-on' : 'is-off'} ${
        isTablet ? 'is-tablet' : ''
      }`}
      aria-label="節拍器"
      aria-pressed={enabled}
      onClick={onToggle}
    >
      <svg
        className="metro-svg"
        width={isTablet ? 40 : 25}
        height={isTablet ? 50 : 31}
        viewBox="0 0 24 30"
        fill="none"
        aria-hidden="true"
      >
        {/* 梯形外框 */}
        <path
          d="M8 3.5 L16 3.5 L20.5 27 L3.5 27 Z"
          stroke={frameStroke}
          strokeWidth={1.6}
          strokeLinejoin="round"
          fill="none"
        />
        {/* 中央淡虛線 */}
        <line
          x1={12}
          y1={6}
          x2={12}
          y2={25}
          stroke={frameStroke}
          strokeOpacity={enabled ? 0.35 : 0.25}
          strokeWidth={1}
          strokeDasharray="1.8 1.8"
        />
        {/* 底部支點半圓 */}
        <path
          d="M8.6 27 A3.4 3.4 0 0 1 15.4 27"
          stroke={frameStroke}
          strokeWidth={1.3}
          fill="none"
        />

        {/* 擺桿群組：以支點 (12, 26) 為中心旋轉 */}
        <g ref={pendulumRef} transform={`rotate(${initialAngle} 12 26)`}>
          <line
            x1={12}
            y1={26}
            x2={12}
            y2={4.5}
            stroke={rodStroke}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <rect
            x={9.4}
            y={wY}
            width={5.2}
            height={3.4}
            rx={0.8}
            fill={weightFill}
          />
          <circle
            ref={topDotRef}
            cx={12}
            cy={4.5}
            r={1.4}
            fill={weightFill}
          />
          <circle cx={12} cy={26} r={1.3} fill={rodStroke} />
        </g>
      </svg>
    </button>
  );
}
