import { describe, expect, it } from 'vitest';
import {
  alignLyricsToStaffLine,
  buildMidiLyricsDocument,
  convertLyricsToPassTime,
  decodeTextBytes,
  ERR_UNKNOWN_ENCODING,
  parseAss,
  parseKarokeJson,
  parseLrc,
  parseSubtitleFile,
  parseUltraStar,
  selectMidiLyricEvents,
  splitSingableTokens,
} from '../lyrics';
import { parseMidi, type MidiAsset } from '../midi';
import { buildMidiExercise } from '../midiExercise';
import { buildMidiLineGlyphs, buildMidiMeasurePages } from '../../ui/practice/midiLayout';

function encodeVlq(value: number): number[] {
  const bytes: number[] = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

function u16(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}

function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function metaEvent(delta: number, type: number, data: number[]): number[] {
  return [...encodeVlq(delta), 0xff, type, ...encodeVlq(data.length), ...data];
}

function tempoEvent(delta: number, tempo: number): number[] {
  return metaEvent(delta, 0x51, [
    (tempo >> 16) & 0xff,
    (tempo >> 8) & 0xff,
    tempo & 0xff,
  ]);
}

function endOfTrack(delta = 0): number[] {
  return metaEvent(delta, 0x2f, []);
}

function buildMidi(format: number, division: number, tracksData: number[][]): Uint8Array {
  const out: number[] = [
    ...ascii('MThd'),
    ...u32(6),
    ...u16(format),
    ...u16(tracksData.length),
    ...u16(division),
  ];
  for (const track of tracksData) {
    out.push(...ascii('MTrk'), ...u32(track.length), ...track);
  }
  return new Uint8Array(out);
}

describe('decodeTextBytes 編碼判斷（UTF-8 / BOM / Big5 / GBK / 錯誤）', () => {
  it('支援 UTF-8、UTF-8 BOM、UTF-16 LE/BE BOM 與 Big5 位元組假字', () => {
    // UTF-8 無 BOM
    const utf8Bytes = new TextEncoder().encode('一二 la');
    expect(decodeTextBytes(utf8Bytes).text).toBe('一二 la');
    expect(decodeTextBytes(utf8Bytes).encoding).toBe('utf-8');

    // UTF-8 BOM (EF BB BF)
    const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes]);
    expect(decodeTextBytes(utf8Bom)).toEqual({
      text: '一二 la',
      encoding: 'utf-8-bom',
    });

    // UTF-16 LE BOM (FF FE): '一'(0x4E00 -> 00 4E) '二'(0x4E8C -> 8C 4E)
    const utf16Le = new Uint8Array([0xff, 0xfe, 0x00, 0x4e, 0x8c, 0x4e]);
    expect(decodeTextBytes(utf16Le)).toEqual({
      text: '一二',
      encoding: 'utf-16le',
    });

    // UTF-16 BE BOM (FE FF)
    const utf16Be = new Uint8Array([0xfe, 0xff, 0x4e, 0x00, 0x4e, 0x8c]);
    expect(decodeTextBytes(utf16Be)).toEqual({
      text: '一二',
      encoding: 'utf-16be',
    });

    // Big5 假字（一=A4 40, 二=A4 54, 三=A4 54? 查正：Big5 一=0xA4 0x40, 二=0xA4 0x47, 三=0xA4 0x54；非合法 UTF-8）
    const big5Fake = new Uint8Array([0xa4, 0x40, 0xa4, 0x47, 0xa4, 0x54]);
    const big5Res = decodeTextBytes(big5Fake);
    expect(big5Res.encoding).toBe('big5');
    expect(big5Res.text).toBe('一二三');
  });

  it('全部解碼失敗時拋出「無法辨識字幕編碼」', () => {
    // 0x81 0x20（或單一孤立引導位元組 0x81）在 UTF-8 / Big5 / GBK 皆非法
    const invalid = new Uint8Array([0x81, 0x20, 0xfe, 0x39]);
    expect(() => decodeTextBytes(invalid)).toThrow(ERR_UNKNOWN_ENCODING);
  });
});

describe('splitSingableTokens 切詞規則', () => {
  it('漢字一字一個、注音合為一字、英文單字一個、標點不佔位', () => {
    expect(splitSingableTokens('一，二、三！')).toEqual(['一', '二', '三']);
    expect(splitSingableTokens('Hello, world!')).toEqual(['Hello', 'world']);
    expect(splitSingableTokens("I'm singing la la.")).toEqual([
      "I'm",
      'singing',
      'la',
      'la',
    ]);
    expect(splitSingableTokens('ㄐㄧㄢ 一 二')).toEqual(['ㄐㄧㄢ', '一', '二']);
  });
});

describe('parseMidi 內嵌歌詞與斷行規則', () => {
  it('讀取 Meta 0x05（Big5 整首判斷）並依同軌優先選取歌詞', () => {
    const t0 = [...tempoEvent(0, 500000), ...endOfTrack(0)];
    // 軌 1（非主唱，有 0x05）
    const t1 = [
      ...encodeVlq(0), 0x90, 60, 80,
      ...metaEvent(0, 0x05, [0x61]),
      ...encodeVlq(480), 0x80, 60, 0,
      ...endOfTrack(0),
    ];
    // 軌 2（主唱，Big5 '一' '二' '三' + '/' + '四' '五'）
    const t2 = [
      ...metaEvent(0, 0x05, [0xa4, 0x40]), // 一
      ...encodeVlq(0), 0x90, 64, 90,
      ...encodeVlq(480), 0x80, 64, 0,
      ...metaEvent(0, 0x05, [0xa4, 0x47]), // 二
      ...encodeVlq(0), 0x90, 65, 90,
      ...encodeVlq(480), 0x80, 65, 0,
      ...metaEvent(0, 0x05, [0xa4, 0x54, 0x2f]), // 三/
      ...encodeVlq(0), 0x90, 67, 90,
      ...encodeVlq(480), 0x80, 67, 0,
      ...metaEvent(0, 0x05, [0xa5, 0x7c]), // 四
      ...encodeVlq(0), 0x90, 69, 90,
      ...encodeVlq(480), 0x80, 69, 0,
      ...metaEvent(0, 0x05, [0xa4, 0xad]), // 五
      ...encodeVlq(0), 0x90, 71, 90,
      ...encodeVlq(480), 0x80, 71, 0,
      ...endOfTrack(0),
    ];

    const asset = parseMidi(buildMidi(1, 480, [t0, t1, t2]));
    expect(asset.lyricsEncoding).toBe('big5');
    expect(selectMidiLyricEvents(asset, 2).map((e) => e.text)).toEqual([
      '一',
      '二',
      '三/',
      '四',
      '五',
    ]);
    // 若指定無歌詞的軌 99，退回第一個有歌詞的軌（軌 1）
    expect(selectMidiLyricEvents(asset, 99).map((e) => e.text)).toEqual(['a']);

    const doc = buildMidiLyricsDocument(asset, 2);
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]!.tokens.map((t) => t.text)).toEqual(['一', '二', '三']);
    expect(doc.lines[1]!.tokens.map((t) => t.text)).toEqual(['四', '五']);
  });

  it('支援 .kar 的 Meta 0x01：略過 @ 檔頭並依 / 與 \\ 斷行', () => {
    const enc = (s: string) => [...new TextEncoder().encode(s)];
    const t0 = [
      ...tempoEvent(0, 500000),
      ...metaEvent(0, 0x01, enc('@KMIDI KARAOKE FILE')),
      ...metaEvent(0, 0x01, enc('@TTest Song')),
      ...metaEvent(0, 0x01, enc('la ')),
      ...encodeVlq(0), 0x90, 60, 80,
      ...encodeVlq(480), 0x80, 60, 0,
      ...metaEvent(0, 0x01, enc('la/')),
      ...encodeVlq(0), 0x90, 62, 80,
      ...encodeVlq(480), 0x80, 62, 0,
      ...metaEvent(0, 0x01, enc('do\\')),
      ...encodeVlq(0), 0x90, 64, 80,
      ...encodeVlq(480), 0x80, 64, 0,
      ...metaEvent(0, 0x01, enc('re')),
      ...encodeVlq(0), 0x90, 65, 80,
      ...encodeVlq(480), 0x80, 65, 0,
      ...endOfTrack(0),
    ];

    const asset = parseMidi(buildMidi(0, 480, [t0]));
    expect(asset.lyrics?.some((e) => e.text.startsWith('@'))).toBe(false);
    const doc = buildMidiLyricsDocument(asset, 0);
    expect(doc.lines).toHaveLength(3);
    expect(doc.lines[0]!.tokens.map((t) => t.text)).toEqual(['la', 'la']);
    expect(doc.lines[1]!.tokens.map((t) => t.text)).toEqual(['do']);
    expect(doc.lines[2]!.tokens.map((t) => t.text)).toEqual(['re']);
  });

  it('無斷行符號時依主唱休止 >= 1 拍斷行，且每行最多 20 字', () => {
    const enc = (s: string) => [...new TextEncoder().encode(s)];
    const t0: number[] = [...tempoEvent(0, 500000)];
    // 先連續 23 個每拍 1 字（無休止）-> 應拆成 20 字 + 3 字
    for (let i = 0; i < 23; i++) {
      t0.push(...metaEvent(0, 0x05, enc('字')));
      t0.push(...encodeVlq(0), 0x90, 60, 80);
      t0.push(...encodeVlq(480), 0x80, 60, 0);
    }
    // 休止 1 拍（480 ticks）後接 2 個字 -> 另起一行
    t0.push(...metaEvent(480, 0x05, enc('一')));
    t0.push(...encodeVlq(0), 0x90, 62, 80);
    t0.push(...encodeVlq(480), 0x80, 62, 0);
    t0.push(...metaEvent(0, 0x05, enc('二')));
    t0.push(...encodeVlq(0), 0x90, 64, 80);
    t0.push(...encodeVlq(480), 0x80, 64, 0);
    t0.push(...endOfTrack(0));

    const asset = parseMidi(buildMidi(0, 480, [t0]));
    const doc = buildMidiLyricsDocument(asset, 0);
    expect(doc.lines).toHaveLength(3);
    expect(doc.lines[0]!.tokens).toHaveLength(20);
    expect(doc.lines[1]!.tokens).toHaveLength(3);
    expect(doc.lines[2]!.tokens.map((t) => t.text)).toEqual(['一', '二']);
  });
});

describe('字幕格式解析（LRC / ASS / UltraStar / JSON 與錯誤行號）', () => {
  it('LRC：支援 [ti:]、[ar:]、[offset]、多時間標籤、enhanced 逐字時間與無逐字平均分配（上限 8 秒）', () => {
    const lrc = [
      '[ti:測試曲]',
      '[ar:測試者]',
      '[offset:+500]',
      '[00:01.00][00:20.00]一，二！',
      '[00:03.00]<00:03.00>la <00:03.50>la<00:04.00>',
      '[00:30.00]三四',
    ].join('\n');

    const doc = parseLrc(lrc);
    expect(doc.title).toBe('測試曲');
    expect(doc.artist).toBe('測試者');
    expect(doc.lines).toHaveLength(4);

    // 第 1 行：01.00 + 0.5 = 1.5s，下一行 03.00 + 0.5 = 3.5s，均分給 2 個漢字（標點不佔時）
    expect(doc.lines[0]!.time).toBeCloseTo(1.5, 5);
    expect(doc.lines[0]!.tokens).toEqual([
      { text: '一', start: 1.5, end: 2.5 },
      { text: '二', start: 2.5, end: 3.5 },
    ]);

    // 第 2 行：enhanced 逐字時間也套用 offset +0.5s
    expect(doc.lines[1]!.tokens).toEqual([
      { text: 'la', start: 3.5, end: 4.0 },
      { text: 'la', start: 4.0, end: 4.5 },
    ]);

    // 第 3 行：多時間標籤 [00:20.00] -> 20.5s，距離下一行 30.5s 超過 8 秒，最多分配 8 秒
    expect(doc.lines[2]!.time).toBeCloseTo(20.5, 5);
    expect(doc.lines[2]!.tokens[0]!.end).toBeCloseTo(24.5, 5);
    expect(doc.lines[2]!.tokens[1]!.end).toBeCloseTo(28.5, 5);
  });

  it('ASS：只讀 [Events] 含 \\k / \\kf / \\K 的 Dialogue，\\N 換空白並移除其他 {} 標籤', () => {
    const ass = [
      '[Script Info]',
      'Title: Test',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,無標記要略過',
      'Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,{\\c&HFFFFFF&}{\\k50}一\\N{\\kf100}二{\\K50}la',
    ].join('\n');

    const doc = parseAss(ass);
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]!.text).toBe('一 二la');
    expect(doc.lines[0]!.tokens).toEqual([
      { text: '一', start: 5.0, end: 5.5 },
      { text: '二', start: 5.5, end: 6.5 },
      { text: 'la', start: 6.5, end: 7.0 },
    ]);
  });

  it('UltraStar .txt：BPM/GAP 時間換算、: * F、~ 延長上一字、- 換行、E 結束', () => {
    // BPM=150 -> beatSec = 60/(150*4) = 0.1s；GAP=1000ms -> 1.0s
    const txt = [
      '#BPM:150',
      '#GAP:1000',
      ': 0 4 60 一',
      '* 4 4 62 ~',
      'F 8 4 64 二',
      '-',
      ': 16 4 65 la ',
      ': 20 4 67 la',
      'E',
      ': 30 4 60 ignored',
    ].join('\n');

    const doc = parseUltraStar(txt);
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]!.tokens[0]).toEqual({ text: '一', start: 1.0, end: 1.8 });
    expect(doc.lines[0]!.tokens[1]).toEqual({ text: '二', start: 1.8, end: 2.2 });
    expect(doc.lines[1]!.tokens).toHaveLength(2);
    expect(doc.lines[1]!.tokens[0]!.text).toBe('la');
    expect(doc.lines[1]!.tokens[0]!.start).toBeCloseTo(2.6, 6);
    expect(doc.lines[1]!.tokens[0]!.end).toBeCloseTo(3.0, 6);
    expect(doc.lines[1]!.tokens[1]!.text).toBe('la');
    expect(doc.lines[1]!.tokens[1]!.start).toBeCloseTo(3.0, 6);
    expect(doc.lines[1]!.tokens[1]!.end).toBeCloseTo(3.4, 6);
  });

  it('JSON：karoke-fun2young 最小形狀解析並忽略未知欄位', () => {
    const json = JSON.stringify({
      version: 1,
      extraRoot: true,
      lines: [
        {
          time: 2.5,
          text: '一二',
          unknownLineField: 'abc',
          tokens: [
            { t: '一', start: 2.5, end: 3.0, extraTok: 99 },
            { t: '二', start: 3.0, end: 3.5 },
          ],
        },
      ],
    });
    const doc = parseKarokeJson(json);
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]!.tokens).toEqual([
      { text: '一', start: 2.5, end: 3.0 },
      { text: '二', start: 3.0, end: 3.5 },
    ]);
  });

  it('超過 5000 行、單行超過 500 字與格式錯誤皆回傳含「第 N 行：」訊息', () => {
    const over5000 = Array.from(
      { length: 5001 },
      (_, i) => `[${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.00]a`,
    ).join('\n');
    expect(() => parseLrc(over5000)).toThrow(/^第 5001 行：/);

    const over500Chars = `[00:01.00]${'字'.repeat(501)}`;
    expect(() => parseLrc(over500Chars)).toThrow(/^第 1 行：/);

    const badAss = '[Events]\nFormat: Start, Layer\nDialogue: 0:00:01.00,0';
    expect(() => parseAss(badAss)).toThrow(/^第 2 行：/);

    const badUltra = '#BPM:120\n: bad line';
    expect(() => parseUltraStar(badUltra)).toThrow(/^第 2 行：/);

    const badJson = JSON.stringify({
      version: 1,
      lines: [{ time: 1, text: 'ok', tokens: [{ t: 'ok', start: 1, end: 2 }] }, { time: 'bad', text: 'x' }],
    });
    expect(() => parseKarokeJson(badJson)).toThrow(/^第 2 行：/);

    const rawBytes = new TextEncoder().encode('[00:01.00]la la');
    const parsedFile = parseSubtitleFile(rawBytes, 'demo.lrc');
    expect(parsedFile.lines).toHaveLength(1);
  });
});

describe('A–B 區間＋變速＋位移時間換算與音符對齊', () => {
  it('位移在減去 A–B 起點與除以速度倍率前加上', () => {
    const doc = parseLrc('[00:10.00]<00:10.00>一<00:11.00>二<00:12.00>');
    // 位移 +1.0s -> 原曲 11.0, 12.0；A-B 起點 9.0s -> 2.0, 3.0；變速 50% -> 4.0, 6.0
    const converted = convertLyricsToPassTime(doc, {
      offsetSec: 1.0,
      regionStartOrigSec: 9.0,
      regionEndOrigSec: 20.0,
      speedPercent: 50,
    });
    expect(converted.lines[0]!.tokens).toEqual([
      { text: '一', start: 4.0, end: 6.0 },
      { text: '二', start: 6.0, end: 8.0 },
    ]);
  });

  it('alignLyricsToStaffLine：<= 1/8 拍對上、跨音延長線 —、太密縮字與只標每拍第一字', () => {
    // 60 BPM (1 拍 = 1.0s, 1/8 拍 = 0.125s), 120 TPB
    // 音符：beat1=[0..0.5, 0.5..1.0], beat2=[1.0..1.5, 1.5..2.0], beat3=[2.0..4.0]
    const asset: MidiAsset = {
      tracks: [
        {
          index: 0,
          name: 'Vocal',
          notes: [
            { start: 0.0, end: 0.5, midi: 60, velocity: 90, track: 0, startTick: 0, endTick: 60 },
            { start: 0.5, end: 1.0, midi: 62, velocity: 90, track: 0, startTick: 60, endTick: 120 },
            { start: 1.0, end: 1.5, midi: 64, velocity: 90, track: 0, startTick: 120, endTick: 180 },
            { start: 1.5, end: 2.0, midi: 65, velocity: 90, track: 0, startTick: 180, endTick: 240 },
          ],
        },
      ],
      duration: 4.0,
      ticksPerBeat: 120,
      beats: [
        [0, 0, 60],
        [1, 1, 60],
        [2, 2, 60],
        [3, 3, 60],
      ],
    };
    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 1,
      countIn: false,
    });
    const pages = buildMidiMeasurePages(res.exercise, res.scoreBars, 680);
    const built = buildMidiLineGlyphs({
      page: pages[0]!,
      key: res.transposedKey,
      clef: 'treble',
      scoreWidth: 680,
      lineSpacing: 12,
      isFirstLineInPass: true,
      isLastPageInPass: true,
      passStartSec: 0,
    });

    // token0 偏移 +0.10s (<= 0.125s = 1/8 拍) 且持續跨過 0.5s 音符 -> 第 1 音「一」，第 2 音「—」
    // token1 偏移 +0.20s (> 1/8 拍) 不該對上 1.0s；token2 對上 1.5s
    const layoutNormal = alignLyricsToStaffLine({
      glyphs: built.glyphs,
      bars: pages[0]!.bars,
      passStartSec: 0,
      passLyrics: [
        {
          time: 0.1,
          text: '一 二',
          tokens: [
            { text: '一', start: 0.1, end: 0.9 },
            { text: '二', start: 1.55, end: 2.0 },
          ],
        },
      ],
      lyricsScale: 100,
      isTablet: true,
    });

    expect(layoutNormal.beatOnlyFallback).toBe(false);
    expect(layoutNormal.marks.map((m) => m.text)).toEqual(['一', '—', '二']);

    // 窄寬度 + 長字測試：無法縮字容納時降級只標每拍第一個字
    const builtNarrow = buildMidiLineGlyphs({
      page: pages[0]!,
      key: res.transposedKey,
      clef: 'treble',
      scoreWidth: 160,
      lineSpacing: 10,
      isFirstLineInPass: true,
      isLastPageInPass: true,
      passStartSec: 0,
    });
    const layoutDense = alignLyricsToStaffLine({
      glyphs: builtNarrow.glyphs,
      bars: pages[0]!.bars,
      passStartSec: 0,
      passLyrics: [
        {
          time: 0,
          text: 'supercalifragilistic',
          tokens: [
            { text: 'superlongword', start: 0.0, end: 0.5 },
            { text: 'anotherlong', start: 0.5, end: 1.0 },
            { text: 'thirdlong', start: 1.0, end: 1.5 },
            { text: 'fourthlong', start: 1.5, end: 2.0 },
          ],
        },
      ],
      lyricsScale: 140,
      isTablet: false,
    });

    expect(layoutDense.beatOnlyFallback).toBe(true);
    // 每拍只留 1 個字（beat 0 與 beat 1）
    expect(layoutDense.marks).toHaveLength(2);
    expect(layoutDense.marks.map((m) => m.text)).toEqual([
      'superlongword',
      'thirdlong',
    ]);
  });

  it('一行中只有一個小節過密時，其他小節顯示率不受影響，且多字元注音事件直排不觸發整行降級', () => {
    // 2 小節 @ 60 BPM (每小節 4 秒, 480 ticks/bar, 120 TPB)
    // 小節 1：beat 0 放 4 個 16 分音符 + 長英文詞（過密會降級為每拍 1 字）、beat 1 放 2 個 8 分音符（正常）
    // 小節 2：4 個四分音符，其中包含一個 3 字元注音事件「ㄐㄧㄢ」，應全部顯示不降級
    const asset: MidiAsset = {
      tracks: [
        {
          index: 0,
          name: 'Vocal',
          notes: [
            // Bar 1 beat 0: 4 個 16 分音符
            { start: 0.0, end: 0.24, midi: 60, velocity: 90, track: 0, startTick: 0, endTick: 29 },
            { start: 0.25, end: 0.49, midi: 62, velocity: 90, track: 0, startTick: 30, endTick: 59 },
            { start: 0.5, end: 0.74, midi: 64, velocity: 90, track: 0, startTick: 60, endTick: 89 },
            { start: 0.75, end: 0.99, midi: 65, velocity: 90, track: 0, startTick: 90, endTick: 119 },
            // Bar 1 beat 1: 2 個 8 分音符
            { start: 1.0, end: 1.49, midi: 67, velocity: 90, track: 0, startTick: 120, endTick: 179 },
            { start: 1.5, end: 1.99, midi: 69, velocity: 90, track: 0, startTick: 180, endTick: 239 },
            // Bar 2: 4 個四分音符
            { start: 4.0, end: 4.99, midi: 60, velocity: 90, track: 0, startTick: 480, endTick: 599 },
            { start: 5.0, end: 5.99, midi: 62, velocity: 90, track: 0, startTick: 600, endTick: 719 },
            { start: 6.0, end: 6.99, midi: 64, velocity: 90, track: 0, startTick: 720, endTick: 839 },
            { start: 7.0, end: 7.99, midi: 65, velocity: 90, track: 0, startTick: 840, endTick: 959 },
          ],
        },
      ],
      duration: 8.0,
      ticksPerBeat: 120,
      beats: [
        [0, 0, 60], [1, 1, 60], [2, 2, 60], [3, 3, 60],
        [4, 0, 60], [5, 1, 60], [6, 2, 60], [7, 3, 60],
      ],
    };

    const res = buildMidiExercise(asset, {
      trackIndex: 0,
      startBar: 1,
      endBar: 2,
      countIn: false,
    });
    const pages = buildMidiMeasurePages(res.exercise, res.scoreBars, 680);
    expect(pages).toHaveLength(1);
    const built = buildMidiLineGlyphs({
      page: pages[0]!,
      key: res.transposedKey,
      clef: 'treble',
      scoreWidth: 680,
      lineSpacing: 12,
      isFirstLineInPass: true,
      isLastPageInPass: true,
      passStartSec: 0,
    });

    const layout = alignLyricsToStaffLine({
      glyphs: built.glyphs,
      bars: pages[0]!.bars,
      passStartSec: 0,
      passLyrics: [
        {
          time: 0,
          text: 'test',
          tokens: [
            { text: 'superlong', start: 0.0, end: 0.25 },
            { text: 'wordtwo', start: 0.25, end: 0.5 },
            { text: 'wordthree', start: 0.5, end: 0.75 },
            { text: 'wordfour', start: 0.75, end: 1.0 },
            { text: '一', start: 1.0, end: 1.5 },
            { text: '二', start: 1.5, end: 2.0 },
            { text: '三', start: 4.0, end: 5.0 },
            { text: 'ㄐㄧㄢ', start: 5.0, end: 6.0 },
            { text: '四', start: 6.0, end: 7.0 },
            { text: '五', start: 7.0, end: 8.0 },
          ],
        },
      ],
      lyricsScale: 100,
      isTablet: true,
    });

    // Bar 1 beat 0 降級為每拍 1 字 (superlong)，Bar 1 beat 1 保留 (一, 二)，Bar 2 全數保留 (三, ㄐㄧㄢ, 四, 五)
    expect(layout.marks.map((m) => m.text)).toEqual([
      'superlong',
      '一',
      '二',
      '三',
      'ㄐㄧㄢ',
      '四',
      '五',
    ]);
    const bopomofoMark = layout.marks.find((m) => m.text === 'ㄐㄧㄢ');
    expect(bopomofoMark?.isVerticalStack).toBe(true);
    // 非降級小節（Bar 2）保留原本較大字級（>= 9 px）
    expect(bopomofoMark?.fontSize).toBe(12);
  });
});
