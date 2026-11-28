# SingPitch-Lite 交接說明

## 位置
- 專案：/Users/corn/AI-Gemini/singpitch-lite（遠端 https://github.com/hyuming32/singpitch-lite ，main 推送後 GitHub Actions 自動部署）
- 線上：https://hyuming32.github.io/singpitch-lite/
- 歷次任務簡報：/Users/corn/AI-Gemini/GEMINI_BRIEF_singpitch_*.md（依時間：core_theory → pitch → midi_analysis → audio → menu → practice_view → clef → transport_v2 → piano_v2 → mic → keylist → shortvp → fix_octave_crash → v4 → bpm → range → cadence → v5 → screenshot → midi_practice → practice_log → shadow → midi_v2 → midi_mix → lyrics_seek）
- 示意圖：claude.ai 設計畫布「SingPitch-Lite 畫面示意圖」

## 環境與指令
    export PATH=/Users/corn/pinokio/bin/miniconda/bin:$PATH
    npm run dev                                      # 本機開發
    npx tsc -b && npx vitest run && npm run build    # 驗收（目前 60 檔 337 測試全過）
- Vite 5 + React 18 + TypeScript 5 + vitest 2；hash 路由；純 CSS（src/ui/app.css）；vite base './'。
- 不新增 npm 套件；未經 SID 同意不要提交或推送到 GitHub。

## 目錄
- src/core/：樂理與分析（notes、key、jianpu、staff、chords、patterns、exercise、yin、curve、midi、keyDetect、analysis）。YIN 逐行移植自桌面版 pitch_detector.py，勿改演算法。
- src/audio/：AudioWorklet 引擎（engine.ts、worklet/engine.worklet.ts、dsp/ piano・voice・click・schedule・mixer）。
- src/mic/：麥克風擷取 worklet、pitch worker、VoiceGate（喇叭漏音 vs 人聲）、取樣率實測、試唱測音域 rangeMeasure。
- src/state/：settings（localStorage singpitch-lite.settings.v1）、keySelection、vocalRange、errlog、db（IndexedDB singpitch-lite 第 2 版：midi、practiceLog）、midiLibrary（每首設定 localStorage singpitch-lite.midi.v1）、practiceLogStore。
- src/ui/：首頁 PatternMenu＋VocalRangeCard、SettingsPanel、RangeTestSheet、practice/（PracticePage、StaffView、JianpuStrip、KeyStrip、TransportBar、viewportLayout、layout…）、piano/。

## 已定規格（重點）
- 音名一律國際寫法（中央 Do＝C4）。音域：男低 E2–E4、男中 A2–F4、男高 C3–C5、女低 F3–F5、女中 A3–A5、女高 C4–C6、我的音域（試唱測得後內縮 1 半音）、完整 C2–C6。
- 男聲＋高音譜 8va（預設）：譜、鋼琴、MIDI 高八度，黃線 +12；男聲＋低音譜：實際音高不位移。VoiceGate 一律用原始 Hz。
- 練唱：手機直拿＝直放三行版面，橫拿＝橫放版面；iPad 橫放。播放不自動開麥克風（只由麥克風鈕）。
- 換調提示和弦只在每調第 1 遍前播；🔁 ×1/2/3/5/∞（預設 ×2）；調名方塊可多選、長按拖動排序、「只練選的」。
- BPM 40.0–208.0、±1、可輸入一位小數。
- MIDI 練唱（src/core/midiExercise.ts、src/ui/midi/）：旋律軌（複音取最高音）、小節 A–B、移調 ±12、變速 50–150%、調性自動判斷可手改；五線譜依小節分頁；練唱中重新整理由 sessionStorage singpitch-lite.active-practice.v1 載回。第一版不做和弦判斷。
- 練習紀錄（src/core/practiceLog.ts、src/ui/log/）：秒數只算播放頭前進量；<10 秒不記；暫停 5 分鐘內同來源合併；CSV 含 BOM。
- 影子練習（mode 'shadow'，只在音階）：示範音後接靜音空拍（倍率 1／2），只在空拍內判斷（±25 cents、排除節拍器點後 60 ms、原始 Hz 對實際目標），每遍結果列不評分。
- MIDI v2：suggestMelodyTrack 先看軌名（vocal/melody/人聲…）、排除鼓；A–B 預設略過前奏；每個 note-on 都是獨立音（同音重複不合併）；量化到 16 分音符，畫小節線、拍號、拍點刻度、附點、連結線、休止符、符槓；簡譜減時線。已用〈分享〉對照 GarageBand 驗證第 7–10 小節。
- MIDI 分軌伴奏：匯入時分主唱／伴奏／節奏組／不播（主唱唯一），伴奏用內建合成音色（鋼琴、風琴、弦樂、貝斯、Karplus-Strong 吉他、鼓組），播放列「混音」面板三組音量與開關；事件分批送進 worklet（每批 512）。
- 歌詞與進度拉桿：parseMidi 讀 Meta 0x05／0x01（.kar），編碼 utf-8→big5→gbk；可匯入 .lrc／.ass／UltraStar .txt／karoke-fun2young .json（IndexedDB 第 3 版 lyrics store），字幕位移／提前／大小；音符下方標字（逐小節碰撞降級）、卡拉 OK 兩行歌詞帶、MidiSeekBar 拖拉對齊到拍。
- 本機測試 MIDI：/Users/corn/AI-Gemini/test-midi/（有版權，不進 git）。
- 推送：Gemini 工具不能 commit／push，把 worktree 的 git diff --binary 套到本資料夾，再用 GitHub Desktop 提交推送。網址 https://sing.fun2young.com
- 待辦：實機驗證伴奏聲音與效能、錄音與成績、自訂音型編輯器、區間 0 音時停用開始練唱。
