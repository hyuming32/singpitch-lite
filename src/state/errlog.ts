export const ERRLOG_STORAGE_KEY = 'singpitch-lite.errlog.v1';
export const MAX_ERRLOG_ENTRIES = 20;
export const MAX_STACK_CHARS = 500;

export type ErrorLogSource =
  | 'onerror'
  | 'unhandledrejection'
  | 'ErrorBoundary';

export interface ErrorLogEntry {
  time: string;
  source: ErrorLogSource;
  message: string;
  stack: string;
  userAgent: string;
  standalone: boolean;
}

export type ErrorLogStorageLike = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export interface RecordErrorInput {
  source: ErrorLogSource;
  message: string;
  stack?: string;
  time?: string;
  userAgent?: string;
  standalone?: boolean;
}

function getDefaultStorage(): ErrorLogStorageLike | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/** 判斷目前是否以獨立 App（standalone / 主畫面 PWA）模式執行 */
export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  const iosStandalone = nav.standalone === true;
  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || mediaStandalone;
}

function normalizeEntry(raw: unknown): ErrorLogEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message !== 'string') {
    return null;
  }
  const source: ErrorLogSource =
    obj.source === 'onerror' ||
    obj.source === 'unhandledrejection' ||
    obj.source === 'ErrorBoundary'
      ? obj.source
      : 'onerror';
  return {
    time: typeof obj.time === 'string' ? obj.time : '',
    source,
    message: obj.message,
    stack: typeof obj.stack === 'string' ? obj.stack.slice(0, MAX_STACK_CHARS) : '',
    userAgent: typeof obj.userAgent === 'string' ? obj.userAgent : '',
    standalone: Boolean(obj.standalone),
  };
}

/** 讀取儲存在 localStorage 的錯誤紀錄（由舊到新） */
export function loadErrorLogs(
  storage: ErrorLogStorageLike | undefined = getDefaultStorage(),
): ErrorLogEntry[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(ERRLOG_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const entries: ErrorLogEntry[] = [];
    for (const item of parsed) {
      const normalized = normalizeEntry(item);
      if (normalized) {
        entries.push(normalized);
      }
    }
    return entries.slice(-MAX_ERRLOG_ENTRIES);
  } catch {
    return [];
  }
}

/** 將新錯誤寫入環形紀錄（最多保留 20 筆、stack 截斷至 500 字） */
export function appendErrorLog(
  input: RecordErrorInput,
  storage: ErrorLogStorageLike | undefined = getDefaultStorage(),
): ErrorLogEntry[] {
  const entry: ErrorLogEntry = {
    time: input.time ?? new Date().toISOString(),
    source: input.source,
    message: String(input.message || '未知錯誤'),
    stack: String(input.stack ?? '').slice(0, MAX_STACK_CHARS),
    userAgent:
      input.userAgent ??
      (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    standalone: input.standalone ?? isStandaloneMode(),
  };

  const prev = loadErrorLogs(storage);
  const next = [...prev, entry].slice(-MAX_ERRLOG_ENTRIES);

  if (storage) {
    try {
      storage.setItem(ERRLOG_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 忽略私密瀏覽或容量限制錯誤
    }
  }
  return next;
}

/** 清除所有錯誤紀錄 */
export function clearErrorLogs(
  storage: ErrorLogStorageLike | undefined = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(ERRLOG_STORAGE_KEY);
  } catch {
    // 忽略錯誤
  }
}

let handlersInstalled = false;

/** 註冊全域 window.onerror 與 unhandledrejection 紀錄器（僅註冊一次） */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined' || handlersInstalled) {
    return;
  }
  handlersInstalled = true;

  const prevOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    const errMsg =
      error instanceof Error
        ? error.message
        : typeof message === 'string'
          ? message
          : String(message);
    const errStack =
      error instanceof Error && error.stack
        ? error.stack
        : `${source ?? ''}:${lineno ?? 0}:${colno ?? 0}`;
    appendErrorLog({
      source: 'onerror',
      message: errMsg,
      stack: errStack,
    });
    if (typeof prevOnError === 'function') {
      return prevOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    const errMsg =
      reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
    const errStack = reason instanceof Error ? (reason.stack ?? '') : '';
    appendErrorLog({
      source: 'unhandledrejection',
      message: errMsg,
      stack: errStack,
    });
  });
}
