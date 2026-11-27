import { useEffect, useRef, useState } from 'react';
import type { MicDiagnostics } from '../../mic/micController';
import {
  clearErrorLogs,
  loadErrorLogs,
  type ErrorLogEntry,
} from '../../state/errlog';
import type { MicInputMode, PracticeSettings } from '../../state/settings';
import { displayNoteName } from '../noteLabel';
import {
  useNoiseCalibration,
  type NoiseGateResult,
} from './useNoiseCalibration';

export interface PracticeDiagnosticsSnapshot {
  mic: MicDiagnostics;
  outputLatencySec: number;
  recentHz: number | null;
  recentMidi: number | null;
  standalone: boolean;
}

interface PracticeSettingsSheetProps {
  open: boolean;
  isTablet: boolean;
  settings: PracticeSettings;
  micActive: boolean;
  liveDb: number | null;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onEnsureMicForCalibration: () => Promise<boolean>;
  getDiagnostics: () => PracticeDiagnosticsSnapshot;
  onClose: () => void;
}

const DB_MIN = -80;
const DB_MAX = 0;

const PITCH_COLOR_SWATCHES = [
  { value: '#e8b400', label: '黃' },
  { value: '#0047ff', label: '藍' },
  { value: '#e5383b', label: '紅' },
  { value: '#1f9d55', label: '綠' },
  { value: '#8b3dff', label: '紫' },
  { value: '#222222', label: '黑' },
] as const;

function dbToPercent(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
}

function formatDiagRate(rate: number | null | undefined): string {
  return rate !== null && rate !== undefined && Number.isFinite(rate)
    ? `${rate} Hz`
    : '無';
}

function formatDiagnosticsClipboardText(
  snap: PracticeDiagnosticsSnapshot | null,
  errLogs: readonly ErrorLogEntry[],
): string {
  const payload = {
    capturedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    standalone: snap?.standalone ?? false,
    ctxSampleRate: snap?.mic.ctxSampleRate ?? null,
    trackSampleRate: snap?.mic.trackSampleRate ?? null,
    workletSampleRate: snap?.mic.workletSampleRate ?? null,
    measuredSamplesPerSec: snap?.mic.measuredSamplesPerSec ?? null,
    effectiveRate: snap?.mic.effectiveRate ?? null,
    rateCorrected: snap?.mic.rateCorrected ?? false,
    outputLatencySec: snap?.outputLatencySec ?? 0,
    inputLatencySec: snap?.mic.inputLatencySec ?? 0,
    recentHz: snap?.recentHz ?? null,
    recentMidi: snap?.recentMidi ?? null,
    errorLogs: errLogs.slice(-5).reverse(),
  };
  return JSON.stringify(payload, null, 2);
}

/** 練唱頁 ⚙ 設定面板：iPhone 用全螢幕 sheet、iPad 用右側面板 */
export function PracticeSettingsSheet({
  open,
  isTablet,
  settings,
  micActive,
  liveDb,
  onUpdateSettings,
  onEnsureMicForCalibration,
  getDiagnostics,
  onClose,
}: PracticeSettingsSheetProps) {
  const [calibMsg, setCalibMsg] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagSnap, setDiagSnap] = useState<PracticeDiagnosticsSnapshot | null>(
    null,
  );
  const [errLogs, setErrLogs] = useState<ErrorLogEntry[]>(() =>
    loadErrorLogs(),
  );
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const copyTimerRef = useRef<number | null>(null);

  const { calibrating, startCalibration } = useNoiseCalibration({
    liveDb,
    onComplete: (result: NoiseGateResult) => {
      if (!result.ok) {
        setCalibMsg({
          text:
            result.reason === 'empty'
              ? '未收到麥克風音量資料，請稍後再試'
              : '環境太吵（建議門檻超過 −30 dB），未變更設定',
          isError: true,
        });
        return;
      }
      onUpdateSettings({ noiseGateDb: result.gateDb, noiseCalibrated: true });
      setCalibMsg({
        text: `已設定噪音門檻為 ${result.gateDb} dB`,
        isError: false,
      });
    },
  });

  useEffect(() => {
    if (!open || !diagOpen) {
      return;
    }
    const refresh = () => {
      setDiagSnap(getDiagnostics());
      setErrLogs(loadErrorLogs());
    };
    refresh();
    const id = window.setInterval(refresh, 300);
    return () => window.clearInterval(id);
  }, [open, diagOpen, getDiagnostics]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  async function handleCalibrateNoise() {
    if (calibrating) return;
    setCalibMsg(null);

    if (!micActive) {
      const ok = await onEnsureMicForCalibration();
      if (!ok) {
        setCalibMsg({
          text: '無法開啟麥克風，請先允許權限再校正',
          isError: true,
        });
        return;
      }
    }

    startCalibration();
  }

  function handleClearErrors() {
    clearErrorLogs();
    setErrLogs([]);
  }

  async function handleCopyDiagnostics() {
    const snap = getDiagnostics();
    const logs = loadErrorLogs();
    setDiagSnap(snap);
    setErrLogs(logs);
    const text = formatDiagnosticsClipboardText(snap, logs);
    let ok = false;
    try {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopyMsg(ok ? '已複製診斷資訊' : '複製失敗');
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopyMsg(null);
    }, 2000);
  }

  const meterPercent =
    micActive && liveDb !== null && Number.isFinite(liveDb)
      ? dbToPercent(liveDb)
      : 0;
  const gatePercent = dbToPercent(settings.noiseGateDb);
  const clampedA4 = Math.max(430, Math.min(450, settings.a4));
  const recentErrors = errLogs.slice(-5).reverse();

  return (
    <div
      className={`practice-settings-backdrop ${isTablet ? 'is-tablet' : 'is-phone'}`}
      role="dialog"
      aria-modal="true"
      aria-label="練唱設定"
      onClick={onClose}
    >
      <div
        className={`practice-settings-sheet ${isTablet ? 'is-tablet' : 'is-phone'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="practice-settings-header">
          <h2>練唱設定</h2>
          <button
            type="button"
            className="sheet-close-btn"
            onClick={onClose}
          >
            關閉
          </button>
        </div>

        <div className="practice-settings-body">
          {/* 0. 錄音開關（由標題列移入，第 4 步開放） */}
          <label
            className="toggle-item practice-setting-toggle practice-rec-row"
            title="第 4 步開放"
          >
            <span className="practice-rec-label">
              <span className="rec-dot" aria-hidden="true" />
              <span>錄音（第 4 步開放）</span>
            </span>
            <input type="checkbox" checked={false} disabled readOnly />
          </label>

          {/* 1. 簡譜模式 */}
          <div className="setting-row">
            <span className="setting-label">簡譜</span>
            <div className="segmented-group">
              {(
                [
                  { value: 'fixed', label: '固定調' },
                  { value: 'movable', label: '首調' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`seg-btn ${settings.jianpuMode === opt.value ? 'is-active' : ''}`}
                  onClick={() => onUpdateSettings({ jianpuMode: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. 收音模式 */}
          <div className="setting-row">
            <span className="setting-label">收音</span>
            <div className="segmented-group">
              {(
                [
                  { value: 'speaker', label: '喇叭（自動）' },
                  { value: 'headphone', label: '耳機' },
                ] as const
              ).map((opt: { value: MicInputMode; label: string }) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`seg-btn ${settings.micMode === opt.value ? 'is-active' : ''}`}
                  onClick={() => onUpdateSettings({ micMode: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. 唱時鋼琴音量 */}
          <div className="setting-row setting-row-stack">
            <div className="setting-row-inline-head">
              <label className="setting-label" htmlFor="sing-piano-volume">
                唱時鋼琴音量
              </label>
              <span className="setting-value-badge">
                {settings.singPianoVolume}%
              </span>
            </div>
            <input
              id="sing-piano-volume"
              className="setting-range"
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.singPianoVolume}
              onChange={(e) =>
                onUpdateSettings({
                  singPianoVolume: Number(e.target.value),
                })
              }
            />
          </div>

          {/* 4. 系統回音消除（實驗） */}
          <label className="toggle-item practice-setting-toggle">
            <span>系統回音消除（實驗）</span>
            <input
              type="checkbox"
              checked={settings.echoCancellation}
              onChange={(e) =>
                onUpdateSettings({ echoCancellation: e.target.checked })
              }
            />
          </label>

          {/* 5. 麥克風音量表 + 噪音門檻線 + 校正 */}
          <div className="mic-meter-card">
            <div className="setting-row-inline-head">
              <span className="setting-label">麥克風音量</span>
              <span className="setting-value-badge">
                {micActive && liveDb !== null
                  ? `${liveDb.toFixed(1)} dB`
                  : '未開啟'}
                {' · '}門檻 {settings.noiseGateDb} dB
              </span>
            </div>
            <div className="mic-meter-track" aria-label="麥克風音量表">
              <div
                className="mic-meter-fill"
                style={{ width: `${meterPercent}%` }}
              />
              <div
                className="mic-meter-gate"
                style={{ left: `${gatePercent}%` }}
                title={`噪音門檻 ${settings.noiseGateDb} dB`}
              />
            </div>
            <div className="mic-meter-actions">
              <button
                type="button"
                className="calibrate-btn"
                disabled={calibrating}
                onClick={handleCalibrateNoise}
              >
                {calibrating ? '安靜測量中（2 秒）…' : '校正環境噪音'}
              </button>
              {calibMsg && (
                <span
                  className={`calib-msg ${calibMsg.isError ? 'is-error' : 'is-ok'}`}
                  role="status"
                >
                  {calibMsg.text}
                </span>
              )}
            </div>
          </div>

          {/* 6. 延遲校正（ms） */}
          <div className="setting-row">
            <span className="setting-label">延遲校正</span>
            <div className="stepper">
              <button
                type="button"
                className="stepper-btn"
                aria-label="減少延遲校正"
                disabled={settings.latencyOffsetMs <= -300}
                onClick={() =>
                  onUpdateSettings({
                    latencyOffsetMs: Math.max(
                      -300,
                      settings.latencyOffsetMs - 10,
                    ),
                  })
                }
              >
                −
              </button>
              <span className="stepper-value">
                {settings.latencyOffsetMs > 0
                  ? `+${settings.latencyOffsetMs}`
                  : settings.latencyOffsetMs}{' '}
                ms
              </span>
              <button
                type="button"
                className="stepper-btn"
                aria-label="增加延遲校正"
                disabled={settings.latencyOffsetMs >= 300}
                onClick={() =>
                  onUpdateSettings({
                    latencyOffsetMs: Math.min(
                      300,
                      settings.latencyOffsetMs + 10,
                    ),
                  })
                }
              >
                ＋
              </button>
            </div>
          </div>

          {/* 7. A4 頻率（430–450 Hz） */}
          <div className="setting-row">
            <span className="setting-label">A4 頻率</span>
            <div className="stepper">
              <button
                type="button"
                className="stepper-btn"
                aria-label="降低 A4 頻率"
                disabled={clampedA4 <= 430}
                onClick={() =>
                  onUpdateSettings({ a4: Math.max(430, clampedA4 - 1) })
                }
              >
                −
              </button>
              <span className="stepper-value">{clampedA4} Hz</span>
              <button
                type="button"
                className="stepper-btn"
                aria-label="提高 A4 頻率"
                disabled={clampedA4 >= 450}
                onClick={() =>
                  onUpdateSettings({ a4: Math.min(450, clampedA4 + 1) })
                }
              >
                ＋
              </button>
            </div>
          </div>

          {/* 7.5 音高線顏色 */}
          <div className="setting-row setting-row-stack">
            <span className="setting-label">音高線顏色</span>
            {(
              [
                {
                  key: 'staffPitchColor',
                  label: '五線譜音高線',
                  current: settings.staffPitchColor,
                },
                {
                  key: 'pianoNeedleColor',
                  label: '鋼琴定位線',
                  current: settings.pianoNeedleColor,
                },
              ] as const
            ).map((row) => (
              <div key={row.key} className="pitch-color-row">
                <span className="pitch-color-label">{row.label}</span>
                <div className="pitch-color-swatches" role="radiogroup" aria-label={row.label}>
                  {PITCH_COLOR_SWATCHES.map((swatch) => {
                    const selected =
                      row.current.toLowerCase() === swatch.value.toLowerCase();
                    return (
                      <button
                        key={swatch.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${row.label} ${swatch.label}`}
                        className={`pitch-color-swatch ${selected ? 'is-selected' : ''}`}
                        style={{ backgroundColor: swatch.value }}
                        onClick={() =>
                          onUpdateSettings({ [row.key]: swatch.value })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 8. 診斷資訊（可折疊） */}
          <section className="diag-section">
            <button
              type="button"
              className="diag-toggle-btn"
              aria-expanded={diagOpen}
              onClick={() => setDiagOpen((prev) => !prev)}
            >
              <span>診斷資訊</span>
              <span aria-hidden="true">{diagOpen ? '▾' : '▸'}</span>
            </button>

            {diagOpen && (
              <div className="diag-panel">
                <dl className="diag-grid">
                  <dt>ctx.sampleRate</dt>
                  <dd>{formatDiagRate(diagSnap?.mic.ctxSampleRate)}</dd>

                  <dt>track sampleRate</dt>
                  <dd>{formatDiagRate(diagSnap?.mic.trackSampleRate)}</dd>

                  <dt>worklet sampleRate</dt>
                  <dd>{formatDiagRate(diagSnap?.mic.workletSampleRate)}</dd>

                  <dt>實測每秒樣本數</dt>
                  <dd>
                    {diagSnap?.mic.measuredSamplesPerSec !== null &&
                    diagSnap?.mic.measuredSamplesPerSec !== undefined
                      ? `${diagSnap.mic.measuredSamplesPerSec} /s${
                          diagSnap.mic.rateCorrected
                            ? `（已修正 → ${diagSnap.mic.effectiveRate} Hz）`
                            : ''
                        }`
                      : '量測中'}
                  </dd>

                  <dt>outputLatency</dt>
                  <dd>
                    {((diagSnap?.outputLatencySec ?? 0) * 1000).toFixed(1)} ms
                  </dd>

                  <dt>inputLatency</dt>
                  <dd>
                    {((diagSnap?.mic.inputLatencySec ?? 0) * 1000).toFixed(1)} ms
                  </dd>

                  <dt>最近 1 秒偵測</dt>
                  <dd>
                    {diagSnap?.recentHz !== null &&
                    diagSnap?.recentHz !== undefined &&
                    diagSnap?.recentMidi !== null &&
                    diagSnap?.recentMidi !== undefined
                      ? `${diagSnap.recentHz.toFixed(1)} Hz / ${displayNoteName(diagSnap.recentMidi)}（MIDI ${diagSnap.recentMidi.toFixed(2)}）`
                      : '無'}
                  </dd>

                  <dt>standalone</dt>
                  <dd>{diagSnap?.standalone ? '是' : '否'}</dd>
                </dl>

                <div className="diag-errlog-head">
                  <span>錯誤紀錄（最近 5 筆）</span>
                  <div className="diag-actions">
                    <button
                      type="button"
                      className="diag-action-btn"
                      onClick={handleClearErrors}
                    >
                      清除紀錄
                    </button>
                    <button
                      type="button"
                      className="diag-action-btn is-primary"
                      onClick={handleCopyDiagnostics}
                    >
                      複製全部
                    </button>
                  </div>
                </div>
                {copyMsg && (
                  <div className="calib-msg is-ok" role="status">
                    {copyMsg}
                  </div>
                )}

                {recentErrors.length === 0 ? (
                  <p className="diag-empty">無錯誤紀錄</p>
                ) : (
                  <ul className="diag-errlog-list">
                    {recentErrors.map((entry, idx) => (
                      <li
                        key={`${entry.time}-${idx}`}
                        className="diag-errlog-item"
                      >
                        <div className="diag-errlog-meta">
                          <span>{entry.time}</span>
                          <span>{entry.source}</span>
                        </div>
                        <div className="diag-errlog-msg">{entry.message}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
