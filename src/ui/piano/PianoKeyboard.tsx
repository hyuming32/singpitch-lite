import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../../audio/engine';
import { displayNoteName } from '../noteLabel';
import {
  toLocalPoint,
  toLocalRect,
  type RotationContext,
} from '../practice/viewportRotation';
import {
  FULL_PIANO_HIGH_MIDI,
  FULL_PIANO_LOW_MIDI,
  keyAt,
  layoutKeyboard,
  needleXForMidi,
  type BlackKeyLayout,
  type WhiteKeyLayout,
} from './pianoGeometry';

export const PIANO_SCROLLBAR_HEIGHT = 12;

interface PianoKeyboardProps {
  /** 建議初始置中的音高（例如目前練習調性主音或音域中點） */
  centerMidi?: number;
  targetMidi: number | null;
  sungMidi: number | null;
  /** 演唱定位線（needle）顏色（預設 #0047ff） */
  needleColor?: string;
  height: number;
  collapsed: boolean;
  isTablet: boolean;
  isPortrait?: boolean;
  rotationCtx: RotationContext;
  engine: AudioEngine;
  onAudioError?: (msg: string) => void;
  onPressedMidisChange?: (midis: readonly number[]) => void;
}

/** 繪製平頂、底部圓角的矩形 SVG 路徑 */
function bottomRoundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const safeR = Math.max(0, Math.min(r, w / 2, h / 2));
  if (safeR <= 0.1) {
    return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  }
  return [
    `M${x},${y}`,
    `H${x + w}`,
    `V${y + h - safeR}`,
    `Q${x + w},${y + h} ${x + w - safeR},${y + h}`,
    `H${x + safeR}`,
    `Q${x},${y + h} ${x},${y + h - safeR}`,
    'Z',
  ].join(' ');
}

/** 依容器寬度計算白鍵中心距 W（px） */
export function computeWhiteKeyWidth(
  containerWidth: number,
  isTablet: boolean,
  isPortrait = false,
): number {
  const safeW =
    containerWidth > 0
      ? containerWidth
      : isTablet
        ? 1146
        : isPortrait
          ? 374
          : 748;
  return safeW / (isTablet ? 22 : isPortrait ? 15 : 19);
}

/** 真實幾何比例 SVG 對音鋼琴：88 鍵、支援頂部捲動條、自動捲動、多指觸控與收合迷你條 */
export function PianoKeyboard({
  centerMidi = 60,
  targetMidi,
  sungMidi,
  needleColor = '#0047ff',
  height,
  collapsed,
  isTablet,
  isPortrait = false,
  rotationCtx,
  engine,
  onAudioError,
  onPressedMidisChange,
}: PianoKeyboardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const keysViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);

  const [containerWidth, setContainerWidth] = useState(() =>
    isTablet ? 1146 : isPortrait ? 374 : 748,
  );
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pressedMidis, setPressedMidis] = useState<Set<number>>(() => new Set());

  const activePointersRef = useRef<Map<number, number>>(new Map());
  const pressedCountsRef = useRef<Map<number, number>>(new Map());
  const initCalledRef = useRef(false);
  const hasInitializedScrollRef = useRef(false);
  const scrollAnimRef = useRef<number | null>(null);
  const scrollDragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
  } | null>(null);

  // 量測鋼琴容器寬度以決定 W
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setContainerWidth(w);
      }
    };
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = computeWhiteKeyWidth(containerWidth, isTablet, isPortrait);
  const preset = isTablet ? 'tablet' : 'korg';
  const keyAreaHeight = collapsed
    ? Math.max(12, height)
    : Math.max(24, height - PIANO_SCROLLBAR_HEIGHT);

  const layout = useMemo(
    () =>
      layoutKeyboard({
        lowMidi: FULL_PIANO_LOW_MIDI,
        highMidi: FULL_PIANO_HIGH_MIDI,
        W,
        preset,
        height: keyAreaHeight,
        fillHeight: isPortrait,
      }),
    [W, preset, keyAreaHeight, isPortrait],
  );

  const maxScroll = Math.max(0, layout.totalWidth - containerWidth);
  const clampedScrollLeft = Math.max(0, Math.min(maxScroll, scrollLeft));

  const findKeyCenter = useCallback(
    (midi: number): number | null => {
      const wk = layout.whites.find((w) => w.midi === midi);
      if (wk) return wk.x + wk.w / 2;
      const bk = layout.blacks.find((b) => b.midi === midi);
      if (bk) return bk.x + bk.w / 2;
      return null;
    },
    [layout],
  );

  // 初始置中至練習音域／主音
  useEffect(() => {
    if (hasInitializedScrollRef.current || containerWidth <= 0) return;
    const focusMidi = isPortrait ? Math.min(108, centerMidi + 5) : centerMidi;
    const cx = findKeyCenter(focusMidi);
    if (cx !== null) {
      hasInitializedScrollRef.current = true;
      setScrollLeft(Math.max(0, Math.min(maxScroll, cx - containerWidth / 2)));
    }
  }, [centerMidi, containerWidth, findKeyCenter, isPortrait, maxScroll]);

  // 平滑捲動動畫
  const smoothScrollTo = useCallback(
    (target: number) => {
      if (scrollAnimRef.current !== null) {
        cancelAnimationFrame(scrollAnimRef.current);
        scrollAnimRef.current = null;
      }
      const clampedTarget = Math.max(0, Math.min(maxScroll, target));
      const start = clampedScrollLeft;
      const diff = clampedTarget - start;
      if (Math.abs(diff) < 1) {
        setScrollLeft(clampedTarget);
        return;
      }
      const duration = 220;
      const startTime = performance.now();

      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setScrollLeft(start + diff * eased);
        if (t < 1) {
          scrollAnimRef.current = requestAnimationFrame(step);
        } else {
          scrollAnimRef.current = null;
        }
      };
      scrollAnimRef.current = requestAnimationFrame(step);
    },
    [clampedScrollLeft, maxScroll],
  );

  useEffect(() => {
    return () => {
      if (scrollAnimRef.current !== null) {
        cancelAnimationFrame(scrollAnimRef.current);
      }
    };
  }, []);

  // 換調時若主音超出可視區，自動將兩個八度捲至目前調範圍
  const prevCenterMidiRef = useRef(centerMidi);
  useEffect(() => {
    if (prevCenterMidiRef.current === centerMidi) return;
    prevCenterMidiRef.current = centerMidi;
    if (
      !hasInitializedScrollRef.current ||
      targetMidi !== null ||
      scrollDragRef.current !== null
    ) {
      return;
    }
    const focusMidi = isPortrait ? Math.min(108, centerMidi + 5) : centerMidi;
    const cx = findKeyCenter(focusMidi);
    if (cx === null) return;
    const safeLeft = clampedScrollLeft + containerWidth * 0.2;
    const safeRight = clampedScrollLeft + containerWidth * 0.8;
    if (cx < safeLeft || cx > safeRight) {
      smoothScrollTo(cx - containerWidth / 2);
    }
  }, [
    centerMidi,
    targetMidi,
    isPortrait,
    containerWidth,
    clampedScrollLeft,
    findKeyCenter,
    smoothScrollTo,
  ]);

  // 練唱中自動捲動：目標音離開窗口中間 60% 時，平滑捲動回中間
  useEffect(() => {
    if (targetMidi === null || scrollDragRef.current !== null) return;
    const cx = findKeyCenter(targetMidi);
    if (cx === null) return;

    const safeLeft = clampedScrollLeft + containerWidth * 0.2;
    const safeRight = clampedScrollLeft + containerWidth * 0.8;
    if (cx < safeLeft || cx > safeRight) {
      smoothScrollTo(cx - containerWidth / 2);
    }
  }, [
    targetMidi,
    containerWidth,
    clampedScrollLeft,
    findKeyCenter,
    smoothScrollTo,
  ]);

  const onPressedMidisChangeRef = useRef(onPressedMidisChange);
  onPressedMidisChangeRef.current = onPressedMidisChange;

  const syncPressedState = useCallback(() => {
    const next = new Set<number>();
    for (const [midi, count] of pressedCountsRef.current.entries()) {
      if (count > 0) {
        next.add(midi);
      }
    }
    setPressedMidis(next);
    onPressedMidisChangeRef.current?.(Array.from(next));
  }, []);

  const pressKey = useCallback(
    (midi: number) => {
      const prev = pressedCountsRef.current.get(midi) ?? 0;
      pressedCountsRef.current.set(midi, prev + 1);
      if (prev === 0) {
        engine.keyOn(midi);
      }
      syncPressedState();
    },
    [engine, syncPressedState],
  );

  const releaseKey = useCallback(
    (midi: number) => {
      const prev = pressedCountsRef.current.get(midi) ?? 0;
      if (prev <= 1) {
        pressedCountsRef.current.delete(midi);
        engine.keyOff(midi);
      } else {
        pressedCountsRef.current.set(midi, prev - 1);
      }
      syncPressedState();
    },
    [engine, syncPressedState],
  );

  // 元件卸載或收合時釋放所有仍按住的琴鍵
  const releaseAllKeys = useCallback(() => {
    for (const [midi, count] of pressedCountsRef.current.entries()) {
      if (count > 0) {
        engine.keyOff(midi);
      }
    }
    pressedCountsRef.current.clear();
    activePointersRef.current.clear();
    syncPressedState();
  }, [engine, syncPressedState]);

  useEffect(() => {
    if (collapsed) {
      releaseAllKeys();
    }
  }, [collapsed, releaseAllKeys]);

  useEffect(() => {
    return () => {
      releaseAllKeys();
    };
  }, [releaseAllKeys]);

  const ensureAudioReady = useCallback(() => {
    void engine.unlock().catch(() => {});
    if (!initCalledRef.current) {
      initCalledRef.current = true;
      void engine
        .init()
        .then(() => engine.unlock())
        .catch((err) => {
          initCalledRef.current = false;
          onAudioError?.(err instanceof Error ? err.message : String(err));
        });
    }
  }, [engine, onAudioError]);

  const midiFromClientPoint = (
    clientX: number,
    clientY: number,
  ): number | null => {
    const vp = keysViewportRef.current;
    if (!vp) return null;
    const pt = toLocalPoint(clientX, clientY, rotationCtx);
    const rect = toLocalRect(vp.getBoundingClientRect(), rotationCtx);
    const localX = pt.x - rect.left + clampedScrollLeft;
    const localY = pt.y - rect.top;
    return keyAt(localX, localY, layout);
  };

  const handleKeyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    e.preventDefault();
    ensureAudioReady();

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略部分環境不支援 setPointerCapture 的情況
    }

    const midi = midiFromClientPoint(e.clientX, e.clientY);
    if (midi !== null) {
      const prevMidi = activePointersRef.current.get(e.pointerId);
      if (prevMidi !== undefined && prevMidi !== midi) {
        releaseKey(prevMidi);
      }
      if (prevMidi !== midi) {
        activePointersRef.current.set(e.pointerId, midi);
        pressKey(midi);
      }
    }
  };

  const handleKeyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed || !activePointersRef.current.has(e.pointerId)) {
      return;
    }
    const prevMidi = activePointersRef.current.get(e.pointerId)!;
    const nextMidi = midiFromClientPoint(e.clientX, e.clientY);
    if (nextMidi === prevMidi) {
      return;
    }
    releaseKey(prevMidi);
    if (nextMidi !== null) {
      activePointersRef.current.set(e.pointerId, nextMidi);
      pressKey(nextMidi);
    } else {
      activePointersRef.current.delete(e.pointerId);
    }
  };

  const handleKeyPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const prevMidi = activePointersRef.current.get(e.pointerId);
    if (prevMidi !== undefined) {
      activePointersRef.current.delete(e.pointerId);
      releaseKey(prevMidi);
    }
  };

  // 頂部 12 px 捲動條互動（只有拖這條才會捲動）
  const thumbRatio =
    layout.totalWidth > 0
      ? Math.min(1, containerWidth / layout.totalWidth)
      : 1;
  const thumbWidthPx = Math.max(24, thumbRatio * containerWidth);
  const trackScrollablePx = Math.max(1, containerWidth - thumbWidthPx);
  const thumbLeftPx =
    maxScroll > 0 ? (clampedScrollLeft / maxScroll) * trackScrollablePx : 0;

  const handleScrollbarPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (collapsed || maxScroll <= 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (scrollAnimRef.current !== null) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略部分環境不支援 setPointerCapture 的情況
    }

    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const rawBarRect = scrollbarRef.current?.getBoundingClientRect();
    let nextStartScroll = clampedScrollLeft;
    if (rawBarRect) {
      const barRect = toLocalRect(rawBarRect, rotationCtx);
      const clickX = pt.x - barRect.left;
      // 若點在滑塊外側，直接跳至點擊位置中心
      if (clickX < thumbLeftPx || clickX > thumbLeftPx + thumbWidthPx) {
        const targetThumbLeft = Math.max(
          0,
          Math.min(trackScrollablePx, clickX - thumbWidthPx / 2),
        );
        nextStartScroll = (targetThumbLeft / trackScrollablePx) * maxScroll;
        setScrollLeft(nextStartScroll);
      }
    }

    scrollDragRef.current = {
      pointerId: e.pointerId,
      startX: pt.x,
      startScrollLeft: nextStartScroll,
    };
  };

  const handleScrollbarPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drag = scrollDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || maxScroll <= 0) return;
    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const dx = pt.x - drag.startX;
    const dScroll = (dx / trackScrollablePx) * maxScroll;
    setScrollLeft(
      Math.max(0, Math.min(maxScroll, drag.startScrollLeft + dScroll)),
    );
  };

  const handleScrollbarPointerEnd = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (scrollDragRef.current?.pointerId === e.pointerId) {
      scrollDragRef.current = null;
    }
  };

  const needleX =
    sungMidi !== null ? needleXForMidi(sungMidi, layout) : null;

  const shadowRatio = 0.04;
  const whiteRadius = collapsed ? 1.5 : 3.5;
  const blackRadius = collapsed ? 1 : 2.5;
  const showLabels = !collapsed && keyAreaHeight >= 36;

  return (
    <div
      ref={containerRef}
      className={`piano-panel ${collapsed ? 'is-collapsed' : ''}`}
      style={{ height: `${height}px` }}
    >
      {!collapsed && (
        <div
          ref={scrollbarRef}
          className="piano-scrollbar"
          style={{ height: `${PIANO_SCROLLBAR_HEIGHT}px` }}
          onPointerDown={handleScrollbarPointerDown}
          onPointerMove={handleScrollbarPointerMove}
          onPointerUp={handleScrollbarPointerEnd}
          onPointerCancel={handleScrollbarPointerEnd}
          onLostPointerCapture={handleScrollbarPointerEnd}
          role="scrollbar"
          aria-label="鋼琴鍵盤水平捲動條"
          aria-valuemin={0}
          aria-valuemax={Math.round(maxScroll)}
          aria-valuenow={Math.round(clampedScrollLeft)}
        >
          <div
            className="piano-scrollbar-thumb"
            style={{
              width: `${thumbWidthPx}px`,
              transform: `translate3d(${thumbLeftPx}px, 0, 0)`,
            }}
          />
        </div>
      )}

      <div
        ref={keysViewportRef}
        className={`piano-keyboard-viewport ${collapsed ? 'is-collapsed' : ''}`}
        style={{ height: `${keyAreaHeight}px` }}
        onPointerDown={handleKeyPointerDown}
        onPointerMove={handleKeyPointerMove}
        onPointerUp={handleKeyPointerEnd}
        onPointerCancel={handleKeyPointerEnd}
        onLostPointerCapture={handleKeyPointerEnd}
        role="group"
        aria-label="對音鋼琴"
      >
        <svg
          className="piano-svg"
          width={layout.totalWidth}
          height={keyAreaHeight}
          viewBox={`0 0 ${layout.totalWidth} ${keyAreaHeight}`}
          style={{
            transform: `translate3d(${-clampedScrollLeft}px, 0, 0)`,
          }}
        >
          {/* 1. 先畫白鍵 */}
          {layout.whites.map((wk: WhiteKeyLayout) => {
            const isTarget = targetMidi === wk.midi;
            const isPressed = pressedMidis.has(wk.midi);
            const fill =
              isTarget && isPressed
                ? '#2563eb'
                : isTarget
                  ? '#4ca4ff'
                  : isPressed
                    ? '#d4d2ca'
                    : '#f2f1ed';
            const shadowColor =
              isTarget && isPressed
                ? '#1d4ed8'
                : isTarget
                  ? '#2e86de'
                  : '#d6d4cc';
            const shadowH = Math.max(1.5, wk.len * shadowRatio);
            const isC = wk.midi % 12 === 0;

            return (
              <g key={wk.midi}>
                <path
                  d={bottomRoundedRectPath(wk.x, 0, wk.w, wk.len, whiteRadius)}
                  fill={fill}
                />
                <rect
                  x={wk.x + 0.5}
                  y={Math.max(0, wk.len - shadowH)}
                  width={Math.max(0, wk.w - 1)}
                  height={shadowH}
                  rx={whiteRadius * 0.6}
                  fill={shadowColor}
                />
                {showLabels && isC && (
                  wk.midi === 60 ? (
                    <text
                      x={wk.x + wk.w / 2}
                      y={wk.len - shadowH - 13}
                      textAnchor="middle"
                      fontSize={isTablet ? 10.5 : 8}
                      fontWeight="700"
                      fill={isTarget ? '#ffffff' : '#1d4ed8'}
                      pointerEvents="none"
                    >
                      <tspan x={wk.x + wk.w / 2} dy="0">
                        {displayNoteName(wk.midi)}
                      </tspan>
                      <tspan x={wk.x + wk.w / 2} dy="9">
                        中央Do
                      </tspan>
                    </text>
                  ) : (
                    <text
                      x={wk.x + wk.w / 2}
                      y={wk.len - shadowH - 5}
                      textAnchor="middle"
                      fontSize={isTablet ? 11 : 9.5}
                      fontWeight="700"
                      fill={isTarget ? '#ffffff' : '#5f6470'}
                      pointerEvents="none"
                    >
                      {displayNoteName(wk.midi)}
                    </text>
                  )
                )}
              </g>
            );
          })}

          {/* 2. 再畫黑鍵（立體頂面高光＋底部斜面暗色） */}
          {layout.blacks.map((bk: BlackKeyLayout) => {
            const isTarget = targetMidi === bk.midi;
            const isPressed = pressedMidis.has(bk.midi);
            const bodyFill =
              isTarget && isPressed
                ? '#1d4ed8'
                : isTarget
                  ? '#4ca4ff'
                  : isPressed
                    ? '#2b313d'
                    : '#1b1e25';
            const topFill =
              isTarget && isPressed
                ? '#3b82f6'
                : isTarget
                  ? '#76bcff'
                  : isPressed
                    ? '#3f4654'
                    : '#363b47';
            const bevelFill =
              isTarget ? '#2563eb' : '#0f1117';

            const highlightW = bk.w * 0.64;
            const highlightX = bk.x + (bk.w - highlightW) / 2;
            const highlightH = bk.len * 0.82;
            const bevelH = Math.max(2, bk.len * 0.14);

            return (
              <g key={bk.midi}>
                <path
                  d={bottomRoundedRectPath(bk.x, 0, bk.w, bk.len, blackRadius)}
                  fill={bodyFill}
                />
                {!collapsed && (
                  <>
                    <rect
                      x={highlightX}
                      y={0}
                      width={highlightW}
                      height={highlightH}
                      rx={1.5}
                      fill={topFill}
                    />
                    <path
                      d={bottomRoundedRectPath(
                        bk.x + 1,
                        Math.max(0, bk.len - bevelH),
                        Math.max(0, bk.w - 2),
                        bevelH,
                        blackRadius * 0.7,
                      )}
                      fill={bevelFill}
                      opacity={0.75}
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* 3. 演唱即時音高定位線（加白色描邊以利在目標藍鍵上辨識） */}
          {needleX !== null && (
            <g pointerEvents="none">
              <line
                x1={needleX}
                y1={0}
                x2={needleX}
                y2={keyAreaHeight}
                stroke="#ffffff"
                strokeWidth={5}
              />
              <polygon
                points={`${needleX - 5},0 ${needleX + 5},0 ${needleX},7`}
                fill="#ffffff"
                stroke="#ffffff"
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <line
                x1={needleX}
                y1={0}
                x2={needleX}
                y2={keyAreaHeight}
                stroke={needleColor}
                strokeWidth={3}
              />
              <polygon
                points={`${needleX - 5},0 ${needleX + 5},0 ${needleX},7`}
                fill={needleColor}
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
