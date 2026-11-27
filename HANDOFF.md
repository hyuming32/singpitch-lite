# SingPitch-Lite 交接說明

## 位置
- 專案：/Users/corn/AI-Gemini/singpitch-lite（遠端 https://github.com/hyuming32/singpitch-lite ，main 推送後 GitHub Actions 自動部署）
- 線上：https://hyuming32.github.io/singpitch-lite/
- 歷次任務簡報：/Users/corn/AI-Gemini/GEMINI_BRIEF_singpitch_*.md（依時間：core_theory → pitch → midi_analysis → audio → menu → practice_view → clef → transport_v2 → piano_v2 → mic → keylist → shortvp → fix_octave_crash → v4 → bpm → range → cadence → v5）
- 示意圖：claude.ai 設計畫布「SingPitch-Lite 畫面示意圖」

## 環境與指令
    export PATH=/Users/corn/pinokio/bin/miniconda/bin:$PATH
    npm run dev                                      # 本機開發
    npx tsc -b && npx vitest run && npm run build    # 驗收（目前 41 檔 210 測試全過）
- Vite 5 + React 18 + TypeScript 5 + vitest 2；hash 路由；純 CSS（src/ui/app.css）；vite base './'。
- 不新增 npm 套件；未經 SID 同意不要提交或推送到 GitHub。

## 目錄
- src/core/：樂理與分析（notes、key、jianpu、staff、chords、patterns、exercise、yin、curve、midi、keyDetect、analysis）。YIN 逐行移植自桌面版 pitch_detector.py，勿改演算法。
- src/audio/：AudioWorklet 引擎（engine.ts、worklet/engine.worklet.ts、dsp/ piano・voice・click・schedule・mixer）。
- src/mic/：麥克風擷取 worklet、pitch worker、VoiceGate（喇叭漏音 vs 人聲）、取樣率實測、試唱測音域 rangeMeasure。
- src/state/：settings（localStorage singpitch-lite.settings.v1）、keySelection、vocalRange、errlog。
- src/ui/：首頁 PatternMenu＋VocalRangeCard、SettingsPanel、RangeTestSheet、practice/（PracticePage、StaffView、JianpuStrip、KeyStrip、TransportBar、viewportLayout、layout…）、piano/。

## 已定規格（重點）
- 音名一律國際寫法（中央 Do＝C4）。音域：男低 E2–E4、男中 A2–F4、男高 C3–C5、女低 F3–F5、女中 A3–A5、女高 C4–C6、我的音域（試唱測得後內縮 1 半音）、完整 C2–C6。
- 男聲＋高音譜 8va（預設）：譜、鋼琴、MIDI 高八度，黃線 +12；男聲＋低音譜：實際音高不位移。VoiceGate 一律用原始 Hz。
- 練唱：手機直拿＝直放三行版面，橫拿＝橫放版面；iPad 橫放。播放不自動開麥克風（只由麥克風鈕）。
- 換調提示和弦只在每調第 1 遍前播；🔁 ×1/2/3/5/∞（預設 ×2）；調名方塊可多選、長按拖動排序、「只練選的」。
- BPM 40.0–208.0、±1、可輸入一位小數。
- 待辦：錄音與成績、MIDI 匯入介面、自訂音型編輯器、練習紀錄。
