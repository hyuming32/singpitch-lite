import { useEffect, useRef, useState } from 'react';
import type { MicInputMode, PracticeSettings } from '../../state/settings';

interface PracticeSettingsSheetProps {
  open: boolean;
  isTablet: boolean;
  settings: PracticeSettings;
  micActive: boolean;
  liveDb: number | null;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onEnsureMicForCalibration: () => Promise<boolean>;
  onClose: () => void;
}

const DB_MIN = -80;
const DB_MAX = 0;
const CALIBRATION_MS = 2000;

function dbToPercent(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
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
  onClose,
}: PracticeSettingsSheetProps) {
  const [calibrating, setCalibrating] = useState(false);
  const [calibMsg, setCalibMsg] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  const samplesRef = useRef<number[]>([]);
  const timerRef = useRef<number | null>(null);
  const calibratingRef = useRef(false);

  useEffect(() => {
    if (calibratingRef.current && liveDb !== null && Number.isFinite(liveDb)) {
      samplesRef.current.push(liveDb);
    }
  }, [liveDb]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      calibratingRef.current = false;
    };
  }, []);

  if (!open) {
    return null;
  }

  async function handleCalibrateNoise() {
    if (calibratingRef.current) return;
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

    samplesRef.current = [];
    calibratingRef.current = true;
    setCalibrating(true);

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      calibratingRef.current = false;
      setCalibrating(false);

      const collected = samplesRef.current;
      if (collected.length === 0) {
        setCalibMsg({
          text: '未收到麥克風音量資料，請稍後再試',
          isError: true,
        });
        return;
      }

      const sorted = [...collected].sort((a, b) => a - b);
      const idx = Math.min(
        sorted.length - 1,
        Math.floor(sorted.length * 0.95),
      );
      const p95 = sorted[idx]!;
      const nextGate = Math.round(p95 + 6);

      if (nextGate > -30) {
        setCalibMsg({
          text: '環境太吵（建議門檻超過 −30 dB），未變更設定',
          isError: true,
        });
        return;
      }

      const clampedGate = Math.max(-80, Math.min(-30, nextGate));
      onUpdateSettings({ noiseGateDb: clampedGate });
      setCalibMsg({
        text: `已設定噪音門檻為 ${clampedGate} dB`,
        isError: false,
      });
    }, CALIBRATION_MS);
  }

  const meterPercent =
    micActive && liveDb !== null && Number.isFinite(liveDb)
      ? dbToPercent(liveDb)
      : 0;
  const gatePercent = dbToPercent(settings.noiseGateDb);
  const clampedA4 = Math.max(430, Math.min(450, settings.a4));

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

          {/* 1. 收音模式 */}
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

          {/* 3. 系統回音消除（實驗） */}
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

          {/* 4. 麥克風音量表 + 噪音門檻線 + 校正 */}
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

          {/* 5. 延遲校正（ms） */}
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

          {/* 6. A4 頻率（430–450 Hz） */}
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
        </div>
      </div>
    </div>
  );
}
