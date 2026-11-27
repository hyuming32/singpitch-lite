import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { KeyBlock } from '../../core/exercise';
import { tonicLabel } from './layout';
import {
  toLocalPoint,
  toLocalRect,
  type RotationContext,
} from './viewportRotation';

interface KeyStripProps {
  keys: readonly KeyBlock[];
  /** 目前正在唱的方塊在完整序列中的索引（無對應時為 -1） */
  activeFullKeyIndex: number;
  /** 目前正在唱的調在當前練習序列中的位置（用於判斷已唱過） */
  activeExerciseKeyIndex: number;
  onlySelected: boolean;
  selectedIndices: readonly number[];
  isTablet: boolean;
  isPortrait?: boolean;
  leadingSlot?: ReactNode;
  rotationCtx: RotationContext;
  onToggleKey: (fullKeyIndex: number) => void;
  onJumpToKey: (fullKeyIndex: number) => void;
  onReorderSelected: (fromOrderIdx: number, toOrderIdx: number) => void;
}

interface DragState {
  chipIndex: number;
  fromOrderIdx: number;
  dx: number;
  hoverToOrderIdx: number;
}

interface PressState {
  pointerId: number;
  chipIndex: number;
  orderIdx: number;
  startX: number;
  startY: number;
  startCenterX: number;
  timerId: number | null;
  dragging: boolean;
  movedTooMuch: boolean;
}

const LONG_PRESS_MS = 350;
const DOUBLE_TAP_MS = 260;

/** 上方標題列的調名方塊列：永遠顯示完整序列，支援選取編號、長按 350ms 左右拖動排序、雙擊跳調與自動捲動 */
export function KeyStrip({
  keys,
  activeFullKeyIndex,
  activeExerciseKeyIndex,
  onlySelected,
  selectedIndices,
  isTablet,
  isPortrait = false,
  leadingSlot,
  rotationCtx,
  onToggleKey,
  onJumpToKey,
  onReorderSelected,
}: KeyStripProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const pressRef = useRef<PressState | null>(null);
  const lastTapRef = useRef<{ chipIndex: number; time: number } | null>(null);
  const pendingClickRef = useRef<{
    chipIndex: number;
    timerId: number;
  } | null>(null);
  const lastDblJumpRef = useRef(0);

  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  // 目前的方塊自動捲動到可見範圍（扣除右緣漸層區）
  useEffect(() => {
    if (dragState || activeFullKeyIndex < 0) return;
    const container = stripRef.current;
    const el = chipRefs.current.get(activeFullKeyIndex);
    if (!container || !el) return;
    const cRect = toLocalRect(container.getBoundingClientRect(), rotationCtx);
    const eRect = toLocalRect(el.getBoundingClientRect(), rotationCtx);
    if (eRect.left < cRect.left + 6 || eRect.right > cRect.right - 22) {
      const targetLeft =
        el.offsetLeft - container.clientWidth / 2 + el.offsetWidth / 2;
      container.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth',
      });
    }
  }, [activeFullKeyIndex, keys.length, dragState, rotationCtx]);

  useEffect(() => {
    return () => {
      if (pressRef.current?.timerId !== null && pressRef.current?.timerId !== undefined) {
        window.clearTimeout(pressRef.current.timerId);
      }
      if (pendingClickRef.current) {
        window.clearTimeout(pendingClickRef.current.timerId);
      }
    };
  }, []);

  function getOrderIdx(chipIndex: number): number {
    return selectedIndices.indexOf(chipIndex);
  }

  function findClosestSelectedOrder(draggedCenterX: number, fallbackOrderIdx: number): number {
    let bestOrder = fallbackOrderIdx;
    let bestDist = Infinity;

    for (let i = 0; i < keys.length; i++) {
      const orderIdx = getOrderIdx(i);
      if (orderIdx === -1) continue;
      const el = chipRefs.current.get(i);
      if (!el) continue;
      const r = toLocalRect(el.getBoundingClientRect(), rotationCtx);
      const midX = r.left + r.width / 2;
      const dist = Math.abs(draggedCenterX - midX);
      if (dist < bestDist) {
        bestDist = dist;
        bestOrder = orderIdx;
      }
    }
    return bestOrder;
  }

  function handlePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    chipIndex: number,
  ) {
    if (e.button !== 0 && e.pointerType === 'mouse') {
      return;
    }

    const orderIdx = getOrderIdx(chipIndex);
    const rect = toLocalRect(
      e.currentTarget.getBoundingClientRect(),
      rotationCtx,
    );
    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const startCenterX = rect.left + rect.width / 2;

    if (pressRef.current?.timerId !== null && pressRef.current?.timerId !== undefined) {
      window.clearTimeout(pressRef.current.timerId);
    }

    const press: PressState = {
      pointerId: e.pointerId,
      chipIndex,
      orderIdx,
      startX: pt.x,
      startY: pt.y,
      startCenterX,
      timerId: null,
      dragging: false,
      movedTooMuch: false,
    };

    // 只有已選取的方塊才支援長按 350ms 拖動排序；未選取長按無作用
    if (orderIdx !== -1) {
      const targetEl = e.currentTarget;
      press.timerId = window.setTimeout(() => {
        if (pressRef.current !== press || press.movedTooMuch) {
          return;
        }
        press.timerId = null;
        press.dragging = true;
        try {
          targetEl.setPointerCapture(press.pointerId);
        } catch {
          // 忽略部分環境不支援 setPointerCapture 的情況
        }
        setDragState({
          chipIndex,
          fromOrderIdx: orderIdx,
          dx: 0,
          hoverToOrderIdx: orderIdx,
        });
      }, LONG_PRESS_MS);
    }

    pressRef.current = press;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;

    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const dx = pt.x - press.startX;
    const dy = pt.y - press.startY;

    if (!press.dragging) {
      if (Math.hypot(dx, dy) > 6) {
        press.movedTooMuch = true;
        if (press.timerId !== null) {
          window.clearTimeout(press.timerId);
          press.timerId = null;
        }
      }
      return;
    }

    e.preventDefault();
    const hoverTo = findClosestSelectedOrder(
      press.startCenterX + dx,
      press.orderIdx,
    );
    setDragState({
      chipIndex: press.chipIndex,
      fromOrderIdx: press.orderIdx,
      dx,
      hoverToOrderIdx: hoverTo,
    });
  }

  function handlePointerEnd(e: React.PointerEvent<HTMLButtonElement>) {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    pressRef.current = null;

    if (press.timerId !== null) {
      window.clearTimeout(press.timerId);
      press.timerId = null;
    }

    if (press.dragging) {
      const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
      const dx = pt.x - press.startX;
      const finalTo =
        e.type === 'pointerup'
          ? findClosestSelectedOrder(press.startCenterX + dx, press.orderIdx)
          : (dragStateRef.current?.hoverToOrderIdx ?? press.orderIdx);
      setDragState(null);
      if (e.type === 'pointerup' && finalTo !== press.orderIdx) {
        onReorderSelected(press.orderIdx, finalTo);
      }
      return;
    }

    if (e.type !== 'pointerup' || press.movedTooMuch) {
      return;
    }

    const now = performance.now();
    const prevTap = lastTapRef.current;
    if (
      prevTap &&
      prevTap.chipIndex === press.chipIndex &&
      now - prevTap.time < DOUBLE_TAP_MS
    ) {
      // 雙擊：跳到該調開始，不切換選取
      if (pendingClickRef.current) {
        window.clearTimeout(pendingClickRef.current.timerId);
        pendingClickRef.current = null;
      }
      lastTapRef.current = null;
      lastDblJumpRef.current = now;
      onJumpToKey(press.chipIndex);
      return;
    }

    // 若前一次點擊的是另一顆方塊，立即送出其選取切換
    if (pendingClickRef.current) {
      window.clearTimeout(pendingClickRef.current.timerId);
      onToggleKey(pendingClickRef.current.chipIndex);
      pendingClickRef.current = null;
    }

    const chipIdx = press.chipIndex;
    lastTapRef.current = { chipIndex: chipIdx, time: now };
    const timerId = window.setTimeout(() => {
      pendingClickRef.current = null;
      onToggleKey(chipIdx);
    }, DOUBLE_TAP_MS - 20);
    pendingClickRef.current = { chipIndex: chipIdx, timerId };
  }

  function handleDoubleClick(chipIndex: number) {
    const now = performance.now();
    if (now - lastDblJumpRef.current < 320) {
      return;
    }
    if (pendingClickRef.current?.chipIndex === chipIndex) {
      window.clearTimeout(pendingClickRef.current.timerId);
      pendingClickRef.current = null;
    }
    lastTapRef.current = null;
    lastDblJumpRef.current = now;
    onJumpToKey(chipIndex);
  }

  return (
    <div
      className={`key-strip-wrap ${isTablet ? 'is-tablet' : ''} ${isPortrait ? 'is-portrait' : ''}`}
    >
      <div
        ref={stripRef}
        className={`key-strip ${dragState ? 'is-dragging' : ''}`}
        role="list"
        aria-label="調名清單"
      >
        {leadingSlot}
        {keys.map((kb, idx) => {
          const isCurrent = idx === activeFullKeyIndex;
          const orderIdx = getOrderIdx(idx);
          const isSelected = orderIdx !== -1;
          const isPast = onlySelected
            ? isSelected && orderIdx < activeExerciseKeyIndex
            : idx < activeExerciseKeyIndex;
          const isFilteredOut = onlySelected && !isSelected;
          const isDraggingThis = dragState?.chipIndex === idx;
          const isDropTarget =
            dragState !== null &&
            !isDraggingThis &&
            isSelected &&
            dragState.hoverToOrderIdx === orderIdx;
          const label = tonicLabel(kb.key);

          const classes = [
            'key-chip',
            isCurrent ? 'is-current' : '',
            !isCurrent && isPast ? 'is-past' : '',
            isFilteredOut ? 'is-filtered-out' : '',
            isSelected ? 'is-selected' : '',
            isDraggingThis ? 'is-dragging' : '',
            isDropTarget ? 'is-drop-target' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={`key-chip-${idx}-${kb.tonicMidi}`}
              ref={(el) => {
                if (el) {
                  chipRefs.current.set(idx, el);
                } else {
                  chipRefs.current.delete(idx);
                }
              }}
              type="button"
              role="listitem"
              className={classes}
              style={
                isDraggingThis
                  ? {
                      transform: `translateX(${dragState.dx}px) scale(1.08)`,
                    }
                  : undefined
              }
              aria-label={`${label} 調${isSelected ? `，已選第 ${orderIdx + 1} 順位` : ''}${isCurrent ? '，目前正在唱' : ''}`}
              aria-pressed={isSelected}
              onPointerDown={(e) => handlePointerDown(e, idx)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onDoubleClick={() => handleDoubleClick(idx)}
              onClick={(e) => {
                // 僅處理鍵盤觸發（e.detail === 0），滑鼠與觸控由 pointer events 統一處理
                if (e.detail === 0) {
                  onToggleKey(idx);
                }
              }}
            >
              <span className="key-chip-label">{label}</span>
              {isSelected && (
                <span className="key-chip-badge" aria-hidden="true">
                  {orderIdx + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
