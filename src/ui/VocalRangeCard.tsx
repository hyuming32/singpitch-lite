import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RANGES } from '../core/notes';
import type { PatternDef } from '../core/patterns';
import {
  MY_RANGE_NAME,
  getRangeBounds,
  type MaleClefOption,
  type PracticeSettings,
} from '../state/settings';
import {
  VOCAL_RANGE_PARTS,
  recommendVoiceRange,
  selectVocalRangePatch,
} from '../state/vocalRange';
import { displayNoteName } from './noteLabel';
import {
  isBlackMidi,
  layoutKeyboard,
  type KeyboardLayout,
} from './piano/pianoGeometry';

export const VOCAL_CARD_LOW_MIDI = 36;
export const VOCAL_CARD_HIGH_MIDI = 86;

const KEY_UNIT_W = 100;
const CARD_KEYBOARD_LAYOUT: KeyboardLayout = layoutKeyboard({
  lowMidi: VOCAL_CARD_LOW_MIDI,
  highMidi: VOCAL_CARD_HIGH_MIDI,
  W: KEY_UNIT_W,
  preset: 'korg',
  height: 220,
});

const OCTAVE_SEGMENTS: readonly {
  low: number;
  high: number;
  color: string;
  label: string;
}[] = [
  { low: 36, high: 47, color: '#4f6d8a', label: 'C2' },
  { low: 48, high: 59, color: '#3b82f6', label: 'C3' },
  { low: 60, high: 71, color: '#22c55e', label: 'C4 中央 Do' },
  { low: 72, high: 83, color: '#eab308', label: 'C5' },
  { low: 84, high: 86, color: '#ec4899', label: 'C6' },
];

const MALE_CLEF_OPTIONS: readonly {
  value: MaleClefOption;
  label: string;
  sub: string;
}[] = [
  { value: 'treble8va', label: '高音譜 8va', sub: '流行' },
  { value: 'bass', label: '低音譜', sub: '古典' },
];

function keyBoundsX(midi: number, layout: KeyboardLayout): [number, number] {
  const clamped = Math.max(
    layout.lowMidi,
    Math.min(layout.highMidi, Math.round(midi)),
  );
  if (!isBlackMidi(clamped)) {
    const wk = layout.whites.find((w) => w.midi === clamped);
    if (wk) return [wk.x, wk.x + wk.w];
  } else {
    const bk = layout.blacks.find((b) => b.midi === clamped);
    if (bk) return [bk.x, bk.x + bk.w];
  }
  return [0, 0];
}

function rangeBoundsPct(
  lowMidi: number,
  highMidi: number,
  layout: KeyboardLayout = CARD_KEYBOARD_LAYOUT,
): { leftPct: number; widthPct: number } {
  const lo = Math.max(
    layout.lowMidi,
    Math.min(layout.highMidi, Math.min(lowMidi, highMidi)),
  );
  const hi = Math.max(
    layout.lowMidi,
    Math.min(layout.highMidi, Math.max(lowMidi, highMidi)),
  );
  const [x0] = keyBoundsX(lo, layout);
  const [, x1] = keyBoundsX(hi, layout);
  const leftPct = (x0 / layout.totalWidth) * 100;
  const widthPct = Math.max(1.5, ((x1 - x0) / layout.totalWidth) * 100);
  return { leftPct, widthPct };
}

function estimateSegmentWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === ' ') {
      w += 0.38 * fontSize;
    } else if (code <= 0x7f) {
      w += 0.62 * fontSize;
    } else {
      w += 1.0 * fontSize;
    }
  }
  return w;
}

export interface RangeBarLayoutResult {
  requiredWidth12: number;
  minWidthPx: number;
  compactEnglish: boolean;
}

/** 依中文 1em、英文大寫 0.62em、預設字級 12px 計算音域色條最小寬度；超出軌道寬時英文字級縮至 10px */
export function computeRangeBarLayout(params: {
  leftSegments: readonly string[];
  rightSegments: readonly string[];
  englishText?: string;
  trackWidth?: number | null;
}): RangeBarLayoutResult {
  const { leftSegments, rightSegments, englishText, trackWidth } = params;
  const calcRequired = (enSize: number) => {
    let textW = 0;
    for (const seg of leftSegments) {
      const size = seg === englishText ? enSize : 12;
      textW += estimateSegmentWidth(seg, size);
    }
    for (const seg of rightSegments) {
      textW += estimateSegmentWidth(seg, 12);
    }
    const leftGaps = Math.max(0, leftSegments.length - 1) * 5;
    const rightGaps = Math.max(0, rightSegments.length - 1) * 5;
    const centerGap =
      leftSegments.length > 0 && rightSegments.length > 0 ? 8 : 0;
    const paddingX = 16;
    const buffer = 6;
    return Math.ceil(
      textW + leftGaps + rightGaps + centerGap + paddingX + buffer,
    );
  };

  const requiredWidth12 = calcRequired(12);
  if (
    trackWidth !== null &&
    trackWidth !== undefined &&
    Number.isFinite(trackWidth) &&
    trackWidth > 0 &&
    requiredWidth12 > trackWidth
  ) {
    const requiredWithCompactEn = calcRequired(10);
    return {
      requiredWidth12,
      minWidthPx: Math.min(Math.floor(trackWidth), requiredWithCompactEn),
      compactEnglish: true,
    };
  }

  return {
    requiredWidth12,
    minWidthPx: requiredWidth12,
    compactEnglish: false,
  };
}

function barCssVars(
  lowMidi: number,
  highMidi: number,
  minWidthPx: number,
): CSSProperties {
  const { leftPct, widthPct } = rangeBoundsPct(lowMidi, highMidi);
  return {
    '--vrc-bar-left': `${leftPct.toFixed(3)}%`,
    '--vrc-bar-width': `${widthPct.toFixed(3)}%`,
    '--vrc-min-w': `${minWidthPx}px`,
  } as CSSProperties;
}

interface VocalRangeCardProps {
  settings: PracticeSettings;
  pattern: Pick<PatternDef, 'jianpu'>;
  onUpdate: (patch: Partial<PracticeSettings>) => void;
  onOpenRangeTest: () => void;
}

/** 首頁最上方「我的音域」卡片：收起只顯示目前音域條，展開可選 7 種音域＋完整範圍 */
export function VocalRangeCard({
  settings,
  pattern,
  onUpdate,
  onOpenRangeTest,
}: VocalRangeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [trackWidth, setTrackWidth] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const barsAreaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = barsAreaRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) {
        setTrackWidth(el.clientWidth);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: PointerEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  const layout = CARD_KEYBOARD_LAYOUT;
  const [selLow, selHigh] = getRangeBounds(
    settings.rangeName,
    settings.myRange,
  );

  const c4Key = useMemo(
    () => layout.whites.find((wk) => wk.midi === 60)!,
    [layout],
  );
  const c4LeftPct = (c4Key.x / layout.totalWidth) * 100;
  const c4WidthPct = (c4Key.w / layout.totalWidth) * 100;

  const octaveBoxes = useMemo(() => {
    return OCTAVE_SEGMENTS.map((seg, idx) => {
      const nextSeg = OCTAVE_SEGMENTS[idx + 1];
      const startX =
        idx === 0
          ? 0
          : (layout.whites.find((w) => w.midi === seg.low)?.x ?? 0) -
            KEY_UNIT_W * 0.02;
      const endX = nextSeg
        ? (layout.whites.find((w) => w.midi === nextSeg.low)?.x ??
            layout.totalWidth) -
          KEY_UNIT_W * 0.02
        : layout.totalWidth;
      const cWhite = layout.whites.find((w) => w.midi === seg.low);
      const cCenterPct = cWhite
        ? ((cWhite.x + cWhite.w * 0.5) / layout.totalWidth) * 100
        : (startX / layout.totalWidth) * 100;
      return {
        ...seg,
        leftPct: (startX / layout.totalWidth) * 100,
        widthPct: ((endX - startX) / layout.totalWidth) * 100,
        cCenterPct,
        isFirst: idx === 0,
        isLast: idx === OCTAVE_SEGMENTS.length - 1,
        isMiddleC: seg.low === 60,
      };
    });
  }, [layout]);

  const myRangeRec = useMemo(
    () =>
      settings.myRange
        ? recommendVoiceRange(settings.myRange.raw[0], settings.myRange.raw[1])
        : null,
    [settings.myRange],
  );

  function handleSelectRange(rangeName: string) {
    onUpdate(selectVocalRangePatch(settings, rangeName, pattern));
    setExpanded(false);
  }

  const selectedPartMeta = VOCAL_RANGE_PARTS.find(
    (p) => p.name === settings.rangeName,
  );
  const fullBounds = RANGES['完整 C2–C6'] ?? [36, 84];

  const renderCollapsedBar = () => {
    if (settings.rangeName === MY_RANGE_NAME && settings.myRange && myRangeRec) {
      const rangeText = `${displayNoteName(settings.myRange.low)}~${displayNoteName(settings.myRange.high)}`;
      const barLayout = computeRangeBarLayout({
        leftSegments: ['我的音域', rangeText],
        rightSegments: [`最接近 ${myRangeRec.rangeName}`, '▼'],
        trackWidth,
      });
      return (
        <div className="vrc-bar-track">
          <button
            type="button"
            className="vrc-bar is-selected is-dark-text"
            style={{
              ...barCssVars(
                settings.myRange.low,
                settings.myRange.high,
                barLayout.minWidthPx,
              ),
              backgroundColor: '#e8b400',
            }}
            aria-expanded={false}
            aria-label={`目前音域 我的音域 ${rangeText} 最接近 ${myRangeRec.rangeName}，點此展開選擇`}
            onClick={() => setExpanded(true)}
          >
            <span className="vrc-bar-left">
              <span className="vrc-bar-cn">我的音域</span>
              <span className="vrc-bar-range">{rangeText}</span>
            </span>
            <span className="vrc-bar-right">
              <span className="vrc-bar-rec">最接近 {myRangeRec.rangeName}</span>
              <span className="vrc-bar-arrow" aria-hidden="true">
                ▼
              </span>
            </span>
          </button>
        </div>
      );
    }

    if (selectedPartMeta) {
      const [lo, hi] = RANGES[selectedPartMeta.name]!;
      const rangeText = `${displayNoteName(lo)}~${displayNoteName(hi)}`;
      const groupLabel = selectedPartMeta.group === 'male' ? '男聲' : '女聲';
      const barLayout = computeRangeBarLayout({
        leftSegments: [
          groupLabel,
          selectedPartMeta.englishName,
          selectedPartMeta.name,
        ],
        rightSegments: [rangeText, '▼'],
        englishText: selectedPartMeta.englishName,
        trackWidth,
      });
      return (
        <div className="vrc-bar-track">
          <button
            type="button"
            className={`vrc-bar is-selected ${selectedPartMeta.darkText ? 'is-dark-text' : 'is-light-text'} ${barLayout.compactEnglish ? 'is-compact-en' : ''}`}
            style={{
              ...barCssVars(lo, hi, barLayout.minWidthPx),
              backgroundColor: selectedPartMeta.color,
            }}
            aria-expanded={false}
            aria-label={`目前音域 ${groupLabel} ${selectedPartMeta.englishName} ${selectedPartMeta.name} ${rangeText}，點此展開選擇`}
            onClick={() => setExpanded(true)}
          >
            <span className="vrc-bar-left">
              <span className="vrc-bar-group">{groupLabel}</span>
              <span className="vrc-bar-en">{selectedPartMeta.englishName}</span>
              <span className="vrc-bar-cn">{selectedPartMeta.name}</span>
            </span>
            <span className="vrc-bar-right">
              <span className="vrc-bar-range">{rangeText}</span>
              <span className="vrc-bar-arrow" aria-hidden="true">
                ▼
              </span>
            </span>
          </button>
        </div>
      );
    }

    const fullRangeText = `${displayNoteName(fullBounds[0])}~${displayNoteName(fullBounds[1])}`;
    const fullBarLayout = computeRangeBarLayout({
      leftSegments: ['完整 C2–C6'],
      rightSegments: [fullRangeText, '▼'],
      trackWidth,
    });
    return (
      <div className="vrc-bar-track">
        <button
          type="button"
          className="vrc-bar is-selected is-light-text"
          style={{
            ...barCssVars(fullBounds[0], fullBounds[1], fullBarLayout.minWidthPx),
            backgroundColor: '#4b5563',
          }}
          aria-expanded={false}
          aria-label={`目前音域 完整 ${fullRangeText}，點此展開選擇`}
          onClick={() => setExpanded(true)}
        >
          <span className="vrc-bar-left">
            <span className="vrc-bar-cn">完整 C2–C6</span>
          </span>
          <span className="vrc-bar-right">
            <span className="vrc-bar-range">{fullRangeText}</span>
            <span className="vrc-bar-arrow" aria-hidden="true">
              ▼
            </span>
          </span>
        </button>
      </div>
    );
  };

  const renderExpandedBars = () => {
    const myRangeSelected = settings.rangeName === MY_RANGE_NAME;
    const myRangeText = settings.myRange
      ? `${displayNoteName(settings.myRange.low)}~${displayNoteName(settings.myRange.high)}`
      : null;

    const fullRangeSelected = settings.rangeName === '完整 C2–C6';
    const fullRangeText = `${displayNoteName(fullBounds[0])}~${displayNoteName(fullBounds[1])}`;
    const myBarLayout =
      settings.myRange && myRangeRec && myRangeText
        ? computeRangeBarLayout({
            leftSegments: ['我的音域', myRangeText],
            rightSegments: [`最接近 ${myRangeRec.rangeName}`],
            trackWidth,
          })
        : null;
    const fullBarLayout = computeRangeBarLayout({
      leftSegments: ['完整 C2–C6'],
      rightSegments: [fullRangeText],
      trackWidth,
    });

    return (
      <div className="vrc-expanded-list" role="listbox" aria-label="選擇音域">
        {/* 1. 我的音域 */}
        <div className="vrc-bar-track">
          {settings.myRange && myRangeRec && myBarLayout ? (
            <button
              type="button"
              role="option"
              aria-selected={myRangeSelected}
              className={`vrc-bar is-dark-text ${myRangeSelected ? 'is-selected' : ''}`}
              style={{
                ...barCssVars(
                  settings.myRange.low,
                  settings.myRange.high,
                  myBarLayout.minWidthPx,
                ),
                backgroundColor: '#e8b400',
              }}
              onClick={() => handleSelectRange(MY_RANGE_NAME)}
            >
              <span className="vrc-bar-left">
                <span className="vrc-bar-cn">我的音域</span>
                <span className="vrc-bar-range">{myRangeText}</span>
              </span>
              <span className="vrc-bar-right">
                <span className="vrc-bar-rec">
                  最接近 {myRangeRec.rangeName}
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              role="option"
              aria-selected={false}
              aria-disabled="true"
              disabled
              className="vrc-bar vrc-bar-unmeasured"
              style={{ left: 0, width: '100%' }}
            >
              <span className="vrc-bar-left">
                <span className="vrc-bar-cn">我的音域</span>
                <span className="vrc-bar-unmeasured-hint">
                  尚未測量，點🎤試唱
                </span>
              </span>
            </button>
          )}
        </div>

        {/* 2–7. 男聲 3 條＋女聲 3 條 */}
        {VOCAL_RANGE_PARTS.map((part) => {
          const [lo, hi] = RANGES[part.name]!;
          const rangeText = `${displayNoteName(lo)}~${displayNoteName(hi)}`;
          const groupLabel = part.group === 'male' ? '男聲' : '女聲';
          const isSelected = settings.rangeName === part.name;
          const partLayout = computeRangeBarLayout({
            leftSegments: [groupLabel, part.englishName, part.name],
            rightSegments: [rangeText],
            englishText: part.englishName,
            trackWidth,
          });
          return (
            <div key={part.name} className="vrc-bar-track">
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`vrc-bar ${part.darkText ? 'is-dark-text' : 'is-light-text'} ${isSelected ? 'is-selected' : ''} ${partLayout.compactEnglish ? 'is-compact-en' : ''}`}
                style={{
                  ...barCssVars(lo, hi, partLayout.minWidthPx),
                  backgroundColor: part.color,
                }}
                onClick={() => handleSelectRange(part.name)}
              >
                <span className="vrc-bar-left">
                  <span className="vrc-bar-group">{groupLabel}</span>
                  <span className="vrc-bar-en">{part.englishName}</span>
                  <span className="vrc-bar-cn">{part.name}</span>
                </span>
                <span className="vrc-bar-right">
                  <span className="vrc-bar-range">{rangeText}</span>
                </span>
              </button>
            </div>
          );
        })}

        {/* 8. 完整 C2–C6（最後一條灰色） */}
        <div className="vrc-bar-track">
          <button
            type="button"
            role="option"
            aria-selected={fullRangeSelected}
            className={`vrc-bar is-light-text ${fullRangeSelected ? 'is-selected' : ''}`}
            style={{
              ...barCssVars(
                fullBounds[0],
                fullBounds[1],
                fullBarLayout.minWidthPx,
              ),
              backgroundColor: '#4b5563',
            }}
            onClick={() => handleSelectRange('完整 C2–C6')}
          >
            <span className="vrc-bar-left">
              <span className="vrc-bar-cn">完整 C2–C6</span>
            </span>
            <span className="vrc-bar-right">
              <span className="vrc-bar-range">{fullRangeText}</span>
            </span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <section
      ref={cardRef}
      className={`vocal-range-card ${expanded ? 'is-expanded' : ''}`}
      aria-label="我的音域"
    >
      {/* 標題列 */}
      <div className="vrc-header">
        <h2 className="vrc-title">我的音域</h2>
        <button
          type="button"
          className="vrc-test-btn"
          onClick={onOpenRangeTest}
        >
          🎤 試唱測音域
        </button>
      </div>

      {/* 鋼琴鍵盤（MIDI 36–86） */}
      <div className="vrc-kbd-section">
        <div className="vrc-octave-labels" aria-hidden="true">
          {octaveBoxes.map((seg) => (
            <span
              key={seg.low}
              className={`vrc-octave-label ${seg.isFirst ? 'is-first' : ''} ${seg.isLast ? 'is-last' : ''} ${seg.isMiddleC ? 'is-middle-c' : ''}`}
              style={{ left: `${seg.cCenterPct}%` }}
            >
              {seg.label}
            </span>
          ))}
        </div>

        <div className="vrc-octave-strip" aria-hidden="true">
          {octaveBoxes.map((seg) => (
            <span
              key={seg.low}
              className="vrc-octave-seg"
              style={{
                left: `${seg.leftPct}%`,
                width: `${seg.widthPct}%`,
                backgroundColor: seg.color,
              }}
            />
          ))}
        </div>

        <div className="vrc-kbd-wrap" aria-label="音域鋼琴鍵盤（C2 至 D6）">
          <svg
            className="vrc-kbd-svg"
            viewBox={`0 0 ${layout.totalWidth} ${layout.whiteLen}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {layout.whites.map((wk) => {
              const inRange = wk.midi >= selLow && wk.midi <= selHigh;
              return (
                <rect
                  key={wk.midi}
                  x={wk.x}
                  y={0}
                  width={wk.w}
                  height={wk.len}
                  rx={10}
                  fill={inRange ? '#cfe2ff' : '#f2f1ed'}
                  stroke={inRange ? '#93c5fd' : '#cbd5e1'}
                  strokeWidth={4}
                />
              );
            })}
            {layout.blacks.map((bk) => (
              <rect
                key={bk.midi}
                x={bk.x}
                y={0}
                width={bk.w}
                height={bk.len}
                rx={8}
                fill="#1b1e25"
              />
            ))}
          </svg>
        </div>

        {/* 中央 Do 下方藍色短線 */}
        <div className="vrc-middlec-underline-track" aria-hidden="true">
          <span
            className="vrc-middlec-underline"
            style={{
              left: `${c4LeftPct}%`,
              width: `${c4WidthPct}%`,
            }}
          />
        </div>
      </div>

      {/* 音域條（收起只顯示 1 條；展開顯示 7+1 條） */}
      <div className="vrc-bars-area" ref={barsAreaRef}>
        {expanded ? renderExpandedBars() : renderCollapsedBar()}
      </div>

      {/* 男聲顯示譜號切換 */}
      {settings.voice === 'male' && (
        <div className="vrc-clef-row">
          <span className="vrc-clef-label">譜號</span>
          <div className="clef-seg-group" role="group" aria-label="譜號">
            {MALE_CLEF_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`clef-seg-btn ${settings.maleClef === opt.value ? 'is-active' : ''}`}
                aria-pressed={settings.maleClef === opt.value}
                onClick={() => onUpdate({ maleClef: opt.value })}
              >
                <span className="clef-seg-main">{opt.label}</span>
                <span className="clef-seg-sub">{opt.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
