import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hzToMidi } from '../core/notes';
import { BUILTIN_PATTERNS, type PatternDef } from '../core/patterns';
import { MicController, MicPermissionError, type MicPitchFrame } from '../mic/micController';
import {
  GLIDE_MAX_DURATION_SEC,
  SteadyNoteDetector,
  analyzeGlideFrames,
  type PitchSampleFrame,
} from '../mic/rangeMeasure';
import {
  MY_RANGE_NAME,
  getRangeBounds,
  type PracticeSettings,
} from '../state/settings';
import {
  buildMeasuredRangeResult,
  rankPatternsForRange,
  resolveStartTonicForRange,
  type MeasuredRangeOutcome,
} from '../state/vocalRange';
import { useAudioEngine } from './AudioContext';
import { RangeChart } from './RangeChart';
import { displayNoteName } from './noteLabel';

type MeasureMethod = 'twoNotes' | 'glide';
type SheetPhase = 'intro' | 'measuring' | 'result' | 'tooNarrow';

interface RangeTestSheetProps {
  open: boolean;
  settings: PracticeSettings;
  currentPattern: PatternDef;
  onApplySettings: (patch: Partial<PracticeSettings>) => void;
  onClose: () => void;
}

const TWO_NOTES_STEP_SETTLE_MS = 500;

/** 試唱測音域全螢幕 Sheet（支援最低＋最高與滑音兩種測量方式） */
export function RangeTestSheet({
  open,
  settings,
  currentPattern,
  onApplySettings,
  onClose,
}: RangeTestSheetProps) {
  const engine = useAudioEngine();
  const micController = useMemo(() => new MicController(engine), [engine]);

  const [method, setMethod] = useState<MeasureMethod>('twoNotes');
  const [phase, setPhase] = useState<SheetPhase>('intro');
  const [twoNoteStep, setTwoNoteStep] = useState<1 | 2>(1);
  const [step1Midi, setStep1Midi] = useState<number | null>(null);
  const [steadyProgress, setSteadyProgress] = useState(0);
  const [steadyHint, setSteadyHint] = useState<string>('請開始發聲');
  const [glideElapsedSec, setGlideElapsedSec] = useState(0);
  const [liveSungMidi, setLiveSungMidi] = useState<number | null>(null);
  const [micStarting, setMicStarting] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MeasuredRangeOutcome | null>(null);

  const detectorRef = useRef<SteadyNoteDetector>(new SteadyNoteDetector(settings.a4));
  const glideFramesRef = useRef<PitchSampleFrame[]>([]);
  const glideStartMsRef = useRef<number | null>(null);
  const glideTimerRef = useRef<number | null>(null);
  const stepSettleUntilMsRef = useRef<number>(0);

  const methodRef = useRef(method);
  methodRef.current = method;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const twoNoteStepRef = useRef(twoNoteStep);
  twoNoteStepRef.current = twoNoteStep;
  const step1MidiRef = useRef(step1Midi);
  step1MidiRef.current = step1Midi;
  const a4Ref = useRef(settings.a4);
  a4Ref.current = settings.a4;
  const startTonicRef = useRef(settings.startTonic);
  startTonicRef.current = settings.startTonic;
  const patternRef = useRef(currentPattern);
  patternRef.current = currentPattern;

  const stopMicAndTimers = useCallback(async () => {
    if (glideTimerRef.current !== null) {
      window.clearInterval(glideTimerRef.current);
      glideTimerRef.current = null;
    }
    glideStartMsRef.current = null;
    await micController.stop();
  }, [micController]);

  // 關閉或卸載時確保釋放麥克風與計時器
  useEffect(() => {
    if (!open) {
      void stopMicAndTimers();
      setPhase('intro');
      setTwoNoteStep(1);
      setStep1Midi(null);
      setSteadyProgress(0);
      setGlideElapsedSec(0);
      setLiveSungMidi(null);
      setMicError(null);
      setOutcome(null);
      return;
    }
    return () => {
      void stopMicAndTimers();
    };
  }, [open, stopMicAndTimers]);

  const finishMeasurement = useCallback(
    async (
      rawLow: number,
      rawHigh: number,
      usedMethod: MeasureMethod,
    ) => {
      await stopMicAndTimers();
      const res = buildMeasuredRangeResult(rawLow, rawHigh, usedMethod);
      setOutcome(res);
      if (res.ok) {
        // 測完直接切到「我的音域」（起始音自動移進新音域）；
        // 結果頁仍可改選「用推薦聲部」或重測
        const nextStart = resolveStartTonicForRange(
          patternRef.current,
          startTonicRef.current,
          res.myRange.low,
          res.myRange.high,
        );
        onApplySettings({
          myRange: res.myRange,
          rangeName: MY_RANGE_NAME,
          voice: res.myRange.voice,
          ...(nextStart !== startTonicRef.current ? { startTonic: nextStart } : {}),
        });
        setPhase('result');
      } else {
        setPhase('tooNarrow');
      }
    },
    [onApplySettings, stopMicAndTimers],
  );

  const finalizeGlide = useCallback(() => {
    if (phaseRef.current !== 'measuring' || methodRef.current !== 'glide') {
      return;
    }
    const analysis = analyzeGlideFrames(glideFramesRef.current, a4Ref.current);
    if (!analysis) {
      void stopMicAndTimers();
      setOutcome({
        ok: false,
        error: '範圍太窄，請重測',
        raw: [0, 0],
        semitones: 0,
      });
      setPhase('tooNarrow');
      return;
    }
    void finishMeasurement(analysis.rawLow, analysis.rawHigh, 'glide');
  }, [finishMeasurement, stopMicAndTimers]);

  const handleFrame = useCallback(
    (frame: MicPitchFrame) => {
      if (phaseRef.current !== 'measuring') return;

      const hasPitch = frame.hz > 0 && Number.isFinite(frame.hz);
      if (hasPitch) {
        const midiFloat = hzToMidi(frame.hz, a4Ref.current);
        setLiveSungMidi(Number.isFinite(midiFloat) ? midiFloat : null);
      } else {
        setLiveSungMidi(null);
      }

      if (methodRef.current === 'glide') {
        glideFramesRef.current.push({ t: frame.t, hz: frame.hz });
        return;
      }

      // twoNotes 模式
      const nowMs = performance.now();
      if (nowMs < stepSettleUntilMsRef.current) {
        return;
      }

      const status = detectorRef.current.push({ t: frame.t, hz: frame.hz });
      setSteadyProgress(status.progress);
      if (!hasPitch) {
        setSteadyHint('請持續唱出單一穩定音高');
      } else if (status.stdCents !== null && status.stdCents >= 40) {
        setSteadyHint('音高跳動較大，請保持穩定');
      } else {
        setSteadyHint('偵測穩定中，請再撐一下…');
      }

      if (status.locked && status.midi !== null) {
        if (twoNoteStepRef.current === 1) {
          step1MidiRef.current = status.midi;
          setStep1Midi(status.midi);
          twoNoteStepRef.current = 2;
          setTwoNoteStep(2);
          setSteadyProgress(0);
          setSteadyHint('已記錄最低音！現在請唱最高音');
          detectorRef.current = new SteadyNoteDetector(a4Ref.current);
          stepSettleUntilMsRef.current = performance.now() + TWO_NOTES_STEP_SETTLE_MS;
        } else {
          const lowMidi = step1MidiRef.current ?? status.midi;
          const highMidi = status.midi;
          void finishMeasurement(lowMidi, highMidi, 'twoNotes');
        }
      }
    },
    [finishMeasurement],
  );

  const startMeasuring = useCallback(
    async (selectedMethod: MeasureMethod) => {
      setMicError(null);
      setMicStarting(true);
      engine.stop(); // 測量時絕不播放任何聲音

      detectorRef.current = new SteadyNoteDetector(settings.a4);
      glideFramesRef.current = [];
      step1MidiRef.current = null;
      stepSettleUntilMsRef.current = 0;

      setTwoNoteStep(1);
      setStep1Midi(null);
      setSteadyProgress(0);
      setSteadyHint('請開始發聲');
      setGlideElapsedSec(0);
      setLiveSungMidi(null);
      setOutcome(null);

      try {
        await micController.start({
          echoCancellation: settings.echoCancellation,
          gateDb: settings.noiseGateDb,
          onFrame: handleFrame,
          onEnded: () => {
            if (phaseRef.current === 'measuring') {
              setMicError('麥克風已中斷，請重新開始');
              setPhase('intro');
            }
          },
        });
        setPhase('measuring');
        if (selectedMethod === 'glide') {
          const startMs = performance.now();
          glideStartMsRef.current = startMs;
          glideTimerRef.current = window.setInterval(() => {
            if (glideStartMsRef.current === null) return;
            const elapsed = (performance.now() - glideStartMsRef.current) / 1000;
            setGlideElapsedSec(Math.min(GLIDE_MAX_DURATION_SEC, elapsed));
            if (elapsed >= GLIDE_MAX_DURATION_SEC) {
              finalizeGlide();
            }
          }, 100);
        }
      } catch (err) {
        if (err instanceof MicPermissionError) {
          setMicError(err.message);
        } else {
          setMicError(
            err instanceof Error ? err.message : '無法啟動麥克風，請稍後再試',
          );
        }
        await stopMicAndTimers();
        setPhase('intro');
      } finally {
        setMicStarting(false);
      }
    },
    [
      engine,
      finalizeGlide,
      handleFrame,
      micController,
      settings.a4,
      settings.echoCancellation,
      settings.noiseGateDb,
      stopMicAndTimers,
    ],
  );

  function handleRetryStep() {
    if (method === 'twoNotes') {
      detectorRef.current = new SteadyNoteDetector(settings.a4);
      setSteadyProgress(0);
      setSteadyHint('請重新唱出穩定音高');
      stepSettleUntilMsRef.current = 0;
    } else {
      glideFramesRef.current = [];
      glideStartMsRef.current = performance.now();
      setGlideElapsedSec(0);
    }
  }

  function handleRedoStep1() {
    detectorRef.current = new SteadyNoteDetector(settings.a4);
    step1MidiRef.current = null;
    setStep1Midi(null);
    twoNoteStepRef.current = 1;
    setTwoNoteStep(1);
    setSteadyProgress(0);
    setSteadyHint('請重新唱出最低音');
    stepSettleUntilMsRef.current = 0;
  }

  function handleRetest() {
    void stopMicAndTimers();
    setOutcome(null);
    setPhase('intro');
  }

  function handleUseMyRange() {
    if (!outcome || !outcome.ok) return;
    const { myRange } = outcome;
    const nextStart = resolveStartTonicForRange(
      currentPattern,
      settings.startTonic,
      myRange.low,
      myRange.high,
    );
    onApplySettings({
      myRange,
      rangeName: MY_RANGE_NAME,
      voice: myRange.voice,
      ...(nextStart !== settings.startTonic ? { startTonic: nextStart } : {}),
    });
    onClose();
  }

  function handleUseRecommended() {
    if (!outcome || !outcome.ok) return;
    const { myRange, recommended } = outcome;
    const [rLow, rHigh] = getRangeBounds(recommended.rangeName, myRange);
    const nextStart = resolveStartTonicForRange(
      currentPattern,
      settings.startTonic,
      rLow,
      rHigh,
    );
    onApplySettings({
      myRange,
      rangeName: recommended.rangeName,
      voice: recommended.voice,
      ...(nextStart !== settings.startTonic ? { startTonic: nextStart } : {}),
    });
    onClose();
  }

  function handleSelectRecommendedPattern(pat: PatternDef) {
    if (!outcome || !outcome.ok) return;
    const { myRange } = outcome;
    const nextStart = resolveStartTonicForRange(
      pat,
      settings.startTonic,
      myRange.low,
      myRange.high,
    );
    onApplySettings({
      myRange,
      rangeName: MY_RANGE_NAME,
      voice: myRange.voice,
      patternId: pat.id,
      ...(nextStart !== settings.startTonic ? { startTonic: nextStart } : {}),
    });
    onClose();
  }

  const topPatterns = useMemo(() => {
    if (!outcome || !outcome.ok) return [];
    return rankPatternsForRange(
      BUILTIN_PATTERNS,
      [outcome.myRange.low, outcome.myRange.high],
      5,
    );
  }, [outcome]);

  if (!open) {
    return null;
  }

  const liveNoteText =
    liveSungMidi !== null && Number.isFinite(liveSungMidi)
      ? displayNoteName(Math.round(liveSungMidi))
      : '—';

  return (
    <div
      className="range-test-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="試唱測音域"
    >
      <div className="range-test-sheet">
        <header className="range-test-header">
          <h2>試唱測音域</h2>
          <button
            type="button"
            className="sheet-close-btn"
            onClick={() => {
              void stopMicAndTimers();
              onClose();
            }}
          >
            關閉
          </button>
        </header>

        <div className="range-test-body">
          {/* 1. 準備頁（選方式＋按開始才開麥克風） */}
          {phase === 'intro' && (
            <div className="range-test-stage">
              <div className="range-test-live-top">
                <RangeChart
                  selectedRangeName={null}
                  myRange={null}
                  liveSungMidi={null}
                  keyboardOnly
                />
              </div>

              <div className="range-test-method-box">
                <span className="setting-label">測量方式</span>
                <div className="segmented-group range-method-seg" role="group" aria-label="測量方式">
                  <button
                    type="button"
                    className={`seg-btn ${method === 'twoNotes' ? 'is-active' : ''}`}
                    onClick={() => setMethod('twoNotes')}
                  >
                    最低＋最高
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${method === 'glide' ? 'is-active' : ''}`}
                    onClick={() => setMethod('glide')}
                  >
                    滑音
                  </button>
                </div>
              </div>

              <p className="range-test-desc">
                {method === 'twoNotes'
                  ? '分別唱出你最低與最高、還舒服的穩定音（各撐約 1.5–2 秒），系統會自動記錄並計算適合你的練習音域。'
                  : '從最低音輕鬆滑唱到最高音再滑回來（約 5 秒），系統會自動排除雜音並計算適合你的練習音域。'}
              </p>
              <p className="range-test-silent-note">
                測量過程不會播放任何鋼琴或伴奏聲，請直接清唱。
              </p>

              {micError && (
                <div className="range-test-error" role="alert">
                  {micError}
                </div>
              )}

              <button
                type="button"
                className="start-btn range-test-primary-btn"
                disabled={micStarting}
                onClick={() => void startMeasuring(method)}
              >
                {micStarting ? '正在開啟麥克風…' : '開始'}
              </button>
            </div>
          )}

          {/* 2. 測量中 */}
          {phase === 'measuring' && (
            <div className="range-test-stage">
              <div className="range-test-live-top">
                <RangeChart
                  selectedRangeName={null}
                  myRange={null}
                  liveSungMidi={liveSungMidi}
                  keyboardOnly
                />
                <div className="range-test-note-readout">
                  <span className="range-test-note-caption">目前音高</span>
                  <strong className="range-test-note-big">{liveNoteText}</strong>
                </div>
              </div>

              {method === 'twoNotes' ? (
                <div className="range-test-card">
                  <div className="range-test-step-badges">
                    <span
                      className={`range-step-pill ${twoNoteStep === 1 ? 'is-active' : 'is-done'}`}
                    >
                      1. 最低音{step1Midi !== null ? `（${displayNoteName(step1Midi)}）` : ''}
                    </span>
                    <span
                      className={`range-step-pill ${twoNoteStep === 2 ? 'is-active' : ''}`}
                    >
                      2. 最高音
                    </span>
                  </div>

                  <p className="range-test-prompt">
                    {twoNoteStep === 1
                      ? '唱你最低、還舒服的音，撐 2 秒'
                      : '唱你最高、還舒服的音，撐 2 秒'}
                  </p>

                  <div className="range-progress-track" aria-label="穩定度進度">
                    <div
                      className="range-progress-fill"
                      style={{ width: `${Math.round(steadyProgress * 100)}%` }}
                    />
                  </div>
                  <p className="range-test-hint">{steadyHint}</p>

                  <div className="range-test-btn-row">
                    <button
                      type="button"
                      className="preview-btn"
                      onClick={handleRetryStep}
                    >
                      重唱
                    </button>
                    {twoNoteStep === 2 && (
                      <button
                        type="button"
                        className="preview-btn"
                        onClick={handleRedoStep1}
                      >
                        重測最低音
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="range-test-card">
                  <p className="range-test-prompt">
                    從最低滑到最高，再滑回來（約 5 秒）
                  </p>
                  <div className="range-progress-track" aria-label="滑音時間進度">
                    <div
                      className="range-progress-fill"
                      style={{
                        width: `${Math.round((glideElapsedSec / GLIDE_MAX_DURATION_SEC) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="range-test-hint">
                    已錄製 {glideElapsedSec.toFixed(1)} / {GLIDE_MAX_DURATION_SEC} 秒（10 秒自動結束）
                  </p>
                  <div className="range-test-btn-row">
                    <button
                      type="button"
                      className="preview-btn"
                      onClick={handleRetryStep}
                    >
                      重唱
                    </button>
                    <button
                      type="button"
                      className="start-btn"
                      onClick={finalizeGlide}
                    >
                      完成
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. 範圍太窄 */}
          {phase === 'tooNarrow' && (
            <div className="range-test-stage">
              <div className="range-test-card range-test-narrow-card">
                <p className="range-test-error" role="alert">
                  範圍太窄，請重測
                </p>
                {outcome && !outcome.ok && outcome.semitones > 0 && (
                  <p className="range-test-hint">
                    測得 {displayNoteName(outcome.raw[0])}–{displayNoteName(outcome.raw[1])}（僅 {outcome.semitones} 個半音，至少需 8 個半音），未儲存。
                  </p>
                )}
                <button
                  type="button"
                  className="start-btn range-test-primary-btn"
                  onClick={handleRetest}
                >
                  重測
                </button>
              </div>
            </div>
          )}

          {/* 4. 結果頁 */}
          {phase === 'result' && outcome && outcome.ok && (
            <div className="range-test-result">
              <div className="range-result-summary">
                <p className="range-result-main">
                  你的音域：
                  <strong>
                    {displayNoteName(outcome.raw[0])}–{displayNoteName(outcome.raw[1])}
                  </strong>
                  （共 {outcome.semitones} 個半音）
                </p>
                <p className="range-result-sub">
                  適合練習的範圍（我的音域）：
                  <strong>
                    {displayNoteName(outcome.myRange.low)}–
                    {displayNoteName(outcome.myRange.high)}
                  </strong>
                </p>
                <p className="range-result-rec">
                  最接近：<strong>{outcome.recommended.rangeName}</strong>
                  <span className="range-result-voice-pill">
                    {outcome.recommended.voice === 'male' ? '男聲' : '女聲'}
                  </span>
                </p>
              </div>

              <RangeChart
                selectedRangeName={outcome.recommended.rangeName}
                myRange={outcome.myRange}
                recommendedRangeName={outcome.recommended.rangeName}
              />

              <div className="range-result-actions">
                <button
                  type="button"
                  className="start-btn"
                  onClick={handleUseMyRange}
                >
                  用我的音域練習
                </button>
                <button
                  type="button"
                  className="preview-btn range-rec-btn"
                  onClick={handleUseRecommended}
                >
                  用推薦聲部
                </button>
                <button
                  type="button"
                  className="preview-btn"
                  onClick={handleRetest}
                >
                  重測
                </button>
              </div>

              <div className="range-fit-section">
                <h3 className="range-fit-title">適合你的音型</h3>
                {topPatterns.length === 0 ? (
                  <p className="range-test-hint">目前音域暫無完全容納的音型</p>
                ) : (
                  <div className="range-fit-list">
                    {topPatterns.map(({ pattern, fit }) => (
                      <button
                        key={pattern.id}
                        type="button"
                        className="range-fit-item"
                        onClick={() => handleSelectRecommendedPattern(pattern)}
                      >
                        <span className="range-fit-name">{pattern.name}</span>
                        <span className="range-fit-keys">{fit.keys} 個調</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
