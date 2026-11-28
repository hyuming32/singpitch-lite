import re
body=open('content.html',encoding='utf-8').read()
css=r'''
@page{size:A4;margin:16mm 15mm 18mm;
 @bottom-center{content:"第 " counter(page) " 頁";font:9pt "Noto Sans CJK TC";color:#888}
 @top-right{content:"SingPitch-Lite 使用手冊";font:8.5pt "Noto Sans CJK TC";color:#9aa}}
@page:first{margin:0;@bottom-center{content:none}@top-right{content:none}}
*{box-sizing:border-box}
body{font-family:"Noto Sans CJK TC","Noto Sans TC",sans-serif;font-size:10.8pt;line-height:1.65;color:#1d2433;margin:0}
.cover{height:297mm;width:210mm;background:linear-gradient(160deg,#0f172a 0%,#13203d 60%,#0b1222 100%);color:#e8eefc;padding:26mm 20mm;position:relative;page-break-after:always}
.cover .badge{display:inline-block;border:1px solid #4aa3ff;color:#8cc8ff;border-radius:20px;padding:3px 14px;font-size:9.5pt;letter-spacing:1px}
.cover h1{font-size:40pt;margin:14px 0 4px;font-weight:800;letter-spacing:.5px}
.cover h1 span{color:#4aa3ff}
.cover .sub{font-size:14pt;color:#b8c6e6;margin:0 0 18px}
.cover img.hero{width:100%;border-radius:10px;border:1px solid #2a3a5e;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.cover .feats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}
.cover .feat{background:#16233f;border:1px solid #263a63;border-radius:8px;padding:10px 12px}
.cover .feat b{color:#6ec1ff;display:block;font-size:11pt}
.cover .feat span{font-size:9.5pt;color:#c3cfe8}
.cover .foot{position:absolute;left:20mm;right:20mm;bottom:18mm;font-size:9.5pt;color:#9fb0d4;display:flex;justify-content:space-between;border-top:1px solid #2a3a5e;padding-top:8px}
.cover .logo{width:46px;height:46px;border-radius:10px;vertical-align:middle;margin-right:10px}
section{page-break-before:always}
section#toc{page-break-before:auto}
h2{font-size:17pt;margin:0 0 10px;color:#0f172a;border-bottom:2px solid #e3e9f5;padding-bottom:6px}
h2 .chap{display:inline-block;background:#1d6fe0;color:#fff;font-size:10pt;border-radius:4px;padding:2px 8px;margin-right:10px;vertical-align:middle;position:relative;top:-2px}
h3{font-size:12.5pt;color:#1d6fe0;margin:14px 0 6px;break-after:avoid;page-break-after:avoid}
h2{break-after:avoid}
p{margin:6px 0}
ul,ol{margin:6px 0 6px 1.3em;padding:0}
li{margin:3px 0}
table{border-collapse:collapse;width:100%;margin:8px 0 10px;font-size:9.8pt;page-break-inside:avoid}
th{background:#eef3fc;color:#123;text-align:left;font-weight:700}
th,td{border:1px solid #d7deeb;padding:5px 8px;vertical-align:top}
table.toc td:first-child{font-weight:700;white-space:nowrap;color:#0f172a;width:34%}
table.small,.small{font-size:9.3pt}
code{font-family:"Noto Sans Mono CJK TC",monospace;background:#f1f4fa;border-radius:3px;padding:0 3px;font-size:9pt;color:#0d5bbf}
figure{margin:10px 0 12px;text-align:center;page-break-inside:avoid}
figure img{max-width:100%;max-height:96mm;border-radius:8px;border:1px solid #d4dbe8;box-shadow:0 3px 10px rgba(15,23,42,.12)}
figcaption{font-size:9pt;color:#5b6780;margin-top:5px}
.tip,.note{border-radius:8px;padding:9px 12px;margin:10px 0;page-break-inside:avoid}
.tip{background:#ecf9f0;border-left:4px solid #22a25a}
.note{background:#fff6e6;border-left:4px solid #f0a01e}
ol.steps{list-style:none;margin:6px 0;padding:0;counter-reset:s}
ol.steps li{counter-increment:s;position:relative;padding:6px 10px 6px 40px;background:#f5f8fd;border:1px solid #e1e8f4;border-radius:8px;margin:5px 0}
ol.steps li::before{content:counter(s);position:absolute;left:10px;top:6px;width:20px;height:20px;border-radius:50%;background:#1d6fe0;color:#fff;font-size:10pt;text-align:center;line-height:20px;font-weight:700}
.shadow-demo{background:#f7f5ee;border:1px solid #e3dfd2;border-radius:10px;padding:10px 12px;margin:10px 0;page-break-inside:avoid}
.shadow-demo .row{display:flex;align-items:center;gap:6px;margin:4px 0}
.shadow-demo .lbl{width:68px;font-size:9.5pt;color:#555}
.shadow-demo .n,.shadow-demo .g,.shadow-demo .ok,.shadow-demo .hi,.shadow-demo .un{display:inline-block;width:42px;text-align:center;border-radius:6px;padding:3px 0;font-weight:700}
.shadow-demo .n{background:#1d2433;color:#fff}
.shadow-demo .n.blank{background:transparent}
.shadow-demo .g{background:#fff;border:1.5px dashed #1d6fe0;color:#1d6fe0;font-size:9.5pt}
.ok{color:#1f9d55;font-weight:700}.hi{color:#d63b3b;font-weight:700}.un{color:#8a8f99;font-weight:700}
'''
cover='''<div class="cover">
<div class="badge">USER MANUAL · 繁體中文使用手冊</div>
<h1><img class="logo" src="img/icon.png">SingPitch-<span>Lite</span></h1>
<p class="sub">網頁版音準練唱：音階、影子練習、MIDI 伴奏與歌詞</p>
<img class="hero" src="img/05_shadow.jpg">
<div class="feats">
<div class="feat"><b>影子練習</b><span>示範一個音、空一拍給你唱，只在空拍裡判斷，逐音標出準、偏高、偏低。</span></div>
<div class="feat"><b>30 種練唱音型</b><span>五聲、大小調、琶音、滑音警笛、半音階，自動依音域換調。</span></div>
<div class="feat"><b>MIDI 歌曲練唱</b><span>分軌伴奏混音、小節與拍點樂譜、進度拉桿、歌詞逐字變色。</span></div>
<div class="feat"><b>練習紀錄</b><span>每天練了什麼、練到哪個調、幾遍幾分鐘，可匯出 CSV。</span></div>
</div>
<div class="foot"><span>網址：https://sing.fun2young.com</span><span>手冊版本 2026-11-28 · Safari／Chrome／Edge</span></div>
</div>'''
html=f'<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><title>SingPitch-Lite 使用手冊</title><style>{css}</style></head><body>{cover}{body}</body></html>'
open('manual.html','w',encoding='utf-8').write(html)
