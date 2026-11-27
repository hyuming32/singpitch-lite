import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { flushSync } from 'react-dom';
import {
  filterBpmInputChars,
  formatBpm,
  parseBpmInput,
} from '../state/settings';

export interface UseBpmEditOptions {
  bpm: number;
  onCommit: (nextBpm: number) => void;
  onEditingChange?: (editing: boolean) => void;
}

/** 管理 BPM 直接輸入狀態：點數字開啟小數輸入框並全選，Enter／失焦套用，Esc 取消 */
export function useBpmEdit({
  bpm,
  onCommit,
  onEditingChange,
}: UseBpmEditOptions) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatBpm(bpm));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const finishedRef = useRef(false);

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;

  useEffect(() => {
    if (!editing) {
      setDraft(formatBpm(bpm));
    }
  }, [bpm, editing]);

  const startEdit = () => {
    if (editing) return;
    finishedRef.current = false;
    onEditingChangeRef.current?.(true);
    flushSync(() => {
      setDraft(formatBpm(bpm));
      setEditing(true);
    });
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        // 忽略部分測試或瀏覽器環境不支援 setSelectionRange 的情況
      }
    }
  };

  const commit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const parsed = parseBpmInput(draft);
    setEditing(false);
    onEditingChangeRef.current?.(false);
    if (parsed !== null && parsed !== bpm) {
      onCommitRef.current(parsed);
    } else {
      setDraft(formatBpm(bpm));
    }
  };

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setDraft(formatBpm(bpm));
    setEditing(false);
    onEditingChangeRef.current?.(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(filterBpmInputChars(e.target.value));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const handleBlur = () => {
    commit();
  };

  return {
    editing,
    startEdit,
    inputProps: {
      ref: inputRef,
      type: 'text' as const,
      inputMode: 'decimal' as const,
      enterKeyHint: 'done' as const,
      value: draft,
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onBlur: handleBlur,
      'aria-label': '輸入速度（BPM）',
    },
  };
}
