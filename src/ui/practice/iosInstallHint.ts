export const IOS_INSTALL_HINT_STORAGE_KEY =
  'singpitch-lite.ios-install-hint-dismissed.v1';

export interface IosInstallHintEnv {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  navigatorStandalone?: boolean;
  mediaStandalone?: boolean;
}

export type HintStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** 判斷目前是否為 iOS 瀏覽器分頁模式（非加入主畫面 standalone 模式） */
export function isIosBrowserMode(env?: IosInstallHintEnv): boolean {
  if (!env) {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      return false;
    }
    const nav = navigator as Navigator & { standalone?: boolean };
    const mediaStandalone =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    return isIosBrowserMode({
      userAgent: navigator.userAgent || '',
      platform: navigator.platform || '',
      maxTouchPoints: navigator.maxTouchPoints || 0,
      navigatorStandalone: nav.standalone === true,
      mediaStandalone,
    });
  }

  const isIos =
    /iPad|iPhone|iPod/.test(env.userAgent) ||
    (env.platform === 'MacIntel' && (env.maxTouchPoints ?? 0) > 1);
  if (!isIos) {
    return false;
  }

  const isStandalone = Boolean(env.navigatorStandalone || env.mediaStandalone);
  return !isStandalone;
}

function getDefaultStorage(): HintStorageLike | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/** 讀取是否已關閉過 iOS 主畫面安裝提示 */
export function readIosInstallHintDismissed(
  storage: HintStorageLike | undefined = getDefaultStorage(),
): boolean {
  try {
    if (!storage) {
      return true;
    }
    return storage.getItem(IOS_INSTALL_HINT_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

/** 記住使用者已關閉（或已看過）iOS 主畫面安裝提示 */
export function markIosInstallHintDismissed(
  storage: HintStorageLike | undefined = getDefaultStorage(),
): void {
  try {
    if (storage) {
      storage.setItem(IOS_INSTALL_HINT_STORAGE_KEY, '1');
    }
  } catch {
    // 忽略私密瀏覽或儲存空間限制錯誤
  }
}
