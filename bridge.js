(() => {
  'use strict';

  const marker = '__rezkaDualSubtitleBridgeV1';
  if (window[marker]) return;
  Object.defineProperty(window, marker, { value: true });

  const SOURCE = 'rezka-dual-bridge';
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_METADATA = 1024 * 1024;
  const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  let generation = 0;
  let cached = null;
  let initialRetired = false;
  let requestOrder = 0;
  let activeOrder = 0;
  let activeEpisode = {};
  let navigationEpoch = 0;

  function post(message) {
    window.postMessage({ source: SOURCE, ...message }, location.origin);
  }

  function reset(context) {
    generation += 1;
    cached = null;
    initialRetired = true;
    post({ type: 'reset', generation, subtitle: '', subtitle_lns: {}, context });
  }

  function subtitleMetadata(value) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'subtitle')) return null;
    if (value.subtitle !== false && typeof value.subtitle !== 'string') return null;
    const subtitle = value.subtitle === false ? '' : value.subtitle;
    if (subtitle.length > MAX_METADATA) return null;
    const languages = Object.create(null);
    if (value.subtitle_lns && typeof value.subtitle_lns === 'object' && !Array.isArray(value.subtitle_lns)) {
      for (const [label, code] of Object.entries(value.subtitle_lns).slice(0, 100)) {
        if (label.length <= 200 && typeof code === 'string' && code.length <= 32) languages[label] = code;
      }
    }
    return { subtitle, subtitle_lns: languages };
  }

  function publish(value, expectedGeneration, context) {
    if (generation !== expectedGeneration) return;
    const metadata = subtitleMetadata(value);
    if (!metadata) return;
    cached = { type: 'tracks', generation, ...metadata, context };
    post(cached);
  }

  function parseResponse(text, expectedGeneration, context) {
    if (generation !== expectedGeneration || typeof text !== 'string' || text.length > MAX_METADATA) return;
    try { publish(JSON.parse(text), expectedGeneration, context); } catch { /* Unrelated or malformed site response. */ }
  }

  function streamURL(input) {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      return url.origin === location.origin && /^\/ajax\/get_cdn_series\/?$/.test(url.pathname) ? url : null;
    } catch { return null; }
  }

  function bodyParameters(body, url) {
    let data = body;
    if (typeof data === 'string') {
      if (data.length > 65536) return null;
      try { data = data.trim().startsWith('{') ? JSON.parse(data) : new URLSearchParams(data); } catch { return null; }
    }
    const get = key => {
      const value = data && typeof data.get === 'function' ? data.get(key) : data && typeof data === 'object' ? data[key] : null;
      return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : url.searchParams.get(key) || '';
    };
    if (get('action') !== 'get_stream') return null;
    const episode = {
      id: get('id'), translator_id: get('translator_id') || get('translator'),
      season: get('season') || get('season_id'), episode: get('episode') || get('episode_id'),
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(episode)) if (value) params.set(key, value);
    return { episode, context: params.toString() };
  }

  function startStream(info, order) {
    if (!info || order < activeOrder) return null;
    activeOrder = order;
    activeEpisode = info.episode;
    reset(info.context);
    return { generation, context: info.context };
  }

  if (window.XMLHttpRequest) {
    const prototype = window.XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    const requests = new WeakMap();
    prototype.open = function (...args) {
      requests.set(this, streamURL(args[1]));
      return Reflect.apply(originalOpen, this, args);
    };
    prototype.send = function (...args) {
      const url = requests.get(this);
      const info = url && bodyParameters(args[0], url);
      const record = info && startStream(info, ++requestOrder);
      if (record) {
        this.addEventListener('load', () => {
          if (generation !== record.generation || this.status < 200 || this.status >= 300) return;
          try {
            if (this.responseType === 'json') publish(this.response, record.generation, record.context);
            else if (!this.responseType || this.responseType === 'text') parseResponse(this.responseText, record.generation, record.context);
          } catch { /* Access to an incompatible XHR response type must not affect the page. */ }
        }, { once: true });
      }
      return Reflect.apply(originalSend, this, args);
    };
  }

  if (originalFetch) {
    window.fetch = function (input, init) {
      const url = streamURL(input);
      let record = null;
      if (url) {
        const order = ++requestOrder;
        const requestEpoch = navigationEpoch;
        if (init && Object.prototype.hasOwnProperty.call(init, 'body')) record = startStream(bodyParameters(init.body, url), order);
        else if (input && typeof input.clone === 'function') {
          try {
            record = input.clone().text().then(body => requestEpoch === navigationEpoch ? startStream(bodyParameters(body, url), order) : null, () => null);
          } catch { /* A consumed Request still belongs to the site's fetch implementation. */ }
        } else record = startStream(bodyParameters(null, url), order);
      }
      const result = originalFetch(input, init);
      if (!url || !record) return result;
      return result.then(async response => {
        const current = await record;
        if (current && current.generation === generation && response.ok) {
          try {
            const text = await response.clone().text();
            parseResponse(text, current.generation, current.context);
          } catch { /* Do not consume or alter the response returned to the player. */ }
        }
        return response;
      });
    };
  }

  // Only parse JSON literals inside the known initializer; never execute page text.
  function initialObjects(text) {
    const results = [];
    const calls = /\bsof\s*\.\s*tv\s*\.\s*initCDNSeriesEvents\s*\(/g;
    let match;
    while ((match = calls.exec(text))) {
      let parentheses = 1;
      let braces = 0;
      let objectStart = -1;
      let quote = '';
      let escaped = false;
      let i = calls.lastIndex;
      for (; i < text.length && parentheses > 0; i += 1) {
        const char = text[i];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = '';
          continue;
        }
        if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
        if (char === '(') parentheses += 1;
        else if (char === ')') parentheses -= 1;
        else if (char === '{') {
          if (braces === 0) objectStart = i;
          braces += 1;
        } else if (char === '}' && braces > 0) {
          braces -= 1;
          if (braces === 0) {
            try { results.push(JSON.parse(text.slice(objectStart, i + 1))); } catch { /* Not a JSON literal. */ }
          }
        }
      }
      calls.lastIndex = i;
    }
    return results;
  }

  function discoverInitial() {
    if (initialRetired || cached) return;
    for (const script of Array.from(document.scripts || [])) {
      const text = script.textContent || '';
      if (!text.includes('initCDNSeriesEvents') || text.length > 4 * MAX_METADATA) continue;
      for (const value of initialObjects(text)) {
        if (subtitleMetadata(value)) {
          publish(value, generation, 'initial');
          return;
        }
      }
    }
  }

  function sameEpisode(candidate) {
    const keys = ['season', 'episode', 'translator_id'];
    const provided = keys.filter(key => candidate[key]);
    return provided.length > 0 && provided.every(key => activeEpisode[key] === candidate[key]);
  }

  document.addEventListener('click', event => {
    const element = event.target && typeof event.target.closest === 'function' ? event.target.closest('.b-simple_episode__item') : null;
    if (!element) return;
    if (element.classList && element.classList.contains('active')) return;
    const data = element.dataset || {};
    const next = {
      season: data.season_id || data.seasonId || data.season || '',
      episode: data.episode_id || data.episodeId || data.episode || '',
    };
    if (sameEpisode(next)) return;
    activeEpisode = next;
    navigationEpoch += 1;
    reset(`episode:${next.season}:${next.episode}`);
  }, true);

  window.addEventListener('hashchange', () => {
    const next = {};
    for (const match of location.hash.matchAll(/(?:^#|[-&])([tse]):([^\-&#]+)/g)) {
      next[({ t: 'translator_id', s: 'season', e: 'episode' })[match[1]]] = match[2];
    }
    if (!Object.keys(next).length || sameEpisode(next)) return;
    activeEpisode = next;
    navigationEpoch += 1;
    reset(`hash:${location.hash}`);
  });

  function subtitleURL(value) {
    if (typeof value !== 'string' || value.length > 16384) throw new Error('Некорректный адрес субтитров');
    const url = new URL(value, location.href);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !/\.(vtt|srt)$/i.test(url.pathname)) {
      throw new Error('Разрешены только HTTP(S) файлы VTT и SRT без логина и пароля');
    }
    return url.href;
  }

  async function readSubtitle(response) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Файл субтитров больше 5 МБ');
    if (/^(video|audio|image)\/|^text\/html/i.test(response.headers.get('content-type') || '')) {
      throw new Error('Ответ сервера не является файлом субтитров');
    }
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      let text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) return text + decoder.decode();
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            throw new Error('Файл субтитров больше 5 МБ');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
      } finally { reader.releaseLock(); }
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Файл субтитров больше 5 МБ');
    return text;
  }

  async function fetchSubtitle(message) {
    let timer;
    try {
      const url = subtitleURL(message.url);
      if (!originalFetch) throw new Error('Загрузка недоступна');
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 12000);
      const response = await originalFetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal });
      const text = await readSubtitle(response);
      post({ type: 'fetch-result', id: message.id, text });
    } catch (error) {
      post({ type: 'fetch-result', id: message.id, error: error && error.name === 'AbortError' ? 'Истекло время загрузки субтитров' : String(error && error.message || error) });
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== 'rezka-dual-content') return;
    if (message.type === 'scan') {
      if (cached) post(cached);
      else discoverInitial();
    } else if (message.type === 'fetch' && typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 200) {
      void fetchSubtitle(message);
    }
  });

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(records => {
      if (initialRetired || cached) return;
      if (records.some(record => record.addedNodes && record.addedNodes.length)) discoverInitial();
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  }
  discoverInitial();
})();
