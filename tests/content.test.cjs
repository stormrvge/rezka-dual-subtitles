const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Core = require('../core.js');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const EN = 'WEBVTT\n\n00:00.000 --> 00:02.000\nFirst English\n\n00:02.000 --> 00:04.000\nSecond English';
const RU = 'WEBVTT\n\n00:00.000 --> 00:02.000\nПервая реплика\n\n00:02.000 --> 00:04.000\nВторая реплика';
const TRACKS = '[English]https://cdn.invalid/en.vtt,[Русский]https://cdn.invalid/ru.vtt';

// This DOM adapter exercises content lifecycle and async coordination. Actual
// browser layout, event propagation and MV3 injection have separate smoke tests.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.files = [];
    const classes = new Set();
    this.classList = {
      toggle(name, force) {
        const present = force === undefined ? !classes.has(name) : force;
        if (present) classes.add(name); else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    };
  }
  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }
  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter(fn => fn !== callback));
  }
  dispatch(name, values = {}) {
    const event = { target: this, stopPropagation() {}, preventDefault() {}, ...values };
    return Promise.all((this.listeners.get(name) || []).map(fn => fn(event)));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      const index = siblings.indexOf(this);
      if (index !== -1) siblings.splice(index, 1);
    }
    this.parentElement = null;
  }
  getBoundingClientRect() { return { width: 1280, height: 720 }; }
  closest() { return this.playerContainer || null; }
  contains(element) {
    for (let current = element; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  attachShadow() {
    const elements = new Map();
    this.shadowRoot = {
      set innerHTML(html) {
        for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
          const element = new Element(match[1]);
          element.id = match[3];
          element.hidden = /\bhidden\b/.test(match[2]);
          elements.set(element.id, element);
        }
      },
      getElementById(id) { return elements.get(id); },
    };
    return this.shadowRoot;
  }
}

function makeVideo() {
  const container = new Element('pjsdiv');
  container.id = 'oframecdnplayer';
  const video = new Element('video');
  video.playerContainer = container;
  video.currentTime = 0.5;
  video.textTracks = [{ kind: 'subtitles', mode: 'showing' }];
  container.append(video);
  return video;
}

function harness() {
  const documentEvents = new Element();
  const windowEvents = new Element();
  const runtimeListeners = [];
  const backgroundCalls = [];
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  let host;
  let video = makeVideo();
  const document = {
    fullscreenElement: null,
    createElement(tag) {
      const element = new Element(tag);
      if (!host && tag === 'div') host = element;
      return element;
    },
    querySelectorAll(selector) { return selector === 'video' ? [video] : []; },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
  };
  const sandbox = {
    document,
    location: { origin: 'https://hdrezka.sb', href: 'https://hdrezka.sb/series/show.html' },
    RezkaSubtitlesCore: Core,
    crypto: webcrypto,
    TextDecoder,
    console,
    getComputedStyle() { return { position: 'relative' }; },
    setInterval(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay, interval: true }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay, interval: false }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    postMessage(message, origin) { messages.push({ ...message, targetOrigin: origin }); },
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {
        onMessage: { addListener(callback) { runtimeListeners.push(callback); } },
        async sendMessage(message) {
          backgroundCalls.push(message);
          return { ok: false, error: 'Fixture denies fallback downloads.' };
        },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.__deliverMessage = (data, sourceWindow) => {
    for (const callback of windowEvents.listeners.get('message') || []) {
      callback({ data, source: sourceWindow, origin: sandbox.location.origin });
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);

  function message(data) {
    context.__incoming = { source: 'rezka-dual-bridge', ...data };
    vm.runInContext('__deliverMessage(__incoming, window)', context);
    delete context.__incoming;
  }
  return {
    messages, timers, backgroundCalls,
    get video() { return video; },
    get host() { return host; },
    $(id) { return host.shadowRoot.getElementById(id); },
    tracks(subtitle = TRACKS, generation = 0) {
      message({ type: 'tracks', generation, subtitle, subtitle_lns: { English: 'en', Русский: 'ru' } });
    },
    reset(generation = 1) { message({ type: 'reset', generation }); },
    requests() { return messages.filter(item => item.type === 'fetch'); },
    respond(request, text) { message({ type: 'fetch-result', id: request.id, text }); },
    respondAll() { for (const request of this.requests()) this.respond(request, request.url.includes('/ru') ? RU : EN); },
    windowEvent(name, values = {}) { return windowEvents.dispatch(name, values); },
    replaceVideo() { video.isConnected = false; video = makeVideo(); return video; },
    tick(delay) { for (const timer of [...timers.values()]) if (timer.interval && timer.delay === delay) timer.fn(); },
    intervalCount() { return [...timers.values()].filter(timer => timer.interval).length; },
  };
}

async function loadedHarness() {
  const h = harness();
  await flush();
  h.tracks();
  h.respondAll();
  await flush();
  assert.equal(h.$('en').textContent, 'First English');
  assert.equal(h.$('captions').hidden, false);
  return h;
}

test('current-generation empty metadata hides captions, restores native tracks and rejects late results', async () => {
  const h = await loadedHarness();
  assert.equal(h.video.textTracks[0].mode, 'hidden');
  h.tracks('');
  assert.equal(h.$('captions').hidden, true);
  assert.equal(h.$('en').textContent, '');
  assert.equal(h.video.textTracks[0].mode, 'showing');
  assert.match(h.$('status').textContent, /нет доступных субтитров/);

  h.tracks('[English]https://cdn.invalid/pending.vtt');
  const pending = h.requests().at(-1);
  h.tracks('');
  h.respond(pending, EN);
  await flush();
  assert.equal(h.$('captions').hidden, true);
  assert.equal(h.$('en').textContent, '');
  assert.equal(h.video.textTracks[0].mode, 'showing');
  assert.match(h.$('status').textContent, /нет доступных субтитров/);
});

test('reset aborts an old track without requesting its next fallback URL', async () => {
  const h = harness();
  await flush();
  const primary = 'https://cdn.invalid/old-primary.vtt';
  const fallback = 'https://cdn.invalid/shared-fallback.vtt';
  h.tracks(`[English]${primary} or ${fallback}`);
  const oldRequest = h.requests()[0];
  assert.deepEqual(h.requests().map(request => request.url), [primary]);
  h.reset();
  await flush();
  assert.deepEqual(h.requests().map(request => request.url), [primary]);
  assert.deepEqual(h.backgroundCalls, []);

  h.respond(oldRequest, EN);
  h.tracks(`[English]${fallback}`, 1);
  assert.deepEqual(h.requests().map(request => request.url), [primary, fallback]);
  h.respond(h.requests().at(-1), EN.replaceAll('English', 'current episode'));
  await flush();
  assert.equal(h.$('en').textContent, 'First current episode');
});

test('BFCache pageshow restarts rendering and discovery without duplicate intervals', async () => {
  const h = await loadedHarness();
  assert.equal(h.intervalCount(), 2);
  await h.windowEvent('pagehide', { persisted: true });
  assert.equal(h.intervalCount(), 0);
  assert.equal(h.video.textTracks[0].mode, 'showing');

  const replacement = h.replaceVideo();
  replacement.currentTime = 2.5;
  await h.windowEvent('pageshow', { persisted: true });
  assert.equal(h.intervalCount(), 2);
  assert.equal(h.host.parentElement, replacement.playerContainer);
  assert.equal(h.$('en').textContent, 'Second English');
  assert.equal(replacement.textTracks[0].mode, 'hidden');
  await h.windowEvent('pageshow', { persisted: true });
  assert.equal(h.intervalCount(), 2);

  replacement.currentTime = 0.5;
  h.tick(120);
  assert.equal(h.$('en').textContent, 'First English');
  const thirdVideo = h.replaceVideo();
  h.tick(1000);
  assert.equal(h.host.parentElement, thirdVideo.playerContainer);
});

test('reveal resets for the next cue, seek, mode changes and the next episode', async () => {
  const h = await loadedHarness();
  assert.equal(h.$('mode').value, 'reveal');
  assert.equal(h.$('ru').hidden, true);
  await h.$('en').dispatch('click');
  assert.equal(h.$('ru').hidden, false);
  assert.equal(h.$('ru').textContent, 'Первая реплика');
  assert.equal(h.$('en').getAttribute('aria-pressed'), 'true');

  h.video.currentTime = 2.5;
  await h.video.dispatch('timeupdate');
  assert.equal(h.$('en').textContent, 'Second English');
  assert.equal(h.$('ru').hidden, true);
  await h.$('en').dispatch('click');
  assert.equal(h.$('ru').textContent, 'Вторая реплика');
  assert.equal(h.$('ru').hidden, false);
  h.video.currentTime = 0.5;
  await h.video.dispatch('seeked');
  assert.equal(h.$('ru').hidden, true);
  assert.equal(h.$('en').getAttribute('aria-pressed'), 'false');

  h.$('mode').value = 'dual';
  await h.$('mode').dispatch('input');
  assert.equal(h.$('ru').hidden, false);
  h.$('mode').value = 'reveal';
  await h.$('mode').dispatch('input');
  assert.equal(h.$('ru').hidden, true);
  await h.$('en').dispatch('click');
  assert.equal(h.$('ru').hidden, false);
  h.reset();
  assert.equal(h.$('captions').hidden, true);
  h.tracks(TRACKS, 1);
  h.respondAll();
  await flush();
  assert.equal(h.$('en').textContent, 'First English');
  assert.equal(h.$('ru').hidden, true);
  assert.equal(h.$('en').getAttribute('aria-pressed'), 'false');
});
