const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'bridge.js');
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const flush = () => new Promise(resolve => setImmediate(resolve));
const endpoint = '/ajax/get_cdn_series/';
const body = episode => `id=1931&translator_id=238&season=1&episode=${episode}&action=get_stream`;

function harness(scripts = [], fetchImpl = () => Promise.reject(new Error('Unexpected fetch'))) {
  const listeners = new Map();
  const docListeners = new Map();
  const messages = [];
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  class XHR {
    constructor() { this.listeners = new Map(); this.responseType = ''; this.status = 0; }
    open(method, url) { this.method = method; this.url = url; }
    send(data) { this.sent = data; }
    addEventListener(name, fn) { const list = this.listeners.get(name) || []; list.push(fn); this.listeners.set(name, list); }
    respond(data, status = 200) {
      this.status = status;
      this.responseText = typeof data === 'string' ? data : JSON.stringify(data);
      this.response = this.responseType === 'json' ? data : this.responseText;
      for (const fn of this.listeners.get('load') || []) fn.call(this);
    }
  }
  const location = { origin: 'https://hdrezka.sb', href: 'https://hdrezka.sb/series/show.html', hash: '' };
  const document = {
    scripts: scripts.map(textContent => ({ textContent })),
    addEventListener(name, fn) { const list = docListeners.get(name) || []; list.push(fn); docListeners.set(name, list); },
    querySelectorAll() { return []; },
    documentElement: {},
  };
  const sandbox = {
    document, location, URL, URLSearchParams, Request, Response, TextEncoder, TextDecoder,
    AbortController, FormData, Uint8Array, console, XMLHttpRequest: XHR,
    fetch(...args) { calls.push(args); return fetchImpl(...args); },
    addEventListener(name, fn) { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); },
    postMessage(data, origin) { messages.push({ ...JSON.parse(JSON.stringify(data)), targetOrigin: origin }); },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class { observe() {} },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  return {
    context, messages, calls, timers, document, location,
    runAgain() { vm.runInContext(source, context); },
    message(data, overrides = {}) {
      for (const fn of listeners.get('message') || []) fn({ data, source: vm.runInContext('window', context), origin: location.origin, ...overrides });
    },
    event(name) { for (const fn of listeners.get(name) || []) fn({}); },
    click(dataset = { season_id: '1', episode_id: '2' }, active = false) {
      const element = { dataset, classList: { contains: name => name === 'active' && active }, getAttribute(name) { return name.startsWith('data-') ? dataset[name.slice(5).replaceAll('-', '_')] : null; } };
      for (const fn of docListeners.get('click') || []) fn({ target: { closest: selector => selector === '.b-simple_episode__item' ? element : null } });
    },
    xhr(episode) { const xhr = new context.XMLHttpRequest(); xhr.open('POST', endpoint); xhr.send(body(episode)); return xhr; },
  };
}

function tracks(h) { return h.messages.filter(message => message.type === 'tracks'); }

test('initial JSON literals decode escaped unicode and slashes without exposing video fields', () => {
  const h = harness(['sof.tv.initCDNSeriesEvents(1931, 0, false, {"url":"https://video.invalid/movie.mp4","subtitle":"[\\u0420\\u0443\\u0441\\u0441\\u043a\\u0438\\u0439]https:\\/\\/cdn.invalid\\/ru.vtt","subtitle_lns":{"Русский":"ru"}});']);
  h.message({ source: 'rezka-dual-content', type: 'scan' });
  const last = tracks(h).at(-1);
  assert.equal(last?.subtitle, '[Русский]https://cdn.invalid/ru.vtt');
  assert.deepEqual(last.subtitle_lns, { Русский: 'ru' });
  assert.equal(last.targetOrigin, 'https://hdrezka.sb');
  assert.equal(last.source, 'rezka-dual-bridge');
  assert.equal(Object.hasOwn(last, 'url'), false);
  assert.equal(typeof last.generation, 'number');
  assert.equal(typeof last.context, 'string');
});

test('absent metadata emits no false empty tracks and never evaluates executable object literals', () => {
  const h = harness(['sof.tv.initCDNSeriesEvents({subtitle:(window.executed = true)});']);
  h.message({ source: 'rezka-dual-content', type: 'scan' });
  assert.equal(tracks(h).length, 0);
  assert.equal(h.context.executed, undefined);
});

test('subtitle false clears metadata as an empty string', () => {
  const h = harness();
  h.xhr(1).respond({ success: true, subtitle: false, url: 'video.mp4' });
  assert.equal(tracks(h).at(-1)?.subtitle, '');
  assert.deepEqual(tracks(h).at(-1).subtitle_lns, {});
});

test('XHR starts a reset and only the latest request may publish tracks', () => {
  const h = harness();
  const old = h.xhr(1);
  const current = h.xhr(2);
  assert.equal(h.messages.filter(m => m.type === 'reset').length, 2);
  current.respond({ subtitle: '[English]https://cdn.invalid/new.vtt', subtitle_lns: { English: 'en' } });
  old.respond({ subtitle: '[English]https://cdn.invalid/old.vtt' });
  assert.equal(tracks(h).length, 1);
  assert.match(tracks(h)[0].subtitle, /new\.vtt$/);
  assert.match(tracks(h)[0].context, /episode=2/);
  assert.match(tracks(h)[0].context, /translator_id=238/);
  assert.equal(tracks(h)[0].generation, h.messages.filter(m => m.type === 'reset').at(-1).generation);
});

test('non-stream requests and malformed responses do not erase or publish metadata', () => {
  const h = harness();
  const xhr = new h.context.XMLHttpRequest();
  xhr.open('POST', endpoint);
  xhr.send('action=get_episodes');
  xhr.respond({ subtitle: '[English]https://cdn.invalid/incorrect.vtt' });
  assert.equal(h.messages.length, 0);
  h.xhr(1).respond('{bad json');
  assert.equal(tracks(h).length, 0);
});

test('fetch observes stream metadata through a clone and rejects stale responses', async () => {
  const pending = [];
  const h = harness([], () => new Promise(resolve => pending.push(resolve)));
  const old = h.context.fetch(endpoint, { method: 'POST', body: body(1) });
  const current = h.context.fetch(endpoint, { method: 'POST', body: body(2) });
  pending[1](new Response(JSON.stringify({ subtitle: '[English]https://cdn.invalid/current.vtt' })));
  const pageResponse = await current;
  assert.equal((await pageResponse.json()).subtitle, '[English]https://cdn.invalid/current.vtt');
  pending[0](new Response(JSON.stringify({ subtitle: '[English]https://cdn.invalid/old.vtt' })));
  await old;
  await flush();
  assert.equal(tracks(h).length, 1);
  assert.match(tracks(h)[0].subtitle, /current\.vtt$/);
});

test('fetch Request objects retain request-body episode context', async () => {
  const h = harness([], async () => new Response(JSON.stringify({ subtitle: false })));
  await h.context.fetch(new Request('https://hdrezka.sb/ajax/get_cdn_series/', { method: 'POST', body: body(9) }));
  await flush();
  assert.match(tracks(h).at(-1)?.context || '', /episode=9/);
});

test('episode clicks clear initial tracks and scans never resurrect the initial config', () => {
  const h = harness(['sof.tv.initCDNSeriesEvents({"subtitle":"[English]https://cdn.invalid/first.vtt"});']);
  h.message({ source: 'rezka-dual-content', type: 'scan' });
  const before = tracks(h).length;
  h.click();
  assert.equal(h.messages.at(-1)?.type, 'reset');
  h.message({ source: 'rezka-dual-content', type: 'scan' });
  assert.equal(tracks(h).length, before);
});

test('clicking the already-active episode retains initial metadata until a stream request starts', () => {
  const h = harness(['sof.tv.initCDNSeriesEvents({"subtitle":"[English]https://cdn.invalid/first.vtt"});']);
  const before = h.messages.length;
  h.click({ season_id: '1', episode_id: '1' }, true);
  assert.equal(h.messages.length, before);
  h.message({ source: 'rezka-dual-content', type: 'scan' });
  assert.match(tracks(h).at(-1).subtitle, /first\.vtt$/);
  h.xhr(1);
  assert.equal(h.messages.at(-1).type, 'reset');
});

test('hashchange after a current response does not clear its episode tracks', () => {
  const h = harness();
  h.click();
  h.xhr(2).respond({ subtitle: '[English]https://cdn.invalid/current.vtt' });
  const count = h.messages.length;
  h.location.hash = '#t:238-s:1-e:2';
  h.event('hashchange');
  assert.equal(h.messages.length, count);
  h.location.hash = '#t:238-s:1-e:3';
  h.event('hashchange');
  assert.equal(h.messages.at(-1)?.type, 'reset');
});

test('reinjection is idempotent and scan republishes cached current metadata', () => {
  const h = harness();
  h.runAgain();
  h.xhr(1).respond({ subtitle: '[English]https://cdn.invalid/current.vtt' });
  assert.equal(tracks(h).length, 1);
  h.message({ source: 'rezka-dual-content', type: 'scan' });
  assert.equal(tracks(h).length, 2);
});

test('subtitle fetch uses the original fetch, omits credentials and returns text', async () => {
  const h = harness([], async () => new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nHello'));
  h.message({ source: 'rezka-dual-content', type: 'fetch', id: 'sub1', url: 'https://cdn.invalid/en.vtt?x=1' });
  await flush();
  const result = h.messages.find(m => m.type === 'fetch-result');
  assert.equal(result?.id, 'sub1');
  assert.match(result.text, /^WEBVTT/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1].credentials, 'omit');
  assert.equal(h.messages.some(m => m.type === 'reset'), false);
  assert.equal(h.timers.size, 0);
});

test('subtitle fetch rejects video, credential-bearing and non-HTTP URLs before network access', async () => {
  const h = harness();
  for (const [id, url] of [['video', 'https://cdn.invalid/movie.mp4'], ['credentials', 'https://user:pass@cdn.invalid/en.vtt'], ['scheme', 'file:///tmp/en.vtt']]) {
    h.message({ source: 'rezka-dual-content', type: 'fetch', id, url });
  }
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.filter(m => m.type === 'fetch-result' && m.error).length, 3);
});

test('subtitle fetch rejects oversized bodies and video response types', async () => {
  const h = harness([], async url => url.endsWith('huge.vtt')
    ? new Response('x', { headers: { 'Content-Length': String(5 * 1024 * 1024 + 1) } })
    : new Response('video', { headers: { 'Content-Type': 'video/mp4' } }));
  h.message({ source: 'rezka-dual-content', type: 'fetch', id: 'huge', url: 'https://cdn.invalid/huge.vtt' });
  h.message({ source: 'rezka-dual-content', type: 'fetch', id: 'video', url: 'https://cdn.invalid/video.vtt' });
  await flush();
  assert.equal(h.messages.filter(m => m.type === 'fetch-result' && m.error).length, 2);
  assert.equal(h.messages.some(m => m.text), false);
});

test('foreign-window or foreign-origin messages cannot request subtitle fetches', async () => {
  const h = harness();
  h.message({ source: 'rezka-dual-content', type: 'fetch', id: 'a', url: 'https://cdn.invalid/a.vtt' }, { source: {} });
  h.message({ source: 'rezka-dual-content', type: 'fetch', id: 'b', url: 'https://cdn.invalid/b.vtt' }, { origin: 'https://foreign.invalid' });
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.length, 0);
});

test('a delayed Request body cannot resurrect metadata after an episode click', async () => {
  let releaseBody;
  const h = harness([], async () => new Response(JSON.stringify({ subtitle: '[English]https://cdn.invalid/old.vtt' })));
  const request = {
    url: 'https://hdrezka.sb/ajax/get_cdn_series/',
    clone: () => ({ text: () => new Promise(resolve => { releaseBody = resolve; }) }),
  };
  const result = h.context.fetch(request);
  h.click();
  const count = h.messages.length;
  releaseBody(body(1));
  await result;
  assert.equal(h.messages.length, count);
  assert.equal(tracks(h).length, 0);
});

test('subtitle size is bounded even when Content-Length is absent', async () => {
  const h = harness([], async () => new Response(new Uint8Array(5 * 1024 * 1024 + 1)));
  h.message({ source: 'rezka-dual-content', type: 'fetch', id: 'stream', url: 'https://cdn.invalid/en.vtt' });
  await flush();
  const result = h.messages.find(m => m.type === 'fetch-result');
  assert.ok(result?.error);
  assert.equal(result.text, undefined);
});

test('subtitle request aborts after twelve seconds and reports a recoverable error', async () => {
  const h = harness([], (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  }));
  h.message({ source: 'rezka-dual-content', type: 'fetch', id: 'timeout', url: 'https://cdn.invalid/en.vtt' });
  const timer = [...h.timers.values()][0];
  assert.equal(timer?.ms, 12000);
  timer.fn();
  await flush();
  assert.ok(h.messages.find(m => m.type === 'fetch-result')?.error);
  assert.equal(h.timers.size, 0);
});
