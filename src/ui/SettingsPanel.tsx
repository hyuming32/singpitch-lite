import { useEffect, useMemo, useRef, useState } from 'react';
import { buildExercise, type CadenceMode, type Exercise } from '../core/exercise';
import { displayNoteName } from './noteLabel';
import type { PatternDef } from '../core/patterns';
import {
  BPM_MAX,
  BPM_MIN,
  clampBpm,
  findLowestFeasibleTonic,
  formatBpm,
  formatExerciseSummary,
  getRangeBounds,
  resolveVoiceDisplay,
  stepBpm,
  toExerciseOptions,
  type ArticulationOption,
  type NoteBeatsOption,
  type PracticeModeOption,
  type PracticeSettings,
  type TransposeOption,
} from '../state/settings';
import { useAudioEngine } from './AudioContext';
import { JianpuLine } from './JianpuLine';
import { buildJianpuTokens } from './miniStaffData';
import { useBpmEdit } from './useBpmEdit';
import { useHoldRepeat } from './useHoldRepeat';

interface SettingsPanelProps {
  pattern: PatternDef;
  settings: PracticeSettings;
  onUpdate: (patch: Partial<PracticeSettings>) => void;
  onStartPractice: () => void;
  onOpenRangeTest?: () => void;
  /** 手機版在全螢幕設定抽屜內可隱藏底部開始按鈕 */
  hideStartButton?: boolean;
}

const NOTE_BEATS_OPTIONS: { value: NoteBeatsOption; label: string }[] = [
  { value: 0.5, label: '½' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
];

const ARTICULATION_OPTIONS: { value: ArticulationOption; label: string }[] = [
  { value: 'legato', label: '連音' },
  { value: 'staccato', label: '跳音' },
];

const TRANSPOSE_OPTIONS: { value: TransposeOption; label: string }[] = [
  { value: 'fixed', label: '固定' },
  { value: 'up', label: '逐半音上' },
  { value: 'up-down', label: '上去再下來' },
];

const MODE_OPTIONS: { value: PracticeModeOption; label: string }[] = [
  { value: 'follow', label: '跟唱' },
  { value: 'listen-then-sing', label: '先聽再唱' },
  { value: 'shadow', label: '影子' },
];

const CADENCE_OPTIONS: { value: CadenceMode; label: string }[] = [
  { value: 'off', label: '關閉' },
  { value: 'direct', label: '直接升' },
  { value: 'leading', label: '5/7 導音' },
  { value: 'single', label: '單和弦快切' },
];

/** 計算試聽時是否啟用和弦墊底：僅在提示和弦關閉時依 settings.pad 決定 */
export function resolvePreviewPad(
  settings: Pick<PracticeSettings, 'cadence' | 'pad'>,
): boolean {
  return settings.cadence === 'off' && settings.pad;
}

/** 右側練習設定面板（含試聽與開始練唱） */
export function SettingsPanel({
  pattern,
  settings,
  onUpdate,
  onStartPractice,
  hideStartButton = false,
}: SettingsPanelProps) {
  const engine = useAudioEngine();
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const bpmRef = useRef(settings.bpm);
  bpmRef.current = settings.bpm;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  function handleBpmStep(delta: -1 | 1) {
    const next = stepBpm(bpmRef.current, delta);
    if (next === bpmRef.current) return;
    bpmRef.current = next;
    onUpdateRef.current({ bpm: next });
  }

  function handleBpmCommit(nextBpm: number) {
    const next = clampBpm(nextBpm);
    if (next === bpmRef.current) return;
    bpmRef.current = next;
    onUpdateRef.current({ bpm: next });
  }

  const minusBpmHold = useHoldRepeat({
    onStep: () => handleBpmStep(-1),
    disabled: settings.bpm <= BPM_MIN,
  });
  const plusBpmHold = useHoldRepeat({
    onStep: () => handleBpmStep(1),
    disabled: settings.bpm >= BPM_MAX,
  });
  const bpmEdit = useBpmEdit({
    bpm: settings.bpm,
    onCommit: handleBpmCommit,
  });

  const jianpuTokens = useMemo(() => buildJianpuTokens(pattern, 60), [pattern]);
  const [low, high] = getRangeBounds(settings.rangeName, settings.myRange);
  const lowestFeasible = useMemo(
    () => findLowestFeasibleTonic(pattern, low, high),
    [pattern, low, high],
  );

  const { exercise, buildError } = useMemo(() => {
    try {
      const ex = buildExercise(pattern, toExerciseOptions(settings));
      return { exercise: ex, buildError: null as string | null };
    } catch (err) {
      return {
        exercise: null as Exercise | null,
        buildError: err instanceof Error ? err.message : String(err),
      };
    }
  }, [pattern, settings]);

  useEffect(() => {
    const unsubEnd = engine.onEnded(() => {
      setPreviewPlaying(false);
    });
    const unsubPos = engine.onPosition((_sec, playing) => {
      if (!playing) {
        setPreviewPlaying(false);
      }
    });
    return () => {
      unsubEnd();
      unsubPos();
    };
  }, [engine]);

  // 切換設定或卸載時停止試聽
  useEffect(() => {
    return () => {
      engine.stop();
    };
  }, [engine]);

  function handleAutoAdjustTonic() {
    if (lowestFeasible !== null) {
      onUpdate({ startTonic: lowestFeasible });
    }
  }

  async function handleTogglePreview() {
    if (previewPlaying) {
      engine.stop();
      setPreviewPlaying(false);
      return;
    }

    try {
      setPreviewError(null);
      const previewTonic =
        buildError && lowestFeasible !== null ? lowestFeasible : settings.startTonic;
      const previewEx = buildExercise(pattern, {
        startTonic: previewTonic,
        low: 24,
        high: 96,
        bpm: settings.bpm,
        noteBeats: settings.noteBeats,
        repeats: 1,
        articulation: settings.articulation,
        transpose: 'fixed',
        cadence: false,
        countInBeats: 0,
        mode: 'follow',
        displayTranspose: resolveVoiceDisplay(settings).pitchShift,
      });

      await engine.unlock();
      await engine.init();
      await engine.unlock();
      engine.setA4(settings.a4);
      engine.load(previewEx, {
        pianoDuringSing: true,
        pad: resolvePreviewPad(settings),
        click: false,
        voiceForGlide: true,
      });
      engine.play();
      setPreviewPlaying(true);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewPlaying(false);
    }
  }

  function handleStartClick() {
    if (previewPlaying) {
      engine.stop();
      setPreviewPlaying(false);
    }
    onStartPractice();
  }

  const summaryText = exercise
    ? formatExerciseSummary(exercise, settings.transpose)
    : null;

  const displayError = buildError
    ? lowestFeasible === null
      ? '這個音型超出目前音域'
      : buildError
    : null;

  return (
    <div className="settings-panel">
      <div className="settings-scroll-area">
        <div className="settings-selected-box">
          <div className="settings-selected-label">已選圖案</div>
          <div className="settings-selected-header">
            <span className="settings-selected-name">{pattern.name}</span>
            <span className="settings-selected-chord">和弦 {pattern.chords}</span>
          </div>
          <div className="settings-selected-jianpu">
            <JianpuLine tokens={jianpuTokens} />
          </div>
        </div>

        <div className="settings-controls">
        {/* 起始音 */}
        <div className="setting-row">
          <span className="setting-label">起始音</span>
          <div className="stepper">
            <button
              type="button"
              className="stepper-btn"
              aria-label="降低起始音半音"
              disabled={settings.startTonic <= 24}
              onClick={() => onUpdate({ startTonic: Math.max(24, settings.startTonic - 1) })}
            >
              −
            </button>
            <span className="stepper-value">{displayNoteName(settings.startTonic)}</span>
            <button
              type="button"
              className="stepper-btn"
              aria-label="提高起始音半音"
              disabled={settings.startTonic >= 96}
              onClick={() => onUpdate({ startTonic: Math.min(96, settings.startTonic + 1) })}
            >
              ＋
            </button>
          </div>
        </div>

        {/* 速度 */}
        <div className="setting-row">
          <span className="setting-label">速度</span>
          <div className="stepper">
            <button
              type="button"
              className="stepper-btn"
              aria-label="減慢速度"
              disabled={settings.bpm <= BPM_MIN}
              onContextMenu={(e) => e.preventDefault()}
              {...minusBpmHold}
            >
              −
            </button>
            <span
              className={`stepper-value stepper-bpm-value ${bpmEdit.editing ? 'is-editing' : ''}`}
              role={bpmEdit.editing ? undefined : 'button'}
              tabIndex={bpmEdit.editing ? undefined : 0}
              aria-label={
                bpmEdit.editing
                  ? undefined
                  : `速度 ${formatBpm(settings.bpm)} BPM，點此直接輸入`
              }
              onClick={() => {
                if (!bpmEdit.editing) bpmEdit.startEdit();
              }}
              onKeyDown={(e) => {
                if (!bpmEdit.editing && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  bpmEdit.startEdit();
                }
              }}
            >
              {bpmEdit.editing ? (
                <>
                  <input {...bpmEdit.inputProps} className="stepper-bpm-input" />
                  <span className="stepper-bpm-unit">BPM</span>
                </>
              ) : (
                `${formatBpm(settings.bpm)} BPM`
              )}
            </span>
            <button
              type="button"
              className="stepper-btn"
              aria-label="加快速度"
              disabled={settings.bpm >= BPM_MAX}
              onContextMenu={(e) => e.preventDefault()}
              {...plusBpmHold}
            >
              ＋
            </button>
          </div>
        </div>

        {/* 每音拍數 */}
        <div className="setting-row">
          <span className="setting-label">每音拍數</span>
          <div className="segmented-group">
            {NOTE_BEATS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`seg-btn ${settings.noteBeats === opt.value ? 'is-active' : ''}`}
                onClick={() => onUpdate({ noteBeats: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 唱法 */}
        <div className="setting-row">
          <span className="setting-label">唱法</span>
          <div className="segmented-group">
            {ARTICULATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`seg-btn ${settings.articulation === opt.value ? 'is-active' : ''}`}
                onClick={() => onUpdate({ articulation: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 換調 */}
        <div className="setting-row setting-row-stack">
          <span className="setting-label">換調</span>
          <div className="segmented-group">
            {TRANSPOSE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`seg-btn ${settings.transpose === opt.value ? 'is-active' : ''}`}
                onClick={() => onUpdate({ transpose: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 模式 */}
        <div className="setting-row">
          <span className="setting-label">模式</span>
          <div className="segmented-group">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`seg-btn ${settings.mode === opt.value ? 'is-active' : ''}`}
                onClick={() => onUpdate({ mode: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 鋼琴 */}
        <div className="setting-row">
          <span className="setting-label">鋼琴</span>
          <div className="segmented-group">
            <button
              type="button"
              className={`seg-btn ${settings.pianoDuringSing ? 'is-active' : ''}`}
              onClick={() => onUpdate({ pianoDuringSing: true })}
            >
              唱時也彈
            </button>
            <button
              type="button"
              className={`seg-btn ${!settings.pianoDuringSing ? 'is-active' : ''}`}
              onClick={() => onUpdate({ pianoDuringSing: false })}
            >
              只先聽
            </button>
          </div>
        </div>

        {/* 換調提示和弦 */}
        <div className="setting-row">
          <span className="setting-label">提示和弦</span>
          <div className="segmented-group">
            {CADENCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`seg-btn ${settings.cadence === opt.value ? 'is-active' : ''}`}
                onClick={() => onUpdate({ cadence: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 開關 */}
        <div className="toggle-list">
          {(() => {
            const padDisabled = settings.cadence !== 'off';
            return (
              <label className={`toggle-item${padDisabled ? ' is-disabled' : ''}`}>
                <span className="toggle-label-group">
                  <span>和弦墊底</span>
                  {padDisabled && (
                    <span className="toggle-hint">有提示和弦時不墊底</span>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={settings.pad}
                  disabled={padDisabled}
                  onChange={(e) => onUpdate({ pad: e.target.checked })}
                />
              </label>
            );
          })()}
          <label className="toggle-item">
            <span>節拍器預備拍</span>
            <input
              type="checkbox"
              checked={settings.countIn}
              onChange={(e) => onUpdate({ countIn: e.target.checked })}
            />
          </label>
        </div>
        </div>
      </div>

      {/* 固定於欄底的摘要、試聽與開始練唱 */}
      <div className="settings-footer">
        <div className="settings-summary-box">
          {displayError ? (
            <div className="settings-error-box">
              <p className="settings-error-text">{displayError}</p>
              {lowestFeasible !== null && (
                <button
                  type="button"
                  className="auto-adjust-btn"
                  onClick={handleAutoAdjustTonic}
                >
                  自動調整起始音（{displayNoteName(lowestFeasible)}）
                </button>
              )}
            </div>
          ) : (
            <p className="settings-summary-text">{summaryText}</p>
          )}
          {previewError && <p className="settings-error-text">{previewError}</p>}
        </div>

        <div className="settings-actions">
          <button
            type="button"
            className={`preview-btn ${previewPlaying ? 'is-playing' : ''}`}
            onClick={handleTogglePreview}
          >
            {previewPlaying ? '■ 停止試聽' : '▶ 試聽一次'}
          </button>
          {!hideStartButton && (
            <button
              type="button"
              className="start-btn"
              disabled={Boolean(displayError)}
              onClick={handleStartClick}
            >
              開始練唱
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
