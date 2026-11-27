import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { singingCurve } from '../../core/curve';
import { buildExercise, type Exercise, type KeyBlock } from '../../core/exercise';
import { type Key } from '../../core/key';
import { centsBetween, hzToMidi, midiToHz } from '../../core/notes';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import { clefForRange, staffPosition } from '../../core/staff';
import { micCtxSecToSongSec } from '../../mic/latency';
import {
  MicController,
  MicPermissionError,
  type MicPitchFrame,
} from '../../mic/micController';
import { outputAt, type ActiveKey } from '../../mic/outputAt';
import { ConfusionDetector, VoiceGate } from '../../mic/voiceGate';
import {
  fullIndexToTonicListIndex,
  loadKeySelection,
  makeKeySelectionScopeKey,
  makeSequenceSignature,
  reorderKeySelection,
  resolveKeyIndexAfterSelectionChange,
  saveKeySelection,
  setOnlySelected,
  syncKeySelectionSequence,
  toggleKeySelection,
  tonicListIndexToFullIndex,
  type KeySelectionState,
} from '../../state/keySelection';
import {
  getPatternSpan,
  getRangeBounds,
  nextRepeatsPerKey,
  repeatsPerKeyToCount,
  toExerciseOptions,
  type PracticeSettings,
} from '../../state/settings';
import { useAudioEngine } from '../AudioContext';
import { CentsBar } from './CentsBar';
import { JianpuStrip } from './JianpuStrip';
import { KeyStrip } from './KeyStrip';
import {
  computeStaffMetrics,
  countInDotStates,
  currentNoteIndex,
  noteGlyphs,
  passWindow,
  rescaleTime,
  scoreLines,
  staffLeftPad,
  timeToX,
  tonicLabel,
  type ScoreLine,
} from './layout';
import {
  clampPianoHeight,
  defaultPianoHeight,
  handleBarHeight,
  miniPianoHeight,
  minScoreLineHeight,
  previewDrawerDrag,
  resolveDrawerPointerEnd,
} from './pianoDrawer';
import { PianoKeyboard } from '../piano/PianoKeyboard';
import { PracticeSettingsSheet } from './PracticeSettingsSheet';
import { StaffView, type SungPoint } from './StaffView';
import { TransportBar } from './TransportBar';

interface PracticePageProps {
  settings: PracticeSettings;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onBack: () => void;
}

const C_MAJOR_KEY: Key = { tonicPc: 0, mode: 'major' };
const RIGHT_PAD = 18;
const EMPTY_SUNG: SungPoint[] = [];

interface RawSungSample {
  t: number;
  hz: number;
  voiced: boolean;
}

function median3(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if ((sorted.length & 1) === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

function readViewport() {
  if (typeof window === 'undefined') {
    return { width: 844, height: 390 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

/** 正式練唱畫面：上方 cents 色條、簡譜帶與五線譜，下方對音鋼琴與播放列 */
export function PracticePage({
  settings,
  onUpdateSettings,
  onBack,
}: PracticePageProps) {
  const engine = useAudioEngine();
  const [viewport, setViewport] = useState(readViewport);
  const [sec, setSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [boundaryToast, setBoundaryToast] = useState(false);
  const [scoreWidth, setScoreWidth] = useState(720);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [liveDb, setLiveDb] = useState<number | null>(null);
  const [sungMidi, setSungMidi] = useState<number | null>(null);
  const [currentCents, setCurrentCents] = useState<number | null>(null);
  const [sungVersion, setSungVersion] = useState(0);
  const [confusionBubbleOpen, setConfusionBubbleOpen] = useState(false);
  const [infLoopCount, setInfLoopCount] = useState(1);

  const micController = useMemo(() => new MicController(engine), [engine]);
  const voiceGateRef = useRef(new VoiceGate());
  const confusionRef = useRef(new ConfusionDetector());
  const rawSungRef = useRef<RawSungSample[]>([]);
  const recentVoiceRef = useRef<{ wallMs: number; hz: number }[]>([]);
  const activeKeysRef = useRef<ActiveKey[]>([]);
  const pressedOnsetsRef = useRef<Map<number, number>>(new Map());
  const targetMidiRef = useRef<number | null>(null);
  const currentPhaseRef = useRef<'listen' | 'sing'>('sing');
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const repeatsPerKeyRef = useRef(settings.repeatsPerKey);
  repeatsPerKeyRef.current = settings.repeatsPerKey;
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const autoMicAttemptedRef = useRef(false);
  const prevEchoRef = useRef(settings.echoCancellation);
  const exerciseRef = useRef<Exercise | null>(null);
  const loopAnchorKeyRef = useRef(0);
  const infLoopRef = useRef<{ lastSeekAt: number }>({ lastSeekAt: 0 });

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const scoreAreaRef = useRef<HTMLDivElement | null>(null);
  const handleDragRef = useRef<{
    pointerId: number;
    startY: number;
    startX: number;
    savedHeight: number;
    collapsed: boolean;
    maxDist: number;
  } | null>(null);
  const baseTonicRef = useRef(settings.startTonic);
  const menuBpmRef = useRef(settings.bpm);
  const boundaryTimerRef = useRef<number | null>(null);
  const pendingSeekRef = useRef<{ sec: number; resumePlay: boolean } | null>(
    null,
  );
  const pendingSeekKeyRef = useRef<{
    keyIndex: number;
    resumePlay: boolean;
  } | null>(null);
  const suppressLoadPosRef = useRef(false);
  const lastPosRef = useRef<{ sec: number; time: number; playing: boolean }>({
    sec: 0,
    time: 0,
    playing: false,
  });

  // 追蹤視窗大小與橫直向切換
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const isPortraitPhone =
    viewport.width < 600 && viewport.height > viewport.width;
  const isTablet = viewport.height > 500;

  // 量測譜面紙張寬度與工作區高度
  useEffect(() => {
    if (isPortraitPhone) return;
    const scoreEl = scoreAreaRef.current;
    const wsEl = workspaceRef.current;

    const updateSizes = () => {
      if (scoreEl && scoreEl.clientWidth > 0) {
        setScoreWidth(scoreEl.clientWidth);
      }
      if (wsEl && wsEl.clientHeight > 0) {
        setWorkspaceHeight(wsEl.clientHeight);
      }
    };
    updateSizes();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateSizes);
    if (scoreEl) ro.observe(scoreEl);
    if (wsEl) ro.observe(wsEl);
    return () => ro.disconnect();
  }, [isPortraitPhone]);

  const pattern = useMemo(
    () =>
      BUILTIN_PATTERNS.find((p) => p.id === settings.patternId) ??
      BUILTIN_PATTERNS[0]!,
    [settings.patternId],
  );

  // 計算完整調性序列，用於調名清單選取與記憶
  const fullKeys = useMemo<KeyBlock[]>(() => {
    try {
      const baseEx = buildExercise(pattern, {
        ...toExerciseOptions(settings),
        repeats: 1,
        cadence: false,
        countInBeats: 0,
      });
      return baseEx.keys;
    } catch {
      return [];
    }
  }, [
    pattern,
    settings.startTonic,
    settings.rangeName,
    settings.bpm,
    settings.noteBeats,
    settings.articulation,
    settings.transpose,
    settings.mode,
  ]);

  const fullTonics = useMemo(
    () => fullKeys.map((k) => k.tonicMidi),
    [fullKeys],
  );

  const selectionScopeKey = useMemo(
    () =>
      makeKeySelectionScopeKey({
        patternId: settings.patternId,
        rangeName: settings.rangeName,
        startTonic: settings.startTonic,
        transpose: settings.transpose,
      }),
    [
      settings.patternId,
      settings.rangeName,
      settings.startTonic,
      settings.transpose,
    ],
  );

  const sequenceSignature = useMemo(
    () => makeSequenceSignature(fullTonics),
    [fullTonics],
  );

  const [rawKeySelection, setRawKeySelection] = useState<KeySelectionState>(() =>
    loadKeySelection(selectionScopeKey, sequenceSignature, fullTonics.length),
  );

  useEffect(() => {
    setRawKeySelection(
      loadKeySelection(selectionScopeKey, sequenceSignature, fullTonics.length),
    );
  }, [selectionScopeKey, sequenceSignature, fullTonics.length]);

  const keySelection = useMemo(
    () =>
      syncKeySelectionSequence(
        rawKeySelection,
        sequenceSignature,
        fullTonics.length,
      ),
    [rawKeySelection, sequenceSignature, fullTonics.length],
  );

  const updateKeySelection = useCallback(
    (updater: (prev: KeySelectionState) => KeySelectionState) => {
      setRawKeySelection((prev) => {
        const synced = syncKeySelectionSequence(
          prev,
          sequenceSignature,
          fullTonics.length,
        );
        const next = updater(synced);
        saveKeySelection(selectionScopeKey, next);
        return next;
      });
    },
    [selectionScopeKey, sequenceSignature, fullTonics.length],
  );

  const selectedTonicList = useMemo(() => {
    if (
      !keySelection.onlySelected ||
      keySelection.selectedIndices.length === 0
    ) {
      return undefined;
    }
    return keySelection.selectedIndices
      .map((idx) => fullTonics[idx])
      .filter((t): t is number => typeof t === 'number');
  }, [keySelection.onlySelected, keySelection.selectedIndices, fullTonics]);

  const { exercise, buildError } = useMemo(() => {
    try {
      const ex = buildExercise(pattern, {
        ...toExerciseOptions(settings),
        repeats: repeatsPerKeyToCount(settings.repeatsPerKey),
        ...(selectedTonicList && selectedTonicList.length > 0
          ? { tonicList: selectedTonicList }
          : {}),
      });
      return { exercise: ex, buildError: null as string | null };
    } catch (err) {
      return {
        exercise: null as Exercise | null,
        buildError: err instanceof Error ? err.message : String(err),
      };
    }
  }, [pattern, settings, selectedTonicList]);
  exerciseRef.current = exercise;

  // 訂閱播放位置與結束事件
  useEffect(() => {
    const unsubPos = engine.onPosition((s, isPlaying) => {
      if (suppressLoadPosRef.current && s === 0 && !isPlaying) {
        suppressLoadPosRef.current = false;
        return;
      }
      suppressLoadPosRef.current = false;

      const ex = exerciseRef.current;
      if (isPlaying && ex) {
        if (repeatsPerKeyRef.current === 'inf') {
          const anchorIdx = Math.max(
            0,
            Math.min(ex.keys.length - 1, loopAnchorKeyRef.current),
          );
          const anchorKb = ex.keys[anchorIdx];
          if (anchorKb && s >= anchorKb.end - 0.015) {
            const now = performance.now();
            if (now - infLoopRef.current.lastSeekAt > 150) {
              infLoopRef.current.lastSeekAt = now;
              rawSungRef.current = rawSungRef.current.filter(
                (p) => p.t < anchorKb.start,
              );
              voiceGateRef.current.reset();
              setSungVersion((v) => v + 1);
              setInfLoopCount((c) => c + 1);
              lastPosRef.current = {
                sec: anchorKb.start,
                time: now,
                playing: true,
              };
              setSec(anchorKb.start);
              engine.seek(anchorKb.start);
              return;
            }
          }
        }
        const activeKb = ex.keys.find((k) => s >= k.start && s < k.end - 0.02);
        if (activeKb) {
          loopAnchorKeyRef.current = activeKb.index;
        }
      }

      lastPosRef.current = {
        sec: s,
        time: performance.now(),
        playing: isPlaying,
      };
      setSec(s);
      setPlaying(isPlaying);
    });
    const unsubEnd = engine.onEnded(() => {
      const ex = exerciseRef.current;
      if (repeatsPerKeyRef.current === 'inf' && ex) {
        const anchorIdx = Math.max(
          0,
          Math.min(ex.keys.length - 1, loopAnchorKeyRef.current),
        );
        const anchorKb = ex.keys[anchorIdx];
        if (anchorKb) {
          const now = performance.now();
          infLoopRef.current.lastSeekAt = now;
          rawSungRef.current = rawSungRef.current.filter(
            (p) => p.t < anchorKb.start,
          );
          voiceGateRef.current.reset();
          setSungVersion((v) => v + 1);
          setInfLoopCount((c) => c + 1);
          lastPosRef.current = {
            sec: anchorKb.start,
            time: now,
            playing: true,
          };
          setSec(anchorKb.start);
          engine.seek(anchorKb.start);
          engine.play();
          return;
        }
      }
      lastPosRef.current = {
        sec: lastPosRef.current.sec,
        time: performance.now(),
        playing: false,
      };
      setPlaying(false);
    });
    return () => {
      unsubPos();
      unsubEnd();
      engine.stop();
    };
  }, [engine]);

  // 播放中以 requestAnimationFrame 外插秒數，讓藍色虛線平滑移動
  useEffect(() => {
    if (!playing || !exercise) return;
    let rafId = 0;
    const total = exercise.total;
    const tick = () => {
      const { sec: baseSec, time, playing: isPlaying } = lastPosRef.current;
      if (isPlaying) {
        const dt = (performance.now() - time) / 1000;
        setSec(Math.min(total, baseSec + Math.max(0, dt)));
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, exercise]);

  // 設定或練習變更時重新載入音訊時間表
  useEffect(() => {
    if (!exercise) return;
    engine.setA4(settings.a4);
    engine.load(exercise, {
      pianoDuringSing: settings.pianoDuringSing,
      pad: settings.pad,
      click: settings.countIn,
      beatClicks: true,
      bpm: settings.bpm,
      voiceForGlide: true,
    });
    const pendingKey = pendingSeekKeyRef.current;
    if (pendingKey) {
      pendingSeekKeyRef.current = null;
      const clampedIdx = Math.max(
        0,
        Math.min(exercise.keys.length - 1, pendingKey.keyIndex),
      );
      const targetSec = exercise.keys[clampedIdx]?.start ?? 0;
      suppressLoadPosRef.current = true;
      loopAnchorKeyRef.current = clampedIdx;
      setInfLoopCount(1);
      lastPosRef.current = {
        sec: targetSec,
        time: performance.now(),
        playing: pendingKey.resumePlay,
      };
      setSec(targetSec);
      engine.seek(targetSec);
      if (pendingKey.resumePlay) {
        engine.play();
      }
      return;
    }

    const pending = pendingSeekRef.current;
    if (pending) {
      pendingSeekRef.current = null;
      suppressLoadPosRef.current = true;
      const clampedSec = Math.max(0, Math.min(exercise.total, pending.sec));
      lastPosRef.current = {
        sec: clampedSec,
        time: performance.now(),
        playing: pending.resumePlay,
      };
      setSec(clampedSec);
      engine.seek(clampedSec);
      if (pending.resumePlay) {
        engine.play();
      }
    }
  }, [
    engine,
    exercise,
    settings.a4,
    settings.bpm,
    settings.pianoDuringSing,
    settings.pad,
    settings.countIn,
  ]);

  // 節拍器與唱時鋼琴音量即時套用，不重新 load
  useEffect(() => {
    engine.setGain('metro', settings.metronome ? 1 : 0);
  }, [engine, settings.metronome]);

  useEffect(() => {
    engine.setGain('melodySing', settings.singPianoVolume / 100);
  }, [engine, settings.singPianoVolume]);

  useEffect(() => {
    micController.setGateDb(settings.noiseGateDb);
  }, [micController, settings.noiseGateDb]);

  // 練習內容變更時清空演唱軌跡與辨識狀態
  useEffect(() => {
    rawSungRef.current = [];
    recentVoiceRef.current = [];
    voiceGateRef.current.reset();
    confusionRef.current.reset();
    setConfusionBubbleOpen(false);
    setSungMidi(null);
    setCurrentCents(null);
    setSungVersion((v) => v + 1);
  }, [exercise]);

  // 離開頁面時關閉麥克風
  useEffect(() => {
    return () => {
      void micController.stop();
    };
  }, [micController]);

  const handleMicFrame = useCallback(
    (frame: MicPitchFrame) => {
      const cfg = settingsRef.current;
      if (settingsOpenRef.current) {
        setLiveDb(frame.db);
      }

      const isPlaying = playingRef.current;
      const offsetSec = engine.ctxToSongOffsetSec;
      const aligned = isPlaying && offsetSec !== null;
      const songSec = aligned
        ? micCtxSecToSongSec({
            micCtxSec: frame.t,
            ctxToSongOffsetSec: offsetSec,
            inputLatencySec: micController.inputLatencySec,
            outputLatencySec: engine.outputLatency,
            manualOffsetMs: cfg.latencyOffsetMs,
          })
        : frame.t;

      const outputs = aligned
        ? outputAt(engine.compiledEvents, songSec, {
            rate: engine.sampleRate,
            activeKeys: activeKeysRef.current,
          })
        : outputAt([], songSec, {
            rate: engine.sampleRate,
            activeKeys: activeKeysRef.current,
          });

      const gate = voiceGateRef.current.processFrame(
        { t: songSec, hz: frame.hz, db: frame.db },
        outputs,
        {
          mode: cfg.micMode,
          gateDb: cfg.noiseGateDb,
        },
      );

      const isVoice = gate.label === 'voice' && frame.hz > 0;
      const midiFloat = isVoice ? hzToMidi(frame.hz, cfg.a4) : NaN;

      if (isVoice && Number.isFinite(midiFloat)) {
        setSungMidi(midiFloat);
        const nowMs = performance.now();
        recentVoiceRef.current.push({ wallMs: nowMs, hz: frame.hz });
        recentVoiceRef.current = recentVoiceRef.current
          .filter((item) => nowMs - item.wallMs <= 250)
          .slice(-3);

        const target = targetMidiRef.current;
        if (target !== null) {
          const centsList = recentVoiceRef.current
            .map((item) => centsBetween(item.hz, target, cfg.a4))
            .filter((c) => Number.isFinite(c));
          setCurrentCents(median3(centsList));
        } else {
          setCurrentCents(null);
        }
      } else {
        setSungMidi(null);
        setCurrentCents(null);
        if (gate.label === 'silent' || gate.label === 'leak') {
          recentVoiceRef.current = [];
        }
      }

      if (aligned && songSec >= 0) {
        const samples = rawSungRef.current;
        const last = samples[samples.length - 1];
        if (!last || songSec > last.t) {
          samples.push({
            t: songSec,
            hz: isVoice ? frame.hz : 0,
            voiced: isVoice,
          });
          setSungVersion((v) => v + 1);
        }

        if (!cfg.hideSpeakerHint && currentPhaseRef.current === 'sing') {
          const conf = confusionRef.current.push({
            t: songSec,
            label: gate.label,
            midi: midiFloat,
            pitchStd: gate.pitchStd,
            hasOutput: gate.hasOutput,
            isMetro: gate.isMetro,
          });
          if (conf.justTriggered) {
            setConfusionBubbleOpen(true);
          }
        }
      }
    },
    [engine, micController],
  );

  const startMic = useCallback(async (): Promise<boolean> => {
    try {
      const cfg = settingsRef.current;
      await micController.start({
        echoCancellation: cfg.echoCancellation,
        gateDb: cfg.noiseGateDb,
        onFrame: handleMicFrame,
        onEnded: () => {
          setMicActive(false);
          setLiveDb(null);
          setSungMidi(null);
          setCurrentCents(null);
        },
      });
      setMicActive(true);
      setErrorMsg((prev) =>
        prev === '沒有麥克風權限，只能聽示範' ? null : prev,
      );
      return true;
    } catch (err) {
      setMicActive(false);
      if (err instanceof MicPermissionError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
      return false;
    }
  }, [micController, handleMicFrame]);

  const stopMic = useCallback(async () => {
    await micController.stop();
    setMicActive(false);
    setLiveDb(null);
    setSungMidi(null);
    setCurrentCents(null);
  }, [micController]);

  async function handleToggleMic() {
    if (micActive) {
      await stopMic();
    } else {
      autoMicAttemptedRef.current = true;
      await startMic();
    }
  }

  // 切換「系統回音消除（實驗）」時自動重開麥克風
  useEffect(() => {
    if (prevEchoRef.current === settings.echoCancellation) {
      return;
    }
    prevEchoRef.current = settings.echoCancellation;
    if (micActive) {
      void startMic();
    }
  }, [settings.echoCancellation, micActive, startMic]);

  const getExtrapolatedSec = useCallback(() => {
    const { sec: baseSec, time, playing: isPlaying } = lastPosRef.current;
    if (!isPlaying) {
      return baseSec;
    }
    const total = exercise?.total ?? Infinity;
    const dt = (performance.now() - time) / 1000;
    return Math.min(total, baseSec + Math.max(0, dt));
  }, [exercise]);

  // 移調邊界計算
  const [rangeLow, rangeHigh] = getRangeBounds(settings.rangeName);
  const { minSemi, maxSemi } = useMemo(() => getPatternSpan(pattern), [pattern]);
  const feasibleLow = rangeLow - minSemi;
  const feasibleHigh = rangeHigh - maxSemi;
  const canTransposeDown = settings.startTonic - 1 >= feasibleLow;
  const canTransposeUp = settings.startTonic + 1 <= feasibleHigh;
  const transposeOffset = settings.startTonic - baseTonicRef.current;

  function showBoundaryHint() {
    setBoundaryToast(true);
    if (boundaryTimerRef.current !== null) {
      window.clearTimeout(boundaryTimerRef.current);
    }
    boundaryTimerRef.current = window.setTimeout(() => {
      setBoundaryToast(false);
    }, 2000);
  }

  useEffect(() => {
    return () => {
      if (boundaryTimerRef.current !== null) {
        window.clearTimeout(boundaryTimerRef.current);
      }
    };
  }, []);

  function applyBpmChange(nextRaw: number) {
    const nextBpm = Math.max(40, Math.min(200, Math.round(nextRaw)));
    if (nextBpm === settings.bpm) {
      return;
    }
    const currentSec = getExtrapolatedSec();
    const scaledSec = rescaleTime(currentSec, settings.bpm, nextBpm);
    pendingSeekRef.current = { sec: scaledSec, resumePlay: playing };
    lastPosRef.current = {
      sec: scaledSec,
      time: performance.now(),
      playing,
    };
    setSec(scaledSec);
    onUpdateSettings({ bpm: nextBpm });
  }

  function handleBpmStep(delta: -4 | 4) {
    applyBpmChange(settings.bpm + delta);
  }

  function handleBpmReset() {
    applyBpmChange(menuBpmRef.current);
  }

  function handleTransposeStep(delta: -1 | 1) {
    const nextTonic = settings.startTonic + delta;
    if (nextTonic < feasibleLow || nextTonic > feasibleHigh) {
      showBoundaryHint();
      return;
    }
    onUpdateSettings({ startTonic: nextTonic });
  }

  async function handlePlayPause() {
    if (playing) {
      engine.pause();
      return;
    }
    if (!exercise) return;
    try {
      setErrorMsg(null);
      await engine.unlock();
      await engine.init();
      await engine.unlock();

      if (!micActive && !autoMicAttemptedRef.current) {
        autoMicAttemptedRef.current = true;
        await startMic();
      }

      engine.setA4(settings.a4);
      engine.load(exercise, {
        pianoDuringSing: settings.pianoDuringSing,
        pad: settings.pad,
        click: settings.countIn,
        beatClicks: true,
        bpm: settings.bpm,
        voiceForGlide: true,
      });
      engine.setGain('metro', settings.metronome ? 1 : 0);
      engine.setGain('melodySing', settings.singPianoVolume / 100);
      const currentSec = lastPosRef.current.sec;
      if (currentSec > 0) {
        engine.seek(currentSec);
      }
      engine.play();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function jumpToKey(keyIdx: number) {
    if (!exercise || exercise.keys.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(exercise.keys.length - 1, keyIdx));
    const targetSec = exercise.keys[clampedIdx]?.start ?? 0;
    loopAnchorKeyRef.current = clampedIdx;
    setInfLoopCount(1);
    rawSungRef.current = rawSungRef.current.filter((p) => p.t < targetSec);
    voiceGateRef.current.reset();
    setSungVersion((v) => v + 1);
    lastPosRef.current = {
      sec: targetSec,
      time: performance.now(),
      playing,
    };
    setSec(targetSec);
    engine.seekToKey(clampedIdx);
  }

  function handlePrevKey() {
    if (!exercise) return;
    jumpToKey(Math.max(0, currentKeyIndex - 1));
  }

  function handleNextKey() {
    if (!exercise) return;
    jumpToKey(Math.min(exercise.keys.length - 1, currentKeyIndex + 1));
  }

  function stopAndResetPlayback() {
    engine.stop();
    loopAnchorKeyRef.current = 0;
    setInfLoopCount(1);
    lastPosRef.current = {
      sec: 0,
      time: performance.now(),
      playing: false,
    };
    setPlaying(false);
    setSec(0);
  }

  function applyOnlySelectedMutation(
    mutator: (prev: KeySelectionState) => KeySelectionState,
  ) {
    const nextState = mutator(keySelection);
    if (keySelection.onlySelected) {
      if (playing) {
        if (nextState.onlySelected && nextState.selectedIndices.length > 0) {
          const nextPos = resolveKeyIndexAfterSelectionChange(
            keySelection.selectedIndices,
            nextState.selectedIndices,
            currentKeyIndex,
          );
          pendingSeekKeyRef.current = {
            keyIndex: nextPos,
            resumePlay: true,
          };
        } else {
          const fallbackFullIdx = tonicListIndexToFullIndex(
            keySelection,
            currentKeyIndex,
          );
          if (fallbackFullIdx !== null) {
            pendingSeekKeyRef.current = {
              keyIndex: fallbackFullIdx,
              resumePlay: true,
            };
          }
        }
      } else {
        loopAnchorKeyRef.current = 0;
        setInfLoopCount(1);
        lastPosRef.current = {
          sec: 0,
          time: performance.now(),
          playing: false,
        };
        setSec(0);
      }
    }
    updateKeySelection(() => nextState);
  }

  function handleToggleKey(fullKeyIndex: number) {
    applyOnlySelectedMutation((prev) =>
      toggleKeySelection(prev, fullKeyIndex, fullTonics.length),
    );
  }

  function handleReorderSelected(fromOrderIdx: number, toOrderIdx: number) {
    applyOnlySelectedMutation((prev) =>
      reorderKeySelection(prev, fromOrderIdx, toOrderIdx),
    );
  }

  function handleJumpToFullKey(fullKeyIndex: number) {
    const targetIdx = fullIndexToTonicListIndex(keySelection, fullKeyIndex);
    if (targetIdx === null) {
      return;
    }
    jumpToKey(targetIdx);
  }

  function handleToggleOnlySelected() {
    if (keySelection.selectedIndices.length === 0) return;
    stopAndResetPlayback();
    updateKeySelection((prev) => setOnlySelected(prev, !prev.onlySelected));
  }

  function handleCycleRepeats() {
    const next = nextRepeatsPerKey(settings.repeatsPerKey);
    const prevCount = repeatsPerKeyToCount(settings.repeatsPerKey);
    const nextCount = repeatsPerKeyToCount(next);
    setInfLoopCount(1);
    if (prevCount !== nextCount && (playing || sec > 0)) {
      pendingSeekKeyRef.current = {
        keyIndex: currentKeyIndex,
        resumePlay: playing,
      };
    }
    onUpdateSettings({ repeatsPerKey: next });
  }

  function handleBackClick() {
    engine.stop();
    void stopMic();
    onBack();
  }

  const handlePressedMidisChange = useCallback(
    (midis: readonly number[]) => {
      const nowSec =
        playingRef.current && engine.ctxToSongOffsetSec !== null
          ? getExtrapolatedSec()
          : (engine.audioContext?.currentTime ?? performance.now() / 1000);
      const nextMap = new Map<number, number>();
      const nextKeys: ActiveKey[] = [];
      for (const m of midis) {
        const existingOnset = pressedOnsetsRef.current.get(m);
        const onsetSec = existingOnset ?? nowSec;
        nextMap.set(m, onsetSec);
        nextKeys.push({
          hz: midiToHz(m, settingsRef.current.a4),
          onsetSec,
        });
      }
      pressedOnsetsRef.current = nextMap;
      activeKeysRef.current = nextKeys;
    },
    [engine, getExtrapolatedSec],
  );

  // 直立手機提示：不渲染練唱內容
  if (isPortraitPhone) {
    return (
      <div className="practice-portrait-guard">
        <svg
          className="rotate-phone-icon"
          width="56"
          height="56"
          viewBox="0 0 56 56"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="16"
            y="8"
            width="24"
            height="40"
            rx="4"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <circle cx="28" cy="42" r="1.8" fill="currentColor" />
          <path
            d="M44 20c3 4 4 9 2 14m0 0-4-1.5m4 1.5 1.5-4"
            stroke="#4ca4ff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="rotate-phone-text">請將手機轉成橫放</p>
      </div>
    );
  }

  const win = exercise ? passWindow(exercise, sec) : null;
  currentPhaseRef.current = win?.phase ?? 'sing';
  const currentKeyIndex = win?.keyIndex ?? 0;
  const totalKeys = exercise?.keys.length ?? 0;
  const activeKeyBlock = exercise?.keys[currentKeyIndex];
  const activeKey = activeKeyBlock?.key ?? C_MAJOR_KEY;
  const tonicMidi = activeKeyBlock?.tonicMidi ?? settings.startTonic;
  const clef = clefForRange(rangeLow, rangeHigh);

  // 計算鋼琴高度上下限與樂譜可用行數
  const fallbackWsH = isTablet
    ? Math.max(400, viewport.height - 172)
    : Math.max(240, viewport.height - 82);
  const wsH = workspaceHeight > 0 ? workspaceHeight : fallbackWsH;
  const handleH = handleBarHeight(isTablet);
  const miniH = miniPianoHeight(isTablet);
  const centsH = isTablet ? 37 : 24;
  const sheetPadY = isTablet ? 16 : 4;
  const wsGaps = isTablet ? 20 : 8;
  const minLineH = minScoreLineHeight(isTablet);
  const minScorePaperH = centsH + sheetPadY + minLineH;
  const maxPianoH = Math.max(40, wsH - handleH - wsGaps - minScorePaperH);

  const savedPianoH = clampPianoHeight(
    settings.pianoHeight ?? defaultPianoHeight(isTablet),
    maxPianoH,
  );
  const isPianoCollapsed = dragHeight !== null ? false : settings.pianoCollapsed;
  const effectivePianoH =
    dragHeight !== null ? dragHeight : isPianoCollapsed ? miniH : savedPianoH;

  const scoreAreaH = Math.max(
    minLineH,
    wsH - handleH - wsGaps - effectivePianoH - centsH - sheetPadY,
  );
  const maxLines = scoreAreaH >= minLineH * 2 ? 2 : 1;
  const jianpuH = isTablet ? 52 : 24;
  const lineTotalH = Math.floor(scoreAreaH / maxLines);
  const staffHeight = Math.max(72, lineTotalH - jianpuH);

  const lines = useMemo(() => {
    if (!exercise) return [];
    const baseLines = scoreLines(exercise, sec, maxLines);
    if (
      settings.repeatsPerKey !== 'inf' ||
      maxLines < 2 ||
      baseLines.length === 0
    ) {
      return baseLines;
    }
    const currIdx = baseLines.findIndex((l) => l.isCurrent);
    if (currIdx === -1) return baseLines;
    const curr = baseLines[currIdx]!;
    if (curr.phase !== 'sing') return baseLines;
    const otherIdx = currIdx === 0 ? 1 : 0;
    const other = baseLines[otherIdx];
    if (
      other &&
      other.keyIndex === curr.keyIndex &&
      other.isSamePassContinuation
    ) {
      return baseLines;
    }
    const currNotes = exercise.notes.filter(
      (n) =>
        n.keyIndex === curr.keyIndex &&
        n.pass === curr.pass &&
        n.phase === curr.phase,
    );
    const isLongPattern = currNotes.length > 12;
    const previewLine: ScoreLine = {
      keyIndex: curr.keyIndex,
      pass: curr.pass,
      phase: curr.phase,
      noteRange: isLongPattern
        ? [0, Math.ceil(currNotes.length / 2)]
        : [0, currNotes.length],
      start: curr.start,
      end: curr.end,
      isCurrent: false,
      label: null,
      isSamePassContinuation: false,
    };
    if (baseLines.length === 1) {
      return [curr, previewLine];
    }
    return currIdx === 0 ? [curr, previewLine] : [previewLine, curr];
  }, [exercise, sec, maxLines, settings.repeatsPerKey]);

  const currentLineInfo = lines.find((l) => l.isCurrent);

  const countIn = exercise
    ? countInDotStates(exercise, sec)
    : { active: false, dots: [] };

  let targetMidi: number | null = null;
  const renderedLines = lines.map((line) => {
    const lineKeyBlock = exercise?.keys[line.keyIndex];
    const lineKey = lineKeyBlock?.key ?? activeKey;
    const lineTonicMidi = lineKeyBlock?.tonicMidi ?? tonicMidi;
    const allWinNotes = exercise
      ? exercise.notes.filter(
          (n) =>
            n.keyIndex === line.keyIndex &&
            n.pass === line.pass &&
            n.phase === line.phase,
        )
      : [];
    const lineNotes = allWinNotes.slice(line.noteRange[0], line.noteRange[1]);
    const positions = lineNotes.map((n) => ({
      position: staffPosition(n.midi, lineKey, clef).position,
      ...(n.endMidi !== undefined
        ? { endPosition: staffPosition(n.endMidi, lineKey, clef).position }
        : {}),
    }));
    const metrics = computeStaffMetrics(positions, staffHeight, isTablet);
    const leftPad = staffLeftPad(lineKey, clef, metrics.lineSpacing);
    const glyphs = exercise
      ? noteGlyphs(
          exercise,
          line,
          lineKey,
          clef,
          scoreWidth,
          leftPad,
          RIGHT_PAD,
          metrics.lineSpacing,
          line.noteRange,
        )
      : [];

    const activeNoteIdx = line.isCurrent ? currentNoteIndex(glyphs, sec) : -1;
    if (line.isCurrent && activeNoteIdx >= 0) {
      targetMidi = glyphs[activeNoteIdx]!.midi;
    }

    const showPlayhead =
      line.isCurrent &&
      sec >= line.start - 0.001 &&
      sec <= line.end + 0.001;
    const playheadX = showPlayhead
      ? timeToX(
          Math.max(line.start, Math.min(line.end, sec)),
          line.start,
          line.end,
          leftPad,
          Math.max(leftPad + 1, scoreWidth - RIGHT_PAD),
        )
      : null;
    const activeNoteX =
      line.isCurrent && activeNoteIdx >= 0 ? glyphs[activeNoteIdx]!.x : null;

    const keyText = tonicLabel(lineKey);
    let lineLabel: string | null = null;
    if (line.isCurrent) {
      if (line.phase === 'listen') {
        lineLabel = `${keyText} 示範`;
      } else if (settings.repeatsPerKey === 'inf') {
        lineLabel = `${keyText} 第 ${infLoopCount} 遍`;
      } else {
        lineLabel = `${keyText} 第 ${line.pass + 1}/${settings.repeatsPerKey} 遍`;
      }
    } else if (line.isSamePassContinuation) {
      lineLabel = settings.jianpuMode === 'fixed' ? '固定調' : `1=${keyText}`;
    } else if (currentLineInfo && line.keyIndex === currentLineInfo.keyIndex) {
      if (line.phase === 'listen') {
        lineLabel = `${keyText} 示範`;
      } else if (settings.repeatsPerKey === 'inf') {
        lineLabel = `${keyText} 第 ${infLoopCount + 1} 遍`;
      } else {
        lineLabel = `${keyText} 第 ${line.pass + 1} 遍`;
      }
    } else {
      lineLabel = `下一個 ${keyText}`;
    }

    return {
      line,
      lineKey,
      lineTonicMidi,
      metrics,
      leftPad,
      glyphs,
      activeNoteIdx,
      playheadX,
      activeNoteX,
      lineLabel,
    };
  });

  targetMidiRef.current = targetMidi;

  const sungByLine = useMemo(() => {
    const raw = rawSungRef.current;
    if (raw.length === 0 || lines.length === 0) {
      return lines.map(() => EMPTY_SUNG);
    }
    return lines.map((line) => {
      const padStart = line.start - 0.5;
      const padEnd = line.end + 0.5;
      const times: number[] = [];
      const pitches: number[] = [];
      const voiced: boolean[] = [];
      for (const pt of raw) {
        if (pt.t < padStart) continue;
        if (pt.t > padEnd) break;
        times.push(pt.t);
        pitches.push(pt.hz > 0 ? hzToMidi(pt.hz, settings.a4) : NaN);
        voiced.push(pt.voiced);
      }
      if (times.length === 0) return EMPTY_SUNG;
      const curved = singingCurve(times, pitches, voiced);
      const pts: SungPoint[] = [];
      for (let i = 0; i < curved.x.length; i++) {
        pts.push({ t: curved.x[i]!, midi: curved.y[i]! });
      }
      return pts;
    });
  }, [lines, sungVersion, settings.a4]);

  function handleDrawerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略部分環境不支援 setPointerCapture 的情況
    }
    handleDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startX: e.clientX,
      savedHeight: savedPianoH,
      collapsed: settings.pianoCollapsed,
      maxDist: 0,
    };
  }

  function handleDrawerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dy = e.clientY - drag.startY;
    const dx = e.clientX - drag.startX;
    drag.maxDist = Math.max(drag.maxDist, Math.hypot(dx, dy));

    if (drag.maxDist >= 6) {
      const preview = previewDrawerDrag({
        savedHeight: drag.savedHeight,
        collapsed: drag.collapsed,
        deltaY: dy,
        miniHeight: miniH,
        maxHeight: maxPianoH,
      });
      setDragHeight(preview.height);
    }
  }

  function handleDrawerPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    handleDragRef.current = null;
    setDragHeight(null);

    const dy = e.clientY - drag.startY;
    const result = resolveDrawerPointerEnd({
      savedHeight: drag.savedHeight,
      collapsed: drag.collapsed,
      deltaY: dy,
      distance: drag.maxDist,
      miniHeight: miniH,
      defaultHeight: defaultPianoHeight(isTablet),
      maxHeight: maxPianoH,
    });
    onUpdateSettings({
      pianoCollapsed: result.collapsed,
      pianoHeight: result.height,
    });
  }

  const selectedCount = keySelection.selectedIndices.length;
  const activeFullKeyIndex =
    tonicListIndexToFullIndex(keySelection, currentKeyIndex) ?? -1;
  const currentPassNum =
    settings.repeatsPerKey === 'inf'
      ? infLoopCount
      : win && win.phase === 'sing'
        ? win.pass + 1
        : 1;

  return (
    <div className={`practice-page ${isTablet ? 'is-tablet' : 'is-phone'}`}>
      {/* 1. 標題列 */}
      <header className="practice-header">
        <button
          type="button"
          className="practice-back-btn"
          aria-label="返回"
          onClick={handleBackClick}
        >
          ‹
        </button>

        <button
          type="button"
          className={`practice-only-selected-btn ${keySelection.onlySelected ? 'is-on' : ''}`}
          disabled={selectedCount === 0}
          aria-pressed={keySelection.onlySelected}
          onClick={handleToggleOnlySelected}
        >
          只練選的 {selectedCount}
        </button>

        <KeyStrip
          keys={fullKeys}
          activeFullKeyIndex={activeFullKeyIndex}
          activeExerciseKeyIndex={currentKeyIndex}
          onlySelected={keySelection.onlySelected}
          selectedIndices={keySelection.selectedIndices}
          isTablet={isTablet}
          onToggleKey={handleToggleKey}
          onJumpToKey={handleJumpToFullKey}
          onReorderSelected={handleReorderSelected}
        />

        <div className="practice-header-right">
          <button
            type="button"
            className="practice-pill-btn"
            onClick={() =>
              onUpdateSettings({
                jianpuMode:
                  settings.jianpuMode === 'fixed' ? 'movable' : 'fixed',
              })
            }
          >
            簡譜 {settings.jianpuMode === 'fixed' ? '固定調' : '首調'} ▾
          </button>
          <button
            type="button"
            className={`practice-pill-btn practice-mic-btn ${micActive ? 'is-on' : ''}`}
            aria-label={micActive ? '關閉麥克風' : '開啟麥克風'}
            aria-pressed={micActive}
            onClick={handleToggleMic}
          >
            <svg
              className="practice-mic-icon"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="22" />
            </svg>
            <span>麥克風</span>
            <span className="mic-toggle-dot" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="practice-gear-btn"
            aria-label="設定"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
        </div>
      </header>

      {/* 2. 主工作區：譜面紙張 + 把手列 + 對音鋼琴 */}
      <div className="practice-workspace" ref={workspaceRef}>
        <section className="sheet-paper" aria-label="譜面">
          {(errorMsg || buildError) && (
            <div className="sheet-error" role="alert">
              {errorMsg ?? buildError}
            </div>
          )}

          {confusionBubbleOpen && (
            <div className="confusion-bubble" role="status">
              <span className="confusion-bubble-text">
                喇叭聲太大，判斷不準。建議戴耳機，或調低唱時鋼琴音量
              </span>
              <div className="confusion-bubble-actions">
                <button
                  type="button"
                  className="confusion-btn confusion-btn-primary"
                  onClick={() => {
                    onUpdateSettings({
                      singPianoVolume: Math.max(
                        0,
                        settings.singPianoVolume - 20,
                      ),
                    });
                    setConfusionBubbleOpen(false);
                  }}
                >
                  降低鋼琴音量
                </button>
                <button
                  type="button"
                  className="confusion-btn"
                  onClick={() => {
                    onUpdateSettings({ hideSpeakerHint: true });
                    setConfusionBubbleOpen(false);
                  }}
                >
                  不再提醒
                </button>
              </div>
            </div>
          )}

          <CentsBar cents={currentCents} isTablet={isTablet} />

          <div className="sheet-score-area" ref={scoreAreaRef}>
            {renderedLines.map((item, lineIdx) => (
              <div
                key={`score-line-${lineIdx}`}
                className={`score-line ${
                  item.line.isCurrent ? 'is-current' : 'is-preview'
                }`}
              >
                {/* 目前音淡藍色直條（僅出現在正在唱的那一行） */}
                {item.activeNoteX !== null && (
                  <div
                    className="score-active-band"
                    style={{ left: `${item.activeNoteX}px` }}
                    aria-hidden="true"
                  />
                )}

                {/* 播放位置藍色虛線（僅出現在正在唱的那一行） */}
                {item.playheadX !== null && (
                  <div
                    className="score-playhead"
                    style={{ left: `${item.playheadX}px` }}
                    aria-hidden="true"
                  />
                )}

                <JianpuStrip
                  glyphs={item.glyphs}
                  activeIndex={item.activeNoteIdx}
                  sec={item.line.isCurrent ? sec : -1}
                  activeKey={item.lineKey}
                  tonicMidi={item.lineTonicMidi}
                  jianpuMode={settings.jianpuMode}
                  isTablet={isTablet}
                  previewLabel={item.line.isCurrent ? null : item.lineLabel}
                  lineLabel={item.lineLabel}
                />

                <StaffView
                  width={scoreWidth}
                  height={staffHeight}
                  clef={clef}
                  activeKey={item.lineKey}
                  window={item.line}
                  glyphs={item.glyphs}
                  activeIndex={item.activeNoteIdx}
                  chords={exercise?.chords ?? []}
                  leftPad={item.leftPad}
                  rightPad={RIGHT_PAD}
                  metrics={item.metrics}
                  sung={sungByLine[lineIdx] ?? EMPTY_SUNG}
                  countIn={
                    item.line.isCurrent
                      ? countIn
                      : { active: false, dots: [] }
                  }
                  isTablet={isTablet}
                />
              </div>
            ))}
          </div>
        </section>

        {/* 把手列：拖動調整高度、點一下收合／展開 */}
        <div
          className={`piano-handle ${isPianoCollapsed ? 'is-collapsed' : ''}`}
          style={{ height: `${handleH}px` }}
          onPointerDown={handleDrawerPointerDown}
          onPointerMove={handleDrawerPointerMove}
          onPointerUp={handleDrawerPointerEnd}
          onPointerCancel={handleDrawerPointerEnd}
          onLostPointerCapture={handleDrawerPointerEnd}
          role="separator"
          aria-orientation="horizontal"
          aria-label="調整對音鋼琴高度"
        >
          <span className="piano-handle-grip" aria-hidden="true">
            <span />
            <span />
          </span>
          <span className="piano-handle-text">
            {isPianoCollapsed
              ? '對音鋼琴 ▸ 已收合（點一下展開，或往上拖）'
              : isTablet
                ? '對音鋼琴 ▾ 拖動調整高度 · 點一下收合'
                : '對音鋼琴 ▾'}
          </span>
        </div>

        {/* 3. 對音鋼琴 */}
        <PianoKeyboard
          centerMidi={tonicMidi}
          targetMidi={targetMidi}
          sungMidi={sungMidi}
          height={effectivePianoH}
          collapsed={isPianoCollapsed}
          isTablet={isTablet}
          engine={engine}
          onAudioError={setErrorMsg}
          onPressedMidisChange={handlePressedMidisChange}
        />
      </div>

      {/* 4. 播放列 */}
      <TransportBar
        playing={playing}
        canPrevKey={currentKeyIndex > 0}
        canNextKey={currentKeyIndex < totalKeys - 1}
        hasExercise={exercise !== null}
        patternName={pattern.name}
        repeatsPerKey={settings.repeatsPerKey}
        currentPass={currentPassNum}
        bpm={settings.bpm}
        metronome={settings.metronome}
        firstBeat={exercise?.clicks[0]?.t ?? 0}
        transposeOffset={transposeOffset}
        canTransposeDown={canTransposeDown}
        canTransposeUp={canTransposeUp}
        boundaryToast={boundaryToast}
        pianoDuringSing={settings.pianoDuringSing}
        isTablet={isTablet}
        getSec={getExtrapolatedSec}
        onPrevKey={handlePrevKey}
        onPlayPause={handlePlayPause}
        onNextKey={handleNextKey}
        onCycleRepeats={handleCycleRepeats}
        onToggleMetronome={() =>
          onUpdateSettings({ metronome: !settings.metronome })
        }
        onBpmStep={handleBpmStep}
        onBpmReset={handleBpmReset}
        onTransposeStep={handleTransposeStep}
        onTogglePiano={() =>
          onUpdateSettings({ pianoDuringSing: !settings.pianoDuringSing })
        }
      />

      {/* 5. ⚙ 設定面板（iPhone 全螢幕 / iPad 右側面板） */}
      <PracticeSettingsSheet
        open={settingsOpen}
        isTablet={isTablet}
        settings={settings}
        micActive={micActive}
        liveDb={liveDb}
        onUpdateSettings={onUpdateSettings}
        onEnsureMicForCalibration={startMic}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
