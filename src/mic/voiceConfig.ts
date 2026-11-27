/** 人聲辨識與混亂偵測的所有可調門檻與權重常數 */
export const VOICE_CONFIG = {
  /** 與喇叭輸出音高（含 2 倍、1/2 倍頻）容許的最大音分差，超過即直接判為人聲 */
  PITCH_MATCH_CENTS: 35,
  /** 節拍器點擊聲遮蔽視窗（秒），[click, click + 60ms] 判為 unknown 且不計入混亂 */
  METRO_WINDOW_SEC: 0.06,
  /** 特徵統計滑動視窗（秒）：150 ms */
  FEATURE_WINDOW_SEC: 0.15,
  /** 顫音週期自相關偵測視窗（秒） */
  VIBRATO_WINDOW_SEC: 0.24,
  /** 計算 pitchStd 所需的最少有音高幀數 */
  MIN_STD_FRAMES: 3,

  /** 音高穩定度門檻（cents）：合成鋼琴數學上極穩定（< 1.5），人聲通常 > 4 */
  PIANO_PITCH_STD_MAX: 1.5,
  PIANO_PITCH_STD_MILD: 2.8,
  VOICE_PITCH_STD_MIN: 4.0,

  /** 顫音頻率範圍（Hz）與偵測門檻 */
  VIBRATO_MIN_HZ: 4.0,
  VIBRATO_MAX_HZ: 7.0,
  VIBRATO_MIN_STD_CENTS: 3.0,
  VIBRATO_MIN_SPAN_CENTS: 8.0,
  VIBRATO_HALF_NEG_AUTOCORR: -0.25,
  VIBRATO_FULL_POS_AUTOCORR: 0.25,

  /** 音量走勢門檻（dB） */
  DB_RISE_150MS_THRESHOLD: 3.0,
  DB_ABOVE_ENVELOPE_THRESHOLD: 6.0,
  /** 起音時間差門檻（秒）：< 30 ms 且特徵像鋼琴 → leak */
  ONSET_MATCH_SEC: 0.03,
  /** 起音後略過鋼琴起音爬升與 43ms 分析窗填滿期，才檢查 dB 上升 */
  POST_ATTACK_GUARD_SEC: 0.065,

  /** 加權分數權重（正分傾向 voice、負分傾向 leak） */
  W_PITCH_STD_VOICE: 0.45,
  W_PITCH_STD_LEAK: 0.45,
  W_PITCH_STD_MILD_LEAK: 0.25,
  W_VIBRATO_VOICE: 0.5,
  W_VOLUME_VOICE: 0.35,
  W_ONSET_LEAK: 0.3,

  /** 判定門檻 */
  SCORE_VOICE_THRESHOLD: 0.25,
  SCORE_LEAK_THRESHOLD: -0.25,

  /** 混亂偵測參數 */
  CONFUSION_WINDOW_SEC: 8.0,
  CONFUSION_NON_VOICE_RATIO: 0.7,
  CONFUSION_MIN_FRAMES: 120,
  CONFUSION_LEAK_STREAK_SEC: 5.0,
  CONFUSION_LEAK_PITCH_STD_MAX: 1.5,
  CONFUSION_JUMP_WINDOW_SEC: 1.0,
  CONFUSION_JUMP_SEMITONES: 3.0,
  CONFUSION_JUMP_MAX_COUNT: 6,
} as const;
