import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeShadowNotes,
  summarizeShadowPass,
  type PitchFrame,
  type ShadowNoteResult,
} from '../../core/analysis';
import { singingCurve } from '../../core/curve';
import {
  buildExercise,
  infLoopSeekTarget,
  type Exercise,
  type KeyBlock,
} from '../../core/exercise';
import { keyName, type Key } from '../../core/key';
import {
  alignLyricsToStaffLine,
  buildMidiLyricsDocument,
  convertLyricsToPassTime,
} from '../../core/lyrics';
import { buildMidiExercise } from '../../core/midiExercise';
import {
  applyScoreBarLongPressLoop,
  findBarAtPassSec,
  findPassWindowForLoopCheck,
  normalizeMidiLoopBars,
  resolveMidiLoopRangeSec,
  shouldLoopBack,
  snapAbsSecToNearestBeat,
  toggleMidiLoopPoint,
  type MidiLoopBars,
  type MidiLoopRangeSec,
} from '../../core/midiSeek';
import {
  buildMidiMixLayers,
  resolveTrackRoles,
  shouldShowAccompSpeakerHint,
} from '../../core/midiMix';
import { hzToMidi, midiToHz } from '../../core/notes';
import { BUILTIN_PATTERNS } from '../../core/patterns';
import {
  advanceSessionPlayback,
  completeSessionAtEnd,
  pauseSession,
  startOrResumeSession,
  syncSessionPlayhead,
  toLogEntry,
  type PracticeLogEntry,
  type PracticeLogSource,
  type PracticeSessionContext,
  type PracticeSessionState,
} from '../../core/practiceLog';
import { staffPosition } from '../../core/staff';
import {
  createPracticeLogStore,
  type PracticeLogStore,
} from '../../state/practiceLogStore';
import {
  resolveMidiLyricsOffset,
  resolveMidiMixer,
  stripMidiExtension,
  type MidiMixerSettings,
  type MidiSongSettings,
} from '../../state/midiLibrary';
import { micCtxSecToSongSec } from '../../mic/latency';
import {
  MicController,
  MicPermissionError,
  type MicDiagnostics,
  type MicPitchFrame,
} from '../../mic/micController';
import { outputAt, type ActiveKey } from '../../mic/outputAt';
import { ConfusionDetector, VoiceGate } from '../../mic/voiceGate';
import { isStandaloneMode } from '../../state/errlog';
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
  clampBpm,
  findLowestFeasibleTonic,
  getPatternSpan,
  getRangeBounds,
  nextRepeatsPerKey,
  repeatsPerKeyToCount,
  resolveVoiceDisplay,
  stepBpm,
  toExerciseOptions,
  type PracticeModeOption,
  type PracticeSettings,
} from '../../state/settings';
import { useAudioEngine } from '../AudioContext';
import type { MidiPracticeSource } from '../midi/MidiPage';
import { JianpuStrip } from './JianpuStrip';
import { KeyStrip } from './KeyStrip';
import { ModeToggleButton } from './ModeToggleButton';
import {
  computeStaffMetrics,
  countInDotStates,
  currentNoteIndex,
  listPassWindows,
  noteGlyphs,
  notesForWindow,
  passWindow,
  rescaleTime,
  scoreLines,
  scoreLinesPortrait,
  staffLeftPad,
  timeToX,
  tonicLabel,
  type NoteGlyph,
  type PassWindow,
  type ScoreLine,
} from './layout';
import {
  buildMidiLineGlyphs,
  buildMidiMeasurePages,
  computeIntroCountdownBars,
  computeMidiScrubSecPerPx,
  computeScrubTargetSec,
  findMidiSegmentAtX,
  midiLineTimeToX,
  midiMeasurePageIndexAtTime,
  midiMeasureScoreLines,
  type MidiLineRenderData,
  type MidiMeasureScoreLine,
} from './midiLayout';
import {
  PORTRAIT_DEFAULT_PIANO_HEIGHT,
  clampPianoHeight,
  defaultPianoHeight,
  miniPianoHeight,
  previewDrawerDrag,
  resolveDrawerPointerEnd,
} from './pianoDrawer';
import {
  isIosBrowserMode,
  markIosInstallHintDismissed,
  readIosInstallHintDismissed,
} from './iosInstallHint';
import {
  computePortraitLayout,
  computeViewportLayout,
  type PianoCollapsedPref,
} from './viewportLayout';
import { usePracticeViewport } from './usePracticeViewport';
import {
  resolvePracticeViewport,
  toLocalPoint,
  toLocalRect,
} from './viewportRotation';
import { PianoKeyboard } from '../piano/PianoKeyboard';
import {
  PracticeSettingsSheet,
  type PracticeDiagnosticsSnapshot,
} from './PracticeSettingsSheet';
import { StaffView, type SungPoint } from './StaffView';
import {
  FREE_WINDOW_SEC,
  freeSpan,
  freeSungPoints,
  pruneFreeSamples,
  type FreeSample,
} from './freeSung';
import {
  useNoiseCalibration,
  type NoiseGateResult,
} from './useNoiseCalibration';
import {
  canScreenshot,
  downloadScreenshotBlob,
  exportPracticeScreenshot,
} from './screenshot';
import { MidiMixerPopover } from './MidiMixerPopover';
import { LyricsStrip } from './LyricsStrip';
import { MidiSeekBar } from './MidiSeekBar';
import { TransportBar } from './TransportBar';

interface PracticePageProps {
  settings: PracticeSettings;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onInputActiveChange?: (active: boolean) => void;
  midiSource?: MidiPracticeSource | null;
  onUpdateMidiSongSettings?: (hash: string, next: MidiSongSettings) => void;
  practiceLogStore?: PracticeLogStore;
  onBack: () => void;
}

const C_MAJOR_KEY: Key = { tonicPc: 0, mode: 'major' };
const RIGHT_PAD = 18;
const EMPTY_SUNG: SungPoint[] = [];

interface RawSungSample {
  t: number;
  rawHz: number;
  voiced: boolean;
}

/** 正式練唱畫面：上方簡譜帶與五線譜，下方對音鋼琴與播放列 */
export function PracticePage({
  settings,
  onUpdateSettings,
  onInputActiveChange,
  midiSource = null,
  onUpdateMidiSongSettings,
  practiceLogStore,
  onBack,
}: PracticePageProps) {
  const isMidiMode = Boolean(midiSource);
  const engine = useAudioEngine();
  const logStore = useMemo(
    () => practiceLogStore ?? createPracticeLogStore(),
    [practiceLogStore],
  );
  const logSessionRef = useRef<PracticeSessionState | null>(null);
  const [bpmEditing, setBpmEditing] = useState(false);
  const viewport = usePracticeViewport(bpmEditing);
  const [sec, setSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [boundaryToast, setBoundaryToast] = useState(false);
  const [scoreWidth, setScoreWidth] = useState(720);
  const [safePadding, setSafePadding] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [forceExpandPiano, setForceExpandPiano] = useState(false);
  const [iosHintVisible, setIosHintVisible] = useState(
    () => isIosBrowserMode() && !readIosInstallHintDismissed(),
  );
  const [iosHintFading, setIosHintFading] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [liveDb, setLiveDb] = useState<number | null>(null);
  const [sungMidi, setSungMidi] = useState<number | null>(null);
  const [sungVersion, setSungVersion] = useState(0);
  const [autoCalibBanner, setAutoCalibBanner] = useState<{
    text: string;
    tone: 'info' | 'ok' | 'error';
  } | null>(null);
  const autoCalibTimerRef = useRef<number | null>(null);
  const [confusionBubbleOpen, setConfusionBubbleOpen] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [midiMetronomeOverride, setMidiMetronomeOverride] = useState<
    boolean | null
  >(null);
  const [scrubPreviewSec, setScrubPreviewSec] = useState<number | null>(null);
  const scrubPreviewSecRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const [flashBarNumber, setFlashBarNumber] = useState<number | null>(null);
  const flashBarTimerRef = useRef<number | null>(null);
  const scoreLongPressTimerRef = useRef<number | null>(null);
  const scoreGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    maxDist: number;
    mode: 'pending' | 'drag' | 'vertical' | 'long-press';
    startSec: number;
    secPerPx: number;
    wasPlaying: boolean;
    targetBarNumber: number | null;
    targetBarAbsStartSec: number | null;
  } | null>(null);
  const lastLoopCheckSecRef = useRef(0);
  const abLoopCooldownRef = useRef(0);
  const midiLoopRangeRef = useRef<MidiLoopRangeSec | null>(null);
  const passWindowsRef = useRef<PassWindow[]>([]);
  const handleMidiSeekRef = useRef<
    (
      targetAbsSec: number,
      seekOptions?: { expectedPlaying?: boolean; tolerance?: number },
    ) => void
  >(() => {});
  const [accompSpeakerHintOpen, setAccompSpeakerHintOpen] = useState(false);
  const accompSpeakerHintShownRef = useRef(false);
  const [shadowMicHintOpen, setShadowMicHintOpen] = useState(false);
  const [shadowPassBanner, setShadowPassBanner] = useState<string | null>(null);
  const shadowBannerTimerRef = useRef<number | null>(null);
  const lastEvaluatedShadowPassRef = useRef<string | null>(null);
  const [infLoopCount, setInfLoopCount] = useState(1);
  const [screenshotToast, setScreenshotToast] = useState<{
    message: string;
    isError: boolean;
    pendingShare?: { file: File; title: string };
  } | null>(null);
  const screenshotToastTimerRef = useRef<number | null>(null);

  const micController = useMemo(() => new MicController(engine), [engine]);
  const voiceGateRef = useRef(new VoiceGate());
  const confusionRef = useRef(new ConfusionDetector());
  const rawSungRef = useRef<RawSungSample[]>([]);
  // 沒播放時的即時演唱音高線（牆上時間）；開麥克風就顯示，不必等播放
  const freeSungRef = useRef<FreeSample[]>([]);
  const freeLineSpanRef = useRef(FREE_WINDOW_SEC);
  const freeTickRef = useRef(0);
  const [freeVersion, setFreeVersion] = useState(0);
  const recentDetectedRef = useRef<
    { wallMs: number; hz: number; midi: number }[]
  >([]);
  const unmountedRef = useRef(false);
  const activeKeysRef = useRef<ActiveKey[]>([]);
  const pressedOnsetsRef = useRef<Map<number, number>>(new Map());
  const targetMidiRef = useRef<number | null>(null);
  const currentPhaseRef = useRef<'listen' | 'sing'>('sing');
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const micActiveRef = useRef(micActive);
  micActiveRef.current = micActive;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const repeatsPerKeyRef = useRef(settings.repeatsPerKey);
  repeatsPerKeyRef.current = settings.repeatsPerKey;
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  // 自動噪音校正進行中（第一次開麥克風）：此時也要回報音量給校正
  const autoCalibActiveRef = useRef(false);
  const prevEchoRef = useRef(settings.echoCancellation);
  const exerciseRef = useRef<Exercise | null>(null);
  const loopAnchorKeyRef = useRef(0);
  const infLoopRef = useRef<{ lastSeekAt: number }>({ lastSeekAt: 0 });

  const pageRef = useRef<HTMLDivElement | null>(null);
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
  const pendingSeekGuardRef = useRef<{
    targetSec: number;
    expiresAt: number;
    expectedPlaying?: boolean;
    tolerance?: number;
  } | null>(null);
  const suppressLoadPosRef = useRef(false);
  const lastPosRef = useRef<{ sec: number; time: number; playing: boolean }>({
    sec: 0,
    time: 0,
    playing: false,
  });

  // 視窗尺寸由 usePracticeViewport 追蹤（輸入期間暫停重算以避免 iOS 鍵盤彈出造成版面跳動）

  const {
    isPortrait,
    isTablet,
    device,
    layoutWidth,
    layoutHeight,
    rotationCtx,
  } = useMemo(() => resolvePracticeViewport(viewport), [viewport]);

  const pattern = useMemo(
    () =>
      BUILTIN_PATTERNS.find((p) => p.id === settings.patternId) ??
      BUILTIN_PATTERNS[0]!,
    [settings.patternId],
  );
  const songTitle = midiSource
    ? stripMidiExtension(midiSource.name)
    : pattern.name;

  const voiceDisplay = useMemo(
    () => resolveVoiceDisplay(settings),
    [settings.voice, settings.maleClef, settings.rangeName, settings.myRange],
  );
  const clef = voiceDisplay.clef;
  const pitchShift = voiceDisplay.pitchShift;
  const octaveTag = voiceDisplay.octaveTag;

  // 混音器只改音量匯流排、A–B 循環只決定跳轉區間；忽略 mixer 與 loop 欄位，避免調整時重建練習、音訊重新 load 而停止播放
  const stableMidiSourceRef = useRef<MidiPracticeSource | null>(null);
  const buildMidiSource = useMemo(() => {
    const prev = stableMidiSourceRef.current;
    if (
      prev &&
      midiSource &&
      isSameMidiSourceIgnoringMixerAndLoop(prev, midiSource)
    ) {
      return prev;
    }
    stableMidiSourceRef.current = midiSource ?? null;
    return midiSource ?? null;
  }, [midiSource]);

  const midiBuild = useMemo(() => {
    if (!buildMidiSource) return null;
    try {
      const res = buildMidiExercise(buildMidiSource.asset, {
        trackIndex: buildMidiSource.songSettings.trackIndex,
        startBar: buildMidiSource.songSettings.startBar,
        endBar: buildMidiSource.songSettings.endBar,
        transposeSemitones: buildMidiSource.songSettings.transposeSemitones,
        speedPercent: buildMidiSource.songSettings.speedPercent,
        ...(buildMidiSource.songSettings.manualKey
          ? { originalKey: buildMidiSource.songSettings.manualKey }
          : {}),
        mode:
          settings.mode === 'listen-then-sing' ? 'listen-then-sing' : 'follow',
        repeats: repeatsPerKeyToCount(settings.repeatsPerKey),
        countIn: settings.countIn,
        displayTranspose: pitchShift,
      });
      return { res, error: null as string | null };
    } catch (err) {
      return {
        res: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [
    buildMidiSource,
    settings.mode,
    settings.repeatsPerKey,
    settings.countIn,
    pitchShift,
  ]);

  const rawSongLyrics = useMemo(() => {
    if (!buildMidiSource) return null;
    if (buildMidiSource.importedLyrics?.document) {
      return buildMidiSource.importedLyrics.document;
    }
    const embedded = buildMidiLyricsDocument(
      buildMidiSource.asset,
      buildMidiSource.songSettings.trackIndex,
    );
    return embedded.lines.length > 0 ? embedded : null;
  }, [buildMidiSource]);

  const passLyrics = useMemo(() => {
    if (!rawSongLyrics || !buildMidiSource || !midiBuild?.res) {
      return null;
    }
    const regionStartOrigSec = midiBuild.res.regionStartOrigSec ?? 0;
    const regionEndOrigSec =
      midiBuild.res.regionEndOrigSec ?? buildMidiSource.asset.duration;
    return convertLyricsToPassTime(rawSongLyrics, {
      offsetSec: resolveMidiLyricsOffset(buildMidiSource.songSettings),
      regionStartOrigSec,
      regionEndOrigSec,
      speedPercent: buildMidiSource.songSettings.speedPercent,
    });
  }, [rawSongLyrics, buildMidiSource, midiBuild]);

  const hasLyrics = isMidiMode && Boolean(passLyrics && passLyrics.lines.length > 0);
  const showLyrics = hasLyrics && settings.lyricsVisible;
  const lyricsTwoLines = isTablet || isPortrait || layoutHeight >= 460;
  const lyricsScaleFactor = Math.max(0.7, Math.min(1.6, settings.lyricsScale / 100));
  const lyricsFontPx = (isTablet ? 17 : 13) * lyricsScaleFactor;
  const lyricsBandHeight = showLyrics
    ? lyricsTwoLines
      ? Math.round(lyricsFontPx * 2.75 + 8)
      : Math.round(lyricsFontPx * 1.45 + 6)
    : 0;
  const seekBarHeight =
    isMidiMode && midiBuild?.res && midiBuild.res.scoreBars.length > 0
      ? isTablet
        ? 40
        : 34
      : 0;
  const staffLyricBottomPad = showLyrics
    ? Math.round((isTablet ? 12 : 10) * lyricsScaleFactor + (isTablet ? 18 : 13))
    : 0;

  const autoLayout = isPortrait
    ? computePortraitLayout(
        layoutWidth,
        layoutHeight,
        safePadding ? { x: safePadding.x, y: safePadding.y } : undefined,
        {
          collapsedPref: 'auto',
          preferredPianoHeight: settings.pianoHeight,
          extraChromeHeight: seekBarHeight,
          lyricsBandHeight,
        },
      )
    : computeViewportLayout({
        height: layoutHeight,
        width: layoutWidth,
        device,
        collapsedPref: 'auto',
        preferredPianoHeight: settings.pianoHeight,
        safePaddingY: safePadding?.y,
        safePaddingX: safePadding?.x,
        extraChromeHeight: seekBarHeight,
        lyricsBandHeight,
      });

  useEffect(() => {
    if (forceExpandPiano && !autoLayout.autoCollapsed) {
      setForceExpandPiano(false);
    }
  }, [forceExpandPiano, autoLayout.autoCollapsed]);

  // iOS 瀏覽器分頁模式下第一次進練唱頁顯示加入主畫面提示，3 秒後自動淡出
  useEffect(() => {
    if (!iosHintVisible) return;
    const fadeTimer = window.setTimeout(() => {
      setIosHintFading(true);
      markIosInstallHintDismissed();
    }, 3000);
    const hideTimer = window.setTimeout(() => {
      setIosHintVisible(false);
    }, 3400);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [iosHintVisible]);

  // 量測譜面紙張寬度與安全區內距
  useEffect(() => {
    const pageEl = pageRef.current;
    const scoreEl = scoreAreaRef.current;

    const updateSizes = () => {
      if (pageEl) {
        const cs = getComputedStyle(pageEl);
        const padY =
          (parseFloat(cs.paddingTop) || 0) +
          (parseFloat(cs.paddingBottom) || 0);
        const padX =
          (parseFloat(cs.paddingLeft) || 0) +
          (parseFloat(cs.paddingRight) || 0);
        const nextX = Math.round(padX);
        const nextY = Math.round(padY);
        setSafePadding((prev) =>
          prev && prev.x === nextX && prev.y === nextY
            ? prev
            : { x: nextX, y: nextY },
        );
      }
      if (scoreEl && scoreEl.clientWidth > 0) {
        setScoreWidth(scoreEl.clientWidth);
      }
    };
    updateSizes();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateSizes);
    if (pageEl) ro.observe(pageEl);
    if (scoreEl) ro.observe(scoreEl);
    return () => ro.disconnect();
  }, [isPortrait, layoutWidth, layoutHeight]);

  const midiMixer = useMemo(
    () => resolveMidiMixer(midiSource?.songSettings),
    [midiSource?.songSettings],
  );

  const midiMixLayers = useMemo(() => {
    if (!buildMidiSource) return null;
    const trackRoles = resolveTrackRoles(
      buildMidiSource.asset,
      buildMidiSource.songSettings,
    );
    return buildMidiMixLayers(buildMidiSource.asset, {
      trackRoles,
      startBar: buildMidiSource.songSettings.startBar,
      endBar: buildMidiSource.songSettings.endBar,
      transposeSemitones: buildMidiSource.songSettings.transposeSemitones,
      speedPercent: buildMidiSource.songSettings.speedPercent,
      mode:
        settings.mode === 'listen-then-sing' ? 'listen-then-sing' : 'follow',
      repeats: repeatsPerKeyToCount(settings.repeatsPerKey),
      countIn: settings.countIn,
    });
  }, [buildMidiSource, settings.mode, settings.repeatsPerKey, settings.countIn]);

  const rhythmActive =
    isMidiMode &&
    Boolean(midiMixLayers?.hasRhythmTracks) &&
    midiMixer.rhythmEnabled;

  const effectiveMetronome = isMidiMode
    ? (midiMetronomeOverride ?? (rhythmActive ? false : settings.metronome))
    : settings.metronome;

  const hasAccompOrRhythmEnabled =
    isMidiMode &&
    Boolean(
      (midiMixLayers?.hasAccompTracks &&
        midiMixer.accompEnabled &&
        midiMixer.accompVolume > 0) ||
        (midiMixLayers?.hasRhythmTracks &&
          midiMixer.rhythmEnabled &&
          midiMixer.rhythmVolume > 0),
    );

  const effectiveBpm = midiBuild?.res
    ? midiBuild.res.effectiveBpm
    : settings.bpm;
  const isShadowMode = !isMidiMode && settings.mode === 'shadow';

  const logSource = useMemo<PracticeLogSource>(
    () =>
      buildMidiSource
        ? {
            kind: 'midi',
            midiId: buildMidiSource.id,
            midiName: stripMidiExtension(buildMidiSource.name),
            midiHash: buildMidiSource.hash,
            startBar: buildMidiSource.songSettings.startBar,
            endBar: buildMidiSource.songSettings.endBar,
          }
        : {
            kind: 'scale',
            patternId: pattern.id,
            patternName: pattern.name,
          },
    [buildMidiSource, pattern.id, pattern.name],
  );

  const logContextRef = useRef<PracticeSessionContext>({
    source: logSource,
    mode: settings.mode,
    bpm: effectiveBpm,
    rangeName: settings.rangeName,
    voice: settings.voice,
    micActive,
  });
  logContextRef.current = {
    source: logSource,
    mode: settings.mode,
    bpm: effectiveBpm,
    rangeName: settings.rangeName,
    voice: settings.voice,
    micActive,
  };

  const persistLogEntry = useCallback(
    (entry: PracticeLogEntry | null) => {
      if (!entry) return;
      void logStore.put(entry).catch(() => {
        // 忽略紀錄寫入錯誤以免中斷練唱
      });
    },
    [logStore],
  );

  const flushLogSession = useCallback(
    (clearAfter: boolean) => {
      const curr = logSessionRef.current;
      if (!curr) return;
      const paused = pauseSession(curr, Date.now());
      persistLogEntry(toLogEntry(paused));
      logSessionRef.current = clearAfter ? null : paused;
    },
    [persistLogEntry],
  );

  useEffect(() => {
    if (micActive && logSessionRef.current && !logSessionRef.current.usedMic) {
      logSessionRef.current = { ...logSessionRef.current, usedMic: true };
    }
  }, [micActive]);

  useEffect(() => {
    const onPageHide = () => flushLogSession(false);
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [flushLogSession]);

  // 計算完整調性序列，用於調名清單選取與記憶
  const fullKeys = useMemo<KeyBlock[]>(() => {
    if (isMidiMode) {
      return midiBuild?.res?.exercise.keys ?? [];
    }
    try {
      const baseEx = buildExercise(pattern, {
        ...toExerciseOptions(settings),
        repeats: 1,
        cadence: false,
        countInBeats: 0,
        displayTranspose: pitchShift,
      });
      return baseEx.keys;
    } catch {
      return [];
    }
  }, [
    isMidiMode,
    midiBuild,
    pattern,
    settings.startTonic,
    settings.rangeName,
    settings.myRange,
    settings.bpm,
    settings.noteBeats,
    settings.articulation,
    settings.transpose,
    settings.mode,
    pitchShift,
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
    if (isMidiMode) {
      return {
        exercise: midiBuild?.res?.exercise ?? null,
        buildError: midiBuild?.error ?? null,
      };
    }
    try {
      const ex = buildExercise(pattern, {
        ...toExerciseOptions(settings),
        displayTranspose: pitchShift,
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
  }, [isMidiMode, midiBuild, pattern, settings, pitchShift, selectedTonicList]);
  exerciseRef.current = exercise;

  const tryTriggerAbLoop = useCallback((curSec: number): boolean => {
    const loopRange = midiLoopRangeRef.current;
    if (!loopRange || !playingRef.current) {
      lastLoopCheckSecRef.current = curSec;
      return false;
    }
    const now = performance.now();
    if (now - abLoopCooldownRef.current < 120) {
      return false;
    }
    const prevSec = lastLoopCheckSecRef.current;
    const win = findPassWindowForLoopCheck(
      passWindowsRef.current,
      prevSec,
      curSec,
    );
    if (!win) {
      lastLoopCheckSecRef.current = curSec;
      return false;
    }
    const decision = shouldLoopBack({
      sec: curSec,
      prevSec,
      loopRange,
      passStartSec: win.start,
      leadSec: 0.03,
    });
    if (decision.shouldLoop) {
      abLoopCooldownRef.current = now;
      handleMidiSeekRef.current(decision.targetAbsSec);
      return true;
    }
    lastLoopCheckSecRef.current = curSec;
    return false;
  }, []);

  // 訂閱播放位置與結束事件
  useEffect(() => {
    const triggerInfLoop = (
      anchorKb: KeyBlock,
      now: number,
      resumePlay: boolean,
    ) => {
      const loopTarget = infLoopSeekTarget(anchorKb);
      infLoopRef.current.lastSeekAt = now;
      rawSungRef.current = rawSungRef.current.filter(
        (p) => p.t < anchorKb.start,
      );
      lastEvaluatedShadowPassRef.current = null;
      voiceGateRef.current.reset();
      setSungVersion((v) => v + 1);
      setInfLoopCount((c) => c + 1);
      lastLoopCheckSecRef.current = loopTarget;
      lastPosRef.current = {
        sec: loopTarget,
        time: now,
        playing: true,
      };
      setSec(loopTarget);
      engine.seek(loopTarget);
      if (resumePlay) {
        engine.play();
      }
    };

    const unsubPos = engine.onPosition((s, isPlaying) => {
      if (suppressLoadPosRef.current && s === 0 && !isPlaying) {
        suppressLoadPosRef.current = false;
        return;
      }
      suppressLoadPosRef.current = false;

      // 譜面拖曳期間暫停接收位置回報，避免覆蓋預覽游標或誤觸暫停狀態
      if (isScrubbingRef.current) {
        return;
      }

      const guard = pendingSeekGuardRef.current;
      if (guard) {
        const playingMatches =
          guard.expectedPlaying === undefined ||
          isPlaying === guard.expectedPlaying;
        const tol = guard.tolerance ?? 0.5;
        if (
          performance.now() > guard.expiresAt ||
          (playingMatches && Math.abs(s - guard.targetSec) <= tol)
        ) {
          pendingSeekGuardRef.current = null;
          lastLoopCheckSecRef.current = s;
        } else {
          return;
        }
      }

      const nowMs = Date.now();
      const ex = exerciseRef.current;
      if (isPlaying) {
        const curr = logSessionRef.current;
        if (!curr || !curr.isPlaying) {
          const { state, finalizedPrev } = startOrResumeSession(
            curr,
            logContextRef.current,
            nowMs,
          );
          persistLogEntry(finalizedPrev);
          logSessionRef.current = state;
        }
      }
      if (logSessionRef.current) {
        logSessionRef.current = advanceSessionPlayback(
          logSessionRef.current,
          s,
          isPlaying,
          ex,
          micActiveRef.current,
          nowMs,
        );
        if (!isPlaying) {
          persistLogEntry(toLogEntry(logSessionRef.current));
        }
      }

      if (isPlaying && ex) {
        if (tryTriggerAbLoop(s)) {
          return;
        }
        if (repeatsPerKeyRef.current === 'inf') {
          const anchorIdx = Math.max(
            0,
            Math.min(ex.keys.length - 1, loopAnchorKeyRef.current),
          );
          const anchorKb = ex.keys[anchorIdx];
          if (anchorKb && s >= anchorKb.end - 0.015) {
            const now = performance.now();
            if (now - infLoopRef.current.lastSeekAt > 150) {
              if (logSessionRef.current) {
                logSessionRef.current = syncSessionPlayhead(
                  completeSessionAtEnd(
                    logSessionRef.current,
                    ex,
                    nowMs,
                    true,
                    s,
                  ),
                  infLoopSeekTarget(anchorKb),
                );
              }
              triggerInfLoop(anchorKb, now, false);
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
      const nowMs = Date.now();
      const ex = exerciseRef.current;
      const loopRange = midiLoopRangeRef.current;
      if (loopRange && ex) {
        const lastWin =
          passWindowsRef.current[passWindowsRef.current.length - 1];
        if (lastWin) {
          const absStart = lastWin.start + loopRange.startPassSec;
          const absEnd = lastWin.start + loopRange.endPassSec;
          const prevSec = lastLoopCheckSecRef.current;
          // 若 B 就是該遍最後一小節且剛從範圍內播到曲尾，直接回跳 A 並繼續播放
          if (
            absEnd >= lastWin.end - 0.05 &&
            prevSec >= absStart - 0.05 &&
            prevSec < absEnd - 0.02
          ) {
            abLoopCooldownRef.current = performance.now();
            handleMidiSeekRef.current(absStart, {
              expectedPlaying: true,
              tolerance: 0.25,
            });
            engine.play();
            return;
          }
        }
      }
      if (repeatsPerKeyRef.current === 'inf' && ex) {
        const anchorIdx = Math.max(
          0,
          Math.min(ex.keys.length - 1, loopAnchorKeyRef.current),
        );
        const anchorKb = ex.keys[anchorIdx];
        if (anchorKb) {
          if (logSessionRef.current) {
            logSessionRef.current = syncSessionPlayhead(
              completeSessionAtEnd(
                logSessionRef.current,
                ex,
                nowMs,
                true,
                anchorKb.end,
              ),
              infLoopSeekTarget(anchorKb),
            );
          }
          triggerInfLoop(anchorKb, performance.now(), true);
          return;
        }
      }
      if (logSessionRef.current) {
        logSessionRef.current = completeSessionAtEnd(
          logSessionRef.current,
          ex,
          nowMs,
          false,
          ex?.total,
        );
        persistLogEntry(toLogEntry(logSessionRef.current));
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
      flushLogSession(true);
      engine.stop();
    };
  }, [engine, flushLogSession, persistLogEntry, tryTriggerAbLoop]);

  // 播放中以 requestAnimationFrame 外插秒數，讓藍色虛線平滑移動並即時檢查 A–B 循環
  useEffect(() => {
    if (!playing || !exercise) return;
    let rafId = 0;
    const total = exercise.total;
    const tick = () => {
      const { sec: baseSec, time, playing: isPlaying } = lastPosRef.current;
      if (isPlaying) {
        const dt = (performance.now() - time) / 1000;
        const nextSec = Math.min(total, baseSec + Math.max(0, dt));
        if (!isScrubbingRef.current) {
          if (tryTriggerAbLoop(nextSec)) {
            rafId = requestAnimationFrame(tick);
            return;
          }
          setSec(nextSec);
        }
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, exercise, tryTriggerAbLoop]);

  const effectivePianoDuringSing = isShadowMode
    ? false
    : isMidiMode && settings.mode === 'follow'
      ? true
      : settings.pianoDuringSing;

  const compileOptions = useMemo(
    () => ({
      pianoDuringSing: effectivePianoDuringSing,
      pad: isMidiMode || isShadowMode ? false : settings.pad,
      click: settings.countIn,
      // MIDI 模式一律排入節拍器、以 'metro' 音量開關，切換節奏組／節拍器不必重新 load
      beatClicks: true,
      countInOnClickBus: isMidiMode,
      bpm: effectiveBpm,
      voiceForGlide: true,
      ...(isMidiMode && midiMixLayers
        ? {
            accompNotes: midiMixLayers.accompNotes,
            rhythmHits: midiMixLayers.rhythmHits,
          }
        : {}),
    }),
    [
      effectivePianoDuringSing,
      isMidiMode,
      isShadowMode,
      settings.pad,
      settings.countIn,
      effectiveBpm,
      midiMixLayers,
    ],
  );

  // 設定或練習變更時重新載入音訊時間表
  useEffect(() => {
    if (!exercise) return;
    engine.setA4(settings.a4);
    engine.load(exercise, compileOptions);
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
      lastLoopCheckSecRef.current = clampedSec;
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
    compileOptions,
    settings.a4,
    settings.bpm,
    settings.pianoDuringSing,
  ]);

  // 節拍器與各匯流排音量即時套用，不重新 load
  useEffect(() => {
    engine.setGain('metro', effectiveMetronome ? 1 : 0);
  }, [engine, effectiveMetronome]);

  useEffect(() => {
    if (isMidiMode) {
      const vocalGain = midiMixer.vocalEnabled
        ? midiMixer.vocalVolume / 100
        : 0;
      const accompGain = midiMixer.accompEnabled
        ? midiMixer.accompVolume / 100
        : 0;
      const rhythmGain = midiMixer.rhythmEnabled
        ? midiMixer.rhythmVolume / 100
        : 0;
      engine.setGain('melody', vocalGain);
      engine.setGain('melodySing', vocalGain);
      engine.setGain('accomp', accompGain);
      engine.setGain('rhythm', rhythmGain);
    } else {
      engine.setGain('melody', 1);
      engine.setGain('melodySing', settings.singPianoVolume / 100);
      engine.setGain('accomp', 0);
      engine.setGain('rhythm', 0);
    }
  }, [engine, isMidiMode, midiMixer, settings.singPianoVolume]);

  useEffect(() => {
    if (
      shouldShowAccompSpeakerHint({
        isMidiMode,
        hasAccompOrRhythmEnabled,
        micActive,
        micMode: settings.micMode,
        alreadyShownThisVisit: accompSpeakerHintShownRef.current,
      })
    ) {
      accompSpeakerHintShownRef.current = true;
      setAccompSpeakerHintOpen(true);
    }
  }, [isMidiMode, hasAccompOrRhythmEnabled, micActive, settings.micMode]);

  useEffect(() => {
    micController.setGateDb(settings.noiseGateDb);
  }, [micController, settings.noiseGateDb]);

  // 練習內容變更時清空演唱軌跡與辨識狀態
  useEffect(() => {
    rawSungRef.current = [];
    voiceGateRef.current.reset();
    confusionRef.current.reset();
    setConfusionBubbleOpen(false);
    lastEvaluatedShadowPassRef.current = null;
    setShadowPassBanner(null);
    if (shadowBannerTimerRef.current !== null) {
      window.clearTimeout(shadowBannerTimerRef.current);
      shadowBannerTimerRef.current = null;
    }
    setSungMidi(null);
    setSungVersion((v) => v + 1);
  }, [exercise]);

  useEffect(() => {
    if (micActive || !isShadowMode) {
      setShadowMicHintOpen(false);
    }
  }, [micActive, isShadowMode]);

  useEffect(() => {
    return () => {
      if (shadowBannerTimerRef.current !== null) {
        window.clearTimeout(shadowBannerTimerRef.current);
        shadowBannerTimerRef.current = null;
      }
    };
  }, []);

  // 離開頁面時關閉麥克風
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      void micController.stop().catch(() => {});
    };
  }, [micController]);

  const handleMicFrame = useCallback(
    (frame: MicPitchFrame) => {
      const cfg = settingsRef.current;
      if (settingsOpenRef.current || autoCalibActiveRef.current) {
        setLiveDb(frame.db);
      }

      const nowWallMs = performance.now();
      if (frame.hz > 0 && Number.isFinite(frame.hz)) {
        const detMidi = hzToMidi(frame.hz, cfg.a4);
        if (Number.isFinite(detMidi)) {
          recentDetectedRef.current.push({
            wallMs: nowWallMs,
            hz: frame.hz,
            midi: detMidi,
          });
        }
      }
      recentDetectedRef.current = recentDetectedRef.current.filter(
        (item) => nowWallMs - item.wallMs <= 1000,
      );

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

      // VoiceGate 漏音比對必須使用原始 Hz（位移前）
      const gate = voiceGateRef.current.processFrame(
        { t: songSec, hz: frame.hz, db: frame.db },
        outputs,
        {
          mode: cfg.micMode,
          gateDb: cfg.noiseGateDb,
        },
      );

      const isVoice = gate.label === 'voice' && frame.hz > 0;
      const rawMidi = isVoice ? hzToMidi(frame.hz, cfg.a4) : NaN;
      const shiftSemitones = resolveVoiceDisplay(cfg).pitchShift;
      const shiftedMidi =
        isVoice && Number.isFinite(rawMidi) ? rawMidi + shiftSemitones : NaN;

      if (isVoice && Number.isFinite(shiftedMidi)) {
        setSungMidi(shiftedMidi);
      } else {
        setSungMidi(null);
      }

      if (!aligned) {
        const wall = nowWallMs / 1000;
        freeSungRef.current.push({
          wall,
          midi: isVoice && Number.isFinite(shiftedMidi) ? shiftedMidi : NaN,
        });
        freeSungRef.current = pruneFreeSamples(
          freeSungRef.current,
          wall,
          Math.max(FREE_WINDOW_SEC, freeLineSpanRef.current),
        );
        // 畫面更新最多每 40 ms 一次
        if (nowWallMs - freeTickRef.current >= 40) {
          freeTickRef.current = nowWallMs;
          setFreeVersion((v) => v + 1);
        }
      } else if (freeSungRef.current.length > 0) {
        freeSungRef.current = [];
        setFreeVersion((v) => v + 1);
      }

      if (aligned && songSec >= 0) {
        const samples = rawSungRef.current;
        const last = samples[samples.length - 1];
        if (!last || songSec > last.t) {
          samples.push({
            t: songSec,
            rawHz: isVoice ? frame.hz : 0,
            voiced: isVoice,
          });
          setSungVersion((v) => v + 1);
        }

        if (!cfg.hideSpeakerHint && currentPhaseRef.current === 'sing') {
          const conf = confusionRef.current.push({
            t: songSec,
            label: gate.label,
            midi: shiftedMidi,
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
    await micController.stop().catch(() => {});
    setMicActive(false);
    freeSungRef.current = [];
    setFreeVersion((v) => v + 1);
    setLiveDb(null);
    setSungMidi(null);
  }, [micController]);

  // 背景切回前景時安全復原音訊與麥克風狀態（不自動重開麥克風，track 已結束則熄燈）
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void (async () => {
        try {
          micController.notifyEndedIfNeeded();
          const ctx = engine.audioContext;
          if (!ctx) {
            return;
          }
          const ctxState = ctx.state as string;
          if (ctxState === 'closed') {
            lastPosRef.current = {
              ...lastPosRef.current,
              playing: false,
            };
            playingRef.current = false;
            setPlaying(false);
            await micController.stop().catch(() => {});
            setMicActive(false);
            setLiveDb(null);
            setSungMidi(null);
            await engine.init();
          } else if (ctxState === 'suspended' || ctxState === 'interrupted') {
            engine.pause();
            lastPosRef.current = {
              ...lastPosRef.current,
              playing: false,
            };
            playingRef.current = false;
            setPlaying(false);
          }
        } catch {
          // 切回前景絕不向外拋出例外
        }
      })();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [engine, micController]);

  const getDiagnostics = useCallback((): PracticeDiagnosticsSnapshot => {
    const nowWallMs = performance.now();
    recentDetectedRef.current = recentDetectedRef.current.filter(
      (item) => nowWallMs - item.wallMs <= 1000,
    );
    const latest =
      recentDetectedRef.current[recentDetectedRef.current.length - 1] ?? null;
    const micDiag: MicDiagnostics = micController.getDiagnostics();
    return {
      mic: micDiag,
      outputLatencySec: engine.outputLatency,
      recentHz: latest ? latest.hz : null,
      recentMidi: latest ? latest.midi : null,
      standalone: isStandaloneMode(),
    };
  }, [engine, micController]);

  const showAutoCalibBanner = useCallback(
    (
      banner: { text: string; tone: 'info' | 'ok' | 'error' } | null,
      autoHideMs?: number,
    ) => {
      if (autoCalibTimerRef.current !== null) {
        window.clearTimeout(autoCalibTimerRef.current);
        autoCalibTimerRef.current = null;
      }
      setAutoCalibBanner(banner);
      if (banner && autoHideMs !== undefined) {
        autoCalibTimerRef.current = window.setTimeout(() => {
          autoCalibTimerRef.current = null;
          setAutoCalibBanner(null);
        }, autoHideMs);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (autoCalibTimerRef.current !== null) {
        window.clearTimeout(autoCalibTimerRef.current);
        autoCalibTimerRef.current = null;
      }
    };
  }, []);

  const {
    calibrating: autoCalibrating,
    startCalibration: startAutoCalibration,
    cancelCalibration: cancelAutoCalibration,
  } = useNoiseCalibration({
    liveDb,
    onComplete: (result: NoiseGateResult) => {
      autoCalibActiveRef.current = false;
      if (result.ok) {
        onUpdateSettings({
          noiseGateDb: result.gateDb,
          noiseCalibrated: true,
        });
        showAutoCalibBanner(
          { text: `已設定噪音門檻為 ${result.gateDb} dB`, tone: 'ok' },
          2000,
        );
      } else {
        // 沒收到音量資料（麥克風還沒真的開好）不算校正過，下次開麥克風再自動校正
        if (result.reason !== 'empty') {
          onUpdateSettings({ noiseCalibrated: true });
        }
        const reasonText =
          result.reason === 'empty'
            ? '未收到麥克風音量資料'
            : '環境太吵（建議門檻超過 −30 dB）';
        showAutoCalibBanner(
          {
            text: `${reasonText}，可從齒輪 → 校正環境噪音 重新校正`,
            tone: 'error',
          },
          4000,
        );
      }
    },
  });

  async function handleToggleMic() {
    if (micActive) {
      if (autoCalibrating) {
        cancelAutoCalibration();
        autoCalibActiveRef.current = false;
        showAutoCalibBanner(null);
      }
      await stopMic();
    } else {
      const ok = await startMic();
      if (ok && !settingsRef.current.noiseCalibrated) {
        showAutoCalibBanner({
          text: '校正環境噪音中，請保持安靜（2 秒）',
          tone: 'info',
        });
        autoCalibActiveRef.current = true;
        startAutoCalibration();
      }
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
  const [rangeLow, rangeHigh] = getRangeBounds(settings.rangeName, settings.myRange);
  const { minSemi, maxSemi } = useMemo(() => getPatternSpan(pattern), [pattern]);
  const feasibleLow = rangeLow - minSemi;
  const feasibleHigh = rangeHigh - maxSemi;
  const isPatternOutOfRange =
    findLowestFeasibleTonic(pattern, rangeLow, rangeHigh) === null;
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
      if (scoreLongPressTimerRef.current !== null) {
        window.clearTimeout(scoreLongPressTimerRef.current);
      }
      if (flashBarTimerRef.current !== null) {
        window.clearTimeout(flashBarTimerRef.current);
      }
    };
  }, []);

  function applyMidiSpeedChange(nextSpeedRaw: number) {
    if (!midiSource || !midiBuild?.res || !onUpdateMidiSongSettings) return;
    const prevBpm = midiBuild.res.effectiveBpm;
    const baseBpm = midiBuild.res.baseBpm;
    const nextSpeed = Math.max(
      50,
      Math.min(150, Math.round(nextSpeedRaw / 5) * 5),
    );
    if (nextSpeed === midiSource.songSettings.speedPercent) return;
    const nextBpm = Math.round(baseBpm * (nextSpeed / 100) * 10) / 10;
    const currentSec = getExtrapolatedSec();
    const scaledSec = rescaleTime(currentSec, prevBpm, nextBpm);
    const isPlaying = playingRef.current;
    pendingSeekRef.current = { sec: scaledSec, resumePlay: isPlaying };
    lastLoopCheckSecRef.current = scaledSec;
    lastPosRef.current = {
      sec: scaledSec,
      time: performance.now(),
      playing: isPlaying,
    };
    setSec(scaledSec);
    onUpdateMidiSongSettings(midiSource.hash, {
      ...midiSource.songSettings,
      speedPercent: nextSpeed,
    });
  }

  function applyBpmChange(nextRaw: number) {
    if (isMidiMode && midiBuild?.res) {
      const nextSpeed = (nextRaw / midiBuild.res.baseBpm) * 100;
      applyMidiSpeedChange(nextSpeed);
      return;
    }
    const prevBpm = settingsRef.current.bpm;
    const nextBpm = clampBpm(nextRaw);
    if (nextBpm === prevBpm) {
      return;
    }
    const currentSec = getExtrapolatedSec();
    const scaledSec = rescaleTime(currentSec, prevBpm, nextBpm);
    const isPlaying = playingRef.current;
    settingsRef.current = { ...settingsRef.current, bpm: nextBpm };
    pendingSeekRef.current = { sec: scaledSec, resumePlay: isPlaying };
    lastPosRef.current = {
      sec: scaledSec,
      time: performance.now(),
      playing: isPlaying,
    };
    setSec(scaledSec);
    onUpdateSettings({ bpm: nextBpm });
  }

  function handleBpmStep(delta: -1 | 1) {
    if (isMidiMode && midiSource) {
      applyMidiSpeedChange(midiSource.songSettings.speedPercent + delta * 5);
      return;
    }
    applyBpmChange(stepBpm(settingsRef.current.bpm, delta));
  }

  function handleBpmChange(nextBpm: number) {
    applyBpmChange(nextBpm);
  }

  function handleBpmReset() {
    if (isMidiMode) {
      applyMidiSpeedChange(100);
      return;
    }
    applyBpmChange(menuBpmRef.current);
  }

  const handleBpmEditingChange = useCallback(
    (editing: boolean) => {
      setBpmEditing(editing);
      onInputActiveChange?.(editing);
    },
    [onInputActiveChange],
  );

  function handleTransposeStep(delta: -1 | 1) {
    if (isMidiMode && midiSource && onUpdateMidiSongSettings) {
      const nextT = midiSource.songSettings.transposeSemitones + delta;
      if (nextT < -12 || nextT > 12) {
        showBoundaryHint();
        return;
      }
      onUpdateMidiSongSettings(midiSource.hash, {
        ...midiSource.songSettings,
        transposeSemitones: nextT,
      });
      return;
    }
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

      if (isShadowMode && !micActiveRef.current) {
        setShadowMicHintOpen(true);
      }

      engine.setA4(settings.a4);
      engine.load(exercise, compileOptions);
      engine.setGain('metro', effectiveMetronome ? 1 : 0);
      if (isMidiMode) {
        const vocalGain = midiMixer.vocalEnabled
          ? midiMixer.vocalVolume / 100
          : 0;
        engine.setGain('melody', vocalGain);
        engine.setGain('melodySing', vocalGain);
        engine.setGain(
          'accomp',
          midiMixer.accompEnabled ? midiMixer.accompVolume / 100 : 0,
        );
        engine.setGain(
          'rhythm',
          midiMixer.rhythmEnabled ? midiMixer.rhythmVolume / 100 : 0,
        );
      } else {
        engine.setGain('melody', 1);
        engine.setGain('melodySing', settings.singPianoVolume / 100);
      }
      const currentSec = lastPosRef.current.sec;
      lastLoopCheckSecRef.current = currentSec;
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
    lastEvaluatedShadowPassRef.current = null;
    voiceGateRef.current.reset();
    setSungVersion((v) => v + 1);
    lastPosRef.current = {
      sec: targetSec,
      time: performance.now(),
      playing,
    };
    setSec(targetSec);
    if (logSessionRef.current) {
      logSessionRef.current = syncSessionPlayhead(
        logSessionRef.current,
        targetSec,
      );
    }
    engine.seekToKey(clampedIdx);
  }

  function jumpToMidiPage(pageIdx: number) {
    if (!exercise || midiPages.length === 0) return;
    const clampedIdx = Math.max(0, Math.min(midiPages.length - 1, pageIdx));
    const targetSec = midiPages[clampedIdx]?.start ?? 0;
    handleMidiSeek(targetSec);
  }

  function handleMidiSeek(
    targetAbsSec: number,
    seekOptions?: { expectedPlaying?: boolean; tolerance?: number },
  ) {
    if (!exercise) return;
    const clampedSec = Math.max(0, Math.min(exercise.total, targetAbsSec));
    const expectPlay = seekOptions?.expectedPlaying ?? playingRef.current;
    if (expectPlay) {
      pendingSeekGuardRef.current = {
        targetSec: clampedSec,
        expiresAt: performance.now() + 300,
        expectedPlaying: seekOptions?.expectedPlaying,
        tolerance: seekOptions?.tolerance ?? 0.25,
      };
    }
    lastLoopCheckSecRef.current = clampedSec;
    rawSungRef.current = rawSungRef.current.filter((p) => p.t < clampedSec);
    lastEvaluatedShadowPassRef.current = null;
    voiceGateRef.current.reset();
    setSungVersion((v) => v + 1);
    lastPosRef.current = {
      sec: clampedSec,
      time: performance.now(),
      playing: expectPlay,
    };
    setSec(clampedSec);
    if (logSessionRef.current) {
      logSessionRef.current = syncSessionPlayhead(
        logSessionRef.current,
        clampedSec,
      );
    }
    if (engine.audioContext) {
      engine.seek(clampedSec);
    }
  }
  handleMidiSeekRef.current = handleMidiSeek;

  function handlePrevKey() {
    if (!exercise) return;
    if (isMidiMode) {
      jumpToMidiPage(midiPageIdx - 1);
      return;
    }
    jumpToKey(Math.max(0, currentKeyIndex - 1));
  }

  function handleNextKey() {
    if (!exercise) return;
    if (isMidiMode) {
      jumpToMidiPage(midiPageIdx + 1);
      return;
    }
    jumpToKey(Math.min(exercise.keys.length - 1, currentKeyIndex + 1));
  }

  function stopAndResetPlayback() {
    flushLogSession(true);
    engine.stop();
    loopAnchorKeyRef.current = 0;
    setInfLoopCount(1);
    lastLoopCheckSecRef.current = 0;
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

  function handleToggleMode(nextMode: PracticeModeOption) {
    if (playing || sec > 0) {
      pendingSeekKeyRef.current = {
        keyIndex: currentKeyIndex,
        resumePlay: playing,
      };
    }
    onUpdateSettings({ mode: nextMode });
  }

  function handleBackClick() {
    flushLogSession(true);
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

  const win = exercise ? passWindow(exercise, sec) : null;
  currentPhaseRef.current = win?.phase ?? 'sing';
  const currentKeyIndex = win?.keyIndex ?? 0;
  const totalKeys = exercise?.keys.length ?? 0;
  const activeKeyBlock = exercise?.keys[currentKeyIndex];
  const activeKey = activeKeyBlock?.key ?? C_MAJOR_KEY;
  const tonicMidi = activeKeyBlock?.tonicMidi ?? settings.startTonic;

  // 依實際可用視窗高度分配各區塊尺寸
  const collapsedPref: PianoCollapsedPref = forceExpandPiano
    ? 'expanded'
    : settings.pianoCollapsed
      ? 'collapsed'
      : 'auto';
  const portraitLayout = isPortrait
    ? computePortraitLayout(
        layoutWidth,
        layoutHeight,
        safePadding ? { x: safePadding.x, y: safePadding.y } : undefined,
        {
          collapsedPref,
          preferredPianoHeight: settings.pianoHeight,
          overridePianoHeight: dragHeight,
          extraChromeHeight: seekBarHeight,
          lyricsBandHeight,
        },
      )
    : null;
  const vpLayout =
    portraitLayout ??
    computeViewportLayout({
      height: layoutHeight,
      width: layoutWidth,
      device,
      collapsedPref,
      preferredPianoHeight: settings.pianoHeight,
      overridePianoHeight: dragHeight,
      safePaddingY: safePadding?.y,
      safePaddingX: safePadding?.x,
      extraChromeHeight: seekBarHeight,
      lyricsBandHeight,
    });

  const handleH = vpLayout.handleHeight;
  const miniH = miniPianoHeight(isTablet);
  const baseDefaultPianoH = isPortrait
    ? PORTRAIT_DEFAULT_PIANO_HEIGHT
    : defaultPianoHeight(isTablet);
  const maxPianoH = vpLayout.maxPianoHeight;
  const isPianoCollapsed = vpLayout.collapsed;
  const effectivePianoH = vpLayout.pianoHeight;
  const maxLines = vpLayout.lineCount;
  const staffHeight = vpLayout.staffHeight;

  const displaySec =
    isMidiMode && scrubPreviewSec !== null ? scrubPreviewSec : sec;

  const midiScoreBars = useMemo(
    () => midiBuild?.res?.scoreBars ?? [],
    [midiBuild],
  );
  const midiLoopBars = useMemo<MidiLoopBars>(() => {
    if (!isMidiMode || !midiSource || midiScoreBars.length === 0) {
      return {};
    }
    const minBar = midiScoreBars[0]!.barNumber;
    const maxBar = midiScoreBars[midiScoreBars.length - 1]!.barNumber;
    return normalizeMidiLoopBars(
      midiSource.songSettings.loopStartBar,
      midiSource.songSettings.loopEndBar,
      minBar,
      maxBar,
    );
  }, [
    isMidiMode,
    midiSource?.songSettings.loopStartBar,
    midiSource?.songSettings.loopEndBar,
    midiScoreBars,
  ]);
  const midiLoopRangeSec = useMemo(
    () =>
      isMidiMode
        ? resolveMidiLoopRangeSec(
            midiScoreBars,
            midiLoopBars.loopStartBar,
            midiLoopBars.loopEndBar,
          )
        : null,
    [isMidiMode, midiScoreBars, midiLoopBars],
  );
  midiLoopRangeRef.current = midiLoopRangeSec;

  // 若區間、移調或變速後原本的 A–B 小節號超出目前 scoreBars 範圍，自動清掉
  useEffect(() => {
    if (
      !isMidiMode ||
      !midiSource ||
      !onUpdateMidiSongSettings ||
      midiScoreBars.length === 0
    ) {
      return;
    }
    const rawA = midiSource.songSettings.loopStartBar;
    const rawB = midiSource.songSettings.loopEndBar;
    if (rawA === undefined && rawB === undefined) return;
    const hasA =
      rawA === undefined || midiScoreBars.some((b) => b.barNumber === rawA);
    const hasB =
      rawB === undefined || midiScoreBars.some((b) => b.barNumber === rawB);
    if (!hasA || !hasB) {
      const { loopStartBar: _a, loopEndBar: _b, ...rest } =
        midiSource.songSettings;
      onUpdateMidiSongSettings(midiSource.hash, rest);
    }
  }, [isMidiMode, midiSource, midiScoreBars, onUpdateMidiSongSettings]);

  const midiHeaderReserve = Math.ceil(
    staffLeftPad(activeKey, clef, vpLayout.sp) + 1.8 * vpLayout.sp + RIGHT_PAD,
  );
  const midiAvailWidth = Math.max(120, scoreWidth - midiHeaderReserve);
  const midiPages = useMemo(
    () =>
      isMidiMode && exercise
        ? buildMidiMeasurePages(exercise, midiScoreBars, midiAvailWidth, vpLayout.sp)
        : [],
    [isMidiMode, exercise, midiScoreBars, midiAvailWidth, vpLayout.sp],
  );
  const midiPageIdx = isMidiMode
    ? midiMeasurePageIndexAtTime(midiPages, displaySec)
    : 0;

  const lines = useMemo(() => {
    if (!exercise) return [];
    if (isMidiMode) {
      return midiMeasureScoreLines(
        exercise,
        midiScoreBars,
        displaySec,
        maxLines,
        midiAvailWidth,
        vpLayout.sp,
      );
    }
    if (isPortrait) {
      const baseLines = scoreLinesPortrait(
        exercise,
        sec,
        maxLines as 1 | 2 | 3,
      );
      if (settings.repeatsPerKey !== 'inf' || maxLines < 3) {
        return baseLines;
      }
      const passLines = baseLines.filter((l) => !l.isPreview);
      const currLine = passLines.find((l) => l.isCurrent) ?? passLines[0];
      if (!currLine || currLine.phase !== 'sing' || passLines.length > 2) {
        return baseLines;
      }
      const firstLine = passLines[0]!;
      const previewLine: ScoreLine = {
        keyIndex: firstLine.keyIndex,
        pass: firstLine.pass,
        phase: firstLine.phase,
        noteRange: firstLine.noteRange,
        start: firstLine.start,
        end: firstLine.end,
        isCurrent: false,
        label: null,
        isSamePassContinuation: false,
        isPreview: true,
      };
      return [...passLines, previewLine];
    }

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
    const currNotes = notesForWindow(exercise, curr);
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
  }, [exercise, isMidiMode, midiScoreBars, midiAvailWidth, vpLayout.sp, displaySec, sec, maxLines, settings.repeatsPerKey, isPortrait]);

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
        pitches.push(
          pt.rawHz > 0 ? hzToMidi(pt.rawHz, settings.a4) + pitchShift : NaN,
        );
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
  }, [lines, sungVersion, settings.a4, pitchShift]);

  // 沒播放時：即時演唱音高線使用目前這一行的整個寬度，最新的點貼在行尾
  const liveSungByLine = useMemo(() => {
    let currentIdx = lines.findIndex((l) => l.isCurrent);
    if (currentIdx < 0) currentIdx = 0;
    const currentLine = lines[currentIdx];
    if (currentLine) {
      freeLineSpanRef.current = Math.max(
        FREE_WINDOW_SEC,
        currentLine.end - currentLine.start,
      );
    }
    const samples = freeSungRef.current;
    if (playing || !micActive || samples.length === 0 || lines.length === 0) {
      return lines.map(() => EMPTY_SUNG);
    }
    const nowWall = performance.now() / 1000;
    const curved = singingCurve(
      samples.map((p) => p.wall),
      samples.map((p) => p.midi),
      samples.map((p) => Number.isFinite(p.midi)),
    );
    const smooth: FreeSample[] = curved.x.map((wall, i) => ({
      wall,
      midi: curved.y[i]!,
    }));
    return lines.map((line, idx) => {
      if (idx !== currentIdx) return EMPTY_SUNG;
      const span = freeSpan(line.start, line.end);
      return span ? freeSungPoints(smooth, nowWall, span) : EMPTY_SUNG;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, freeVersion, playing, micActive]);

  function handleDismissIosHint() {
    markIosInstallHintDismissed();
    setIosHintVisible(false);
  }

  const currentLineInfo = lines.find((l) => l.isCurrent);

  const countIn = exercise
    ? countInDotStates(exercise, displaySec)
    : { active: false, dots: [] };

  const shadowClickTimes = useMemo<number[]>(() => {
    if (!isShadowMode || !settings.metronome || !exercise || effectiveBpm <= 0) {
      return [];
    }
    const firstBeat = exercise.clicks[0]?.t ?? 0;
    const beatSec = 60 / effectiveBpm;
    const times: number[] = [];
    for (let i = 0; ; i++) {
      const t = firstBeat + i * beatSec;
      if (t >= exercise.total - 1e-6) break;
      times.push(t);
    }
    return times;
  }, [isShadowMode, settings.metronome, exercise, effectiveBpm]);

  const shadowFrames = useMemo<PitchFrame[]>(() => {
    if (!isShadowMode) return [];
    return rawSungRef.current.map((s) => ({
      t: s.t,
      hz: s.voiced ? s.rawHz : 0,
      db: s.voiced ? 0 : -100,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShadowMode, sungVersion]);

  useEffect(() => {
    if (
      !isShadowMode ||
      !exercise ||
      (!micActive && shadowFrames.length === 0)
    ) {
      return;
    }
    const windows = listPassWindows(exercise);
    for (const w of windows) {
      if (!w.isShadow) continue;
      const gapNotes = notesForWindow(exercise, w).filter((n) => n.silent);
      if (gapNotes.length === 0) continue;
      const lastGap = gapNotes[gapNotes.length - 1]!;
      const lastGapEnd = lastGap.start + lastGap.dur;
      if (sec < lastGapEnd - 0.02 || sec > w.end + 0.4) continue;
      const passKey = `${w.keyIndex}:${w.pass}`;
      if (lastEvaluatedShadowPassRef.current === passKey) continue;
      lastEvaluatedShadowPassRef.current = passKey;

      const results = analyzeShadowNotes(gapNotes, shadowFrames, {
        a4: settings.a4,
        displayTranspose: pitchShift,
        clickTimes: shadowClickTimes,
      });
      const summary = summarizeShadowPass(results);
      setShadowPassBanner(summary.text);
      if (shadowBannerTimerRef.current !== null) {
        window.clearTimeout(shadowBannerTimerRef.current);
      }
      shadowBannerTimerRef.current = window.setTimeout(() => {
        shadowBannerTimerRef.current = null;
        setShadowPassBanner(null);
      }, 3000);
      break;
    }
  }, [
    isShadowMode,
    exercise,
    micActive,
    shadowFrames,
    sec,
    settings.a4,
    pitchShift,
    shadowClickTimes,
  ]);

  const passWindows = useMemo(
    () => (exercise ? listPassWindows(exercise) : []),
    [exercise],
  );
  passWindowsRef.current = passWindows;
  const activePassWin = useMemo(() => {
    if (passWindows.length === 0) return null;
    if (displaySec < passWindows[0]!.start) return passWindows[0]!;
    return (
      passWindows.find((w) => displaySec >= w.start && displaySec < w.end) ??
      passWindows[passWindows.length - 1]!
    );
  }, [passWindows, displaySec]);
  const activePassStart = activePassWin?.start ?? exercise?.keys[0]?.start ?? 0;
  const totalPassDur =
    midiScoreBars.length > 0
      ? Math.max(0.05, midiScoreBars[midiScoreBars.length - 1]!.endSec)
      : 0;

  let targetMidi: number | null = null;
  const renderedLines = lines.map((line) => {
    const lineKeyBlock = exercise?.keys[line.keyIndex];
    const lineKey = lineKeyBlock?.key ?? activeKey;
    const lineTonicMidi = lineKeyBlock?.tonicMidi ?? tonicMidi;

    let metrics;
    let leftPad: number;
    let glyphs: NoteGlyph[];
    let midiData: MidiLineRenderData | undefined;
    let introCountdownBars: number | null = null;
    let playheadX: number | null = null;

    if (isMidiMode && 'page' in line) {
      const midiLine = line as MidiMeasureScoreLine;
      const positions: { position: number }[] = [];
      for (const bar of midiLine.page.bars) {
        for (const ev of bar.events) {
          if (ev.kind === 'note' && ev.midi !== undefined) {
            positions.push({
              position: staffPosition(ev.midi, lineKey, clef).position,
            });
          }
        }
      }
      metrics = computeStaffMetrics(
        positions,
        staffHeight,
        isTablet,
        staffLyricBottomPad,
      );
      const passWin = passWindows.find(
        (w) =>
          w.keyIndex === midiLine.keyIndex &&
          w.pass === midiLine.pass &&
          w.phase === midiLine.phase,
      );
      const passStartSec = passWin?.start ?? midiLine.start;
      const built = buildMidiLineGlyphs({
        page: midiLine.page,
        key: lineKey,
        clef,
        scoreWidth,
        rightPad: RIGHT_PAD,
        lineSpacing: metrics.lineSpacing,
        isFirstLineInPass: midiLine.page.barRange[0] === 0,
        isLastPageInPass: midiLine.page.barRange[1] >= midiScoreBars.length,
        passStartSec,
      });
      glyphs = built.glyphs;
      midiData = built.renderData;
      if (showLyrics && passLyrics) {
        midiData.lyricMarks = alignLyricsToStaffLine({
          glyphs,
          bars: midiLine.page.bars,
          passStartSec,
          passLyrics: passLyrics.lines,
          lyricsScale: settings.lyricsScale,
          isTablet,
        });
      }
      leftPad = midiData.leftPad;

      const showPlayhead =
        line.isCurrent &&
        displaySec >= line.start - 0.001 &&
        displaySec <= line.end + 0.001;
      playheadX = showPlayhead
        ? midiLineTimeToX(
            Math.max(line.start, Math.min(line.end, displaySec)),
            midiData.segments,
            midiData.leftPad,
            midiData.rightEdge,
          )
        : null;
      if (line.isCurrent) {
        introCountdownBars = computeIntroCountdownBars(
          midiScoreBars,
          passStartSec,
          displaySec,
        );
      }
    } else {
      const allWinNotes = exercise ? notesForWindow(exercise, line) : [];
      const lineNotes = allWinNotes.slice(line.noteRange[0], line.noteRange[1]);
      const positions = lineNotes.map((n) => ({
        position: staffPosition(n.midi, lineKey, clef).position,
        ...(n.endMidi !== undefined
          ? { endPosition: staffPosition(n.endMidi, lineKey, clef).position }
          : {}),
      }));
      metrics = computeStaffMetrics(positions, staffHeight, isTablet);
      leftPad = staffLeftPad(lineKey, clef, metrics.lineSpacing);
      glyphs = exercise
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
      const showPlayhead =
        line.isCurrent &&
        sec >= line.start - 0.001 &&
        sec <= line.end + 0.001;
      playheadX = showPlayhead
        ? timeToX(
            Math.max(line.start, Math.min(line.end, sec)),
            line.start,
            line.end,
            leftPad,
            Math.max(leftPad + 1, scoreWidth - RIGHT_PAD),
          )
        : null;
    }

    const activeNoteIdx = line.isCurrent ? currentNoteIndex(glyphs, displaySec) : -1;
    const activeGlyph = activeNoteIdx >= 0 ? glyphs[activeNoteIdx] : undefined;
    if (line.isCurrent && activeGlyph && !activeGlyph.isRest) {
      targetMidi = activeGlyph.midi;
    }

    const activeNoteX =
      line.isCurrent && activeGlyph && !activeGlyph.isRest
        ? activeGlyph.x
        : null;

    const isPreviewLine = line.isPreview ?? !line.isCurrent;
    const shadowResults: (ShadowNoteResult | null)[] | undefined =
      isShadowMode &&
      !isPreviewLine &&
      (micActive || shadowFrames.length > 0)
        ? glyphs.map((g) => {
            if (!g.silent || sec < g.start + g.dur - 0.005) {
              return null;
            }
            return (
              analyzeShadowNotes([g], shadowFrames, {
                a4: settings.a4,
                displayTranspose: pitchShift,
                clickTimes: shadowClickTimes,
              })[0] ?? null
            );
          })
        : undefined;
    const keyText = tonicLabel(lineKey);
    let lineLabel: string | null = null;
    if (isMidiMode) {
      if (!isPreviewLine) {
        const phaseText =
          line.phase === 'listen'
            ? `${keyText} 示範`
            : `${keyText} 第 ${line.pass + 1} 遍`;
        lineLabel =
          midiPages.length > 1
            ? `${phaseText} · ${midiPageIdx + 1}/${midiPages.length}`
            : phaseText;
      } else {
        lineLabel = line.label;
      }
    } else if (!isPreviewLine) {
      if (!line.isSamePassContinuation) {
        if (line.phase === 'listen') {
          lineLabel = `${keyText} 示範`;
        } else if (settings.repeatsPerKey === 'inf') {
          lineLabel = `${keyText} 第 ${infLoopCount} 遍`;
        } else {
          lineLabel = `${keyText} 第 ${line.pass + 1}/${settings.repeatsPerKey} 遍`;
        }
      } else {
        lineLabel = isPortrait
          ? null
          : settings.jianpuMode === 'fixed'
            ? '固定調'
            : `1=${keyText}`;
      }
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
      isPreviewLine,
      lineKey,
      lineTonicMidi,
      metrics,
      leftPad,
      glyphs,
      activeNoteIdx,
      playheadX,
      activeNoteX,
      shadowResults,
      lineLabel,
      midiData,
      introCountdownBars,
    };
  });

  targetMidiRef.current = targetMidi;

  function saveLoopBars(nextLoop: MidiLoopBars) {
    if (!midiSource || !onUpdateMidiSongSettings) return;
    const { loopStartBar: _a, loopEndBar: _b, ...rest } =
      midiSource.songSettings;
    onUpdateMidiSongSettings(midiSource.hash, {
      ...rest,
      ...(nextLoop.loopStartBar !== undefined
        ? { loopStartBar: nextLoop.loopStartBar }
        : {}),
      ...(nextLoop.loopEndBar !== undefined
        ? { loopEndBar: nextLoop.loopEndBar }
        : {}),
    });
  }

  function triggerBarFlash(barNumber: number) {
    setFlashBarNumber(barNumber);
    if (flashBarTimerRef.current !== null) {
      window.clearTimeout(flashBarTimerRef.current);
    }
    flashBarTimerRef.current = window.setTimeout(() => {
      flashBarTimerRef.current = null;
      setFlashBarNumber(null);
    }, 450);
  }

  const currentMidiBarNum = useMemo(() => {
    if (!isMidiMode || midiScoreBars.length === 0) {
      return midiSource?.songSettings.startBar ?? 1;
    }
    const passSec = Math.max(0, displaySec - activePassStart);
    return (
      findBarAtPassSec(midiScoreBars, passSec)?.barNumber ??
      midiScoreBars[0]!.barNumber
    );
  }, [
    isMidiMode,
    midiScoreBars,
    displaySec,
    activePassStart,
    midiSource?.songSettings.startBar,
  ]);

  function handleToggleLoopA() {
    if (!isMidiMode || midiScoreBars.length === 0) return;
    const minBar = midiScoreBars[0]!.barNumber;
    const maxBar = midiScoreBars[midiScoreBars.length - 1]!.barNumber;
    saveLoopBars(
      toggleMidiLoopPoint(midiLoopBars, 'A', currentMidiBarNum, minBar, maxBar),
    );
  }

  function handleToggleLoopB() {
    if (!isMidiMode || midiScoreBars.length === 0) return;
    const minBar = midiScoreBars[0]!.barNumber;
    const maxBar = midiScoreBars[midiScoreBars.length - 1]!.barNumber;
    saveLoopBars(
      toggleMidiLoopPoint(midiLoopBars, 'B', currentMidiBarNum, minBar, maxBar),
    );
  }

  function handleClearLoopAB() {
    if (!isMidiMode) return;
    saveLoopBars({});
  }

  function cancelScoreLongPressTimer() {
    if (scoreLongPressTimerRef.current !== null) {
      window.clearTimeout(scoreLongPressTimerRef.current);
      scoreLongPressTimerRef.current = null;
    }
  }

  function handleScorePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isMidiMode || !exercise || midiScoreBars.length === 0) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const areaEl = scoreAreaRef.current;
    let targetLine = renderedLines.find((l) => l.line.isCurrent) ?? renderedLines[0];
    let relX = pt.x;
    if (areaEl) {
      const areaRect = toLocalRect(areaEl.getBoundingClientRect(), rotationCtx);
      relX = pt.x - areaRect.left;
      const relY = pt.y - areaRect.top;
      if (renderedLines.length > 1) {
        const lineIdx = Math.min(
          renderedLines.length - 1,
          Math.max(0, Math.floor(relY / Math.max(1, vpLayout.lineHeight))),
        );
        targetLine = renderedLines[lineIdx] ?? targetLine;
      }
    }

    const hitSeg = targetLine?.midiData
      ? findMidiSegmentAtX(relX, targetLine.midiData.segments)
      : null;
    const rateSegments =
      (renderedLines.find((l) => l.line.isCurrent) ?? targetLine)?.midiData
        ?.segments ?? [];
    const secPerPx = computeMidiScrubSecPerPx(rateSegments, midiAvailWidth, 4);
    const startSec = getExtrapolatedSec();
    const pointerId = e.pointerId;

    scoreGestureRef.current = {
      pointerId,
      startX: pt.x,
      startY: pt.y,
      startTime: performance.now(),
      maxDist: 0,
      mode: 'pending',
      startSec,
      secPerPx,
      wasPlaying: playingRef.current,
      targetBarNumber: hitSeg?.barNumber ?? null,
      targetBarAbsStartSec: hitSeg
        ? (hitSeg.beatAbsSecs[0] ?? hitSeg.absStartSec)
        : null,
    };

    cancelScoreLongPressTimer();
    if (hitSeg) {
      const targetBarNum = hitSeg.barNumber;
      const minBar = midiScoreBars[0]!.barNumber;
      const maxBar = midiScoreBars[midiScoreBars.length - 1]!.barNumber;
      scoreLongPressTimerRef.current = window.setTimeout(() => {
        scoreLongPressTimerRef.current = null;
        const g = scoreGestureRef.current;
        if (!g || g.pointerId !== pointerId || g.mode !== 'pending') {
          return;
        }
        g.mode = 'long-press';
        const nextLoop = applyScoreBarLongPressLoop(
          midiLoopBars,
          targetBarNum,
          minBar,
          maxBar,
        );
        saveLoopBars(nextLoop);
        triggerBarFlash(targetBarNum);
      }, 500);
    }
  }

  function handleScorePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = scoreGestureRef.current;
    if (!g || g.pointerId !== e.pointerId || !exercise) return;
    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const dx = pt.x - g.startX;
    const dy = pt.y - g.startY;
    const dist = Math.hypot(dx, dy);
    g.maxDist = Math.max(g.maxDist, dist);

    if (g.maxDist >= 8) {
      cancelScoreLongPressTimer();
    }

    if (g.mode === 'pending') {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        g.mode = 'drag';
        isScrubbingRef.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // 忽略部分環境不支援 setPointerCapture
        }
        if (g.wasPlaying) {
          engine.pause();
        }
        const preview = computeScrubTargetSec(
          g.startSec,
          dx,
          g.secPerPx,
          exercise.total,
        );
        scrubPreviewSecRef.current = preview;
        setScrubPreviewSec(preview);
      } else if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        g.mode = 'vertical';
      }
    } else if (g.mode === 'drag') {
      const preview = computeScrubTargetSec(
        g.startSec,
        dx,
        g.secPerPx,
        exercise.total,
      );
      scrubPreviewSecRef.current = preview;
      setScrubPreviewSec(preview);
    }
  }

  function handleScorePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    cancelScoreLongPressTimer();
    const g = scoreGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    scoreGestureRef.current = null;

    if (g.mode === 'long-press' || g.mode === 'vertical') {
      return;
    }
    if (g.mode === 'drag') {
      isScrubbingRef.current = false;
      const rawTarget = scrubPreviewSecRef.current ?? g.startSec;
      scrubPreviewSecRef.current = null;
      setScrubPreviewSec(null);
      if (exercise) {
        const snapped = snapAbsSecToNearestBeat({
          targetAbsSec: rawTarget,
          totalSec: exercise.total,
          scoreBars: midiScoreBars,
          passWindows,
        });
        handleMidiSeek(
          snapped,
          g.wasPlaying ? { expectedPlaying: true, tolerance: 0.25 } : undefined,
        );
        if (g.wasPlaying) {
          engine.play();
        }
      }
      return;
    }

    // 點一下（移動距離 < 8px 且時間 < 300ms）：跳到被點小節的第一拍
    const elapsed = performance.now() - g.startTime;
    if (
      g.mode === 'pending' &&
      g.maxDist < 8 &&
      elapsed < 300 &&
      g.targetBarAbsStartSec !== null
    ) {
      handleMidiSeek(g.targetBarAbsStartSec);
    }
  }

  function handleScorePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    cancelScoreLongPressTimer();
    const g = scoreGestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    scoreGestureRef.current = null;
    if (g.mode === 'drag') {
      isScrubbingRef.current = false;
      scrubPreviewSecRef.current = null;
      setScrubPreviewSec(null);
      if (g.wasPlaying) {
        pendingSeekGuardRef.current = {
          targetSec: g.startSec,
          expiresAt: performance.now() + 300,
          expectedPlaying: true,
          tolerance: 0.5,
        };
        engine.play();
      }
    }
  }

  function handleDrawerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略部分環境不支援 setPointerCapture 的情況
    }
    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const expandedFallback = clampPianoHeight(
      settings.pianoHeight ?? baseDefaultPianoH,
      maxPianoH,
    );
    handleDragRef.current = {
      pointerId: e.pointerId,
      startY: pt.y,
      startX: pt.x,
      savedHeight: isPianoCollapsed ? expandedFallback : effectivePianoH,
      collapsed: isPianoCollapsed,
      maxDist: 0,
    };
  }

  function handleDrawerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const dy = pt.y - drag.startY;
    const dx = pt.x - drag.startX;
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

    const pt = toLocalPoint(e.clientX, e.clientY, rotationCtx);
    const dy = pt.y - drag.startY;
    const result = resolveDrawerPointerEnd({
      savedHeight: drag.savedHeight,
      collapsed: drag.collapsed,
      deltaY: dy,
      distance: drag.maxDist,
      miniHeight: miniH,
      defaultHeight: baseDefaultPianoH,
      maxHeight: maxPianoH,
    });
    if (!result.collapsed && autoLayout.autoCollapsed) {
      // 空間不足自動收合時，使用者手動展開改為單行並把剩餘空間交給鋼琴
      setForceExpandPiano(true);
      onUpdateSettings({
        pianoCollapsed: false,
        pianoHeight: result.height,
      });
    } else if (result.collapsed && forceExpandPiano) {
      // 由手動強制展開再點一下收合時，回到依可用空間自動決定
      setForceExpandPiano(false);
      onUpdateSettings({
        pianoCollapsed: false,
        pianoHeight: result.height,
      });
    } else {
      setForceExpandPiano(false);
      onUpdateSettings({
        pianoCollapsed: result.collapsed,
        pianoHeight: result.height,
      });
    }
  }

  const showScreenshotToast = useCallback(
    (
      message: string,
      isError: boolean,
      options?: {
        durationMs?: number;
        pendingShare?: { file: File; title: string };
      },
    ) => {
      setScreenshotToast({
        message,
        isError,
        pendingShare: options?.pendingShare,
      });
      if (screenshotToastTimerRef.current !== null) {
        window.clearTimeout(screenshotToastTimerRef.current);
      }
      screenshotToastTimerRef.current = window.setTimeout(() => {
        screenshotToastTimerRef.current = null;
        setScreenshotToast(null);
      }, options?.durationMs ?? 2000);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (screenshotToastTimerRef.current !== null) {
        window.clearTimeout(screenshotToastTimerRef.current);
      }
    };
  }, []);

  const selectedCount = keySelection.selectedIndices.length;
  const activeFullKeyIndex =
    tonicListIndexToFullIndex(keySelection, currentKeyIndex) ?? -1;
  const currentPassNum =
    settings.repeatsPerKey === 'inf'
      ? infLoopCount
      : win && win.phase === 'sing'
        ? win.pass + 1
        : 1;

  const onlySelectedButton = (
    <button
      type="button"
      className={`practice-only-selected-btn ${keySelection.onlySelected ? 'is-on' : ''}`}
      disabled={selectedCount === 0}
      aria-pressed={keySelection.onlySelected}
      onClick={handleToggleOnlySelected}
    >
      只練選的 {selectedCount}
    </button>
  );

  const canTakeScreenshot =
    exercise !== null && canScreenshot(playing, sec);

  async function handleScreenshot() {
    if (!canTakeScreenshot) return;
    const svgNodes = Array.from(
      scoreAreaRef.current?.querySelectorAll('svg.staff-svg') ?? [],
    ) as SVGSVGElement[];

    try {
      const result = await exportPracticeScreenshot({
        patternName: songTitle,
        keyLabel: tonicLabel(activeKey),
        keyIndex: currentKeyIndex,
        totalKeys,
        passNum: currentPassNum,
        repeatsPerKey: settings.repeatsPerKey,
        phase: currentLineInfo?.phase,
        sec,
        jianpuMode: settings.jianpuMode,
        scoreWidth,
        jianpuHeight: vpLayout.jianpuHeight,
        staffHeight,
        isTablet,
        isPortrait,
        lines: renderedLines.map((item, idx) => ({
          isCurrent: item.line.isCurrent,
          isPreviewLine: item.isPreviewLine,
          lineKey: item.lineKey,
          lineTonicMidi: item.lineTonicMidi,
          glyphs: item.glyphs,
          activeNoteIdx: item.activeNoteIdx,
          playheadX: item.playheadX,
          activeNoteX: item.activeNoteX,
          lineLabel: item.lineLabel,
          octaveTag:
            !item.isPreviewLine && !item.line.isSamePassContinuation
              ? octaveTag
              : null,
          svgElement: svgNodes[idx] ?? null,
          extraJianpuMarkers: item.midiData?.jianpuMarkers,
          underlineSegments: item.midiData?.jianpuUnderlineSegments,
          minNoteSpacingPx: item.midiData?.minNoteSpacingPx,
        })),
      });
      if (result.status === 'needs-tap') {
        showScreenshotToast('截圖已完成，點這裡分享', false, {
          durationMs: 8000,
          pendingShare: { file: result.file, title: result.title },
        });
      } else if (result.status !== 'cancelled') {
        showScreenshotToast('已截圖', false);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : '未知錯誤';
      showScreenshotToast(`截圖失敗：${detail}`, true);
    }
  }

  function handlePendingShareClick() {
    const pending = screenshotToast?.pendingShare;
    if (!pending) return;

    if (screenshotToastTimerRef.current !== null) {
      window.clearTimeout(screenshotToastTimerRef.current);
      screenshotToastTimerRef.current = null;
    }
    setScreenshotToast(null);

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      // 必須在使用者點擊事件內同步呼叫 navigator.share，不可先 await
      navigator
        .share({ files: [pending.file], title: pending.title })
        .then(() => {
          showScreenshotToast('已截圖', false);
        })
        .catch((err) => {
          if (
            typeof err === 'object' &&
            err !== null &&
            'name' in err &&
            (err as { name: unknown }).name === 'AbortError'
          ) {
            return;
          }
          try {
            downloadScreenshotBlob(pending.file, pending.file.name);
            showScreenshotToast('已截圖', false);
          } catch (dlErr) {
            const detail = dlErr instanceof Error ? dlErr.message : '未知錯誤';
            showScreenshotToast(`截圖失敗：${detail}`, true);
          }
        });
      return;
    }

    try {
      downloadScreenshotBlob(pending.file, pending.file.name);
      showScreenshotToast('已截圖', false);
    } catch (dlErr) {
      const detail = dlErr instanceof Error ? dlErr.message : '未知錯誤';
      showScreenshotToast(`截圖失敗：${detail}`, true);
    }
  }

  return (
    <div
      ref={pageRef}
      className={`practice-page ${isTablet ? 'is-tablet' : isPortrait ? 'is-portrait' : 'is-phone'} ${seekBarHeight > 0 ? 'has-midi-seek' : ''}`}
      style={{
        width: `${vpLayout.viewportWidth}px`,
        height: `${vpLayout.viewportHeight}px`,
      }}
    >
      {/* 1. 標題列 */}
      <header
        className="practice-header"
        style={{ height: `${vpLayout.headerHeight}px` }}
      >
        <button
          type="button"
          className="practice-back-btn"
          aria-label="返回"
          onClick={handleBackClick}
        >
          ‹
        </button>

        {isMidiMode ? (
          <div className="practice-midi-title" title={songTitle}>
            <span className="practice-midi-song">{songTitle}</span>
            <span className="practice-midi-key">{keyName(activeKey)}</span>
          </div>
        ) : (
          <>
            {!isPortrait && onlySelectedButton}

            <KeyStrip
              keys={fullKeys}
              activeFullKeyIndex={activeFullKeyIndex}
              activeExerciseKeyIndex={currentKeyIndex}
              onlySelected={keySelection.onlySelected}
              selectedIndices={keySelection.selectedIndices}
              isTablet={isTablet}
              isPortrait={isPortrait}
              leadingSlot={
                isPortrait && selectedCount > 0 ? onlySelectedButton : undefined
              }
              rotationCtx={rotationCtx}
              onToggleKey={handleToggleKey}
              onJumpToKey={handleJumpToFullKey}
              onReorderSelected={handleReorderSelected}
            />
          </>
        )}

        <div className="practice-header-right">
          <ModeToggleButton
            mode={settings.mode}
            isCompact={isPortrait}
            allowShadow={!isMidiMode}
            onToggle={handleToggleMode}
          />
          {!isPortrait && (
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
          )}
          <button
            type="button"
            className={`practice-pill-btn practice-mic-btn ${isPortrait ? 'is-compact' : ''} ${micActive ? 'is-on' : ''}`}
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
            {!isPortrait && <span>麥克風</span>}
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
      <div
        className="practice-workspace"
        ref={workspaceRef}
        style={{ height: `${vpLayout.workspaceHeight}px` }}
      >
        <section
          className="sheet-paper"
          style={{ height: `${vpLayout.sheetPaperHeight}px` }}
          aria-label="譜面"
        >
          {iosHintVisible && (
            <div
              className={`ios-install-banner ${iosHintFading ? 'is-fading' : ''}`}
              role="status"
            >
              <span className="ios-install-banner-text">
                用 Safari「分享 → 加入主畫面」打開，可全螢幕練唱
              </span>
              <button
                type="button"
                className="ios-install-banner-close"
                aria-label="關閉提示"
                onClick={handleDismissIosHint}
              >
                ✕
              </button>
            </div>
          )}

          {(errorMsg || buildError) && (
            <div className="sheet-error" role="alert">
              {errorMsg ??
                (isPatternOutOfRange ? '這個音型超出目前音域' : buildError)}
            </div>
          )}

          {screenshotToast &&
            (screenshotToast.pendingShare ? (
              <button
                type="button"
                className="screenshot-toast is-action"
                onClick={handlePendingShareClick}
              >
                {screenshotToast.message}
              </button>
            ) : (
              <div
                className={`screenshot-toast ${screenshotToast.isError ? 'is-error' : ''}`}
                role="status"
                aria-live="polite"
              >
                {screenshotToast.message}
              </div>
            ))}

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

          {accompSpeakerHintOpen && (
            <div
              className="confusion-bubble accomp-speaker-hint"
              role="status"
            >
              <span className="confusion-bubble-text">
                伴奏會被麥克風收到，建議戴耳機，判斷才準
              </span>
              <div className="confusion-bubble-actions">
                <button
                  type="button"
                  className="confusion-btn confusion-btn-primary"
                  onClick={() => setAccompSpeakerHintOpen(false)}
                >
                  知道了
                </button>
              </div>
            </div>
          )}

          {autoCalibBanner && (
            <div
              className={`auto-calib-toast is-${autoCalibBanner.tone}`}
              role="status"
              aria-live="polite"
            >
              {autoCalibBanner.text}
            </div>
          )}

          {shadowMicHintOpen && isShadowMode && !micActive && (
            <div className="shadow-mic-hint-banner" role="status">
              <span>影子練習需要麥克風才能判斷</span>
              <div className="shadow-mic-hint-actions">
                <button
                  type="button"
                  className="shadow-mic-hint-btn"
                  onClick={() => void handleToggleMic()}
                >
                  開啟麥克風
                </button>
                <button
                  type="button"
                  className="shadow-mic-hint-close"
                  aria-label="關閉提示"
                  onClick={() => setShadowMicHintOpen(false)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {shadowPassBanner && isShadowMode && (
            <div
              className="shadow-pass-summary-banner"
              role="status"
              aria-live="polite"
            >
              {shadowPassBanner}
            </div>
          )}

          {showLyrics && passLyrics && (
            <LyricsStrip
              lines={passLyrics.lines}
              passSec={Math.max(0, displaySec - activePassStart)}
              leadSec={settings.lyricsLeadSec}
              lyricsScale={settings.lyricsScale}
              twoLines={lyricsTwoLines}
              isTablet={isTablet}
              height={lyricsBandHeight}
            />
          )}

          <div
            className={`sheet-score-area ${isMidiMode ? 'is-midi' : ''} ${scrubPreviewSec !== null ? 'is-scrubbing' : ''}`}
            ref={scoreAreaRef}
            style={{ height: `${vpLayout.scoreAreaHeight}px` }}
            onPointerDown={isMidiMode ? handleScorePointerDown : undefined}
            onPointerMove={isMidiMode ? handleScorePointerMove : undefined}
            onPointerUp={isMidiMode ? handleScorePointerUp : undefined}
            onPointerCancel={isMidiMode ? handleScorePointerCancel : undefined}
            onContextMenu={
              isMidiMode ? (e) => e.preventDefault() : undefined
            }
          >
            {renderedLines.map((item, lineIdx) => (
              <div
                key={`score-line-${lineIdx}`}
                className={`score-line ${
                  item.line.isCurrent ? 'is-current' : ''
                } ${item.isPreviewLine ? 'is-preview' : ''}`}
                style={{ height: `${vpLayout.lineHeight}px` }}
              >
                {/* 目前音淡藍色直條（僅出現在正在唱的那一行） */}
                {item.activeNoteX !== null && (
                  <div
                    className="score-active-band"
                    style={{ left: `${item.activeNoteX}px` }}
                    aria-hidden="true"
                  />
                )}

                {/* 播放位置藍色虛線／MIDI 直線游標（僅出現在正在唱的那一行） */}
                {item.playheadX !== null && (
                  <div
                    className={`score-playhead ${isMidiMode ? 'is-midi' : ''}`}
                    style={{ left: `${item.playheadX}px` }}
                    aria-hidden="true"
                  />
                )}

                <JianpuStrip
                  glyphs={item.glyphs}
                  activeIndex={item.activeNoteIdx}
                  sec={item.line.isCurrent ? displaySec : -1}
                  activeKey={item.lineKey}
                  tonicMidi={item.lineTonicMidi}
                  jianpuMode={settings.jianpuMode}
                  isTablet={isTablet}
                  isPortrait={isPortrait}
                  previewLabel={item.isPreviewLine ? item.lineLabel : null}
                  lineLabel={item.lineLabel}
                  octaveTag={
                    !item.isPreviewLine && !item.line.isSamePassContinuation
                      ? octaveTag
                      : null
                  }
                  height={vpLayout.jianpuHeight}
                  extraMarkers={item.midiData?.jianpuMarkers}
                  underlineSegments={item.midiData?.jianpuUnderlineSegments}
                  minNoteSpacingPx={item.midiData?.minNoteSpacingPx}
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
                  liveSung={liveSungByLine[lineIdx] ?? EMPTY_SUNG}
                  pitchColor={settings.staffPitchColor}
                  countIn={
                    item.line.isCurrent
                      ? countIn
                      : { active: false, dots: [] }
                  }
                  shadowResults={item.shadowResults}
                  isTablet={isTablet}
                  midiData={item.midiData}
                  sec={item.line.isCurrent ? displaySec : undefined}
                  introCountdownBars={item.introCountdownBars}
                  isCurrentLine={item.line.isCurrent}
                  loopStartBar={isMidiMode ? midiLoopBars.loopStartBar : undefined}
                  loopEndBar={isMidiMode ? midiLoopBars.loopEndBar : undefined}
                  flashBarNumber={isMidiMode ? flashBarNumber : undefined}
                />
              </div>
            ))}
          </div>
        </section>

        {/* 把手列：2px 細線，拖動調整高度、點一下收合／展開 */}
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
          <span className="piano-handle-line" aria-hidden="true" />
        </div>

        {/* 3. 對音鋼琴 */}
        <PianoKeyboard
          centerMidi={tonicMidi}
          targetMidi={targetMidi}
          sungMidi={sungMidi}
          needleColor={settings.pianoNeedleColor}
          height={effectivePianoH}
          collapsed={isPianoCollapsed}
          isTablet={isTablet}
          isPortrait={isPortrait}
          rotationCtx={rotationCtx}
          engine={engine}
          onAudioError={setErrorMsg}
          onPressedMidisChange={handlePressedMidisChange}
        />
      </div>

      {/* 4. MIDI 進度拉桿 + 播放列 + MIDI 混音器 */}
      {isMidiMode && exercise && midiScoreBars.length > 0 && midiSource && (
        <MidiSeekBar
          scoreBars={midiScoreBars}
          startBar={midiSource.songSettings.startBar}
          endBar={midiSource.songSettings.endBar}
          activePassStart={activePassStart}
          totalPassDur={totalPassDur}
          sec={displaySec}
          passLyrics={showLyrics && passLyrics ? passLyrics.lines : []}
          isTablet={isTablet}
          height={seekBarHeight}
          loopStartBar={midiLoopBars.loopStartBar}
          loopEndBar={midiLoopBars.loopEndBar}
          onSeek={handleMidiSeek}
        />
      )}
      {isMidiMode && (
        <MidiMixerPopover
          open={mixerOpen}
          mixer={midiMixer}
          hasAccompTracks={Boolean(midiMixLayers?.hasAccompTracks)}
          hasRhythmTracks={Boolean(midiMixLayers?.hasRhythmTracks)}
          onChange={(nextMixer: MidiMixerSettings) => {
            if (midiSource && onUpdateMidiSongSettings) {
              onUpdateMidiSongSettings(midiSource.hash, {
                ...midiSource.songSettings,
                mixer: nextMixer,
              });
            }
          }}
          onClose={() => setMixerOpen(false)}
        />
      )}
      <TransportBar
        playing={playing}
        canPrevKey={isMidiMode ? midiPageIdx > 0 : currentKeyIndex > 0}
        canNextKey={
          isMidiMode
            ? midiPageIdx < midiPages.length - 1
            : currentKeyIndex < totalKeys - 1
        }
        hasExercise={exercise !== null}
        patternName={songTitle}
        repeatsPerKey={settings.repeatsPerKey}
        currentPass={currentPassNum}
        bpm={effectiveBpm}
        metronome={effectiveMetronome}
        firstBeat={exercise?.clicks[0]?.t ?? 0}
        transposeOffset={
          isMidiMode && midiSource
            ? midiSource.songSettings.transposeSemitones
            : transposeOffset
        }
        canTransposeDown={
          isMidiMode && midiSource
            ? midiSource.songSettings.transposeSemitones > -12
            : canTransposeDown
        }
        canTransposeUp={
          isMidiMode && midiSource
            ? midiSource.songSettings.transposeSemitones < 12
            : canTransposeUp
        }
        boundaryToast={boundaryToast}
        pianoDuringSing={settings.pianoDuringSing}
        isTablet={isTablet}
        isPortrait={isPortrait}
        titleHeight={portraitLayout?.patternTitleHeight}
        height={vpLayout.transportHeight}
        getSec={getExtrapolatedSec}
        canScreenshot={canTakeScreenshot}
        showMixerButton={isMidiMode}
        mixerOpen={mixerOpen}
        onToggleMixer={() => setMixerOpen((v) => !v)}
        showAbLoop={isMidiMode}
        loopStartBar={midiLoopBars.loopStartBar}
        loopEndBar={midiLoopBars.loopEndBar}
        onToggleLoopA={handleToggleLoopA}
        onToggleLoopB={handleToggleLoopB}
        onClearLoopAB={handleClearLoopAB}
        onPrevKey={handlePrevKey}
        onPlayPause={handlePlayPause}
        onScreenshot={handleScreenshot}
        onNextKey={handleNextKey}
        onCycleRepeats={handleCycleRepeats}
        onToggleMetronome={() => {
          if (isMidiMode) {
            if (playing || sec > 0) {
              pendingSeekRef.current = {
                sec: getExtrapolatedSec(),
                resumePlay: playing,
              };
            }
            setMidiMetronomeOverride(!effectiveMetronome);
          } else {
            onUpdateSettings({ metronome: !settings.metronome });
          }
        }}
        onBpmStep={handleBpmStep}
        onBpmChange={handleBpmChange}
        onBpmReset={handleBpmReset}
        onBpmEditingChange={handleBpmEditingChange}
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
        getDiagnostics={getDiagnostics}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function songSettingsEqualIgnoringMixerAndLoop(
  a: MidiPracticeSource['songSettings'],
  b: MidiPracticeSource['songSettings'],
): boolean {
  if (a === b) return true;
  const {
    mixer: _ma,
    loopStartBar: _la,
    loopEndBar: _lb,
    ...restA
  } = a;
  const {
    mixer: _mb,
    loopStartBar: _lc,
    loopEndBar: _ld,
    ...restB
  } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

/** 兩個 MIDI 練唱來源除了混音器與 A–B 循環設定外是否完全相同 */
function isSameMidiSourceIgnoringMixerAndLoop(
  a: MidiPracticeSource,
  b: MidiPracticeSource,
): boolean {
  return (
    a.id === b.id &&
    a.hash === b.hash &&
    a.name === b.name &&
    a.asset === b.asset &&
    a.importedLyrics === b.importedLyrics &&
    songSettingsEqualIgnoringMixerAndLoop(a.songSettings, b.songSettings)
  );
}
