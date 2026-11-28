import { useEffect, useMemo, useRef, useState } from 'react';
import { keyName, type Key } from '../../core/key';
import type { KeyConfidence } from '../../core/keyDetect';
import {
  melodyCandidates,
  parseMidi,
  suggestMelodyTrack,
  trackInfo,
  type MidiAsset,
} from '../../core/midi';
import {
  autoTransposeForRange,
  computeMidiBars,
  defaultBarRangeForTrack,
  detectMelodyKey,
  sliceMelodyByBars,
  transposeKey,
} from '../../core/midiExercise';
import {
  autoAssignTrackRoles,
  findVocalTrackIndex,
  isRhythmTrackCandidate,
  resolveTrackRoles,
  setTrackRole,
} from '../../core/midiMix';
import {
  buildMidiLyricsDocument,
  parseSubtitleFile,
} from '../../core/lyrics';
import {
  createLyricsStore,
  type ImportedLyricsEntry,
  type LyricsStore,
} from '../../state/lyricsStore';
import {
  createMidiStore,
  DEFAULT_MIDI_MIXER,
  fnv1aHash,
  loadMidiSongSettings,
  MIDI_LYRICS_OFFSET_MAX,
  MIDI_LYRICS_OFFSET_MIN,
  MIDI_LYRICS_OFFSET_STEP,
  resolveMidiLyricsOffset,
  resolveMidiMixer,
  saveMidiSongSettings,
  stripMidiExtension,
  type MidiLibraryMeta,
  type MidiSongSettings,
  type MidiStore,
  type MidiTrackRole,
} from '../../state/midiLibrary';
import {
  formatBpm,
  getRangeBounds,
  type PracticeModeOption,
  type PracticeSettings,
} from '../../state/settings';
import { displayNoteNameInKey } from '../noteLabel';
import { TrackMixModal } from './TrackMixModal';

export interface MidiPracticeSource {
  id: string;
  hash: string;
  name: string;
  asset: MidiAsset;
  songSettings: MidiSongSettings;
  importedLyrics?: ImportedLyricsEntry | null;
}

interface MidiPageProps {
  settings: PracticeSettings;
  onUpdateSettings: (patch: Partial<PracticeSettings>) => void;
  onStartMidiPractice: (source: MidiPracticeSource) => void;
  /** 若剛從練唱頁返回，保留先前開啟的 MIDI 來源 */
  initialSource?: MidiPracticeSource | null;
  store?: MidiStore;
  lyricsStore?: LyricsStore;
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
  const autoRoles = autoAssignTrackRoles(asset);
  const recommendedIdx =
    findVocalTrackIndex(autoRoles, asset) ?? suggestMelodyTrack(asset);
  const trackIndex = recommendedIdx ?? asset.tracks[0]?.index ?? 0;
  const track =
    asset.tracks.find((t) => t.index === trackIndex) ?? asset.tracks[0];
  const bars = computeMidiBars(asset);
  const range = track
    ? defaultBarRangeForTrack(track, bars)
    : { startBar: 1, endBar: Math.max(1, bars.length), skippedIntroBars: 0 };
  return {
    trackIndex,
    startBar: range.startBar,
    endBar: range.endBar,
    transposeSemitones: 0,
    speedPercent: 100,
    manualKey: null,
    trackRoles: autoRoles,
    mixer: { ...DEFAULT_MIDI_MIXER },
  };
}

/** MIDI 練唱分頁：匯入 .mid、曲庫清單、軌道／區間／移調／變速／調性設定 */
export function MidiPage({
  settings,
  onUpdateSettings,
  onStartMidiPractice,
  initialSource = null,
  store: propStore,
  lyricsStore: propLyricsStore,
}: MidiPageProps) {
  const store = useMemo(() => propStore ?? createMidiStore(), [propStore]);
  const lyricsStore = useMemo(
    () => propLyricsStore ?? createLyricsStore(),
    [propLyricsStore],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lyricsInputRef = useRef<HTMLInputElement | null>(null);

  const [library, setLibrary] = useState<MidiLibraryMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importedLyrics, setImportedLyrics] =
    useState<ImportedLyricsEntry | null>(
      () => initialSource?.importedLyrics ?? null,
    );
  const [lyricsError, setLyricsError] = useState<string | null>(null);

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
  const [trackMixOpen, setTrackMixOpen] = useState(false);
  const [isInitialImportMix, setIsInitialImportMix] = useState(false);
  const [draftTrackRoles, setDraftTrackRoles] = useState<Record<
    number,
    MidiTrackRole
  > | null>(null);

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

  // 載入目前曲目的匯入字幕（若從初始來源進來且尚未帶入）
  const activeItemId = activeItem?.id ?? null;
  useEffect(() => {
    if (!activeItemId) {
      setImportedLyrics(null);
      setLyricsError(null);
      return;
    }
    let cancelled = false;
    lyricsStore
      .get(activeItemId)
      .then((entry) => {
        if (!cancelled && entry) {
          setImportedLyrics(entry);
        }
      })
      .catch(() => {
        // 忽略讀取字幕失敗
      });
    return () => {
      cancelled = true;
    };
  }, [activeItemId, lyricsStore]);

  const embeddedLyrics = useMemo(() => {
    if (!activeItem || !songSettings) return null;
    return buildMidiLyricsDocument(activeItem.asset, songSettings.trackIndex);
  }, [activeItem, songSettings]);

  const bars = useMemo(
    () => (activeItem ? computeMidiBars(activeItem.asset) : []),
    [activeItem],
  );

  const trackEntries = useMemo(() => {
    if (!activeItem) return [];
    const candidateOrder = melodyCandidates(activeItem.asset);
    const recommendedIndex =
      suggestMelodyTrack(activeItem.asset) ?? candidateOrder[0];
    const orderMap = new Map<number, number>();
    candidateOrder.forEach((idx, rank) => orderMap.set(idx, rank));
    return [...activeItem.asset.tracks]
      .filter((track) => !isRhythmTrackCandidate(track))
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

  const resolvedTrackRoles = useMemo(() => {
    if (!activeItem) return {};
    return resolveTrackRoles(activeItem.asset, songSettings);
  }, [activeItem, songSettings]);

  const mixCounts = useMemo(() => {
    let accomp = 0;
    let rhythm = 0;
    if (!activeItem) return { accomp, rhythm };
    for (const t of activeItem.asset.tracks) {
      if (t.notes.length === 0) continue;
      const role = resolvedTrackRoles[t.index];
      if (role === 'accompaniment') accomp++;
      else if (role === 'rhythm') rhythm++;
    }
    return { accomp, rhythm };
  }, [activeItem, resolvedTrackRoles]);

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
      const isNewMixSetup = !saved?.trackRoles;
      const initial = saved ?? defaultSongSettings(asset);
      const maxBar = Math.max(1, computeMidiBars(asset).length);
      const initialRoles = resolveTrackRoles(asset, initial);
      const initialVocal =
        findVocalTrackIndex(initialRoles, asset) ?? initial.trackIndex;
      const normalized: MidiSongSettings = {
        ...initial,
        trackIndex: initialVocal,
        startBar: Math.max(1, Math.min(maxBar, initial.startBar)),
        endBar: Math.max(
          Math.max(1, Math.min(maxBar, initial.startBar)),
          Math.min(maxBar, initial.endBar),
        ),
        mixer: resolveMidiMixer(initial),
      };

      setActiveItem({ id: hash, hash, name: file.name, asset });
      setSongSettings(normalized);
      setConfirmDeleteId(null);
      setLyricsError(null);
      const existingLyrics = await lyricsStore.get(hash).catch(() => null);
      setImportedLyrics(existingLyrics);

      if (isNewMixSetup) {
        setDraftTrackRoles(initialRoles);
        setIsInitialImportMix(true);
        setTrackMixOpen(true);
      } else {
        saveMidiSongSettings(hash, normalized);
        setDraftTrackRoles(null);
        setIsInitialImportMix(false);
        setTrackMixOpen(false);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleOpenEntry(meta: MidiLibraryMeta) {
    setImportError(null);
    setConfirmDeleteId(null);
    setTrackMixOpen(false);
    setIsInitialImportMix(false);
    setDraftTrackRoles(null);
    try {
      const entry = await store.get(meta.id);
      if (!entry) {
        setImportError('找不到該 MIDI 檔案，可能已被移除。');
        return;
      }
      const asset = parseMidi(entry.bytes);
      const saved = loadMidiSongSettings(entry.hash);
      const initial = saved ?? defaultSongSettings(asset);
      const savedLyrics = await lyricsStore.get(entry.id).catch(() => null);
      setLyricsError(null);
      setImportedLyrics(savedLyrics);
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

  function handleOpenTrackMixModal() {
    if (!activeItem || !songSettings) return;
    setDraftTrackRoles(resolveTrackRoles(activeItem.asset, songSettings));
    setIsInitialImportMix(false);
    setTrackMixOpen(true);
  }

  function handleChangeDraftRole(trackIndex: number, nextRole: MidiTrackRole) {
    setDraftTrackRoles((prev) =>
      setTrackRole(prev ?? resolvedTrackRoles, trackIndex, nextRole),
    );
  }

  function handleTrackMixDone() {
    if (!activeItem || !songSettings) return;
    const finalRoles = draftTrackRoles ?? resolvedTrackRoles;
    const nextVocalIdx =
      findVocalTrackIndex(finalRoles, activeItem.asset) ??
      songSettings.trackIndex;
    let nextStart = songSettings.startBar;
    let nextEnd = songSettings.endBar;
    if (nextVocalIdx !== songSettings.trackIndex) {
      const nextTrack = activeItem.asset.tracks.find(
        (t) => t.index === nextVocalIdx,
      );
      if (nextTrack) {
        const range = defaultBarRangeForTrack(nextTrack, bars);
        nextStart = range.startBar;
        nextEnd = range.endBar;
      }
    }
    const nextSettings: MidiSongSettings = {
      ...songSettings,
      trackIndex: nextVocalIdx,
      startBar: nextStart,
      endBar: nextEnd,
      trackRoles: finalRoles,
      mixer: resolveMidiMixer(songSettings),
    };
    setSongSettings(nextSettings);
    saveMidiSongSettings(activeItem.hash, nextSettings);
    setTrackMixOpen(false);
    setIsInitialImportMix(false);
    setDraftTrackRoles(null);
  }

  async function handleDeleteEntry(id: string) {
    await store.delete(id);
    await lyricsStore.delete(id).catch(() => {});
    const updatedList = await store.list();
    setLibrary(updatedList);
    setConfirmDeleteId(null);
    if (activeItem?.id === id) {
      setActiveItem(null);
      setSongSettings(null);
      setImportedLyrics(null);
      setLyricsError(null);
    }
  }

  async function handleLyricsFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeItem) return;

    setLyricsError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const doc = parseSubtitleFile(bytes, file.name);
      const entry: ImportedLyricsEntry = {
        id: activeItem.id,
        fileName: file.name,
        importedAt: new Date().toISOString(),
        document: doc,
      };
      await lyricsStore.put(entry);
      setImportedLyrics(entry);
    } catch (err) {
      setLyricsError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemoveImportedLyrics() {
    if (!activeItem) return;
    setLyricsError(null);
    await lyricsStore.delete(activeItem.id).catch(() => {});
    setImportedLyrics(null);
  }

  function handleAutoTranspose() {
    if (!sliced || !songSettings) return;
    const shift = autoTransposeForRange(sliced.notes, rangeLow, rangeHigh);
    updateSongSettings({ transposeSemitones: shift });
  }

  function handleStart() {
    if (!activeItem || !songSettings) return;
    const finalized: MidiSongSettings = {
      ...songSettings,
      trackRoles: resolveTrackRoles(activeItem.asset, songSettings),
      mixer: resolveMidiMixer(songSettings),
    };
    saveMidiSongSettings(activeItem.hash, finalized);
    onStartMidiPractice({
      id: activeItem.id,
      hash: activeItem.hash,
      name: activeItem.name,
      asset: activeItem.asset,
      songSettings: finalized,
      importedLyrics,
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
        {!activeItem || !songSettings || (trackMixOpen && isInitialImportMix) ? (
          <div className="midi-empty-detail">
            <h2>MIDI 練唱</h2>
            <p>
              {trackMixOpen && isInitialImportMix
                ? '請先完成分軌設定，按「完成」進入練唱設定。'
                : '請從左側匯入 .mid 檔，或選擇已保存的曲目進行設定。'}
            </p>
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
              <div className="midi-head-actions">
                <button
                  type="button"
                  className="midi-track-mix-btn"
                  onClick={handleOpenTrackMixModal}
                >
                  分軌
                </button>
                <button
                  type="button"
                  className="midi-start-btn"
                  disabled={!sliced || sliced.notes.length === 0}
                  onClick={handleStart}
                >
                  開始練唱
                </button>
              </div>
            </div>

            {/* 1. 旋律軌 */}
            <div className="setting-row setting-row-stack">
              <div className="setting-row-inline-head">
                <label className="setting-label" htmlFor="midi-track-select">
                  主唱旋律軌
                </label>
                <span className="setting-value-badge">
                  伴奏 {mixCounts.accomp} 軌 · 節奏 {mixCounts.rhythm} 軌
                </span>
              </div>
              <select
                id="midi-track-select"
                className="midi-select"
                value={songSettings.trackIndex}
                onChange={(e) => {
                  const nextTrackIndex = Number(e.target.value);
                  const nextTrack = activeItem.asset.tracks.find(
                    (t) => t.index === nextTrackIndex,
                  );
                  const nextRoles = setTrackRole(
                    resolvedTrackRoles,
                    nextTrackIndex,
                    'vocal',
                  );
                  if (nextTrack) {
                    const range = defaultBarRangeForTrack(nextTrack, bars);
                    updateSongSettings({
                      trackIndex: nextTrackIndex,
                      startBar: range.startBar,
                      endBar: range.endBar,
                      trackRoles: nextRoles,
                    });
                  } else {
                    updateSongSettings({
                      trackIndex: nextTrackIndex,
                      trackRoles: nextRoles,
                    });
                  }
                }}
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
                <div className="midi-range-head-actions">
                  {songSettings.startBar > 1 && (
                    <span className="setting-value-badge">
                      已略過前奏 {songSettings.startBar - 1} 小節
                    </span>
                  )}
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

            {/* 7. 歌詞設定與外掛字幕匯入 */}
            {(() => {
              const hasEmbedded = Boolean(
                embeddedLyrics && embeddedLyrics.lines.length > 0,
              );
              const lyricsSourceLabel = importedLyrics
                ? importedLyrics.fileName
                : hasEmbedded
                  ? `MIDI 內嵌（${embeddedLyrics!.lines.length} 行）`
                  : '無';
              const lyricsOffset = resolveMidiLyricsOffset(songSettings);
              const offsetDisplay =
                lyricsOffset > 0
                  ? `+${lyricsOffset.toFixed(2)} 秒`
                  : lyricsOffset < 0
                    ? `−${Math.abs(lyricsOffset).toFixed(2)} 秒`
                    : '0.00 秒';
              return (
                <div className="setting-row setting-row-stack midi-lyrics-section">
                  <div className="setting-row-inline-head">
                    <span className="setting-label">歌詞</span>
                    <span className="setting-value-badge">
                      來源：{lyricsSourceLabel}
                    </span>
                  </div>

                  <div className="midi-lyrics-actions">
                    <input
                      ref={lyricsInputRef}
                      type="file"
                      accept=".lrc,.ass,.txt,.json"
                      className="midi-file-input"
                      aria-label="匯入字幕檔"
                      onChange={handleLyricsFileChange}
                    />
                    <button
                      type="button"
                      className="midi-lyrics-import-btn"
                      onClick={() => lyricsInputRef.current?.click()}
                    >
                      匯入字幕檔
                    </button>
                    {importedLyrics && (
                      <button
                        type="button"
                        className="midi-lyrics-remove-btn"
                        onClick={() => void handleRemoveImportedLyrics()}
                      >
                        移除匯入的字幕
                      </button>
                    )}
                  </div>

                  {lyricsError && (
                    <p className="midi-notice-error" role="alert">
                      {lyricsError}
                    </p>
                  )}

                  <div className="midi-lyrics-offset-box">
                    <div className="setting-row-inline-head">
                      <label
                        className="setting-label"
                        htmlFor="midi-lyrics-offset"
                      >
                        字幕位移
                      </label>
                      <div className="midi-range-head-actions">
                        <span className="setting-value-badge">
                          {offsetDisplay}
                        </span>
                        {lyricsOffset !== 0 && (
                          <button
                            type="button"
                            className="midi-inline-link"
                            onClick={() =>
                              updateSongSettings({ lyricsOffsetSec: 0 })
                            }
                          >
                            重設
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      id="midi-lyrics-offset"
                      className="setting-range"
                      type="range"
                      min={MIDI_LYRICS_OFFSET_MIN}
                      max={MIDI_LYRICS_OFFSET_MAX}
                      step={MIDI_LYRICS_OFFSET_STEP}
                      value={lyricsOffset}
                      onChange={(e) =>
                        updateSongSettings({
                          lyricsOffsetSec: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              );
            })()}

            {sliced && sliced.notes.length === 0 && (
              <p className="midi-notice-warn" role="status">
                所選軌道與小節區間內沒有音符，請調整軌道或 A–B 區間。
              </p>
            )}
          </div>
        )}
      </section>

      {activeItem && songSettings && (
        <TrackMixModal
          open={trackMixOpen}
          songTitle={stripMidiExtension(activeItem.name)}
          asset={activeItem.asset}
          bars={bars}
          roles={draftTrackRoles ?? resolvedTrackRoles}
          originalKey={originalKey}
          a4={settings.a4}
          onChangeRole={handleChangeDraftRole}
          onDone={handleTrackMixDone}
        />
      )}
    </div>
  );
}
