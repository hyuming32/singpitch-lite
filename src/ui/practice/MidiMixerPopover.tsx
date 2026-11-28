import {
  DEFAULT_MIDI_MIXER,
  type MidiMixerSettings,
} from '../../state/midiLibrary';

interface MidiMixerPopoverProps {
  open: boolean;
  mixer: MidiMixerSettings;
  hasAccompTracks: boolean;
  hasRhythmTracks: boolean;
  onChange: (next: MidiMixerSettings) => void;
  onClose: () => void;
}

interface ChannelRowDef {
  key: 'vocal' | 'accomp' | 'rhythm';
  label: string;
  enabledKey: 'vocalEnabled' | 'accompEnabled' | 'rhythmEnabled';
  volumeKey: 'vocalVolume' | 'accompVolume' | 'rhythmVolume';
  emptyHint?: string;
}

/** 練唱頁 MIDI 混音器小面板（主唱示範／伴奏／節奏組，各有開關與 0–100% 音量滑桿） */
export function MidiMixerPopover({
  open,
  mixer,
  hasAccompTracks,
  hasRhythmTracks,
  onChange,
  onClose,
}: MidiMixerPopoverProps) {
  if (!open) {
    return null;
  }

  const rows: ChannelRowDef[] = [
    {
      key: 'vocal',
      label: '主唱示範',
      enabledKey: 'vocalEnabled',
      volumeKey: 'vocalVolume',
    },
    {
      key: 'accomp',
      label: '伴奏',
      enabledKey: 'accompEnabled',
      volumeKey: 'accompVolume',
      ...(!hasAccompTracks ? { emptyHint: '（未指定伴奏軌）' } : {}),
    },
    {
      key: 'rhythm',
      label: '節奏組',
      enabledKey: 'rhythmEnabled',
      volumeKey: 'rhythmVolume',
      ...(!hasRhythmTracks ? { emptyHint: '（未指定節奏軌）' } : {}),
    },
  ];

  return (
    <div
      className="midi-mixer-popover"
      role="dialog"
      aria-label="MIDI 混音器"
    >
      <div className="midi-mixer-head">
        <span className="midi-mixer-title">混音器</span>
        <div className="midi-mixer-head-actions">
          <button
            type="button"
            className="midi-mixer-reset-btn"
            onClick={() => onChange({ ...DEFAULT_MIDI_MIXER })}
          >
            重設
          </button>
          <button
            type="button"
            className="midi-mixer-close-btn"
            aria-label="關閉混音器"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="midi-mixer-rows">
        {rows.map((row) => {
          const enabled = mixer[row.enabledKey];
          const volume = mixer[row.volumeKey];
          return (
            <div key={row.key} className="midi-mixer-row">
              <div className="midi-mixer-row-top">
                <label className="midi-mixer-toggle">
                  <input
                    type="checkbox"
                    checked={enabled}
                    aria-label={`${row.label}開關`}
                    onChange={(e) =>
                      onChange({
                        ...mixer,
                        [row.enabledKey]: e.target.checked,
                      })
                    }
                  />
                  <span className="midi-mixer-label">
                    {row.label}
                    {row.emptyHint && (
                      <small className="midi-mixer-empty-hint">
                        {row.emptyHint}
                      </small>
                    )}
                  </span>
                </label>
                <span className="midi-mixer-val">{volume}%</span>
              </div>
              <input
                type="range"
                className="setting-range midi-mixer-slider"
                aria-label={`${row.label}音量`}
                min={0}
                max={100}
                step={1}
                disabled={!enabled}
                value={volume}
                onChange={(e) =>
                  onChange({
                    ...mixer,
                    [row.volumeKey]: Number(e.target.value),
                  })
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
