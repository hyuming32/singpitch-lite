import { useEffect, useMemo, useRef, useState } from 'react';
import { keyName, type Key } from '../../core/key';
import type { KeyConfidence } from '../../core/keyDetect';
import {
  melodyCandidates,
  parseMidi,
  trackInfo,
  type MidiAsset,
} from '../../core/midi';
import {
  autoTransposeForRange,
  computeMidiBars,
  detectMelodyKey,
  sliceMelodyByBars,
  transposeKey,
} from '../../core/midiExercise';
import {
  createMidiStore,
  fnv1aHash,
  loadMidiSongSettings,
  saveMidiSongSettings,
  stripMidiExtension,
  type MidiLibraryMeta,
  type MidiSongSettings,
  type MidiStore,
} from '../../state/midiLibrary';
import {
  formatBpm,
  getRangeBounds,
  type PracticeModeOption,
  type PracticeSettings,
} from '../../state/settings';
import { displayNoteNameInKey } from '../noteLabel';

export interface MidiPracticeSource {
  id: string;
  hash: string;
  name: string;
  asset: MidiAsset;
  songSettings: MidiSongSettings;
}

interface MidiPageProps {
  settings: PracticeSettings;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onStartMidiPractice: (source: MidiPracticeSource) => void;
  /** 若剛從練唱頁返回，保留先前開啟的 MIDI 來源 */
  initialSource?: MidiPracticeSource | null;
  store?: MidiStore;
}

const CONFIDENCE_LABEL: Record<KeyConfidence, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const ALL_24_KEYS: Key[] = (() => {
  const list: Key[] = [];
  for (let pc = 0; pc < 12; pc++) {
    list.push({ tonicPc: pc, mode: 'major' });
  }
  for (let pc = 0; pc < 12; pc++) {
    list.push({ tonicPc: pc, mode: 'minor' });
  }
  return list;
})();

function keyToValue(k: Key): string {
  return `${k.tonicPc}:${k.mode}`;
}

function valueToKey(val: string): Key | null {
  const [pcStr, mode] = val.split(':');
  const pc = Number(pcStr);
  if (
    !Number.isInteger(pc) ||
    pc < 0 ||
    pc > 11 ||
    (mode !== 'major' && mode !== 'minor')
  ) {
    return null;
  }
  return { tonicPc: pc, mode };
}

function formatImportDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function defaultSongSettings(asset: MidiAsset): MidiSongSettings {
  const candidates = melodyCandidates(asset);
  const bars = computeMidiBars(asset);
  return {
    trackIndex: candidates[0] ?? asset.tracks[0]?.index ?? 0,
    startBar: 1,
    endBar: Math.max(1, bars.length),
    transposeSemitones: 0,
    speedPercent: 100,
    manualKey: null,
  };
}

/** MIDI 練唱分頁：匯入 .mid、曲庫清單、軌道／區間／移調／變速／調性設定 */
export function MidiPage({
  settings,
  onUpdateSettings,
  onStartMidiPractice,
  initialSource = null,
  store: propStore,
}: MidiPageProps) {
  const store = useMemo(() => propStore ?? createMidiStore(), [propStore]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [library, setLibrary] = useState<MidiLibraryMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [activeItem, setActiveItem] = useState<{
    id: string;
    hash: string;
    name: string;
    asset: MidiAsset;
  } | null>(() =>
    initialSource
      ? {
          id: initialSource.id,
          hash: initialSource.hash,
          name: initialSource.name,
          asset: initialSource.asset,
        }
      : null,
  );
  const [songSettings, setSongSettings] = useState<MidiSongSettings | null>(
    () => initialSource?.songSettings ?? null,
  );

  // 載入曲庫清單
  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    store
      .list()
      .then((items) => {
        if (!cancelled) {
          setLibrary(items);
          setLoadingList(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingList(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const bars = useMemo(
    () => (activeItem ? computeMidiBars(activeItem.asset) : []),
    [activeItem],
  );

  const trackEntries = useMemo(() => {
    if (!activeItem) return [];
    const candidateOrder = melodyCandidates(activeItem.asset);
    const recommendedIndex = candidateOrder[0];
    const orderMap = new Map<number, number>();
    candidateOrder.forEach((idx, rank) => orderMap.set(idx, rank));
    return [...activeItem.asset.tracks]
      .sort(
        (a, b) =>
          (orderMap.get(a.index) ?? 999) - (orderMap.get(b.index) ?? 999),
      )
      .map((track) => ({
        track,
        info: trackInfo(track),
        isRecommended: track.index === recommendedIndex,
      }));
  }, [activeItem]);

  const activeTrack = useMemo(() => {
    if (!activeItem || !songSettings) return null;
    return (
      activeItem.asset.tracks.find((t) => t.index === songSettings.trackIndex) ??
      activeItem.asset.tracks[0] ??
      null
    );
  }, [activeItem, songSettings]);

  const sliced = useMemo(() => {
    if (!activeTrack || !songSettings || bars.length === 0) {
      return null;
    }
    return sliceMelodyByBars(
      activeTrack,
      bars,
      songSettings.startBar,
      songSettings.endBar,
    );
  }, [activeTrack, bars, songSettings]);

  const detectedKey = useMemo(() => {
    if (!sliced) {
      return { key: { tonicPc: 0, mode: 'major' } as Key, confidence: 'low' as KeyConfidence };
    }
    return detectMelodyKey(sliced.notes);
  }, [sliced]);

  const [rangeLow, rangeHigh] = getRangeBounds(
    settings.rangeName,
    settings.myRange,
  );

  function updateSongSettings(patch: Partial<MidiSongSettings>) {
    if (!activeItem || !songSettings) return;
    const next: MidiSongSettings = { ...songSettings, ...patch };
    setSongSettings(next);
    saveMidiSongSettings(activeItem.hash, next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const asset = parseMidi(bytes);
      const hash = fnv1aHash(bytes);
      const entry = {
        id: hash,
        hash,
        name: file.name,
        importedAt: new Date().toISOString(),
        bytes,
      };
      await store.put(entry);
      const updatedList = await store.list();
      setLibrary(updatedList);

      const saved = loadMidiSongSettings(hash);
      const initial = saved ?? defaultSongSettings(asset);
      const maxBar = Math.max(1, computeMidiBars(asset).length);
      const normalized: MidiSongSettings = {
        ...initial,
        startBar: Math.max(1, Math.min(maxBar, initial.startBar)),
        endBar: Math.max(
          Math.max(1, Math.min(maxBar, initial.startBar)),
          Math.min(maxBar, initial.endBar),
        ),
      };

      setActiveItem({ id: hash, hash, name: file.name, asset });
      setSongSettings(normalized);
      saveMidiSongSettings(hash, normalized);
      setConfirmDeleteId(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleOpenEntry(meta: MidiLibraryMeta) {
    setImportError(null);
    setConfirmDeleteId(null);
    try {
      const entry = await store.get(meta.id);
      if (!entry) {
        setImportError('找不到該 MIDI 檔案，可能已被移除。');
        return;
      }
      const asset = parseMidi(entry.bytes);
      const saved = loadMidiSongSettings(entry.hash);
      const initial = saved ?? defaultSongSettings(asset);
      setActiveItem({
        id: entry.id,
        hash: entry.hash,
        name: entry.name,
        asset,
      });
      setSongSettings(initial);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteEntry(id: string) {
    await store.delete(id);
    const updatedList = await store.list();
    setLibrary(updatedList);
    setConfirmDeleteId(null);
    if (activeItem?.id === id) {
      setActiveItem(null);
      setSongSettings(null);
    }
  }

  function handleAutoTranspose() {
    if (!sliced || !songSettings) return;
    const shift = autoTransposeForRange(sliced.notes, rangeLow, rangeHigh);
    updateSongSettings({ transposeSemitones: shift });
  }

  function handleStart() {
    if (!activeItem || !songSettings) return;
    saveMidiSongSettings(activeItem.hash, songSettings);
    onStartMidiPractice({
      id: activeItem.id,
      hash: activeItem.hash,
      name: activeItem.name,
      asset: activeItem.asset,
      songSettings,
    });
  }

  const originalKey = songSettings?.manualKey ?? detectedKey.key;
  const transposedKey = songSettings
    ? transposeKey(originalKey, songSettings.transposeSemitones)
    : originalKey;
  const baseBpm = sliced?.baseBpm ?? 120;
  const effectiveBpm = songSettings
    ? Math.round(baseBpm * (songSettings.speedPercent / 100) * 10) / 10
    : baseBpm;

  return (
    <div className="midi-page">
      {/* 左欄：匯入與我的 MIDI 清單 */}
      <aside className="midi-sidebar" aria-label="我的 MIDI 曲庫">
        <div className="midi-import-box">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mid,.midi"
            className="midi-file-input"
            aria-label="匯入 MIDI 檔案"
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="midi-import-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            ＋ 匯入 .mid / .midi
          </button>
          {!store.persistent && (
            <p className="midi-notice-warn" role="status">
              此瀏覽器無法保存 MIDI
            </p>
          )}
          {importError && (
            <p className="midi-notice-error" role="alert">
              {importError}
            </p>
          )}
        </div>

        <div className="midi-list-header">
          <h2>我的 MIDI</h2>
          <span className="midi-list-count">{library.length} 首</span>
        </div>

        {loadingList ? (
          <p className="midi-empty-text">載入中…</p>
        ) : library.length === 0 ? (
          <p className="midi-empty-text">
            尚未匯入 MIDI 檔案，點上方按鈕選擇 .mid 檔即可開始練唱。
          </p>
        ) : (
          <ul className="midi-list">
            {library.map((item) => {
              const isActive = activeItem?.id === item.id;
              const isConfirming = confirmDeleteId === item.id;
              return (
                <li
                  key={item.id}
                  className={`midi-list-item ${isActive ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="midi-item-open"
                    onClick={() => handleOpenEntry(item)}
                  >
                    <span className="midi-item-name">
                      {stripMidiExtension(item.name)}
                    </span>
                    <span className="midi-item-date">
                      {item.name} · {formatImportDate(item.importedAt)}
                    </span>
                  </button>
                  <div className="midi-item-actions">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="midi-del-confirm-btn"
                          onClick={() => handleDeleteEntry(item.id)}
                        >
                          確認刪除
                        </button>
                        <button
                          type="button"
                          className="midi-del-cancel-btn"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="midi-del-btn"
                        aria-label={`刪除 ${item.name}`}
                        onClick={() => setConfirmDeleteId(item.id)}
                      >
                        刪除
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* 右欄：曲目練唱設定 */}
      <section className="midi-detail" aria-label="MIDI 練唱設定">
        {!activeItem || !songSettings ? (
          <div className="midi-empty-detail">
            <h2>MIDI 練唱</h2>
            <p>請從左側匯入 .mid 檔，或選擇已保存的曲目進行設定。</p>
          </div>
        ) : (
          <div className="midi-settings-card">
            <div className="midi-settings-head">
              <div>
                <h2 className="midi-song-title">
                  {stripMidiExtension(activeItem.name)}
                </h2>
                <p className="midi-song-meta">
                  共 {bars.length} 小節 · 區間 {sliced?.notes.length ?? 0} 個旋律音符
                </p>
              </div>
              <button
                type="button"
                className="midi-start-btn"
                disabled={!sliced || sliced.notes.length === 0}
                onClick={handleStart}
              >
                開始練唱
              </button>
            </div>

            {/* 1. 旋律軌 */}
            <div className="setting-row setting-row-stack">
              <label className="setting-label" htmlFor="midi-track-select">
                旋律軌
              </label>
              <select
                id="midi-track-select"
                className="midi-select"
                value={songSettings.trackIndex}
                onChange={(e) =>
                  updateSongSettings({ trackIndex: Number(e.target.value) })
                }
              >
                {trackEntries.map(({ track, info, isRecommended }) => {
                  const trackNum = track.index + 1;
                  const trimmedName = track.name.trim();
                  const isDefaultName =
                    !trimmedName || trimmedName === `旋律軌 ${trackNum}`;
                  const titlePart = isDefaultName
                    ? `第 ${trackNum} 軌`
                    : `第 ${trackNum} 軌 ${trimmedName}`;
                  const lowName = displayNoteNameInKey(info.low, originalKey);
                  const highName = displayNoteNameInKey(info.high, originalKey);
                  return (
                    <option key={track.index} value={track.index}>
                      {titlePart}（{lowName}–{highName}，{info.noteCount} 音
                      {info.polyphonic ? '，複音' : ''}）
                      {isRecommended ? '（建議）' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* 2. A–B 小節區間 */}
            <div className="setting-row setting-row-stack">
              <div className="setting-row-inline-head">
                <span className="setting-label">A–B 小節區間</span>
                {(songSettings.startBar !== 1 ||
                  songSettings.endBar !== bars.length) && (
                  <button
                    type="button"
                    className="midi-inline-link"
                    onClick={() =>
                      updateSongSettings({
                        startBar: 1,
                        endBar: Math.max(1, bars.length),
                      })
                    }
                  >
                    重設整首
                  </button>
                )}
              </div>
              <div className="midi-bar-range">
                <label className="midi-bar-field">
                  <span>起</span>
                  <select
                    className="midi-select"
                    aria-label="起始小節"
                    value={songSettings.startBar}
                    onChange={(e) => {
                      const nextStart = Number(e.target.value);
                      updateSongSettings({
                        startBar: nextStart,
                        endBar: Math.max(nextStart, songSettings.endBar),
                      });
                    }}
                  >
                    {bars.map((b) => (
                      <option key={b.barNumber} value={b.barNumber}>
                        第 {b.barNumber} 小節
                      </option>
                    ))}
                  </select>
                </label>
                <span className="midi-bar-sep">–</span>
                <label className="midi-bar-field">
                  <span>訖</span>
                  <select
                    className="midi-select"
                    aria-label="結束小節"
                    value={songSettings.endBar}
                    onChange={(e) => {
                      const nextEnd = Number(e.target.value);
                      updateSongSettings({
                        endBar: Math.max(songSettings.startBar, nextEnd),
                      });
                    }}
                  >
                    {bars
                      .filter((b) => b.barNumber >= songSettings.startBar)
                      .map((b) => (
                        <option key={b.barNumber} value={b.barNumber}>
                          第 {b.barNumber} 小節
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </div>

            {/* 3. 移調 + 自動移調 */}
            <div className="setting-row setting-row-stack">
              <div className="setting-row-inline-head">
                <span className="setting-label">移調</span>
                <span className="setting-value-badge">
                  目前音域：{settings.rangeName}（
                  {displayNoteNameInKey(rangeLow, transposedKey)}–
                  {displayNoteNameInKey(rangeHigh, transposedKey)}）
                </span>
              </div>
              <div className="midi-transpose-row">
                <div className="stepper">
                  <button
                    type="button"
                    className="stepper-btn"
                    aria-label="降一個半音"
                    disabled={songSettings.transposeSemitones <= -12}
                    onClick={() =>
                      updateSongSettings({
                        transposeSemitones: Math.max(
                          -12,
                          songSettings.transposeSemitones - 1,
                        ),
                      })
                    }
                  >
                    −
                  </button>
                  <span className="stepper-value">
                    {songSettings.transposeSemitones > 0
                      ? `+${songSettings.transposeSemitones}`
                      : songSettings.transposeSemitones === 0
                        ? '0'
                        : `−${Math.abs(songSettings.transposeSemitones)}`}{' '}
                    半音
                  </span>
                  <button
                    type="button"
                    className="stepper-btn"
                    aria-label="升一個半音"
                    disabled={songSettings.transposeSemitones >= 12}
                    onClick={() =>
                      updateSongSettings({
                        transposeSemitones: Math.min(
                          12,
                          songSettings.transposeSemitones + 1,
                        ),
                      })
                    }
                  >
                    ＋
                  </button>
                </div>

                <button
                  type="button"
                  className="midi-auto-transpose-btn"
                  disabled={!sliced || sliced.notes.length === 0}
                  onClick={handleAutoTranspose}
                >
                  依我的音域自動移調
                </button>
              </div>
            </div>

            {/* 4. 變速（50%–150%，每 5% 一格） */}
            <div className="setting-row setting-row-stack">
              <div className="setting-row-inline-head">
                <label className="setting-label" htmlFor="midi-speed-range">
                  變速
                </label>
                <span className="setting-value-badge">
                  {songSettings.speedPercent}% · {formatBpm(effectiveBpm)} BPM
                  {songSettings.speedPercent !== 100
                    ? `（原速 ${formatBpm(baseBpm)}）`
                    : ''}
                </span>
              </div>
              <div className="midi-speed-row">
                <button
                  type="button"
                  className="stepper-btn"
                  aria-label="減慢 5%"
                  disabled={songSettings.speedPercent <= 50}
                  onClick={() =>
                    updateSongSettings({
                      speedPercent: Math.max(50, songSettings.speedPercent - 5),
                    })
                  }
                >
                  −
                </button>
                <input
                  id="midi-speed-range"
                  className="setting-range"
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={songSettings.speedPercent}
                  onChange={(e) =>
                    updateSongSettings({ speedPercent: Number(e.target.value) })
                  }
                />
                <button
                  type="button"
                  className="stepper-btn"
                  aria-label="加快 5%"
                  disabled={songSettings.speedPercent >= 150}
                  onClick={() =>
                    updateSongSettings({
                      speedPercent: Math.min(150, songSettings.speedPercent + 5),
                    })
                  }
                >
                  ＋
                </button>
              </div>
            </div>

            {/* 5. 調性判斷與手動覆寫 */}
            <div className="setting-row setting-row-stack">
              <div className="setting-row-inline-head">
                <label className="setting-label" htmlFor="midi-key-select">
                  調性
                </label>
                <span className="setting-value-badge">
                  判斷為 {keyName(detectedKey.key)}（信心
                  {CONFIDENCE_LABEL[detectedKey.confidence]}）
                </span>
              </div>
              <div className="midi-key-row">
                <select
                  id="midi-key-select"
                  className="midi-select"
                  value={
                    songSettings.manualKey
                      ? keyToValue(songSettings.manualKey)
                      : 'auto'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    updateSongSettings({
                      manualKey: val === 'auto' ? null : valueToKey(val),
                    });
                  }}
                >
                  <option value="auto">
                    自動判斷（{keyName(detectedKey.key)}）
                  </option>
                  {ALL_24_KEYS.map((k) => (
                    <option key={keyToValue(k)} value={keyToValue(k)}>
                      {keyName(k)}
                    </option>
                  ))}
                </select>
                {songSettings.transposeSemitones !== 0 && (
                  <span className="midi-transposed-key">
                    移調後：{keyName(transposedKey)}
                  </span>
                )}
              </div>
            </div>

            {/* 6. 練唱模式 */}
            <div className="setting-row">
              <span className="setting-label">練唱模式</span>
              <div className="segmented-group">
                {(
                  [
                    { value: 'follow', label: '跟唱' },
                    { value: 'listen-then-sing', label: '先聽再唱' },
                  ] as const
                ).map((opt: { value: PracticeModeOption; label: string }) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`seg-btn ${settings.mode === opt.value ? 'is-active' : ''}`}
                    onClick={() => onUpdateSettings({ mode: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {sliced && sliced.notes.length === 0 && (
              <p className="midi-notice-warn" role="status">
                所選軌道與小節區間內沒有音符，請調整軌道或 A–B 區間。
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
