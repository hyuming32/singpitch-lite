import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PracticeLogEntry } from '../core/practiceLog';
import { createLyricsStore } from '../state/lyricsStore';
import {
  createMidiStore,
  saveMidiSongSettings,
  type MidiSongSettings,
} from '../state/midiLibrary';
import { createPracticeLogStore } from '../state/practiceLogStore';
import {
  loadSettings,
  saveSettings,
  type PracticeSettings,
} from '../state/settings';
import { AudioProvider } from './AudioContext';
import {
  buildMidiSourceFromEntry,
  buildPracticePageKey,
  shouldRestoreMidiPractice,
  type ActivePracticeSession,
  type AppRoute,
} from './appPracticeState';
import { ErrorBoundary } from './ErrorBoundary';
import { PracticeLogPage } from './log/PracticeLogPage';
import { MidiPage, type MidiPracticeSource } from './midi/MidiPage';
import { PatternMenu } from './PatternMenu';
import { PracticePage } from './practice/PracticePage';

const ACTIVE_PRACTICE_SESSION_KEY = 'singpitch-lite.active-practice.v1';

function readPracticeSession(): ActivePracticeSession | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(ACTIVE_PRACTICE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivePracticeSession>;
    if (parsed.mode === 'midi' && typeof parsed.id === 'string') {
      return {
        mode: 'midi',
        id: parsed.id,
        ...(typeof parsed.hash === 'string' ? { hash: parsed.hash } : {}),
        ...(typeof parsed.startBar === 'number'
          ? { startBar: parsed.startBar }
          : {}),
        ...(typeof parsed.endBar === 'number'
          ? { endBar: parsed.endBar }
          : {}),
      };
    }
    if (parsed.mode === 'scale') {
      return { mode: 'scale' };
    }
    return null;
  } catch {
    return null;
  }
}

function writePracticeSession(session: ActivePracticeSession): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(
        ACTIVE_PRACTICE_SESSION_KEY,
        JSON.stringify(session),
      );
    }
  } catch {
    // 忽略 sessionStorage 存取錯誤
  }
}

function parseHashRoute(hash: string): AppRoute {
  const cleaned = hash.replace(/^#/, '');
  if (cleaned === '/practice') return 'practice';
  if (cleaned === '/midi') return 'midi';
  if (cleaned === '/log') return 'log';
  return 'scale';
}

function navigateTo(route: AppRoute): void {
  const target =
    route === 'scale'
      ? '#/'
      : route === 'practice'
        ? '#/practice'
        : route === 'midi'
          ? '#/midi'
          : '#/log';
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

/** 應用程式主外框（含 Hash 路由、雙平台導覽列與全域設定面板） */
export function AppShell() {
  const [route, setRoute] = useState<AppRoute>(() =>
    parseHashRoute(window.location.hash),
  );
  const [settings, setSettings] = useState<PracticeSettings>(() => loadSettings());
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [clearLogStep, setClearLogStep] = useState<0 | 1 | 2>(0);
  const [clearLogNotice, setClearLogNotice] = useState(false);
  const [logReloadToken, setLogReloadToken] = useState(0);
  const [customNoticeOpen, setCustomNoticeOpen] = useState(false);
  const logStore = useMemo(() => createPracticeLogStore(), []);
  const midiStore = useMemo(() => createMidiStore(), []);
  const lyricsStore = useMemo(() => createLyricsStore(), []);
  const [practiceSource, setPracticeSource] = useState<'scale' | 'midi'>(() => {
    const sess = readPracticeSession();
    return sess?.mode === 'midi' ? 'midi' : 'scale';
  });
  const [activeMidiSource, setActiveMidiSource] =
    useState<MidiPracticeSource | null>(null);
  const [practiceMountSeq, setPracticeMountSeq] = useState(0);
  const [midiRestoreNotice, setMidiRestoreNotice] = useState<string | null>(null);

  const currentSession = readPracticeSession();
  const restoringMidi = shouldRestoreMidiPractice({
    route,
    practiceSource,
    activeMidiSource,
    session: currentSession,
  });

  // 進入 #/practice（含重新整理與紀錄頁「再練一次」）時，若為 MIDI 練唱則從 IndexedDB 載回
  useEffect(() => {
    if (route !== 'practice' || practiceSource !== 'midi' || activeMidiSource !== null) {
      return;
    }
    const sess = readPracticeSession();
    if (!sess || sess.mode !== 'midi' || !sess.id) {
      setPracticeSource('scale');
      return;
    }

    let cancelled = false;

    const loadMidiEntry = async () => {
      let entry = await midiStore.get(sess.id!);
      if (!entry && sess.hash) {
        const list = await midiStore.list();
        const byHash = list.find((m) => m.hash === sess.hash);
        if (byHash) {
          entry = await midiStore.get(byHash.id);
        }
      }
      if (!entry) return null;
      const importedLyrics = await lyricsStore.get(entry.id).catch(() => null);
      return { entry, importedLyrics };
    };

    loadMidiEntry()
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          writePracticeSession({ mode: 'scale' });
          setPracticeSource('scale');
          setMidiRestoreNotice('找不到對應的 MIDI 檔案，已返回 MIDI 練唱。');
          navigateTo('midi');
          return;
        }
        try {
          const source = buildMidiSourceFromEntry(loaded.entry, sess);
          setMidiRestoreNotice(null);
          setActiveMidiSource({
            ...source,
            importedLyrics: loaded.importedLyrics,
          });
        } catch {
          writePracticeSession({ mode: 'scale' });
          setPracticeSource('scale');
          setMidiRestoreNotice('載入 MIDI 檔案失敗，已返回 MIDI 練唱。');
          navigateTo('midi');
        }
      })
      .catch(() => {
        if (!cancelled) {
          writePracticeSession({ mode: 'scale' });
          setPracticeSource('scale');
          setMidiRestoreNotice('載入 MIDI 檔案失敗，已返回 MIDI 練唱。');
          navigateTo('midi');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [route, practiceSource, activeMidiSource, midiStore, lyricsStore]);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#/';
    }
    const onHashChange = () => {
      setRoute(parseHashRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleUpdateSettings = useCallback((patch: Partial<PracticeSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const handleShowCustomNotice = useCallback(() => {
    setCustomNoticeOpen(true);
    window.setTimeout(() => {
      setCustomNoticeOpen(false);
    }, 2400);
  }, []);

  const handleStartMidiPractice = useCallback((source: MidiPracticeSource) => {
    setMidiRestoreNotice(null);
    setActiveMidiSource(source);
    setPracticeSource('midi');
    setPracticeMountSeq((n) => n + 1);
    writePracticeSession({
      mode: 'midi',
      id: source.id,
      hash: source.hash,
      startBar: source.songSettings.startBar,
      endBar: source.songSettings.endBar,
    });
    navigateTo('practice');
  }, []);

  const handleReplayLogEntry = useCallback(
    (entry: PracticeLogEntry) => {
      if (entry.source.kind === 'scale') {
        handleUpdateSettings({
          patternId: entry.source.patternId,
          mode: entry.mode,
        });
        setActiveMidiSource(null);
        setPracticeSource('scale');
        setPracticeMountSeq((n) => n + 1);
        writePracticeSession({ mode: 'scale' });
        navigateTo('practice');
        return;
      }

      handleUpdateSettings({ mode: entry.mode });
      setMidiRestoreNotice(null);
      setActiveMidiSource(null);
      setPracticeSource('midi');
      setPracticeMountSeq((n) => n + 1);
      writePracticeSession({
        mode: 'midi',
        id: entry.source.midiId,
        hash: entry.source.midiHash,
        startBar: entry.source.startBar,
        endBar: entry.source.endBar,
      });
      navigateTo('practice');
    },
    [handleUpdateSettings],
  );

  const handleUpdateMidiSongSettings = useCallback(
    (hash: string, next: MidiSongSettings) => {
      saveMidiSongSettings(hash, next);
      setActiveMidiSource((prev) => {
        if (!prev || prev.hash !== hash) return prev;
        writePracticeSession({
          mode: 'midi',
          id: prev.id,
          hash: prev.hash,
          startBar: next.startBar,
          endBar: next.endBar,
        });
        return { ...prev, songSettings: next };
      });
    },
    [],
  );

  if (route === 'practice') {
    if (restoringMidi) {
      return (
        <AudioProvider>
          <div className="app-shell is-practice">
            <div className="practice-loading-state" role="status">
              載入中…
            </div>
          </div>
        </AudioProvider>
      );
    }
    const isMidiPractice =
      practiceSource === 'midi' && activeMidiSource !== null;
    const practicePageKey = buildPracticePageKey({
      mountSeq: practiceMountSeq,
      practiceSource,
      midiSource: isMidiPractice ? activeMidiSource : null,
      patternId: settings.patternId,
    });
    return (
      <AudioProvider>
        <div className="app-shell is-practice">
          <ErrorBoundary label="PracticePage">
            <PracticePage
              key={practicePageKey}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              midiSource={isMidiPractice ? activeMidiSource : null}
              onUpdateMidiSongSettings={handleUpdateMidiSongSettings}
              practiceLogStore={logStore}
              onBack={() => navigateTo(isMidiPractice ? 'midi' : 'scale')}
            />
          </ErrorBoundary>
        </div>
      </AudioProvider>
    );
  }

  return (
    <AudioProvider>
      <div className="app-shell">
        {/* 平板／桌面頂列 64px */}
        <header className="desktop-topbar">
          <div className="topbar-left">
            <span className="brand-title">
              <img
                src="./icon-192.png"
                alt=""
                className="brand-icon"
                width={32}
                height={32}
              />
              <span>
                SingPitch<span className="brand-accent">-Lite</span>
              </span>
            </span>
            <nav className="desktop-nav" aria-label="主要功能">
              <button
                type="button"
                className={`nav-tab ${route === 'scale' ? 'is-active' : ''}`}
                onClick={() => navigateTo('scale')}
              >
                音階練習
              </button>
              <button
                type="button"
                className={`nav-tab ${route === 'midi' ? 'is-active' : ''}`}
                onClick={() => navigateTo('midi')}
              >
                MIDI 練唱
              </button>
              <button
                type="button"
                className={`nav-tab ${route === 'log' ? 'is-active' : ''}`}
                onClick={() => navigateTo('log')}
              >
                練習紀錄
              </button>
            </nav>
          </div>
          <div className="topbar-right">
            <span className="mic-status">
              <span className="mic-dot" aria-hidden="true" />
              麥克風未啟用
            </span>
            <button
              type="button"
              className="gear-btn"
              aria-label="設定"
              onClick={() => setGlobalSettingsOpen(true)}
            >
              ⚙
            </button>
          </div>
        </header>

        {/* 手機版頂列 52px + 安全區 */}
        <header className="mobile-topbar">
          <h1 className="mobile-topbar-title">
            {route === 'scale'
              ? '音階練習'
              : route === 'midi'
                ? 'MIDI 練唱'
                : '練習紀錄'}
          </h1>
          <div className="mobile-topbar-actions">
            {customNoticeOpen && (
              <span className="mobile-toast" role="status">
                第 6 步開放
              </span>
            )}
            {route === 'scale' && (
              <button
                type="button"
                className="mobile-add-btn"
                aria-label="自訂圖案"
                onClick={handleShowCustomNotice}
              >
                ＋
              </button>
            )}
            {route === 'log' && (
              <button
                type="button"
                className="gear-btn"
                aria-label="設定"
                onClick={() => setGlobalSettingsOpen(true)}
              >
                ⚙
              </button>
            )}
          </div>
        </header>

        {/* 主內容區 */}
        <main className="app-content">
          {route === 'scale' && (
            <PatternMenu
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onStartPractice={() => {
                setActiveMidiSource(null);
                setPracticeSource('scale');
                setPracticeMountSeq((n) => n + 1);
                writePracticeSession({ mode: 'scale' });
                navigateTo('practice');
              }}
              customNoticeOpen={customNoticeOpen}
              onShowCustomNotice={handleShowCustomNotice}
            />
          )}

          {route === 'midi' && (
            <>
              {midiRestoreNotice && (
                <div className="midi-restore-notice" role="status">
                  <span>{midiRestoreNotice}</span>
                  <button
                    type="button"
                    className="midi-restore-dismiss"
                    onClick={() => setMidiRestoreNotice(null)}
                  >
                    關閉
                  </button>
                </div>
              )}
              <MidiPage
                settings={settings}
                onUpdateSettings={handleUpdateSettings}
                onStartMidiPractice={handleStartMidiPractice}
                initialSource={activeMidiSource}
                store={midiStore}
                lyricsStore={lyricsStore}
              />
            </>
          )}

          {route === 'log' && (
            <PracticeLogPage
              logStore={logStore}
              midiStore={midiStore}
              onReplayEntry={(entry) => void handleReplayLogEntry(entry)}
              reloadToken={logReloadToken}
            />
          )}
        </main>

        {/* 手機版底部分頁列 */}
        <nav className="mobile-tabbar" aria-label="底部分頁">
          <button
            type="button"
            className={`mobile-tab ${route === 'scale' ? 'is-active' : ''}`}
            onClick={() => navigateTo('scale')}
          >
            音階
          </button>
          <button
            type="button"
            className={`mobile-tab ${route === 'midi' ? 'is-active' : ''}`}
            onClick={() => navigateTo('midi')}
          >
            MIDI
          </button>
          <button
            type="button"
            className={`mobile-tab ${route === 'log' ? 'is-active' : ''}`}
            onClick={() => navigateTo('log')}
          >
            紀錄
          </button>
        </nav>

        {/* 全域設定面板 */}
        {globalSettingsOpen && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="全域設定"
            onClick={() => {
              setGlobalSettingsOpen(false);
              setClearLogStep(0);
            }}
          >
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>全域設定</h2>
                <button
                  type="button"
                  className="sheet-close-btn"
                  onClick={() => {
                    setGlobalSettingsOpen(false);
                    setClearLogStep(0);
                  }}
                >
                  關閉
                </button>
              </div>
              <div className="modal-section">
                <h3 className="modal-section-title">練習紀錄資料</h3>
                {clearLogStep === 0 && (
                  <button
                    type="button"
                    className="log-clear-all-btn"
                    onClick={() => {
                      setClearLogNotice(false);
                      setClearLogStep(1);
                    }}
                  >
                    清除全部紀錄
                  </button>
                )}
                {clearLogStep === 1 && (
                  <div className="log-clear-confirm-box">
                    <p>確定要清除所有練習紀錄嗎？此動作無法復原。</p>
                    <div className="log-clear-confirm-actions">
                      <button
                        type="button"
                        className="log-clear-danger-btn"
                        onClick={() => setClearLogStep(2)}
                      >
                        確定清除
                      </button>
                      <button
                        type="button"
                        className="log-clear-cancel-btn"
                        onClick={() => setClearLogStep(0)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                {clearLogStep === 2 && (
                  <div className="log-clear-confirm-box">
                    <p>請再次確認：真的要永久刪除全部練習紀錄嗎？</p>
                    <div className="log-clear-confirm-actions">
                      <button
                        type="button"
                        className="log-clear-danger-btn"
                        onClick={async () => {
                          await logStore.clear();
                          setClearLogStep(0);
                          setClearLogNotice(true);
                          setLogReloadToken((t) => t + 1);
                        }}
                      >
                        永久刪除
                      </button>
                      <button
                        type="button"
                        className="log-clear-cancel-btn"
                        onClick={() => setClearLogStep(0)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                {clearLogNotice && (
                  <p className="log-clear-done" role="status">
                    已清除全部練習紀錄
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AudioProvider>
  );
}
