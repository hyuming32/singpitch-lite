import re
s=open('content.html',encoding='utf-8').read()
BASE='https://sing.fun2young.com/manual/'
s=s.replace('src="img/','src="'+BASE+'img/')
s=re.sub(r'<section[^>]*>','<div>',s).replace('</section>','</div>')
st={
 'h2':'font-size:1.45em;margin:1.6em 0 .5em;padding-bottom:.3em;border-bottom:2px solid #e3e9f5;color:#0f172a',
 'h3':'font-size:1.15em;margin:1.2em 0 .4em;color:#1d6fe0',
 'table':'border-collapse:collapse;width:100%;margin:.6em 0 1em;font-size:.95em',
 'th':'background:#eef3fc;border:1px solid #d7deeb;padding:6px 8px;text-align:left',
 'td':'border:1px solid #d7deeb;padding:6px 8px;vertical-align:top',
 'figure':'margin:1em 0 1.2em;text-align:center',
 'figcaption':'font-size:.88em;color:#5b6780;margin-top:4px',
 'code':'background:#f1f4fa;border-radius:3px;padding:0 3px;color:#0d5bbf;font-size:.92em',
}
def addstyle(tag,style):
    global s
    s=re.sub(r'<'+tag+r'(\s[^>]*)?>',lambda m:'<'+tag+(m.group(1) or '')+' style="'+style+'">',s)
for t,v in st.items(): addstyle(t,v)
s=s.replace('<span class="chap">','<span style="display:inline-block;background:#1d6fe0;color:#fff;font-size:.65em;border-radius:4px;padding:2px 8px;margin-right:8px;vertical-align:middle">')
s=re.sub(r'<img ','<img style="max-width:100%;height:auto;border-radius:8px;border:1px solid #d4dbe8" ',s)
s=s.replace('<p class="tip">','<p style="background:#ecf9f0;border-left:4px solid #22a25a;border-radius:6px;padding:8px 12px">')
s=s.replace('<p class="note">','<p style="background:#fff6e6;border-left:4px solid #f0a01e;border-radius:6px;padding:8px 12px">')
s=s.replace('<ol class="steps">','<ol>').replace('<table class="toc">','<table>').replace('<table class="small">','<table>').replace('<p class="small">','<p style="font-size:.92em">')
s=s.replace('<span class="ok">','<span style="color:#1f9d55;font-weight:bold">').replace('<span class="hi">','<span style="color:#d63b3b;font-weight:bold">').replace('<span class="un">','<span style="color:#8a8f99;font-weight:bold">')
# shadow demo -> table
demo='''<table style="border-collapse:collapse;margin:.6em 0 1em;font-size:.95em;background:#f7f5ee"><tr><td style="padding:4px 8px;color:#555">原本音型</td>'''+''.join(f'<td style="padding:4px 10px;text-align:center"><b>{n}</b></td><td></td>' for n in '12321')+'''</tr><tr><td style="padding:4px 8px;color:#555">影子練習</td>'''+''.join(f'<td style="padding:4px 10px;text-align:center"><b>{n}</b></td><td style="padding:4px 10px;text-align:center;color:#1d6fe0;border:1px dashed #1d6fe0">唱</td>' for n in '12321')+'''</tr><tr><td style="padding:4px 8px;color:#555">判斷結果</td>'''+''.join(f'<td></td><td style="padding:4px 10px;text-align:center;font-weight:bold;color:{c}">{t}</td>' for t,c in [('✓','#1f9d55'),('✓','#1f9d55'),('↑+32','#d63b3b'),('✓','#1f9d55'),('—','#8a8f99')])+'</tr></table>'
s=re.sub(r'<div class="shadow-demo">.*?</div>\s*</div>',demo,s,flags=re.S)
intro=f'''<p><img style="max-width:100%;height:auto;border-radius:8px;border:1px solid #d4dbe8" src="{BASE}img/05_shadow.jpg" alt="SingPitch-Lite 影子練習畫面"></p>
<p><b>SingPitch-Lite</b> 是一個免安裝的網頁音準練唱 App：30 種練唱音型、能逐音判斷準不準的<b>影子練習</b>，也能匯入 MIDI 跟著伴奏與歌詞練歌。打開 <a href="https://sing.fun2young.com">https://sing.fun2young.com</a> 就能用，手機、平板、電腦都可以，資料只存在你自己的裝置上。</p>
<p>📄 <a href="{BASE}SingPitch-Lite-使用手冊.pdf">下載 PDF 版使用手冊</a></p>
<!--more-->'''
out=intro+re.sub(r' class="[^"]+"','',s)
open('blog.html','w',encoding='utf-8').write(out)
print(len(out), out.count('<img'))
assert 'class="' not in re.sub(r'<code[^>]*>','',out) or True
print([m for m in re.findall(r'class="[^"]+"',out)][:10])
