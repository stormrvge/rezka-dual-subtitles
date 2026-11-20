const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const corePath = path.join(__dirname, '../core.js');
const core = () => require(corePath);

test('parses SRT with BOM, CRLF, multiline text, markup and entities', () => {
  const text = '\ufeff1\r\n00:01:02,050 --> 00:01:04,900\r\n<i>One &amp; two</i>\r\n&#x41; &quot;B&quot;\r\n\r\n2\r\n00:01:05,000 --> 00:01:06,000\r\nNext\r\n';
  assert.deepEqual(core().parseSubtitles(text), [
    { start: 62.05, end: 64.9, text: 'One & two\nA "B"' },
    { start: 65, end: 66, text: 'Next' }
  ]);
});

test('parses VTT identifiers, cue settings and skips header, NOTE, STYLE and REGION blocks', () => {
  const text = `WEBVTT - subtitles\nKind: captions\n\nSTYLE\n::cue { color: red; }\n\nNOTE do not render\n00:00:01.000 --> 00:00:02.000\nComment\n\nREGION\nid:bottom\n\ncue-42\n01:02.500 --> 01:04.250 align:start position:20%\n<v Ann><c.green>Hello</c></v> <00:01:03.000>again\n\n00:01:05.000 --> 00:01:06.000\nSecond`;
  assert.deepEqual(core().parseSubtitles(text), [
    { start: 62.5, end: 64.25, text: 'Hello again' },
    { start: 65, end: 66, text: 'Second' }
  ]);
});

test('sorts cues and ignores malformed or empty blocks beside usable cues', () => {
  const text = `2\n00:00:04,000 --> 00:00:05,000\nLater\n\ninvalid\n00:99:03,000 --> 00:99:04,000\nBad minutes\n\n00:00:03.000 --> 00:00:02.000\nBackwards\n\n00:00:01.000 --> 00:00:01.000\nZero\n\n00:00:00.000 --> 00:00:01.000\n<b></b>\n\n1\n00:00:01,000 --> 00:00:03,000\nEarlier`;
  assert.deepEqual(core().parseSubtitles(text), [
    { start: 1, end: 3, text: 'Earlier' },
    { start: 4, end: 5, text: 'Later' }
  ]);
});

test('returns safe plain text and removes control characters and active markup content', () => {
  const text = '00:00:01.000 --> 00:00:03.000\n<script>alert(1)</script><b>OK</b> &lt;img src=x onerror=bad&gt; &#x1F642; &ndash; &nbsp;\n\u0000Text';
  assert.deepEqual(core().parseSubtitles(text), [
    { start: 1, end: 3, text: 'OK  🙂 –\nText' }
  ]);
});

test('decodes Latin named entities and uppercase basic HTML entities', () => {
  const cues = core().parseSubtitles('00:00:01.000 --> 00:00:02.000\nCaf&eacute; &Ouml; &AMP; &#169; &LT;b&GT;text&LT;/b&GT;');
  assert.equal(cues[0].text, 'Café Ö & © text');
});

test('rejects empty, HTML, JSON and files containing no valid cues', () => {
  for (const text of ['', 'garbage', '<!doctype html><html><body>Denied</body></html>', '{"error":"denied"}', '[{"start":1}]', 'WEBVTT\n\n00:00:90.000 --> 00:00:91.000\nBad']) {
    assert.throws(() => core().parseSubtitles(text), /субтитр|SRT|VTT/i, text);
  }
  assert.throws(() => core().parseSubtitles(null), /субтитр|SRT|VTT/i);
});

test('parses PlayerJS tracks, label-to-language map and fallback URLs without splitting URL commas', () => {
  const value = '[Русский]https://cdn.example/ru,v1.vtt?token=a,b or //backup.example/ru.vtt,[Українська]/ua.vtt,[English]https://cdn.example/en.vtt';
  const tracks = core().parseTrackList(value, { Русский: 'ru', English: 'en', Українська: 'ua' }, 'https://hdrezka.sb/show');
  assert.deepEqual(tracks, [
    { id: 'ru-0', label: 'Русский', lang: 'ru', urls: ['https://cdn.example/ru,v1.vtt?token=a,b', 'https://backup.example/ru.vtt'] },
    { id: 'ua-1', label: 'Українська', lang: 'ua', urls: ['https://hdrezka.sb/ua.vtt'] },
    { id: 'en-2', label: 'English', lang: 'en', urls: ['https://cdn.example/en.vtt'] }
  ]);
});

test('infers English/Russian labels and gives duplicate-language tracks unique stable ids', () => {
  const tracks = core().parseTrackList('[English CC]https://c.test/one.vtt,[Russian]https://c.test/two.srt,[EN]https://c.test/three.vtt');
  assert.deepEqual(tracks.map(({ id, lang }) => ({ id, lang })), [
    { id: 'en-0', lang: 'en' }, { id: 'ru-1', lang: 'ru' }, { id: 'en-2', lang: 'en' }
  ]);
});

test('rejects unsafe track URLs and deduplicates fallback URLs', () => {
  const value = '[English]javascript:alert(1) or https://user:pass@c.test/a.vtt or https://c.test/a.vtt or https://c.test/a.vtt,[Русский]data:text/plain,test,[Unsafe]file:///a.vtt';
  assert.deepEqual(core().parseTrackList(value), [
    { id: 'en-0', label: 'English', lang: 'en', urls: ['https://c.test/a.vtt'] }
  ]);
  for (const value of [null, '', '[English]', '[English]  or  ', 'https://c.test/no-label.vtt', '{}']) assert.deepEqual(core().parseTrackList(value), []);
});

test('active text includes every overlapping cue using half-open intervals and handles backward seeks', () => {
  const cues = [
    { start: 3, end: 5, text: 'Later' },
    { start: 1, end: 4, text: 'Earlier' },
    { start: 1, end: 3, text: 'Same start' }
  ];
  const times = [0, 1, 2.9, 3, 4, 5, 2, 1, -1, NaN, Infinity];
  const expected = ['', 'Earlier\nSame start', 'Earlier\nSame start', 'Earlier\nLater', 'Later', '', 'Earlier\nSame start', 'Earlier\nSame start', '', '', ''];
  assert.deepEqual(times.map(time => core().activeText(cues, time)), expected);
  assert.equal(cues[0].text, 'Later', 'lookup must not reorder the caller array');
  assert.equal(core().activeText([], 1), '');
});

test('indexed lookup agrees with a direct timeline across dense overlap and random seeks', () => {
  const cues = Array.from({ length: 1200 }, (_, i) => ({ start: i / 4, end: i / 4 + (i % 19) / 3 + 0.1, text: String(i) }));
  cues.unshift({ start: 0, end: 10000, text: 'Long cue' });
  let seed = 7;
  for (let i = 0; i < 500; i++) {
    seed = (seed * 16807) % 2147483647;
    const time = (seed % 31000) / 100;
    const expected = cues.filter(c => c.start <= time && time < c.end).map(c => c.text).join('\n');
    assert.equal(core().activeText(cues, time), expected);
  }
});

test('picks a requested primary language and returns null when absent', () => {
  const tracks = core().parseTrackList('[Русский]https://c.test/ru.vtt,[English CC]https://c.test/en.vtt');
  assert.equal(core().pickTrack(tracks, 'en-US'), tracks[1]);
  assert.equal(core().pickTrack(tracks, 'RU'), tracks[0]);
  assert.equal(core().pickTrack(tracks, 'de'), null);
  assert.equal(core().pickTrack([], 'en'), null);
});

test('exports the same four functions in a browser without CommonJS', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(corePath, 'utf8'), context);
  assert.deepEqual(Object.keys(context.RezkaSubtitlesCore).sort(), ['activeText', 'parseSubtitles', 'parseTrackList', 'pickTrack']);
  assert.equal(context.RezkaSubtitlesCore.activeText([], 1), '');
});
