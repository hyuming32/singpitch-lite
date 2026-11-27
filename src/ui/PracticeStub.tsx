import { useEffect, useMemo, useState } from 'react';
import { buildExercise, type Exercise } from '../core/exercise';
import { keyName, type Key } from '../core/key';
import { BUILTIN_PATTERNS } from '../core/patterns';
import { toExerciseOptions, type PracticeSettings } from '../state/settings';
import { useAudioEngine } from './AudioContext';
import { JianpuLine } from './JianpuLine';
import { buildJianpuTokens } from './miniStaffData';

interface PracticeStubProps {
  settings: PracticeSettings;
  onBack: () => void;
}

const C_MAJOR_KEY: Key = { tonicPc: 0, mode: 'major' };

/** 練唱佔位頁（第 2c 步將擴充為完整即時音準偵測與譜面） */
export function PracticeStub({ settings, onBack }: PracticeStubProps) {
  const engine = useAudioEngine();
  const [sec, setSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pattern = useMemo(
    () =>
      BUILTIN_PATTERNS.find((p) => p.id === settings.patternId) ??
      BUILTIN_PATTERNS[0]!,
    [settings.patternId],
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

  const currentKeyIndex = useMemo(() => {
    if (!exercise || exercise.keys.length === 0) {
      return 0;
    }
    for (let i = exercise.keys.length - 1; i >= 0; i--) {
      if (sec >= exercise.keys[i]!.start - 0.01) {
        return i;
      }
    }
    return 0;
  }, [exercise, sec]);

  useEffect(() => {
    const unsubPos = engine.onPosition((s, isPlaying) => {
      setSec(s);
      setPlaying(isPlaying);
    });
    const unsubEnd = engine.onEnded(() => {
      setPlaying(false);
    });
    return () => {
      unsubPos();
      unsubEnd();
      engine.stop();
    };
  }, [engine]);

  useEffect(() => {
    if (!exercise) {
      return;
    }
    engine.setA4(settings.a4);
    engine.load(exercise, {
      pianoDuringSing: settings.pianoDuringSing,
      pad: settings.pad,
      click: settings.countIn,
      voiceForGlide: true,
    });
  }, [engine, exercise, settings.a4, settings.pianoDuringSing, settings.pad, settings.countIn]);

  async function handlePlayPause() {
    if (playing) {
      engine.pause();
      return;
    }
    if (!exercise) {
      return;
    }
    try {
      setErrorMsg(null);
      await engine.unlock();
      await engine.init();
      await engine.unlock();
      engine.setA4(settings.a4);
      engine.load(exercise, {
        pianoDuringSing: settings.pianoDuringSing,
        pad: settings.pad,
        click: settings.countIn,
        voiceForGlide: true,
      });
      engine.play();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function handleStop() {
    engine.stop();
    setPlaying(false);
  }

  function handlePrevKey() {
    if (!exercise) return;
    const prev = Math.max(0, currentKeyIndex - 1);
    engine.seekToKey(prev);
  }

  function handleNextKey() {
    if (!exercise) return;
    const next = Math.min(exercise.keys.length - 1, currentKeyIndex + 1);
    engine.seekToKey(next);
  }

  function handleBackClick() {
    engine.stop();
    onBack();
  }

  const totalKeys = exercise?.keys.length ?? 0;
  const activeKey = exercise?.keys[currentKeyIndex];
  const displayKeyLabel = activeKey
    ? `${keyName(activeKey.key)} · ${currentKeyIndex + 1}/${totalKeys}`
    : '—';

  const jianpuTokens = useMemo(
    () =>
      buildJianpuTokens(
        pattern,
        activeKey?.tonicMidi ?? settings.startTonic,
        activeKey?.key ?? C_MAJOR_KEY,
        settings.jianpuMode,
      ),
    [pattern, activeKey, settings.startTonic, settings.jianpuMode],
  );

  return (
    <div className="practice-stub">
      <div className="portrait-hint-banner">建議將手機轉成橫放</div>

      <header className="practice-topbar">
        <button type="button" className="back-btn" onClick={handleBackClick}>
          ‹ 返回
        </button>
        <h1 className="practice-title">{pattern.name}</h1>
        <div className="practice-key-badge">{displayKeyLabel}</div>
      </header>

      {(errorMsg || buildError) && (
        <div className="practice-error" role="alert">
          {errorMsg ?? buildError}
        </div>
      )}

      <main className="practice-stage">
        <div className="practice-jianpu-display">
          <JianpuLine tokens={jianpuTokens} />
        </div>
        <div className="practice-time-hint">
          {sec.toFixed(1)}s / {(exercise?.total ?? 0).toFixed(1)}s
        </div>
      </main>

      <footer className="practice-controls">
        <button
          type="button"
          className="transport-btn"
          aria-label="上一調"
          disabled={!exercise || currentKeyIndex <= 0}
          onClick={handlePrevKey}
        >
          ⏮
        </button>
        <button
          type="button"
          className="transport-btn transport-btn-primary"
          aria-label={playing ? '暫停' : '播放'}
          disabled={!exercise}
          onClick={handlePlayPause}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="transport-btn"
          aria-label="下一調"
          disabled={!exercise || currentKeyIndex >= totalKeys - 1}
          onClick={handleNextKey}
        >
          ⏭
        </button>
        <button
          type="button"
          className="transport-btn"
          aria-label="停止"
          disabled={!exercise}
          onClick={handleStop}
        >
          ■
        </button>
      </footer>
    </div>
  );
}
