import type { PracticeDevice } from './viewportLayout';

export interface ViewportSize {
  width: number;
  height: number;
}

export interface RotationContext {
  rotated: boolean;
  /** 未旋轉前的瀏覽器視窗寬度（px） */
  viewportWidth: number;
}

export interface LocalPoint {
  x: number;
  y: number;
}

export interface LocalRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ResolvedPracticeViewport {
  rotated: boolean;
  isPhone: boolean;
  isPortrait: boolean;
  isTablet: boolean;
  device: PracticeDevice;
  layoutWidth: number;
  layoutHeight: number;
  rotationCtx: RotationContext;
}

/** 讀取目前視窗尺寸（優先使用 visualViewport） */
export function readViewportSize(): ViewportSize {
  if (typeof window === 'undefined') {
    return { width: 844, height: 390 };
  }
  const vv = window.visualViewport;
  return {
    width: Math.round(vv ? vv.width : window.innerWidth),
    height: Math.round(vv ? vv.height : window.innerHeight),
  };
}

/** 判斷目前視窗是否為手機尺寸（含直放與橫放） */
export function isPhoneViewport(width: number, height: number): boolean {
  return Math.min(width, height) < 600;
}

/** 判斷目前視窗是否為直立手機畫面 */
export function isPortraitPhoneViewport(
  width: number,
  height: number,
): boolean {
  return isPhoneViewport(width, height) && height > width;
}

/** 取得目前版面寬高、裝置類型與直／橫向狀態（不再進行 90° 畫面旋轉） */
export function resolvePracticeViewport(
  viewport: ViewportSize,
): ResolvedPracticeViewport;
export function resolvePracticeViewport(
  width: number,
  height: number,
): ResolvedPracticeViewport;
export function resolvePracticeViewport(
  widthOrViewport: number | ViewportSize,
  heightArg?: number,
): ResolvedPracticeViewport {
  const width =
    typeof widthOrViewport === 'number'
      ? widthOrViewport
      : widthOrViewport.width;
  const height =
    typeof widthOrViewport === 'number'
      ? (heightArg ?? 390)
      : widthOrViewport.height;
  const isPhone = isPhoneViewport(width, height);
  const isPortrait = isPhone && height > width;
  const isTablet = !isPhone;
  return {
    rotated: false,
    isPhone,
    isPortrait,
    isTablet,
    device: isPhone ? 'phone' : 'tablet',
    layoutWidth: width,
    layoutHeight: height,
    rotationCtx: {
      rotated: false,
      viewportWidth: width,
    },
  };
}

/** 將螢幕 client 座標轉換為局部座標（已取消畫面旋轉，保留函式介面並回傳恆等座標） */
export function toLocalPoint(
  clientX: number,
  clientY: number,
  _ctx?: RotationContext,
): LocalPoint {
  return { x: clientX, y: clientY };
}

/** 將 DOMRect 換算為局部座標矩形（已取消畫面旋轉，保留函式介面並回傳原值） */
export function toLocalRect(
  rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>,
  _ctx?: RotationContext,
): LocalRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}
