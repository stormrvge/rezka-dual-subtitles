(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RezkaSubtitlesCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const namedEntities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    AMP: '&', LT: '<', GT: '>', QUOT: '"',
    lrm: '\u200e', rlm: '\u200f', ndash: '–', mdash: '—', hellip: '…',
    laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    sbquo: '‚', bdquo: '„', bull: '•', middot: '·', copy: '©', reg: '®',
    trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢', times: '×',
    divide: '÷', minus: '−', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
    shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c', acute: '´', deg: '°'
  };
  const latinNames = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
  latinNames.split(' ').forEach((name, index) => { namedEntities[name] = String.fromCharCode(160 + index); });

  function plainText(value) {
    const decoded = value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, name) => {
      if (name[0] !== '#') return namedEntities[name] === undefined ? entity : namedEntities[name];
      const hex = name[1].toLowerCase() === 'x';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : '\ufffd';
    });
    return decoded
      .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .split('\n').map(line => line.trim()).join('\n').trim();
  }

  function timestamp(value) {
    const match = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(value);
    if (!match) return NaN;
    const hours = match[1] === undefined ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    if (minutes > 59 || seconds > 59) return NaN;
    return hours * 3600 + minutes * 60 + seconds + Number(match[4].padEnd(3, '0')) / 1000;
  }

  function parseSubtitles(text) {
    const invalid = () => new Error('Не удалось прочитать субтитры: нужен файл SRT или VTT с корректными репликами.');
    if (typeof text !== 'string' || !text.trim()) throw invalid();
    const source = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').trim();
    if (/^<(?:!doctype\s+html|html|head|body|script)\b/i.test(source)) throw invalid();
    if (/^[\[{]/.test(source)) {
      try { JSON.parse(source); throw invalid(); } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    const cues = [];
    for (const block of source.split(/\n[ \t]*\n+/)) {
      const lines = block.trim().split('\n');
      if (/^(?:WEBVTT(?:\s|$)|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(lines[0])) continue;
      let position = lines[0].includes('-->') ? 0 : 1;
      if (position >= lines.length) continue;
      const timing = /^\s*(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[position]);
      if (!timing) continue;
      const start = timestamp(timing[1]);
      const end = timestamp(timing[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const cueText = plainText(lines.slice(position + 1).join('\n'));
      if (cueText) cues.push({ start, end, text: cueText });
    }
    if (!cues.length) throw invalid();
    return cues.sort((a, b) => a.start - b.start);
  }

  function languageCode(value) {
    return typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : '';
  }

  function inferLanguage(label) {
    if (/^(?:en(?:g)?(?:\b|[-_])|english\b|английск)/i.test(label)) return 'en';
    if (/^(?:ru(?:s)?(?:\b|[-_])|russian\b|русск)/i.test(label)) return 'ru';
    return '';
  }

  function safeUrl(value, baseUrl) {
    if (!value) return null;
    try {
      const url = new URL(value, baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch (_) { return null; }
  }

  function parseTrackList(value, languageMap = {}, baseUrl = 'https://rezka.ag/') {
    if (typeof value !== 'string' || !value.trim()) return [];
    // Only a comma followed by a new [label] separates tracks; commas inside URLs survive.
    const labels = Array.from(value.matchAll(/(?:^|,)\s*\[([^\]\r\n]+)\]/g));
    const tracks = [];
    for (let i = 0; i < labels.length; i++) {
      const match = labels[i];
      const label = plainText(match[1]);
      const source = value.slice(match.index + match[0].length, i + 1 < labels.length ? labels[i + 1].index : value.length);
      const urls = [];
      for (const candidate of source.split(/\s+or\s+/i)) {
        const url = safeUrl(candidate.trim(), baseUrl);
        if (url && !urls.includes(url)) urls.push(url);
      }
      if (!label || !urls.length) continue;
      const mapped = languageMap && Object.prototype.hasOwnProperty.call(languageMap, match[1].trim())
        ? languageMap[match[1].trim()] : '';
      const lang = languageCode(mapped) || inferLanguage(label);
      tracks.push({ id: `${lang || 'track'}-${i}`, label, lang, urls });
    }
    return tracks;
  }

  const timelineCache = new WeakMap();

  function intervalTree(cues) {
    if (!cues.length) return null;
    const center = cues[Math.floor(cues.length / 2)].start;
    const left = [];
    const right = [];
    const overlap = [];
    for (const cue of cues) {
      if (cue.end <= center) left.push(cue);
      else if (cue.start > center) right.push(cue);
      else overlap.push(cue);
    }
    return {
      center, byStart: overlap,
      byEnd: overlap.slice().sort((a, b) => b.end - a.end),
      left: intervalTree(left), right: intervalTree(right)
    };
  }

  function activeText(cues, time) {
    if (!Array.isArray(cues) || !cues.length || !Number.isFinite(time)) return '';
    let cached = timelineCache.get(cues);
    if (!cached || cached.length !== cues.length) {
      const sorted = cues.filter(c => c && Number.isFinite(c.start) && Number.isFinite(c.end)
        && c.end > c.start && typeof c.text === 'string').slice().sort((a, b) => a.start - b.start);
      const indexed = sorted.map((cue, index) => ({ start: cue.start, end: cue.end, text: cue.text, index }));
      cached = { length: cues.length, tree: intervalTree(indexed) };
      timelineCache.set(cues, cached);
    }
    const active = [];
    let node = cached.tree;
    while (node) {
      if (time < node.center) {
        for (const cue of node.byStart) {
          if (cue.start > time) break;
          active.push(cue);
        }
        node = node.left;
      } else {
        for (const cue of node.byEnd) {
          if (cue.end <= time) break;
          active.push(cue);
        }
        node = node.right;
      }
    }
    return active.sort((a, b) => a.index - b.index).map(cue => cue.text).join('\n');
  }

  function pickTrack(tracks, lang) {
    if (!Array.isArray(tracks)) return null;
    const requested = languageCode(lang).split('-')[0];
    if (!requested) return null;
    return tracks.find(track => track && (languageCode(track.lang).split('-')[0] || inferLanguage(track.label || '')) === requested) || null;
  }

  return Object.freeze({ parseSubtitles, parseTrackList, activeText, pickTrack });
});
