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
  MIN_MY_RANGE_SEMITONES,
  MY_RANGE_NAME,
  getRangeBounds,
  type PracticeSettings,
} from '../state/settings';
import {
  buildMeasuredRangeResult,
  highNoteGap,
  mergeMeasuredRange,
  rankPatternsForRange,
  resolveStartTonicForRange,
  type MeasuredRangeOutcome,
  type MeasuredSpan,
} from '../state/vocalRange';
import { useAudioEngine } from './AudioContext';
import { RangeChart } from './RangeChart';
import { displayNoteName } from './noteLabel';

type MeasureMethod = 'twoNotes' | 'glide';
/** intro → measuring → confirm（滿意嗎？）→ result；測試過程不顯示失敗 */
type SheetPhase = 'intro' | 'measuring' | 'confirm' | 'result';
/** 最低＋最高：low → high → confirm；按「想重測」進入 extend（只擴大不縮小） */
type TwoNoteStep = 'low' | 'high' | 'extend';
type HintTone = 'normal' | 'needHigher' | 'good';

interface RangeTestSheetProps {
  open: boolean;
  settings: PracticeSettings;
  currentPattern: PatternDef;
  onApplySettings: (patch: Partial<PracticeSettings>) => void;
  onClose: () => void;
}

/** 確認一個音後，給使用者換氣的緩衝時間（期間不判斷） */
const STEP_SETTLE_MS = 800;
/** 「這是我最低了／唱不上去了」取候選音時，至少要穩定多久 */
const CANDIDATE_MIN_SEC = 0.5;

function rangeText(low: number, high: number | null): string {
  if (high === null || high === low) return `${displayNoteName(low)}（1 個音）`;
  return `${displayNoteName(low)}–${displayNoteName(high)}（共 ${high - low} 個半音）`;
}

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
  const [step, setStep] = useState<TwoNoteStep>('low');
  const [low, setLow] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const [steadyProgress, setSteadyProgress] = useState(0);
  const [hint, setHint] = useState<string>('請開始發聲');
  const [hintTone, setHintTone] = useState<HintTone>('normal');
  const [hasLowCandidate, setHasLowCandidate] = useState(false);
  const [glideElapsedSec, setGlideElapsedSec] = useState(0);
  const [liveSungMidi, setLiveSungMidi] = useState<number | null>(null);
  const [micStarting, setMicStarting] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<MeasuredRangeOutcome | null>(null);

  const detectorRef = useRef<SteadyNoteDetector>(new SteadyNoteDetector(settings.a4));
  const glideFramesRef = useRef<PitchSampleFrame[]>([]);
  const glideStartMsRef = useRef<number | null>(null);
  const glideTimerRef = useRef<number | null>(null);
  /** 滑音：前幾次（想重測之前）累積的範圍 */
  const glideBestRef = useRef<MeasuredSpan | null>(null);
  const settleUntilMsRef = useRef<number>(0);
  const lowCandidateRef = useRef<number | null>(null);
  const highCandidateRef = useRef<number | null>(null);

  const methodRef = useRef(method);
  methodRef.current = method;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const stepRef = useRef(step);
  stepRef.current = step;
  const lowRef = useRef(low);
  lowRef.current = low;
  const highRef = useRef(high);
  highRef.current = high;
  const a4Ref = useRef(settings.a4);
  a4Ref.current = settings.a4;
  const startTonicRef = useRef(settings.startTonic);
  startTonicRef.current = settings.startTonic;
  const patternRef = useRef(currentPattern);
  patternRef.current = currentPattern;

  const commitLow = useCallback((v: number | null) => {
    lowRef.current = v;
    setLow(v);
  }, []);
  const commitHigh = useCallback((v: number | null) => {
    highRef.current = v;
    setHigh(v);
  }, []);
  const commitStep = useCallback((v: TwoNoteStep) => {
    stepRef.current = v;
    setStep(v);
  }, []);
  const commitPhase = useCallback((v: SheetPhase) => {
    phaseRef.current = v;
    setPhase(v);
  }, []);
  const showHint = useCallback((text: string, tone: HintTone = 'normal') => {
    setHint(text);
    setHintTone(tone);
  }, []);
  const resetDetector = useCallback((settleMs = 0) => {
    detectorRef.current = new SteadyNoteDetector(a4Ref.current);
    settleUntilMsRef.current = settleMs > 0 ? performance.now() + settleMs : 0;
    setSteadyProgress(0);
  }, []);

  const stopGlideTimer = useCallback(() => {
    if (glideTimerRef.current !== null) {
      window.clearInterval(glideTimerRef.current);
      glideTimerRef.current = null;
    }
    glideStartMsRef.current = null;
  }, []);

  const stopMicAndTimers = useCallback(async () => {
    stopGlideTimer();
    await micController.stop();
  }, [micController, stopGlideTimer]);

  // 關閉或卸載時確保釋放麥克風與計時器
  useEffect(() => {
    if (!open) {
      void stopMicAndTimers();
      setPhase('intro');
      setStep('low');
      setLow(null);
      setHigh(null);
      setSteadyProgress(0);
      setGlideElapsedSec(0);
      setLiveSungMidi(null);
      setHasLowCandidate(false);
      setMicError(null);
      setOutcome(null);
      glideBestRef.current = null;
      lowCandidateRef.current = null;
      highCandidateRef.current = null;
      return;
    }
    return () => {
      void stopMicAndTimers();
    };
  }, [open, stopMicAndTimers]);

  /** 進入「滿意嗎？」確認頁（麥克風保持開著，按想重測可直接接著唱） */
  const goConfirm = useCallback(() => {
    stopGlideTimer();
    setLiveSungMidi(null);
    commitPhase('confirm');
  }, [commitPhase, stopGlideTimer]);

  /** 按「盡力了」：存成我的音域並切換過去 */
  const finishMeasurement = useCallback(
    async (rawLow: number, rawHigh: number, usedMethod: MeasureMethod) => {
      await stopMicAndTimers();
      const res = buildMeasuredRangeResult(rawLow, rawHigh, usedMethod);
      setOutcome(res);
      if (res.ok) {
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
      }
      commitPhase('result');
    },
    [commitPhase, onApplySettings, stopMicAndTimers],
  );

  // ---- 滑音 ----
  const finalizeGlideRef = useRef<() => void>(() => {});

  const startGlideTimer = useCallback(() => {
    stopGlideTimer();
    glideFramesRef.current = [];
    setGlideElapsedSec(0);
    glideStartMsRef.current = performance.now();
    glideTimerRef.current = window.setInterval(() => {
      if (glideStartMsRef.current === null) return;
      const elapsed = (performance.now() - glideStartMsRef.current) / 1000;
      setGlideElapsedSec(Math.min(GLIDE_MAX_DURATION_SEC, elapsed));
      // 鍵盤即時塗出「已唱到的範圍」（含想重測之前的結果）
      const a = analyzeGlideFrames(glideFramesRef.current, a4Ref.current);
      const merged = mergeMeasuredRange(
        glideBestRef.current,
        a ? { low: a.rawLow, high: a.rawHigh } : null,
      );
      commitLow(merged ? merged.low : null);
      commitHigh(merged ? merged.high : null);
      if (elapsed >= GLIDE_MAX_DURATION_SEC) {
        finalizeGlideRef.current();
      }
    }, 100);
  }, [commitHigh, commitLow, stopGlideTimer]);

  const finalizeGlide = useCallback(() => {
    if (phaseRef.current !== 'measuring' || methodRef.current !== 'glide') return;
    const a = analyzeGlideFrames(glideFramesRef.current, a4Ref.current);
    const merged = mergeMeasuredRange(
      glideBestRef.current,
      a ? { low: a.rawLow, high: a.rawHigh } : null,
    );
    if (!merged) {
      // 什麼都沒聽到：不判失敗，重新計時再滑一次
      showHint('沒有聽到聲音，請再滑一次', 'needHigher');
      startGlideTimer();
      return;
    }
    glideBestRef.current = merged;
    commitLow(merged.low);
    commitHigh(merged.high);
    goConfirm();
  }, [commitHigh, commitLow, goConfirm, showHint, startGlideTimer]);
  finalizeGlideRef.current = finalizeGlide;

  // ---- 最低＋最高 ----
  const acceptLow = useCallback(
    (midi: number) => {
      commitLow(midi);
      commitHigh(null);
      highCandidateRef.current = null;
      commitStep('high');
      resetDetector(STEP_SETTLE_MS);
      showHint(`最低音已確認（${displayNoteName(midi)}）！可以先停一下，再唱最高音`, 'good');
    },
    [commitHigh, commitLow, commitStep, resetDetector, showHint],
  );

  const handleFrame = useCallback(
    (frame: MicPitchFrame) => {
      if (phaseRef.current !== 'measuring') return;

      const hasPitch = frame.hz > 0 && Number.isFinite(frame.hz);
      const sungFloat = hasPitch ? hzToMidi(frame.hz, a4Ref.current) : NaN;
      setLiveSungMidi(Number.isFinite(sungFloat) ? sungFloat : null);

      if (methodRef.current === 'glide') {
        glideFramesRef.current.push({ t: frame.t, hz: frame.hz });
        return;
      }

      if (performance.now() < settleUntilMsRef.current) return;

      const det = detectorRef.current;
      const status = det.push({ t: frame.t, hz: frame.hz });
      const st = stepRef.current;
      const lo = lowRef.current;

      // 步驟 1：最低音
      if (st === 'low') {
        if (status.locked && status.midi !== null) {
          acceptLow(status.midi);
          return;
        }
        const peek = det.peekStable(CANDIDATE_MIN_SEC);
        if (peek !== null && (lowCandidateRef.current === null || peek < lowCandidateRef.current)) {
          lowCandidateRef.current = peek;
          setHasLowCandidate(true);
        }
        setSteadyProgress(status.progress);
        if (!hasPitch) showHint('唱你最低、還舒服的音，撐 2 秒');
        else if (status.stdCents !== null && status.stdCents >= 40) showHint('音高跳動較大，請保持穩定');
        else showHint('偵測穩定中，請再撐一下…');
        return;
      }

      if (lo === null) return;

      // 步驟 2：最高音（太近不判失敗，提示還差幾個半音）
      if (st === 'high') {
        const peek = det.peekStable(CANDIDATE_MIN_SEC);
        if (peek !== null && peek > lo && (highCandidateRef.current === null || peek > highCandidateRef.current)) {
          highCandidateRef.current = peek;
        }
        if (status.locked && status.midi !== null) {
          const g = highNoteGap(lo, status.midi);
          if (g.reached) {
            commitHigh(status.midi);
            setSteadyProgress(1);
            goConfirm();
            return;
          }
          if (status.midi > lo && (highCandidateRef.current === null || status.midi > highCandidateRef.current)) {
            highCandidateRef.current = status.midi;
          }
          resetDetector();
          showHint(
            `${displayNoteName(status.midi)} 離最低音太近，請往上唱到 ${displayNoteName(g.targetMin)} 以上（還差 ${g.missingSemitones} 個半音）`,
            'needHigher',
          );
          return;
        }
        const gap = hasPitch ? highNoteGap(lo, sungFloat) : null;
        if (gap && !gap.reached) {
          setSteadyProgress(0);
          showHint(
            `請往上唱到 ${displayNoteName(gap.targetMin)} 以上（還差 ${gap.missingSemitones} 個半音）`,
            'needHigher',
          );
          return;
        }
        setSteadyProgress(status.progress);
        if (!hasPitch) {
          showHint(`請唱最高、還舒服的音（${displayNoteName(highNoteGap(lo, lo).targetMin)} 以上）`);
        } else if (status.stdCents !== null && status.stdCents >= 40) {
          showHint('音高跳動較大，請保持穩定');
        } else {
          showHint('偵測穩定中，請再撐一下…');
        }
        return;
      }

      // 想重測（extend）：只有比原本更低或更高才更新
      setSteadyProgress(status.progress);
      if (status.locked && status.midi !== null) {
        const m = status.midi;
        const hi = highRef.current ?? lo;
        if (m < lo) {
          commitLow(m);
          showHint(`最低音更新為 ${displayNoteName(m)}！`, 'good');
        } else if (m > hi) {
          commitHigh(m);
          showHint(`最高音更新為 ${displayNoteName(m)}！`, 'good');
        } else {
          showHint(`${displayNoteName(m)} 在已測範圍內，試試更低或更高`);
        }
        resetDetector(STEP_SETTLE_MS);
      }
    },
    [acceptLow, commitHigh, commitLow, goConfirm, resetDetector, showHint],
  );

  const startMeasuring = useCallback(
    async (selectedMethod: MeasureMethod) => {
      setMicError(null);
      setMicStarting(true);
      engine.stop(); // 測量時絕不播放任何聲音

      resetDetector();
      glideFramesRef.current = [];
      glideBestRef.current = null;
      lowCandidateRef.current = null;
      highCandidateRef.current = null;
      setHasLowCandidate(false);
      commitStep('low');
      commitLow(null);
      commitHigh(null);
      showHint(selectedMethod === 'glide' ? '從最低滑到最高，再滑回來' : '唱你最低、還舒服的音，撐 2 秒');
      setGlideElapsedSec(0);
      setLiveSungMidi(null);
      setOutcome(null);

      try {
        await micController.start({
          echoCancellation: settings.echoCancellation,
          gateDb: settings.noiseGateDb,
          onFrame: handleFrame,
          onEnded: () => {
            if (phaseRef.current === 'measuring' || phaseRef.current === 'confirm') {
              setMicError('麥克風已中斷，請重新開始');
              stopGlideTimer();
              commitPhase('intro');
            }
          },
        });
        commitPhase('measuring');
        if (selectedMethod === 'glide') startGlideTimer();
      } catch (err) {
        if (err instanceof MicPermissionError) {
          setMicError(err.message);
        } else {
          setMicError(err instanceof Error ? err.message : '無法啟動麥克風，請稍後再試');
        }
        await stopMicAndTimers();
        commitPhase('intro');
      } finally {
        setMicStarting(false);
      }
    },
    [
      commitHigh,
      commitLow,
      commitPhase,
      commitStep,
      engine,
      handleFrame,
      micController,
      resetDetector,
      settings.echoCancellation,
      settings.noiseGateDb,
      showHint,
      startGlideTimer,
      stopGlideTimer,
      stopMicAndTimers,
    ],
  );

  function handleRetryStep() {
    if (method === 'twoNotes') {
      resetDetector();
      showHint('請重新唱出穩定音高');
    } else {
      startGlideTimer();
    }
  }

  function handleRedoLow() {
    resetDetector();
    commitLow(null);
    commitHigh(null);
    lowCandidateRef.current = null;
    highCandidateRef.current = null;
    setHasLowCandidate(false);
    commitStep('low');
    showHint('請重新唱出最低音');
  }

  /** 「這是我最低了」：用剛才最穩的低音候選 */
  function handleLowestReached() {
    const cand = lowCandidateRef.current;
    if (cand === null) return;
    acceptLow(cand);
  }

  /** 「唱不上去了」：用剛才最穩的高音候選；完全沒有就只存最低音 */
  function handleCannotGoHigher() {
    const lo = lowRef.current;
    if (lo === null) return;
    commitHigh(highCandidateRef.current ?? lo);
    goConfirm();
  }

  /** 滿意嗎？→ 想重測：保留結果，只擴大不縮小 */
  function handleWantRetest() {
    if (method === 'twoNotes') {
      resetDetector();
      commitStep('extend');
      const lo = lowRef.current;
      const hi = highRef.current ?? lo;
      if (lo !== null && hi !== null) {
        showHint(`再唱一次：比 ${displayNoteName(lo)} 更低、或比 ${displayNoteName(hi)} 更高才會更新`);
      }
      commitPhase('measuring');
    } else {
      showHint('再滑一次，只會擴大範圍');
      commitPhase('measuring');
      startGlideTimer();
    }
  }

  /** 滿意嗎？→ 盡力了 */
  function handleDoneBest() {
    const lo = lowRef.current;
    if (lo === null) return;
    void finishMeasurement(lo, highRef.current ?? lo, method);
  }

  function handleRetestFromScratch() {
    void stopMicAndTimers();
    setOutcome(null);
    commitPhase('intro');
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

  const highTarget =
    method === 'twoNotes' && step === 'high' && low !== null
      ? highNoteGap(low, low).targetMin
      : null;
  const hintClass =
    hintTone === 'needHigher' ? 'is-need-higher' : hintTone === 'good' ? 'is-good' : '';
  const confirmNarrow =
    low !== null && (high ?? low) - low < MIN_MY_RANGE_SEMITONES;

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
                  ? '先唱最低、再唱最高的穩定音（各撐約 2 秒）。鍵盤會跟著你的聲音變色，穩定後顏色就固定下來。'
                  : '從最低音輕鬆滑唱到最高音再滑回來（約 5 秒），鍵盤會即時塗出你唱到的範圍。'}
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

          {/* 2. 測量中（不顯示失敗） */}
          {phase === 'measuring' && (
            <div className="range-test-stage">
              <div className="range-test-live-top">
                <RangeChart
                  selectedRangeName={null}
                  myRange={null}
                  liveSungMidi={liveSungMidi}
                  keyboardOnly
                  confirmedLowMidi={low}
                  confirmedHighMidi={method === 'twoNotes' && step === 'high' ? null : high}
                  highTargetMinMidi={highTarget}
                />
                <div className="range-test-note-readout">
                  <span className="range-test-note-caption">目前音高</span>
                  <strong className="range-test-note-big">{liveNoteText}</strong>
                </div>
              </div>

              {method === 'twoNotes' ? (
                <div className="range-test-card">
                  {step !== 'extend' ? (
                    <div className="range-test-step-badges">
                      <span className={`range-step-pill ${step === 'low' ? 'is-active' : 'is-done'}`}>
                        1. 最低音{low !== null ? `（${displayNoteName(low)}）✓` : ''}
                      </span>
                      <span className={`range-step-pill ${step === 'high' ? 'is-active' : ''}`}>
                        2. 最高音
                      </span>
                    </div>
                  ) : (
                    low !== null && (
                      <p className="range-test-confirmed" role="status">
                        目前範圍：{rangeText(low, high)}
                      </p>
                    )
                  )}

                  <p className="range-test-prompt">
                    {step === 'low'
                      ? '唱你最低、還舒服的音，撐 2 秒'
                      : step === 'high'
                        ? `換唱最高、還舒服的音（${highTarget !== null ? displayNoteName(highTarget) : ''} 以上，鍵盤藍條），撐 2 秒`
                        : '再挑戰一次：唱得更低或更高，撐 2 秒'}
                  </p>

                  <div className="range-progress-track" aria-label="穩定度進度">
                    <div
                      className="range-progress-fill"
                      style={{ width: `${Math.round(steadyProgress * 100)}%` }}
                    />
                  </div>
                  <p className={`range-test-hint ${hintClass}`} aria-live="polite">
                    {hint}
                  </p>

                  <div className="range-test-btn-row">
                    <button type="button" className="preview-btn" onClick={handleRetryStep}>
                      重唱
                    </button>
                    {step === 'low' && (
                      <button
                        type="button"
                        className="preview-btn"
                        disabled={!hasLowCandidate}
                        onClick={handleLowestReached}
                      >
                        這是我最低了
                      </button>
                    )}
                    {step === 'high' && (
                      <>
                        <button type="button" className="preview-btn" onClick={handleRedoLow}>
                          重測最低音
                        </button>
                        <button type="button" className="preview-btn" onClick={handleCannotGoHigher}>
                          唱不上去了
                        </button>
                      </>
                    )}
                    {step === 'extend' && (
                      <button type="button" className="start-btn" onClick={goConfirm}>
                        完成
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
                  <p className={`range-test-hint ${hintClass}`} aria-live="polite">
                    {low !== null
                      ? `已唱到 ${rangeText(low, high)} · ${glideElapsedSec.toFixed(1)} / ${GLIDE_MAX_DURATION_SEC} 秒`
                      : `${hint} · ${glideElapsedSec.toFixed(1)} / ${GLIDE_MAX_DURATION_SEC} 秒`}
                  </p>
                  <div className="range-test-btn-row">
                    <button type="button" className="preview-btn" onClick={handleRetryStep}>
                      重唱
                    </button>
                    <button type="button" className="start-btn" onClick={finalizeGlide}>
                      完成
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. 滿意嗎？ */}
          {phase === 'confirm' && low !== null && (
            <div className="range-test-stage">
              <div className="range-test-live-top">
                <RangeChart
                  selectedRangeName={null}
                  myRange={null}
                  liveSungMidi={null}
                  keyboardOnly
                  confirmedLowMidi={low}
                  confirmedHighMidi={high}
                />
              </div>
              <div className="range-test-card">
                <p className="range-test-prompt">測到的範圍，滿意嗎？</p>
                <p className="range-test-confirm-range">{rangeText(low, high)}</p>
                {confirmNarrow && (
                  <p className="range-test-hint">
                    比一般練習範圍窄一點也沒關係，會照實際測到的範圍存。
                  </p>
                )}
                <p className="range-test-hint">
                  想重測：保留這次結果再唱一次，只有更低或更高才會更新。
                </p>
                <div className="range-test-btn-row">
                  <button type="button" className="preview-btn" onClick={handleWantRetest}>
                    想重測
                  </button>
                  <button type="button" className="start-btn" onClick={handleDoneBest}>
                    盡力了
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. 結果頁 */}
          {phase === 'result' && outcome && !outcome.ok && (
            <div className="range-test-stage">
              <div className="range-test-card">
                <p className="range-test-hint">{outcome.error}</p>
                <button
                  type="button"
                  className="start-btn range-test-primary-btn"
                  onClick={handleRetestFromScratch}
                >
                  重測
                </button>
              </div>
            </div>
          )}

          {phase === 'result' && outcome && outcome.ok && (
            <div className="range-test-result">
              <div className="range-result-summary">
                <p className="range-result-main">
                  你的音域：
                  <strong>{rangeText(outcome.raw[0], outcome.raw[1])}</strong>
                </p>
                {outcome.narrow ? (
                  <p className="range-result-sub">
                    範圍比較窄，已照實存成「我的音域」。建議先從三音來回、五音這類小音型練起，慢慢就會擴大。
                  </p>
                ) : (
                  <p className="range-result-sub">
                    適合練習的範圍（我的音域）：
                    <strong>
                      {displayNoteName(outcome.myRange.low)}–
                      {displayNoteName(outcome.myRange.high)}
                    </strong>
                  </p>
                )}
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
                <button type="button" className="start-btn" onClick={handleUseMyRange}>
                  用我的音域練習
                </button>
                <button
                  type="button"
                  className="preview-btn range-rec-btn"
                  onClick={handleUseRecommended}
                >
                  用推薦聲部
                </button>
                <button type="button" className="preview-btn" onClick={handleRetestFromScratch}>
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
