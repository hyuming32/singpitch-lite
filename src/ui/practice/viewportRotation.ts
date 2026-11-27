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

/** 判斷目前視窗是否為需旋轉 90° 的直立手機畫面 */
export function isPortraitPhoneViewport(
  width: number,
  height: number,
): boolean {
  return isPhoneViewport(width, height) && height > width;
}

/** 取得目前旋轉後的版面寬高、裝置類型與旋轉狀態 */
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
  const rotated = isPhone && height > width;
  const isTablet = !isPhone;
  return {
    rotated,
    isPhone,
    isTablet,
    device: isPhone ? 'phone' : 'tablet',
    layoutWidth: rotated ? height : width,
    layoutHeight: rotated ? width : height,
    rotationCtx: {
      rotated,
      viewportWidth: width,
    },
  };
}

function defaultRotationContext(): RotationContext {
  if (typeof window === 'undefined') {
    return { rotated: false, viewportWidth: 844 };
  }
  const vp = readViewportSize();
  return {
    rotated: isPortraitPhoneViewport(vp.width, vp.height),
    viewportWidth: vp.width,
  };
}

/**
 * 將螢幕 client 座標轉換為練唱頁容器內的局部座標：
 * - 未旋轉：{ x: clientX, y: clientY }
 * - 直立手機順時針 90°（逆時針拿橫時為正）旋轉：{ x: clientY, y: viewportWidth - clientX }
 */
export function toLocalPoint(
  clientX: number,
  clientY: number,
  ctx: RotationContext = defaultRotationContext(),
): LocalPoint {
  if (!ctx.rotated) {
    return { x: clientX, y: clientY };
  }
  return {
    x: clientY,
    y: ctx.viewportWidth - clientX,
  };
}

/** 將 getBoundingClientRect() 的螢幕矩形換算為容器內的局部座標矩形 */
export function toLocalRect(
  rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>,
  ctx: RotationContext = defaultRotationContext(),
): LocalRect {
  if (!ctx.rotated) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }
  const tl = toLocalPoint(rect.right, rect.top, ctx);
  const br = toLocalPoint(rect.left, rect.bottom, ctx);
  return {
    left: tl.x,
    top: tl.y,
    right: br.x,
    bottom: br.y,
    width: br.x - tl.x,
    height: br.y - tl.y,
  };
}
