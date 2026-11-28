import { useEffect, useState } from 'react';
import type { Key } from '../../core/key';
import { trackInfo, type MidiAsset, type MidiTrack } from '../../core/midi';
import type { MidiBarInfo } from '../../core/midiExercise';
import {
  buildTrackPreviewEvents,
  classifyProgramTimbre,
  getGmInstrumentName,
  SYNTH_TIMBRE_LABEL_ZH,
} from '../../core/midiMix';
import type { MidiTrackRole } from '../../state/midiLibrary';
import { useOptionalAudioEngine } from '../AudioContext';
import { displayNoteNameInKey } from '../noteLabel';

interface TrackMixModalProps {
  open: boolean;
  songTitle: string;
  asset: MidiAsset;
  bars: readonly MidiBarInfo[];
  roles: Record<number, MidiTrackRole>;
  originalKey: Key;
  a4: number;
  onChangeRole: (trackIndex: number, role: MidiTrackRole) => void;
  onDone: () => void;
}

const ROLE_OPTIONS: readonly { value: MidiTrackRole; label: string }[] = [
  { value: 'vocal', label: '主唱' },
  { value: 'accompaniment', label: '伴奏' },
  { value: 'rhythm', label: '節奏組' },
  { value: 'mute', label: '不播' },
];

function formatTrackTitle(track: MidiTrack): string {
  const num = track.index + 1;
  const trimmed = track.name.trim();
  const isDefault = !trimmed || trimmed === `旋律軌 ${num}`;
  return isDefault ? `第 ${num} 軌` : `第 ${num} 軌 ${trimmed}`;
}

/** 匯入或重設 MIDI 分軌角色畫面（主唱／伴奏／節奏組／不播＋試聽） */
export function TrackMixModal({
  open,
  songTitle,
  asset,
  bars,
  roles,
  originalKey,
  a4,
  onChangeRole,
  onDone,
}: TrackMixModalProps) {
  const engine = useOptionalAudioEngine();
  const [previewTrackIdx, setPreviewTrackIdx] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!engine) return;
    return engine.onEnded(() => {
      setPreviewTrackIdx(null);
    });
  }, [engine]);

  useEffect(() => {
    if (!open && previewTrackIdx !== null) {
      engine?.stop();
      setPreviewTrackIdx(null);
    }
  }, [open, previewTrackIdx, engine]);

  useEffect(() => {
    return () => {
      engine?.stop();
    };
  }, [engine]);

  if (!open) {
    return null;
  }

  const nonEmptyTracks = asset.tracks
    .filter((t) => t.notes.length > 0)
    .sort((a, b) => a.index - b.index);

  let vocalCount = 0;
  let accompCount = 0;
  let rhythmCount = 0;
  for (const t of nonEmptyTracks) {
    const r = roles[t.index] ?? 'accompaniment';
    if (r === 'vocal') vocalCount++;
    else if (r === 'accompaniment') accompCount++;
    else if (r === 'rhythm') rhythmCount++;
  }

  async function handleTogglePreview(track: MidiTrack) {
    if (!engine) return;
    setPreviewError(null);
    if (previewTrackIdx === track.index) {
      engine.stop();
      setPreviewTrackIdx(null);
      return;
    }

    try {
      engine.stop();
      await engine.unlock();
      await engine.init();
      await engine.unlock();

      const role = roles[track.index] ?? 'accompaniment';
      const preview = buildTrackPreviewEvents({
        track,
        bars,
        role,
        rate: engine.sampleRate,
        a4,
        maxDurationSec: 8,
      });
      if (preview.events.length === 0) {
        setPreviewTrackIdx(null);
        return;
      }
      engine.setGain('master', 1);
      engine.setGain('accomp', 0.85);
      engine.setGain('rhythm', 0.85);
      engine.loadEvents(preview.events, preview.totalFrames);
      setPreviewTrackIdx(track.index);
      engine.play();
    } catch (err) {
      setPreviewTrackIdx(null);
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDoneClick() {
    if (previewTrackIdx !== null) {
      engine?.stop();
      setPreviewTrackIdx(null);
    }
    onDone();
  }

  return (
    <div
      className="modal-backdrop track-mix-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${songTitle} 分軌設定`}
    >
      <div className="modal-card track-mix-card">
        <div className="track-mix-head">
          <div>
            <h2>分軌設定：{songTitle}</h2>
            <p className="track-mix-subtitle">
              請指定 1 軌為主唱（畫譜與音準判斷），其餘可設為伴奏、節奏組或不播。
            </p>
          </div>
          <button
            type="button"
            className="track-mix-done-btn"
            disabled={vocalCount !== 1}
            onClick={handleDoneClick}
          >
            完成
          </button>
        </div>

        {previewError && (
          <p className="midi-notice-error" role="alert">
            試聽失敗：{previewError}
          </p>
        )}

        <ul className="track-mix-list">
          {nonEmptyTracks.map((track) => {
            const info = trackInfo(track);
            const role = roles[track.index] ?? 'accompaniment';
            const isDrum = track.channel === 9;
            const instName = getGmInstrumentName(track);
            const timbreLabel = isDrum
              ? '鼓組'
              : SYNTH_TIMBRE_LABEL_ZH[classifyProgramTimbre(track.program)];
            const rangeText = isDrum
              ? '打擊樂'
              : `${displayNoteNameInKey(info.low, originalKey)}–${displayNoteNameInKey(info.high, originalKey)}`;
            const isPreviewing = previewTrackIdx === track.index;

            return (
              <li
                key={track.index}
                className={`track-mix-row ${role === 'vocal' ? 'is-vocal' : ''}`}
              >
                <div className="track-mix-info">
                  <div className="track-mix-title-line">
                    <span className="track-mix-name">
                      {formatTrackTitle(track)}
                    </span>
                    <span className="track-mix-inst-badge">
                      {instName}
                      {!isDrum && instName !== timbreLabel
                        ? ` · ${timbreLabel}`
                        : ''}
                    </span>
                  </div>
                  <div className="track-mix-meta-line">
                    <span>音域 {rangeText}</span>
                    <span>·</span>
                    <span>{info.noteCount} 音</span>
                    <span>·</span>
                    <span>{info.polyphonic ? '複音' : '單音'}</span>
                  </div>
                </div>

                <div className="track-mix-controls">
                  <button
                    type="button"
                    className={`track-preview-btn ${isPreviewing ? 'is-playing' : ''}`}
                    aria-pressed={isPreviewing}
                    onClick={() => void handleTogglePreview(track)}
                  >
                    {isPreviewing ? '停止' : '試聽'}
                  </button>
                  <div
                    className="segmented-group track-role-group"
                    role="radiogroup"
                    aria-label={`${formatTrackTitle(track)} 軌道角色`}
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={role === opt.value}
                        className={`seg-btn ${role === opt.value ? 'is-active' : ''}`}
                        onClick={() => onChangeRole(track.index, opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="track-mix-foot">
          <span className="track-mix-summary">
            主唱 {vocalCount} 軌 · 伴奏 {accompCount} 軌 · 節奏組 {rhythmCount} 軌
          </span>
          {vocalCount !== 1 && (
            <span className="track-mix-warn" role="status">
              請選擇一軌作為「主唱」
            </span>
          )}
          <button
            type="button"
            className="track-mix-done-btn"
            disabled={vocalCount !== 1}
            onClick={handleDoneClick}
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
