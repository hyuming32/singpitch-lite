import type { JianpuDisplayToken } from './miniStaffData';

interface JianpuLineProps {
  tokens: JianpuDisplayToken[];
  className?: string;
}

/** 渲染含高低音點、升降記號、延長線與滑音記號的簡譜列 */
export function JianpuLine({ tokens, className = '' }: JianpuLineProps) {
  return (
    <span className={`jianpu-line ${className}`.trim()}>
      {tokens.map((tok, idx) => {
        const upDots = tok.note.octave > 0 ? tok.note.octave : 0;
        const downDots = tok.note.octave < 0 ? Math.abs(tok.note.octave) : 0;
        const dashes = tok.beats > 1 ? Array.from({ length: tok.beats - 1 }) : [];

        return (
          <span key={idx} className="jianpu-token-group">
            <span className="jianpu-note">
              {upDots > 0 && (
                <span className="jianpu-dots jianpu-dots-up" aria-hidden="true">
                  {'•'.repeat(upDots)}
                </span>
              )}
              <span className="jianpu-core">
                {tok.note.accidental && (
                  <span className="jianpu-acc">{tok.note.accidental}</span>
                )}
                <span className="jianpu-digit">{tok.note.digit}</span>
              </span>
              {downDots > 0 && (
                <span className="jianpu-dots jianpu-dots-down" aria-hidden="true">
                  {'•'.repeat(downDots)}
                </span>
              )}
            </span>
            {dashes.map((_, di) => (
              <span key={`dash-${di}`} className="jianpu-dash">
                -
              </span>
            ))}
            {tok.glideToNext && <span className="jianpu-glide">~</span>}
          </span>
        );
      })}
    </span>
  );
}
