'use strict';
const $ = id => document.getElementById(id);
let tabId;
let status;
async function send(type) { return chrome.tabs.sendMessage(tabId, {type}); }
async function refresh() {
  try {
    status = await send('RDS_STATUS');
    $('connect').hidden = true;
    $('settings').hidden = false;
    $('retry').hidden = false;
    $('status').textContent = `${status.video ? 'Плеер найден' : 'Ожидаю плеер на странице'}\n${status.status}`;
    const origins = [...new Set(status.permissionOrigins || [])];
    $('permission').hidden = origins.length === 0;
    $('origins').textContent = origins.length ? 'Доступ только к серверам субтитров: ' + origins.map(o => new URL(o).host).join(', ') : '';
  } catch {
    status = null;
    $('status').textContent = 'Открой страницу серии на HDRezka. На другом зеркале нажми «Подключить».';
    $('connect').hidden = false;
    $('settings').hidden = $('retry').hidden = $('permission').hidden = true;
  }
}
$('connect').addEventListener('click', async () => {
  $('connect').disabled = true;
  try {
    await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:['bridge.js']});
    await chrome.scripting.executeScript({target:{tabId},files:['core.js','content.js']});
    await refresh();
    await send('RDS_OPEN');
  } catch (error) { $('status').textContent = 'Не удалось подключиться. Открой обычную веб-страницу HDRezka.\n' + error.message; }
  finally { $('connect').disabled = false; }
});
$('settings').addEventListener('click', async () => { await send('RDS_OPEN'); window.close(); });
$('retry').addEventListener('click', async () => { await send('RDS_RETRY'); await refresh(); });
$('permission').addEventListener('click', async () => {
  // Must remain directly within the user gesture for Chromium's permission UI.
  const origins = [...new Set(status?.permissionOrigins || [])].slice(0,12);
  if (!origins.length) return;
  try {
    const granted = await chrome.permissions.request({origins});
    if (granted) { await send('RDS_RETRY'); await refresh(); }
    else $('status').textContent = 'Доступ не выдан. Можно загрузить локальные SRT/VTT в настройках над видео.';
  } catch (error) { $('status').textContent = error.message; }
});
(async () => {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  tabId = tab?.id;
  await refresh();
})();
