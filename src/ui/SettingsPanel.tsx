import { useEffect, useMemo, useRef, useState } from 'react';
import { buildExercise, type Exercise } from '../core/exercise';
import { displayNoteName } from './noteLabel';
import type { PatternDef } from '../core/patterns';
import {
  BPM_MAX,
  BPM_MIN,
  MY_RANGE_NAME,
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
  type VoiceOption,
} from '../state/settings';
import { resolveStartTonicForRange } from '../state/vocalRange';
import { useAudioEngine } from './AudioContext';
import { JianpuLine } from './JianpuLine';
import { RangeChart } from './RangeChart';
import { VoiceClefControls } from './VoiceClefControls';
import { buildJianpuTokens } from './miniStaffData';
import { useBpmEdit } from './useBpmEdit';
import { useHoldRepeat } from './useHoldRepeat';

interface SettingsPanelProps {
  pattern: PatternDef;
  settings: PracticeSettings;
  onUpdate: (patch: Partial<PracticeSettings>) => void;
  onStartPractice: () => void;
  onOpenRangeTest: () => void;
  /** 手機版在全螢幕設定抽屜內可隱藏底部開始按鈕 */
  hideStartButton?: boolean;
}

const NOTE_BEATS_OPTIONS: { value: NoteBeatsOption; label: string }[] = [
  { value: 0.5, label: '½' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
];

const REPEATS_OPTIONS = [1, 2, 3, 4] as const;

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
];

/** 右側練習設定面板（含試聽與開始練唱） */
export function SettingsPanel({
  pattern,
  settings,
  onUpdate,
  onStartPractice,
  onOpenRangeTest,
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

  function handleRangeChange(newRangeName: string) {
    const [newLow, newHigh] = getRangeBounds(newRangeName, settings.myRange);
    const nextStart = resolveStartTonicForRange(
      pattern,
      settings.startTonic,
      newLow,
      newHigh,
    );

    let nextVoice: VoiceOption | undefined;
    if (
      newRangeName === '男低音' ||
      newRangeName === '男中音' ||
      newRangeName === '男高音'
    ) {
      nextVoice = 'male';
    } else if (
      newRangeName === '女低音' ||
      newRangeName === '女中音' ||
      newRangeName === '女高音'
    ) {
      nextVoice = 'normal';
    } else if (newRangeName === MY_RANGE_NAME && settings.myRange) {
      nextVoice = settings.myRange.voice;
    }

    onUpdate({
      rangeName: newRangeName,
      ...(nextVoice !== undefined ? { voice: nextVoice } : {}),
      ...(nextStart !== settings.startTonic ? { startTonic: nextStart } : {}),
    });
  }

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
        pad: settings.pad,
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

        {/* 音域圖與試唱測音域 */}
        <div className="setting-row setting-row-stack">
          <RangeChart
            selectedRangeName={settings.rangeName}
            myRange={settings.myRange}
            onSelectRange={handleRangeChange}
            showFullRangeOption
          />
          <button
            type="button"
            className="range-test-open-btn"
            onClick={onOpenRangeTest}
          >
            🎤 試唱測音域
          </button>
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

        {/* 重複 */}
        <div className="setting-row">
          <span className="setting-label">重複</span>
          <div className="segmented-group">
            {REPEATS_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={`seg-btn ${settings.repeats === n ? 'is-active' : ''}`}
                onClick={() => onUpdate({ repeats: n })}
              >
                {n} 次
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

        {/* 開關 */}
        <div className="toggle-list">
          <label className="toggle-item">
            <span>和弦墊底</span>
            <input
              type="checkbox"
              checked={settings.pad}
              onChange={(e) => onUpdate({ pad: e.target.checked })}
            />
          </label>
          <label className="toggle-item">
            <span>換調前提示和弦</span>
            <input
              type="checkbox"
              checked={settings.cadence}
              onChange={(e) => onUpdate({ cadence: e.target.checked })}
            />
          </label>
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

      {/* 固定於欄底的聲部／譜號、摘要、試聽與開始練唱 */}
      <div className="settings-footer">
        {!hideStartButton && (
          <VoiceClefControls
            settings={settings}
            pattern={pattern}
            onUpdate={onUpdate}
          />
        )}
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
