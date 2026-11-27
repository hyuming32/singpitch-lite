import type { PatternDef } from '../core/patterns';
import {
  switchVoiceSettings,
  type MaleClefOption,
  type PracticeSettings,
  type VoiceOption,
} from '../state/settings';

interface VoiceClefControlsProps {
  settings: PracticeSettings;
  pattern: Pick<PatternDef, 'jianpu'>;
  onUpdate: (patch: Partial<PracticeSettings>) => void;
}

const VOICE_OPTIONS: { value: VoiceOption; label: string }[] = [
  { value: 'normal', label: '正常（女聲）' },
  { value: 'male', label: '男聲' },
];

const MALE_CLEF_OPTIONS: {
  value: MaleClefOption;
  label: string;
  sub: string;
}[] = [
  { value: 'treble8va', label: '高音譜 8va', sub: '流行' },
  { value: 'bass', label: '低音譜', sub: '古典' },
];

/** 選單頁的聲部（「我是」）與男聲譜號分段控制 */
export function VoiceClefControls({
  settings,
  pattern,
  onUpdate,
}: VoiceClefControlsProps) {
  return (
    <div className="voice-clef-controls">
      <div className="voice-seg-row">
        <span className="voice-seg-label">我是</span>
        <div className="voice-seg-group" role="group" aria-label="我是">
          {VOICE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`voice-seg-btn ${settings.voice === opt.value ? 'is-active' : ''}`}
              aria-pressed={settings.voice === opt.value}
              onClick={() =>
                onUpdate(switchVoiceSettings(settings, opt.value, pattern))
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {settings.voice === 'male' && (
        <div className="voice-seg-row">
          <span className="voice-seg-label">譜號</span>
          <div className="clef-seg-group" role="group" aria-label="譜號">
            {MALE_CLEF_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`clef-seg-btn ${settings.maleClef === opt.value ? 'is-active' : ''}`}
                aria-pressed={settings.maleClef === opt.value}
                onClick={() => onUpdate({ maleClef: opt.value })}
              >
                <span className="clef-seg-main">{opt.label}</span>
                <span className="clef-seg-sub">{opt.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
