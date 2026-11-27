import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

export interface HoldRepeatOptions {
  onStep: () => void;
  disabled: boolean;
  delayMs?: number;
  intervalMs?: number;
}

/** 按鈕短按觸發一次、長按超過 delayMs 後每 intervalMs 連續觸發，放開或 disabled 時停止 */
export function useHoldRepeat({
  onStep,
  disabled,
  delayMs = 400,
  intervalMs = 80,
}: HoldRepeatOptions) {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const delayTimerRef = useRef<number | null>(null);
  const intervalTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (delayTimerRef.current !== null) {
      window.clearTimeout(delayTimerRef.current);
      delayTimerRef.current = null;
    }
    if (intervalTimerRef.current !== null) {
      window.clearInterval(intervalTimerRef.current);
      intervalTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    if (suppressClickRef.current) {
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
      suppressResetTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        suppressResetTimerRef.current = null;
      }, 60);
    }
  }, [clearTimers]);

  useEffect(() => {
    if (disabled) {
      clearTimers();
    }
  }, [disabled, clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
    };
  }, [clearTimers, stop]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabledRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    clearTimers();
    if (suppressResetTimerRef.current !== null) {
      window.clearTimeout(suppressResetTimerRef.current);
      suppressResetTimerRef.current = null;
    }
    suppressClickRef.current = true;
    onStepRef.current();

    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    delayTimerRef.current = window.setTimeout(() => {
      delayTimerRef.current = null;
      if (disabledRef.current) {
        stop();
        return;
      }
      onStepRef.current();
      intervalTimerRef.current = window.setInterval(() => {
        if (disabledRef.current) {
          stop();
          return;
        }
        onStepRef.current();
      }, intervalMs);
    }, delayMs);
  };

  const onClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
        suppressResetTimerRef.current = null;
      }
      return;
    }
    if (disabledRef.current) return;
    onStepRef.current();
  };

  return {
    onPointerDown,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onClick,
  };
}
