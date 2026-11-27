import { useEffect, useRef, useState } from 'react';
import { readViewportSize, type ViewportSize } from './viewportRotation';

const KEYBOARD_DISMISS_SETTLE_MS = 350;

function isEditableElementFocused(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  const tag = active.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (active as HTMLElement).isContentEditable === true
  );
}

/**
 * 追蹤視窗大小，並在輸入鎖定期間（及鍵盤收合動畫緩衝期）暫停重算，
 * 避免 iOS 虛擬鍵盤彈出或收合時造成旋轉直放版面跳動。
 */
export function usePracticeViewport(locked: boolean): ViewportSize {
  const [viewport, setViewport] = useState<ViewportSize>(readViewportSize);
  const lockedRef = useRef(locked);
  const prevLockedRef = useRef(locked);
  const coolingDownRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);

  lockedRef.current = locked;

  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = locked;

    if (locked) {
      coolingDownRef.current = false;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      return;
    }

    if (wasLocked) {
      coolingDownRef.current = true;
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        coolingDownRef.current = false;
        if (!lockedRef.current && !isEditableElementFocused()) {
          if (typeof window !== 'undefined' && (window.scrollX !== 0 || window.scrollY !== 0)) {
            window.scrollTo(0, 0);
          }
          setViewport(readViewportSize());
        }
      }, KEYBOARD_DISMISS_SETTLE_MS);
    }
  }, [locked]);

  useEffect(() => {
    let rafId = 0;
    const onResize = () => {
      if (
        lockedRef.current ||
        coolingDownRef.current ||
        isEditableElementFocused()
      ) {
        return;
      }
      setViewport(readViewportSize());
    };
    const onOrientation = () => {
      onResize();
      rafId = requestAnimationFrame(onResize);
    };
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientation);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onResize);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientation);
      vv?.removeEventListener('resize', onResize);
    };
  }, []);

  return viewport;
}
