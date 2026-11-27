import { useCallback, useEffect, useState } from 'react';
import {
  loadSettings,
  saveSettings,
  type PracticeSettings,
} from '../state/settings';
import { AudioProvider } from './AudioContext';
import { ErrorBoundary } from './ErrorBoundary';
import { PatternMenu } from './PatternMenu';
import { PracticePage } from './practice/PracticePage';

type AppRoute = 'scale' | 'practice' | 'midi' | 'log';

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
  const [customNoticeOpen, setCustomNoticeOpen] = useState(false);

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

  if (route === 'practice') {
    return (
      <AudioProvider>
        <div className="app-shell is-practice">
          <ErrorBoundary label="PracticePage">
            <PracticePage
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onBack={() => navigateTo('scale')}
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
          </div>
        </header>

        {/* 主內容區 */}
        <main className="app-content">
          {route === 'scale' && (
            <PatternMenu
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              onStartPractice={() => navigateTo('practice')}
              customNoticeOpen={customNoticeOpen}
              onShowCustomNotice={handleShowCustomNotice}
            />
          )}

          {route === 'midi' && (
            <section className="coming-soon-page">
              <h2>MIDI 練唱</h2>
              <p>即將推出</p>
            </section>
          )}

          {route === 'log' && (
            <section className="coming-soon-page">
              <h2>練習紀錄</h2>
              <p>即將推出</p>
            </section>
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

        {/* 齒輪空設定面板 */}
        {globalSettingsOpen && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="全域設定"
            onClick={() => setGlobalSettingsOpen(false)}
          >
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>全域設定</h2>
                <button
                  type="button"
                  className="sheet-close-btn"
                  onClick={() => setGlobalSettingsOpen(false)}
                >
                  關閉
                </button>
              </div>
              <p className="modal-placeholder-text">設定項目將於後續步驟加入。</p>
            </div>
          </div>
        )}
      </div>
    </AudioProvider>
  );
}
