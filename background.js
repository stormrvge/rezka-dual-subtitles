/* Only subtitle text is fetched. Video sources are never requested. */
'use strict';
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

function validSubtitleUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !/\.(vtt|srt|ass|ssa)$/i.test(url.pathname)) {
    throw new Error('Ожидалась ссылка на файл VTT или SRT.');
  }
  return url;
}

async function readSubtitleResponse(response) {
  if (!response.ok) throw new Error(`Сервер субтитров ответил HTTP ${response.status}.`);
  if (/^(video|audio)\//i.test(response.headers.get('Content-Type') || '')) throw new Error('Сервер вернул медиафайл вместо субтитров.');
  if (Number(response.headers.get('Content-Length')) > MAX_SUBTITLE_BYTES) throw new Error('Файл субтитров больше 5 МБ.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Пустой ответ сервера субтитров.');
  let size = 0;
  const chunks = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SUBTITLE_BYTES) {
      await reader.cancel();
      throw new Error('Файл субтитров больше 5 МБ.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result = new TextDecoder('utf-8').decode(bytes);
  if ((result.match(/\uFFFD/g) || []).length > 3) result = new TextDecoder('windows-1251').decode(bytes);
  return result;
}

async function fetchSubtitle(value) {
  const url = validSubtitleUrl(value);
  const origin = `${url.origin}/*`;
  if (!await chrome.permissions.contains({origins:[origin]})) {
    return {ok:false, needsPermission:true, origin, error:'Открой значок расширения и разреши загрузку с сервера субтитров.'};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.href, {credentials:'omit', redirect:'error', signal:controller.signal});
    return {ok:true, text:await readSubtitleResponse(response)};
  } finally { clearTimeout(timer); }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'RDS_FETCH' || sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return;
    fetchSubtitle(message.url).then(reply, error => reply({ok:false, error:error.name === 'AbortError' ? 'Сервер субтитров не ответил за 15 секунд.' : error.message}));
    return true;
  });
}
if (typeof module !== 'undefined') module.exports = {validSubtitleUrl, readSubtitleResponse};
