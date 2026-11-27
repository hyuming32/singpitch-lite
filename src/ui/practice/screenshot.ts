import {
  solfegeName,
  toJianpu,
  type JianpuMode,
} from '../../core/jianpu';
import type { Key } from '../../core/key';
import type { RepeatsPerKeyOption } from '../../state/settings';
import type { NoteGlyph } from './layout';

export const SCREENSHOT_BG_COLOR = '#f6f4ee';
const MAX_DPR = 3;
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

const CSS_VAR_FALLBACKS: Record<string, string> = {
  '--text': '#2c2c2a',
  '--text-muted': '#5f5e5a',
  '--blue': '#185fa5',
  '--orange': '#ef9f27',
};

export interface ScreenshotLineInput {
  isCurrent: boolean;
  isPreviewLine: boolean;
  lineKey: Key;
  lineTonicMidi: number;
  glyphs: NoteGlyph[];
  activeNoteIdx: number;
  playheadX: number | null;
  activeNoteX: number | null;
  lineLabel: string | null;
  octaveTag: string | null;
  svgElement: SVGSVGElement | null;
}

export interface PracticeScreenshotParams {
  patternName: string;
  keyLabel: string;
  keyIndex: number;
  totalKeys: number;
  passNum: number;
  repeatsPerKey: RepeatsPerKeyOption;
  phase?: 'listen' | 'sing';
  sec: number;
  jianpuMode: JianpuMode;
  scoreWidth: number;
  jianpuHeight: number;
  staffHeight: number;
  isTablet: boolean;
  isPortrait: boolean;
  lines: ScreenshotLineInput[];
  date?: Date;
}

/** 判斷目前是否處於可截圖的暫停狀態（未播放且播放秒數大於 0） */
export function canScreenshot(playing: boolean, sec: number): boolean {
  return !playing && Number.isFinite(sec) && sec > 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function sanitizeFilePart(value: string, fallback: string): string {
  const cleaned = value.replace(INVALID_FILENAME_CHARS, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/** 產生截圖 PNG 檔名：SingPitch_<圖案名>_<調名>_<YYYYMMDD-HHmmss>.png */
export function screenshotFileName(
  patternName: string,
  keyName: string,
  date: Date = new Date(),
): string {
  const safePattern = sanitizeFilePart(patternName, '練習');
  const safeKey = sanitizeFilePart(keyName, 'C');
  const stamp =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `SingPitch_${safePattern}_${safeKey}_${stamp}.png`;
}

/** 格式化截圖上方資訊列的本地日期時間（YYYY/MM/DD HH:mm） */
export function formatScreenshotTimestamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** 組合截圖上方資訊文字（圖案名、調名、第幾調／第幾遍） */
export function formatScreenshotHeader(info: {
  patternName: string;
  keyLabel: string;
  keyIndex: number;
  totalKeys: number;
  passNum: number;
  repeatsPerKey: RepeatsPerKeyOption;
  phase?: 'listen' | 'sing';
}): string {
  const keyProgress =
    info.totalKeys > 0
      ? `第 ${info.keyIndex + 1}/${info.totalKeys} 調`
      : '';
  const passProgress =
    info.phase === 'listen'
      ? '示範'
      : info.repeatsPerKey === 'inf'
        ? `第 ${info.passNum} 遍`
        : `第 ${info.passNum}/${info.repeatsPerKey} 遍`;
  return [info.patternName, `${info.keyLabel} 調`, keyProgress, passProgress]
    .filter((part) => part.length > 0)
    .join(' · ');
}

function replaceCssVars(value: string): string {
  return value.replace(
    /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g,
    (_, varName: string, fallback?: string) => {
      return CSS_VAR_FALLBACKS[varName] ?? fallback?.trim() ?? '#2c2c2a';
    },
  );
}

/**
 * 將 SVG 字串整理成可獨立載入繪製的格式：
 * 補上 xmlns、明確寬高、內嵌預設字型與展開常見 CSS 變數顏色。
 */
export function prepareSvgForScreenshot(
  svgMarkup: string,
  width: number,
  height: number,
  options?: {
    defaultFill?: string;
    defaultStroke?: string;
    fontFamily?: string;
  },
): string {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const fontFamily =
    options?.fontFamily ??
    '-apple-system, BlinkMacSystemFont, "Noto Sans TC", "PingFang TC", sans-serif';

  let out = replaceCssVars(svgMarkup.trim());
  if (options?.defaultFill) {
    out = out.replace(/fill="currentColor"/gi, `fill="${options.defaultFill}"`);
  }
  if (options?.defaultStroke) {
    out = out.replace(
      /stroke="currentColor"/gi,
      `stroke="${options.defaultStroke}"`,
    );
  }

  out = out.replace(/<svg\b([^>]*)>/i, (_match, rawAttrs: string) => {
    let attrs = rawAttrs;
    if (!/\bxmlns\s*=/.test(attrs)) {
      attrs += ' xmlns="http://www.w3.org/2000/svg"';
    }
    if (/\bwidth\s*=/.test(attrs)) {
      attrs = attrs.replace(/\bwidth\s*=\s*(['"])[^'"]*\1/, `width="${safeW}"`);
    } else {
      attrs += ` width="${safeW}"`;
    }
    if (/\bheight\s*=/.test(attrs)) {
      attrs = attrs.replace(
        /\bheight\s*=\s*(['"])[^'"]*\1/,
        `height="${safeH}"`,
      );
    } else {
      attrs += ` height="${safeH}"`;
    }
    if (!/\bstyle\s*=/.test(attrs)) {
      attrs += ` style="font-family: ${fontFamily.replace(/"/g, "'")}"`;
    }
    return `<svg${attrs}>`;
  });

  return out;
}

/** 複製 SVG 節點並序列化為可獨立繪製的字串（不修改畫面上的原始 DOM） */
export function serializeSvgElement(
  svgEl: SVGSVGElement,
  width: number,
  height: number,
): string {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;

  const canReadStyle = typeof getComputedStyle === 'function';
  if (canReadStyle) {
    const origNodes = svgEl.querySelectorAll('*');
    const cloneNodes = clone.querySelectorAll('*');
    for (let i = 0; i < cloneNodes.length; i++) {
      const orig = origNodes[i];
      const target = cloneNodes[i];
      if (!orig || !target) continue;

      const fillAttr = target.getAttribute('fill');
      const strokeAttr = target.getAttribute('stroke');
      const cs = getComputedStyle(orig);

      if (
        fillAttr &&
        (fillAttr.includes('var(') || fillAttr === 'currentColor') &&
        cs.fill
      ) {
        target.setAttribute('fill', cs.fill);
      }
      if (
        strokeAttr &&
        (strokeAttr.includes('var(') || strokeAttr === 'currentColor') &&
        cs.stroke
      ) {
        target.setAttribute('stroke', cs.stroke);
      }
    }
  }

  const raw = new XMLSerializer().serializeToString(clone);
  return prepareSvgForScreenshot(raw, width, height);
}

function loadSvgImage(svgString: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('無法載入五線譜 SVG 影像'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  });
}

function drawJianpuStripOnCanvas(
  ctx: CanvasRenderingContext2D,
  line: ScreenshotLineInput,
  yOffset: number,
  jianpuHeight: number,
  sec: number,
  jianpuMode: JianpuMode,
  isTablet: boolean,
  isPortrait: boolean,
): void {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "Noto Sans TC", "PingFang TC", sans-serif';

  // 左側標籤（調性／遍數／八度位移）
  const tagX = isTablet ? 14 : isPortrait ? 8 : 10;
  const tagY = yOffset + jianpuHeight * 0.52;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  let nextTagX = tagX;
  if (line.lineLabel) {
    const labelSize = isTablet ? 13 : isPortrait ? 9.5 : 10;
    ctx.font = `${line.isPreviewLine ? 700 : 600} ${labelSize}px ${fontStack}`;
    ctx.fillStyle = line.isPreviewLine ? '#185fa5' : '#5f5e5a';
    ctx.fillText(line.lineLabel, nextTagX, tagY);
    nextTagX += ctx.measureText(line.lineLabel).width + (isTablet ? 6 : 4);
  }
  if (line.octaveTag) {
    const octSize = isTablet ? 12 : isPortrait ? 9.5 : 10;
    ctx.font = `600 ${octSize}px ${fontStack}`;
    ctx.fillStyle = '#7b7970';
    ctx.fillText(line.octaveTag, nextTagX, tagY);
  }
  ctx.restore();

  // 簡譜數字（水平對齊五線譜音符 x）
  const digitSize = isTablet ? 38 : isPortrait ? 15 : 18;
  const accSize = isTablet ? 20 : isPortrait ? 10 : 12;
  const dotSize = isTablet ? 10 : 7;
  const solfegeSize = 12;
  const baseBottomY = yOffset + jianpuHeight - 2;

  for (let idx = 0; idx < line.glyphs.length; idx++) {
    const g = line.glyphs[idx]!;
    const jp = toJianpu(g.midi, line.lineKey, jianpuMode, line.lineTonicMidi);
    const upDots = jp.octave > 0 ? jp.octave : 0;
    const downDots = jp.octave < 0 ? Math.abs(jp.octave) : 0;

    let color = '#2c2c2a';
    if (idx === line.activeNoteIdx) {
      color = '#185fa5';
    } else if (
      (line.activeNoteIdx >= 0 && idx < line.activeNoteIdx) ||
      (line.isCurrent && sec >= g.start + g.dur)
    ) {
      color = '#888780';
    }

    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';

    let digitCenterY = baseBottomY - (downDots > 0 ? dotSize * 0.85 : 0);
    digitCenterY -= digitSize * 0.42;

    if (jp.accidental) {
      ctx.font = `700 ${digitSize}px ${fontStack}`;
      const digitW = ctx.measureText(jp.digit).width;
      ctx.font = `700 ${accSize}px ${fontStack}`;
      const accW = ctx.measureText(jp.accidental).width;
      const totalW = accW + 1 + digitW;
      const startX = g.x - totalW / 2;

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(jp.accidental, startX, digitCenterY);
      ctx.font = `700 ${digitSize}px ${fontStack}`;
      ctx.fillText(jp.digit, startX + accW + 1, digitCenterY);
    } else {
      ctx.font = `700 ${digitSize}px ${fontStack}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(jp.digit, g.x, digitCenterY);
    }

    // 上／下八度點
    ctx.font = `700 ${dotSize}px ${fontStack}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (upDots > 0) {
      ctx.fillText(
        '•'.repeat(upDots),
        g.x,
        digitCenterY - digitSize * 0.55,
      );
    }
    if (downDots > 0) {
      ctx.fillText(
        '•'.repeat(downDots),
        g.x,
        baseBottomY - dotSize * 0.35,
      );
    }

    // 平板顯示唱名
    if (isTablet) {
      const solfege = solfegeName(g.midi, line.lineKey, jianpuMode);
      if (solfege) {
        ctx.font = `600 ${solfegeSize}px ${fontStack}`;
        ctx.fillText(
          solfege,
          g.x,
          digitCenterY - digitSize * 0.55 - (upDots > 0 ? dotSize + 4 : 4),
        );
      }
    }

    ctx.restore();
  }
}

/** 將目前練唱譜面（資訊列、簡譜帶、五線譜 SVG、演唱黃線與播放位置線）繪製到 Canvas */
export async function renderPracticeScreenshotCanvas(
  params: PracticeScreenshotParams,
): Promise<HTMLCanvasElement> {
  const date = params.date ?? new Date();
  const dpr = Math.min(
    MAX_DPR,
    Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
  );
  const padX = params.isTablet ? 20 : 12;
  const headerH = params.isTablet ? 40 : 30;
  const lineH = params.jianpuHeight + params.staffHeight;
  const lineGap = params.lines.length > 1 ? (params.isTablet ? 10 : 6) : 0;
  const padBottom = params.isTablet ? 16 : 10;

  const logicalW = Math.max(240, Math.round(params.scoreWidth) + padX * 2);
  const logicalH =
    headerH +
    params.lines.length * lineH +
    Math.max(0, params.lines.length - 1) * lineGap +
    padBottom;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(logicalW * dpr);
  canvas.height = Math.round(logicalH * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('無法建立畫布繪圖環境');
  }
  ctx.scale(dpr, dpr);

  // 譜面紙張底色
  ctx.fillStyle = SCREENSHOT_BG_COLOR;
  ctx.fillRect(0, 0, logicalW, logicalH);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "Noto Sans TC", "PingFang TC", sans-serif';

  // 頂部資訊列
  const headerText = formatScreenshotHeader({
    patternName: params.patternName,
    keyLabel: params.keyLabel,
    keyIndex: params.keyIndex,
    totalKeys: params.totalKeys,
    passNum: params.passNum,
    repeatsPerKey: params.repeatsPerKey,
    phase: params.phase,
  });
  const timeText = formatScreenshotTimestamp(date);
  const headerFontSize = params.isTablet ? 14 : 11;

  ctx.save();
  ctx.font = `600 ${headerFontSize}px ${fontStack}`;
  ctx.fillStyle = '#2c2c2a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(headerText, padX, headerH / 2);

  ctx.font = `500 ${headerFontSize}px ${fontStack}`;
  ctx.fillStyle = '#5f5e5a';
  ctx.textAlign = 'right';
  ctx.fillText(timeText, logicalW - padX, headerH / 2);

  ctx.strokeStyle = 'rgba(44, 44, 42, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, headerH - 0.5);
  ctx.lineTo(logicalW - padX, headerH - 0.5);
  ctx.stroke();
  ctx.restore();

  // 先並行載入每行五線譜 SVG 影像
  const svgImages = await Promise.all(
    params.lines.map(async (line) => {
      if (!line.svgElement) return null;
      const svgMarkup = serializeSvgElement(
        line.svgElement,
        params.scoreWidth,
        params.staffHeight,
      );
      return loadSvgImage(svgMarkup);
    }),
  );

  // 依序繪製每一行（分隔線、目前音淡藍直條、簡譜帶、五線譜 SVG、播放位置虛線）
  for (let i = 0; i < params.lines.length; i++) {
    const line = params.lines[i]!;
    const lineTop = headerH + i * (lineH + lineGap);

    if (i > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(44, 44, 42, 0.14)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padX, lineTop - lineGap / 2);
      ctx.lineTo(logicalW - padX, lineTop - lineGap / 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    if (line.isPreviewLine) {
      ctx.globalAlpha = 0.55;
    }

    if (line.activeNoteX !== null) {
      const bandW = params.isTablet ? 40 : 28;
      ctx.fillStyle = 'rgba(76, 164, 255, 0.14)';
      ctx.fillRect(
        padX + line.activeNoteX - bandW / 2,
        lineTop,
        bandW,
        lineH,
      );
    }

    ctx.save();
    ctx.translate(padX, 0);
    drawJianpuStripOnCanvas(
      ctx,
      line,
      lineTop,
      params.jianpuHeight,
      params.sec,
      params.jianpuMode,
      params.isTablet,
      params.isPortrait,
    );
    ctx.restore();

    const img = svgImages[i];
    if (img) {
      ctx.drawImage(
        img,
        padX,
        lineTop + params.jianpuHeight,
        params.scoreWidth,
        params.staffHeight,
      );
    }

    if (line.playheadX !== null) {
      ctx.save();
      ctx.strokeStyle = '#185fa5';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padX + line.playheadX, lineTop);
      ctx.lineTo(padX + line.playheadX, lineTop + lineH);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('無法產生 PNG 圖檔'));
      }
    }, 'image/png');
  });
}

export type ScreenshotExportResult =
  | { status: 'shared' | 'downloaded' | 'cancelled' }
  | { status: 'needs-tap'; file: File; title: string };

function isErrorNamed(err: unknown, name: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === name
  );
}

/** 建立暫時下載連結並觸發 PNG 下載 */
export function downloadScreenshotBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    const schedule =
      typeof window !== 'undefined' && typeof window.setTimeout === 'function'
        ? window.setTimeout.bind(window)
        : setTimeout;
    schedule(() => URL.revokeObjectURL(url), 1000);
  }
}

/** 嘗試透過 Web Share 分享截圖，依瀏覽器能力或錯誤類型回傳結果或退回下載 */
export async function shareOrDownloadFile(
  file: File,
  title: string,
): Promise<ScreenshotExportResult> {
  if (typeof navigator !== 'undefined') {
    const shareData: ShareData = {
      files: [file],
      title,
    };
    if (
      typeof navigator.canShare === 'function' &&
      typeof navigator.share === 'function' &&
      navigator.canShare(shareData)
    ) {
      try {
        await navigator.share(shareData);
        return { status: 'shared' };
      } catch (err) {
        if (isErrorNamed(err, 'AbortError')) {
          return { status: 'cancelled' };
        }
        if (isErrorNamed(err, 'NotAllowedError')) {
          return { status: 'needs-tap', file, title };
        }
        throw err;
      }
    }
  }

  downloadScreenshotBlob(file, file.name);
  return { status: 'downloaded' };
}

/** 產生譜面截圖並透過 Web Share 分享或觸發瀏覽器下載 */
export async function exportPracticeScreenshot(
  params: PracticeScreenshotParams,
): Promise<ScreenshotExportResult> {
  const date = params.date ?? new Date();
  const canvas = await renderPracticeScreenshotCanvas({ ...params, date });
  const blob = await canvasToPngBlob(canvas);
  const fileName = screenshotFileName(params.patternName, params.keyLabel, date);
  const title = `${params.patternName} (${params.keyLabel})`;
  const file = new File([blob], fileName, { type: 'image/png' });
  return shareOrDownloadFile(file, title);
}
