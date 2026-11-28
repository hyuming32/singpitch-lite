import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildWeekBar,
  exportPracticeLogCsv,
  formatDayHeader,
  formatKeyRangeSummary,
  formatPracticeModeLabel,
  formatSourceTitle,
  formatTimeOfDay,
  groupEntriesByDate,
  localDateKey,
  type PracticeLogEntry,
} from '../../core/practiceLog';
import type { MidiStore } from '../../state/midiLibrary';
import type { PracticeLogStore } from '../../state/practiceLogStore';

export interface PracticeLogPageProps {
  logStore: PracticeLogStore;
  midiStore: MidiStore;
  onReplayEntry: (entry: PracticeLogEntry) => void;
  reloadToken?: number;
}

function formatDurationBadge(durationSec: number): string {
  if (durationSec < 60) {
    return `${durationSec} 秒`;
  }
  return `${Math.round(durationSec / 60)} 分鐘`;
}

/** 練習紀錄分頁：本週練習長條圖、依日期分組清單、展開詳情、再練一次與 CSV 匯出 */
export function PracticeLogPage({
  logStore,
  midiStore,
  onReplayEntry,
  reloadToken = 0,
}: PracticeLogPageProps) {
  const [entries, setEntries] = useState<PracticeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [storagePersistent, setStoragePersistent] = useState(
    logStore.persistent,
  );
  const [availableMidiIds, setAvailableMidiIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [availableMidiHashes, setAvailableMidiHashes] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [highlightedDate, setHighlightedDate] = useState<string | null>(null);
  const dayRefs = useRef<Map<string, HTMLElement>>(new Map());

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [logRows, midiRows] = await Promise.all([
        logStore.list(),
        midiStore.list().catch(() => []),
      ]);
      setEntries(logRows);
      setStoragePersistent(logStore.persistent);
      setAvailableMidiIds(new Set(midiRows.map((m) => m.id)));
      setAvailableMidiHashes(new Set(midiRows.map((m) => m.hash)));
    } catch {
      setStoragePersistent(false);
    } finally {
      setLoading(false);
    }
  }, [logStore, midiStore]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, reloadToken]);

  const weekBars = useMemo(() => buildWeekBar(entries), [entries]);
  const maxWeekMin = useMemo(
    () => Math.max(1, ...weekBars.map((b) => b.minutes)),
    [weekBars],
  );
  const dayGroups = useMemo(() => groupEntriesByDate(entries), [entries]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleConfirmDelete(id: string) {
    await logStore.delete(id);
    setConfirmDeleteId(null);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function handleJumpToDay(dateKey: string) {
    const el = dayRefs.current.get(dateKey);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlightedDate(dateKey);
    window.setTimeout(() => {
      setHighlightedDate((curr) => (curr === dateKey ? null : curr));
    }, 1200);
  }

  function handleExportCsv() {
    if (entries.length === 0) return;
    const csv = exportPracticeLogCsv(entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `singpitch-練習紀錄-${localDateKey(Date.now())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function isMidiAvailable(entry: PracticeLogEntry): boolean {
    if (entry.source.kind !== 'midi') return true;
    return (
      availableMidiIds.has(entry.source.midiId) ||
      availableMidiHashes.has(entry.source.midiHash)
    );
  }

  return (
    <div className="log-page">
      <div className="log-page-inner">
        <div className="log-header">
          <h2 className="log-title">練習紀錄</h2>
          <button
            type="button"
            className="log-export-btn"
            disabled={entries.length === 0}
            onClick={handleExportCsv}
          >
            匯出 CSV
          </button>
        </div>

        {!storagePersistent && (
          <div className="log-warning-banner" role="status">
            此瀏覽器無法保存紀錄
          </div>
        )}

        {/* 本週 7 天小長條 */}
        <section className="log-week-card" aria-label="本週練習分鐘">
          <div className="log-week-caption">本週練習</div>
          <div className="log-week-bars">
            {weekBars.map((bar) => {
              const heightPct =
                bar.minutes > 0
                  ? Math.max(14, Math.round((bar.minutes / maxWeekMin) * 100))
                  : bar.totalSec > 0
                    ? 10
                    : 0;
              return (
                <button
                  key={bar.dateKey}
                  type="button"
                  className={`log-week-day ${bar.isToday ? 'is-today' : ''} ${bar.hasEntries ? 'has-entries' : ''}`}
                  disabled={!bar.hasEntries}
                  onClick={() => handleJumpToDay(bar.dateKey)}
                  aria-label={`${bar.dateKey} 練習 ${bar.minutes} 分鐘`}
                >
                  <span className="log-week-min">
                    {bar.minutes > 0 ? `${bar.minutes}分` : ''}
                  </span>
                  <span className="log-week-track">
                    <span
                      className="log-week-fill"
                      style={{ height: `${heightPct}%` }}
                    />
                  </span>
                  <span className="log-week-label">{bar.weekdayLabel}</span>
                </button>
              );
            })}
          </div>
        </section>

        {!loading && entries.length === 0 ? (
          <div className="log-empty">
            <p>開始練唱後，這裡會自動記錄</p>
          </div>
        ) : (
          <div className="log-days">
            {dayGroups.map((group) => (
              <section
                key={group.dateKey}
                ref={(el) => {
                  if (el) {
                    dayRefs.current.set(group.dateKey, el);
                  } else {
                    dayRefs.current.delete(group.dateKey);
                  }
                }}
                className={`log-day-group ${highlightedDate === group.dateKey ? 'is-highlighted' : ''}`}
              >
                <h3 className="log-day-header">
                  {formatDayHeader(group.dateKey, group.totalMinutes)}
                </h3>
                <div className="log-day-list">
                  {group.entries.map((entry) => {
                    const expanded = expandedIds.has(entry.id);
                    const midiOk = isMidiAvailable(entry);
                    const confirming = confirmDeleteId === entry.id;
                    return (
                      <article
                        key={entry.id}
                        className={`log-entry-card ${expanded ? 'is-expanded' : ''}`}
                      >
                        <button
                          type="button"
                          className="log-entry-row"
                          aria-expanded={expanded}
                          onClick={() => toggleExpand(entry.id)}
                        >
                          <span className="log-entry-time">
                            {formatTimeOfDay(entry.startedAtMs)}
                          </span>
                          <span className="log-entry-name">
                            {formatSourceTitle(entry.source)}
                          </span>
                          <span className="log-entry-keys">
                            {formatKeyRangeSummary(entry)}
                          </span>
                          <span className="log-entry-passes">
                            {entry.completedPasses} 遍
                          </span>
                          <span className="log-entry-dur">
                            {formatDurationBadge(entry.durationSec)}
                          </span>
                        </button>

                        {expanded && (
                          <div className="log-entry-details">
                            <dl className="log-detail-grid">
                              <div>
                                <dt>練過的調</dt>
                                <dd>
                                  {entry.keys.length > 0
                                    ? entry.keys.join(' → ')
                                    : '未記錄調性'}
                                </dd>
                              </div>
                              <div>
                                <dt>調性範圍</dt>
                                <dd>
                                  {entry.lowestKey && entry.highestKey
                                    ? `最低 ${entry.lowestKey} ／ 最高 ${entry.highestKey}`
                                    : '—'}
                                </dd>
                              </div>
                              <div>
                                <dt>練唱模式</dt>
                                <dd>{formatPracticeModeLabel(entry.mode)}</dd>
                              </div>
                              <div>
                                <dt>速度 / 音域 / 聲部</dt>
                                <dd>
                                  {entry.bpm} BPM · {entry.rangeName} ·{' '}
                                  {entry.voice === 'male' ? '男聲' : '一般'}
                                </dd>
                              </div>
                              <div>
                                <dt>麥克風 / 播放秒數</dt>
                                <dd>
                                  {entry.usedMic ? '已開啟' : '未開啟'} ·{' '}
                                  {entry.durationSec} 秒
                                </dd>
                              </div>
                            </dl>

                            <div className="log-entry-actions">
                              <div className="log-replay-wrap">
                                <button
                                  type="button"
                                  className="log-replay-btn"
                                  disabled={!midiOk}
                                  onClick={() => onReplayEntry(entry)}
                                >
                                  再練一次
                                </button>
                                {!midiOk && (
                                  <span className="log-midi-deleted-note">
                                    MIDI 檔已刪除
                                  </span>
                                )}
                              </div>

                              {confirming ? (
                                <div className="log-delete-confirm">
                                  <span>確定刪除？</span>
                                  <button
                                    type="button"
                                    className="log-delete-yes-btn"
                                    onClick={() =>
                                      void handleConfirmDelete(entry.id)
                                    }
                                  >
                                    確認刪除
                                  </button>
                                  <button
                                    type="button"
                                    className="log-delete-no-btn"
                                    onClick={() => setConfirmDeleteId(null)}
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="log-delete-btn"
                                  onClick={() => setConfirmDeleteId(entry.id)}
                                >
                                  刪除
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
