(() => {
  'use strict';
  if (globalThis.__rezkaDualContent) return;
  globalThis.__rezkaDualContent = true;
  const Core = globalThis.RezkaSubtitlesCore;
  const defaults = {enabled:true, mode:'reveal', enOffset:0, ruOffset:0, size:25, bottom:14};
  let settings = {...defaults};
  let video = null, generation = -1, epoch = 0, loadVersion = 0, signature = '';
  let tracks = [], locals = {}, cues = {en:[],ru:[]}, selected = {en:'',ru:''};
  let status = 'Выбери «Оригинал (+субтитры)» на сайте.', permissionOrigins = new Set();
  let revealed = false, cueKey = '', panelOpen = false;
  const pending = new Map(), cache = new Map(), nativeModes = new Map();
  const host = document.createElement('div');
  host.id = 'rezka-dual-subtitles';
  host.style.cssText = 'position:absolute!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;display:block!important;';
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `
    <style>
      :host{all:initial;color-scheme:dark}*{box-sizing:border-box}
      .app{font:14px/1.45 system-ui,-apple-system,sans-serif;color:#eef3fb;pointer-events:none}
      button,select,input{font:inherit}button,select,input[type=file],input[type=range],input[type=checkbox]{cursor:pointer}
      button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #f2ce86;outline-offset:3px}
      button{border:0;border-radius:7px;padding:7px 11px;color:#eef3fb;background:#26334a}
      .tools{position:absolute;right:14px;top:14px;pointer-events:auto;display:flex;gap:6px;align-items:center}
      #launcher{background:#182738e8;box-shadow:0 2px 12px #0005;border:1px solid #aacbbb4d;font-size:12px;font-weight:750;letter-spacing:.4px}
      #launcher.off{opacity:.6}.panel{position:absolute;right:14px;top:54px;width:min(360px,calc(100% - 28px));max-height:calc(100% - 70px);overflow:auto;pointer-events:auto;background:#101a2bf7;border:1px solid #526078;border-radius:12px;padding:17px;box-shadow:0 12px 40px #0008}
      h2{margin:0 0 12px;font-size:17px;font-weight:650}.row{display:flex;gap:10px;align-items:center;margin:10px 0}.row>label{flex:1}.row>select{width:65%}
      select,input[type=number]{color:#f0f3fa;background:#26334a;border:1px solid #5b6880;border-radius:6px;padding:6px;min-width:0;max-width:100%}
      input[type=number]{width:78px}input[type=range]{width:145px;accent-color:#a9e1d3}input[type=checkbox]{accent-color:#a9e1d3}
      #status{white-space:pre-line;color:#a9ded1;font-size:12px;line-height:1.5;margin:12px 0;overflow-wrap:anywhere}
      .note{font-size:11px;color:#a7b5cc;margin:10px 0;line-height:1.5}.files{display:grid;gap:8px;border-top:1px solid #40506c;padding-top:10px}.files label{font-size:12px}.files input{display:block;width:100%;font-size:11px;margin-top:4px;color:#c8d2e5}
      .captions{position:absolute;left:5%;right:5%;bottom:14%;display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;pointer-events:none}
      #en,#ru{max-width:100%;white-space:pre-line;overflow-wrap:anywhere;line-height:1.35;font-weight:600;text-shadow:0 2px 3px #000,1px 0 2px #000,-1px 0 2px #000;background:#080d16c9;border-radius:5px;padding:4px 12px;margin:0;font-family:Arial,sans-serif}
      #en{pointer-events:auto;color:#fff;border:1px solid transparent}#en:hover{border-color:#ffffff70}#ru{color:#f3d59a;pointer-events:none}.hint{font-size:11px;color:#e2d5b3;background:#101822c9;padding:3px 8px;border-radius:4px}
      [hidden]{display:none!important}
    </style>
    <div class="app">
      <div class="tools"><button id="launcher" type="button" aria-expanded="false" title="Настройки двойных субтитров">EN ↔ RU</button></div>
      <section id="panel" class="panel" aria-label="Настройки двойных субтитров" hidden>
        <h2>Двойные субтитры</h2>
        <label><input id="enabled" type="checkbox" checked> Показывать субтитры</label>
        <div class="row"><label for="mode">Режим</label><select id="mode"><option value="reveal">Перевод по нажатию</option><option value="dual">EN + RU постоянно</option></select></div>
        <div class="row"><label for="enTrack">Английский</label><select id="enTrack"></select></div>
        <div class="row"><label for="ruTrack">Русский</label><select id="ruTrack"></select></div>
        <div class="row"><label for="enOffset">Задержка EN, с</label><input id="enOffset" type="number" min="-600" max="600" step="0.1" value="0"></div>
        <div class="row"><label for="ruOffset">Задержка RU, с</label><input id="ruOffset" type="number" min="-600" max="600" step="0.1" value="0"></div>
        <div class="row"><label for="size">Размер текста</label><input id="size" type="range" min="16" max="48" value="25"></div>
        <div class="row"><label for="bottom">Высота над низом</label><input id="bottom" type="range" min="5" max="65" value="14"></div>
        <div id="status" role="status"></div>
        <button id="retry" type="button">Найти и загрузить заново</button>
        <p class="note">В плеере выключи его субтитры: «Субтитры → откл.». Нажатие на английскую реплику раскрывает перевод до следующей реплики. Alt+R — перевод, Alt+S — смена режима.</p>
        <div class="files"><label>Свои английские SRT / VTT<input id="enFile" type="file" accept=".srt,.vtt"></label><label>Свои русские SRT / VTT<input id="ruFile" type="file" accept=".srt,.vtt"></label></div>
        <p class="note">Положительная задержка показывает реплику позже. Файлы остаются в этой вкладке до смены серии.</p>
      </section>
      <div id="captions" class="captions" hidden>
        <button id="en" type="button" title="Показать или скрыть русский перевод" aria-pressed="false" hidden></button>
        <div id="ru" lang="ru" hidden></div><div id="hint" class="hint" hidden></div>
      </div>
    </div>`;
  const $ = id => shadow.getElementById(id);
  function setStatus(value) { status = value; $('status').textContent = value; }
  function post(message) { window.postMessage({source:'rezka-dual-content',...message},location.origin); }
  function persist() { chrome.storage.local.set({rdsSettings:settings}).catch(() => {}); }
  function showPanel(value = !panelOpen) {
    panelOpen = value; $('panel').hidden = !value; $('launcher').setAttribute('aria-expanded', String(value));
  }
  function applySettings() {
    for (const key of ['mode','enOffset','ruOffset','size','bottom']) $(key).value = settings[key];
    $('enabled').checked = settings.enabled;
    $('launcher').classList.toggle('off',!settings.enabled);
    $('captions').style.bottom = settings.bottom + '%';
    $('en').style.fontSize = settings.size + 'px';
    $('ru').style.fontSize = Math.round(settings.size * .9) + 'px';
    if (!settings.enabled) restoreNative();
    render();
  }
  function available() { return [...tracks, ...Object.values(locals).map(t => t.track)]; }
  function updateSelects() {
    const all = available();
    for (const lang of ['en','ru']) {
      const select = $(lang + 'Track');
      select.replaceChildren();
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Не выбраны'; select.append(empty);
      for (const track of all) {
        const option = document.createElement('option'); option.value = track.id; option.textContent = track.label; select.append(option);
      }
      if (!all.some(t => t.id === selected[lang])) selected[lang] = Core.pickTrack(all,lang)?.id || '';
      select.value = selected[lang];
    }
  }
  function restoreNative() {
    for (const [track,mode] of nativeModes) { try { track.mode = mode; } catch {} }
    nativeModes.clear();
  }
  function hideNative() {
    if (!video || !settings.enabled || (!cues.en.length && !cues.ru.length)) return;
    for (const track of video.textTracks || []) {
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      if (track.mode === 'showing') { if (!nativeModes.has(track)) nativeModes.set(track,track.mode); track.mode = 'hidden'; }
    }
  }
  function clearEpisode(message) {
    epoch++; loadVersion++; signature = ''; tracks = []; locals = {}; cues = {en:[],ru:[]}; selected = {en:'',ru:''};
    cache.clear(); permissionOrigins.clear(); revealed = false; cueKey = ''; restoreNative();
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Серия изменилась.')); }
    pending.clear();
    $('enFile').value = ''; $('ruFile').value = '';
    updateSelects(); setStatus(message); render();
  }
  async function pageFetch(url) {
    const id = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Страница не смогла загрузить файл субтитров.')); },14000);
      pending.set(id,{resolve,reject,timer});
      post({type:'fetch',id,url});
    });
  }
  async function loadUrl(url) {
    if (cache.has(url)) return cache.get(url);
    const requestEpoch = epoch;
    let text;
    try { text = await pageFetch(url); }
    catch {
      if (requestEpoch !== epoch) throw new Error('Серия изменилась.');
      const response = await chrome.runtime.sendMessage({type:'RDS_FETCH',url});
      if (!response?.ok) {
        const error = new Error(response?.error || 'Не удалось загрузить субтитры.');
        if (response?.needsPermission && typeof response.origin === 'string') error.permissionOrigin = response.origin;
        throw error;
      }
      text = response.text;
    }
    const parsed = Core.parseSubtitles(text);
    if (!parsed.length) throw new Error('В файле нет реплик SRT/VTT. Возможно, сервер вернул ошибку или этот формат не поддерживается.');
    if (requestEpoch === epoch) cache.set(url,parsed);
    return parsed;
  }
  async function loadTrack(id) {
    const trackEpoch = epoch;
    const local = Object.values(locals).find(t => t.track.id === id);
    if (local) return local.cues;
    const track = tracks.find(t => t.id === id);
    if (!track) return [];
    let lastError;
    const origins = new Set();
    for (const url of track.urls) {
      if (trackEpoch !== epoch) throw new Error('Серия изменилась.');
      try { return await loadUrl(url); } catch (error) {
        if (trackEpoch !== epoch) throw new Error('Серия изменилась.');
        lastError = error; if (error.permissionOrigin) origins.add(error.permissionOrigin);
      }
    }
    if (lastError) lastError.permissionOrigins = [...origins];
    throw lastError || new Error('У дорожки нет доступного адреса.');
  }
  async function loadSelected() {
    const version = ++loadVersion, currentEpoch = epoch;
    cues = {en:[],ru:[]}; revealed = false; cueKey = ''; restoreNative(); render();
    if (!settings.enabled) { setStatus('Субтитры выключены.'); return; }
    permissionOrigins.clear();
    setStatus('Загружаю выбранные дорожки…');
    const results = await Promise.allSettled(['en','ru'].map(lang => loadTrack(selected[lang])));
    if (version !== loadVersion || currentEpoch !== epoch) return;
    const parts = [];
    results.forEach((result,index) => {
      const lang = index === 0 ? 'en' : 'ru', label = lang.toUpperCase();
      if (result.status === 'fulfilled') {
        cues[lang] = result.value;
        parts.push(result.value.length ? `${label}: ${result.value.length} реплик` : `${label}: дорожка не выбрана`);
      } else {
        parts.push(`${label}: ${result.reason.message}`);
        if (result.reason.permissionOrigin) permissionOrigins.add(result.reason.permissionOrigin);
        for (const origin of result.reason.permissionOrigins || []) permissionOrigins.add(origin);
      }
    });
    if (permissionOrigins.size) parts.push('Для доступа к серверу открой значок расширения в браузере.');
    setStatus(parts.join('\n'));
    hideNative(); render();
  }
  function render() {
    if (!video || !settings.enabled) { $('captions').hidden = true; return; }
    const time = Number(video.currentTime) || 0;
    const enTime = time - settings.enOffset, ruTime = time - settings.ruOffset;
    const enText = Core.activeText(cues.en,enTime);
    const key = enText ? cues.en.filter(c => c.start <= enTime && c.end > enTime).map(c => `${c.start}:${c.end}`).join('|') : '';
    if (key !== cueKey) { cueKey = key; revealed = false; }
    let ruText = Core.activeText(cues.ru,ruTime);
    if (!ruText && enText && revealed) {
      // Small timing differences between independently authored tracks are common.
      const primary = cues.en.filter(c => c.start <= enTime && c.end > enTime);
      ruText = [...new Set(cues.ru.filter(c => Math.min(Math.abs(c.start-ruTime),Math.abs(c.end-ruTime)) <= .65 && primary.some(p => c.start < p.end + settings.enOffset - settings.ruOffset && c.end > p.start + settings.enOffset - settings.ruOffset)).map(c => c.text))].join('\n');
    }
    const showRussian = settings.mode === 'dual' || (revealed && !!enText);
    $('en').textContent = enText; $('en').hidden = !enText;
    $('en').lang = 'en'; $('en').setAttribute('aria-pressed',String(revealed));
    $('ru').textContent = ruText; $('ru').hidden = !showRussian || !ruText;
    $('hint').hidden = !(revealed && enText && !ruText);
    $('hint').textContent = cues.ru.length ? 'Для этого момента нет русской реплики' : 'Выбери русскую дорожку в настройках';
    $('captions').hidden = !enText && (!showRussian || !ruText);
  }
  function mount() {
    const videos = Array.from(document.querySelectorAll('video')).filter(v => v.isConnected && v.getBoundingClientRect().width > 100 && v.getBoundingClientRect().height > 80);
    videos.sort((a,b) => { const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(); return br.width*br.height-ar.width*ar.height; });
    const next = videos[0] || null;
    if (next !== video) {
      restoreNative();
      if (video) for (const event of ['timeupdate','seeked','seeking','pause','loadedmetadata']) video.removeEventListener(event,render);
      video = next;
      if (video) for (const event of ['timeupdate','seeked','seeking','pause','loadedmetadata']) video.addEventListener(event,render);
      revealed = false; cueKey = '';
    }
    if (!video) { host.remove(); return; }
    const full = document.fullscreenElement;
    const container = full && full !== video && full.contains(video) ? full : video.closest('#oframecdnplayer') || video.parentElement;
    if (!container || container === video) return;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (host.parentElement !== container) container.append(host);
    hideNative(); render();
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'rezka-dual-bridge') return;
    if (data.type === 'fetch-result') {
      const request = pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(data.id);
      if (typeof data.text === 'string' && data.text.length <= 5*1024*1024) request.resolve(data.text);
      else request.reject(new Error(String(data.error || 'Не удалось прочитать субтитры.').slice(0,300)));
      return;
    }
    if (!Number.isSafeInteger(data.generation) || data.generation < generation) return;
    if (data.type === 'reset') {
      generation = data.generation;
      clearEpisode('Серия или озвучка меняется. Ожидаю новые дорожки…');
    } else if (data.type === 'tracks' && (typeof data.subtitle === 'string' || data.subtitle === false)) {
      if (data.generation > generation) { generation = data.generation; clearEpisode('Читаю дорожки…'); }
      const nextTracks = Core.parseTrackList(data.subtitle || '',data.subtitle_lns || {},location.href);
      const nextSignature = JSON.stringify(nextTracks);
      if (signature === nextSignature) return;
      signature = nextSignature; tracks = nextTracks;
      updateSelects();
      if (!tracks.length && !Object.keys(locals).length) {
        loadVersion++; cues = {en:[],ru:[]}; revealed = false; cueKey = ''; permissionOrigins.clear(); restoreNative(); render();
        setStatus('У этой серии или озвучки нет доступных субтитров. Выбери «Оригинал (+субтитры)» или загрузи свои файлы.');
      }
      else loadSelected();
    }
  });
  for (const event of ['click','dblclick','pointerdown','pointerup','keydown']) host.addEventListener(event,e => e.stopPropagation());
  $('launcher').addEventListener('click',() => showPanel());
  $('en').addEventListener('click',() => { revealed = !revealed; render(); });
  $('enabled').addEventListener('change',() => { settings.enabled = $('enabled').checked; persist(); applySettings(); loadSelected(); });
  for (const key of ['mode','enOffset','ruOffset','size','bottom']) $(key).addEventListener(key.endsWith('Offset') ? 'change' : 'input',() => {
    const value = key === 'mode' ? $(key).value : Number($(key).value);
    settings[key] = key === 'mode' ? (value === 'dual' ? 'dual' : 'reveal') : Number.isFinite(value) ? value : defaults[key];
    if (key.endsWith('Offset')) settings[key] = Math.max(-600,Math.min(600,settings[key]));
    revealed = false; persist(); applySettings();
  });
  for (const lang of ['en','ru']) {
    $(lang + 'Track').addEventListener('change',() => { selected[lang] = $(lang + 'Track').value; loadSelected(); });
    $(lang + 'File').addEventListener('change',async () => {
      const file = $(lang + 'File').files[0], currentEpoch = epoch;
      if (!file) return;
      if (file.size > 5*1024*1024) { setStatus('Файл больше 5 МБ.'); return; }
      try {
        let text = await file.text();
        if ((text.match(/\uFFFD/g)||[]).length > 3) text = new TextDecoder('windows-1251').decode(await file.arrayBuffer());
        const parsed = Core.parseSubtitles(text);
        if (!parsed.length) throw new Error('В файле нет реплик SRT/VTT.');
        if (currentEpoch !== epoch) return;
        const id = 'local-' + lang;
        locals[lang] = {track:{id,label:`${lang.toUpperCase()}: ${file.name}`,lang,urls:[]},cues:parsed};
        selected[lang] = id; updateSelects(); loadSelected();
      } catch (error) { if (currentEpoch === epoch) setStatus(error.message); }
    });
  }
  function retry() { cache.clear(); signature = ''; post({type:'scan'}); if (available().length) loadSelected(); }
  $('retry').addEventListener('click',retry);
  document.addEventListener('keydown',event => {
    const target = event.composedPath()[0];
    if (!event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName) || target?.isContentEditable) return;
    if (event.code === 'KeyR') { revealed = !revealed; render(); event.preventDefault(); }
    if (event.code === 'KeyS') { settings.mode = settings.mode === 'dual' ? 'reveal' : 'dual'; persist(); applySettings(); event.preventDefault(); }
  },true);
  chrome.runtime.onMessage.addListener((message,sender,reply) => {
    if (message?.type === 'RDS_STATUS') reply({video:!!video,status,permissionOrigins:[...permissionOrigins],enabled:settings.enabled});
    else if (message?.type === 'RDS_OPEN') { mount(); showPanel(true); reply({ok:true}); }
    else if (message?.type === 'RDS_RETRY') { retry(); reply({ok:true}); }
  });
  document.addEventListener('fullscreenchange',mount);
  window.addEventListener('resize',mount);
  let timer, mountTimer;
  function startTimers() { clearInterval(timer); clearInterval(mountTimer); timer = setInterval(render,120); mountTimer = setInterval(mount,1000); mount(); }
  window.addEventListener('pagehide',() => { clearInterval(timer); clearInterval(mountTimer); restoreNative(); });
  window.addEventListener('pageshow',startTimers);
  startTimers();
  updateSelects(); applySettings(); mount();
  chrome.storage.local.get('rdsSettings').then(result => {
    const saved = result?.rdsSettings;
    if (saved && typeof saved === 'object') {
      settings.enabled = saved.enabled !== false;
      settings.mode = saved.mode === 'dual' ? 'dual' : 'reveal';
      for (const key of ['enOffset','ruOffset']) if (Number.isFinite(saved[key])) settings[key] = Math.max(-600,Math.min(600,saved[key]));
      if (Number.isFinite(saved.size)) settings.size = Math.max(16,Math.min(48,saved.size));
      if (Number.isFinite(saved.bottom)) settings.bottom = Math.max(5,Math.min(65,saved.bottom));
      applySettings();
    }
    post({type:'scan'});
  },() => post({type:'scan'}));
})();
