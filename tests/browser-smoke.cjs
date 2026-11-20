/* Run separately after installing Playwright Chromium. No real video is loaded. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname,'..');
const en1 = 'WEBVTT\n\n1\n00:00:25.000 --> 00:00:28.000\nA little practice every day.\n\n2\n00:00:30.000 --> 00:00:34.000\nNow I understand.\n';
const ru1 = 'WEBVTT\n\n1\n00:00:25.200 --> 00:00:27.800\nНемного практики каждый день.\n\n2\n00:00:30.100 --> 00:00:34.100\nТеперь я понимаю.\n';
const sub = episode => `[Русский]https://static.voidboost.com/test/ru${episode}.vtt,[English]https://static.voidboost.com/test/en${episode}.vtt`;
const config = episode => ({subtitle:sub(episode),subtitle_lns:{'Русский':'ru',English:'en'}});
// A silent generated WAV gives the real media element a native seekable timeline.
// DOM-property overrides in the page do not cross Chrome's isolated-world boundary.
const silentWav = Buffer.alloc(44+8000*2*40);
silentWav.write('RIFF',0); silentWav.writeUInt32LE(silentWav.length-8,4); silentWav.write('WAVEfmt ',8);
silentWav.writeUInt32LE(16,16); silentWav.writeUInt16LE(1,20); silentWav.writeUInt16LE(1,22);
silentWav.writeUInt32LE(8000,24); silentWav.writeUInt32LE(16000,28); silentWav.writeUInt16LE(2,32); silentWav.writeUInt16LE(16,34);
silentWav.write('data',36); silentWav.writeUInt32LE(silentWav.length-44,40);
const fixture = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Проверка субтитров</title><style>body{font:16px system-ui;background:#192231;color:#ddd;margin:30px}#oframecdnplayer{position:relative;width:850px;height:480px;background:radial-gradient(ellipse at center,#20364a,#060d18);border-radius:12px;overflow:hidden}video{width:100%;height:100%}h1{font-size:20px;font-weight:500}button{margin:10px 8px 0 0;padding:10px;border:0;border-radius:6px}.mock{position:absolute;top:44%;width:100%;text-align:center;color:#8b9cad;font:14px system-ui;pointer-events:none}</style></head><body>
<h1>Проверка расширения · видеоплеер без загрузки видео</h1>
<div id="oframecdnplayer"><video preload="auto" src="/test.wav"></video><div class="mock">EN ↔ RU</div></div>
<button id="time26">Время 26</button><button id="time31">Время 31</button><button id="time25">Время 25.1</button><button id="replace">Заменить video</button><button id="full">Полный экран</button>
<button class="b-simple_episode__item" data-season_id="1" data-episode_id="2" id="episode2">Серия 2</button><button class="b-simple_episode__item" data-season_id="1" data-episode_id="3" id="episode3">Серия 3</button>
<script>
function bindVideo(){const v=document.querySelector('video');v.addEventListener('canplay',()=>{v.currentTime=26},{once:true});const track=v.addTextTrack('subtitles','native','en');track.mode='showing';}
bindVideo();
for(const [id,value]of [['time26',26],['time31',31],['time25',25.1]])document.getElementById(id).onclick=()=>{document.querySelector('video').currentTime=value};
document.getElementById('replace').onclick=()=>{const v=document.createElement('video');v.src='/test.wav';document.querySelector('video').replaceWith(v);bindVideo()};
document.getElementById('full').onclick=()=>document.getElementById('oframecdnplayer').requestFullscreen();
let requestedEpisode='1';
for(const b of document.querySelectorAll('.b-simple_episode__item'))b.onclick=()=>{const episode=b.dataset.episode_id;requestedEpisode=episode;return fetch('/ajax/get_cdn_series/',{method:'POST',body:new URLSearchParams({action:'get_stream',id:'1931',translator_id:'238',season:'1',episode})}).then(r=>r.json()).then(()=>{if(requestedEpisode===episode)location.hash='t:238-s:1-e:'+episode})};
window.sof={tv:{initCDNSeriesEvents(){}}};sof.tv.initCDNSeriesEvents(1931,238,1,1,false,'hdrezka.sb',true,false,${JSON.stringify(config(1))});
</script></body></html>`;

(async () => {
  const profile = await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp/','rezka-test-'));
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(profile,{
      headless:true,channel:'chromium',ignoreHTTPSErrors:true,viewport:{width:1000,height:750},
      args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]
    });
    await context.route('https://hdrezka.sb/**',async route => {
      if (route.request().url().endsWith('/test.wav')) {
        const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
        if (range) {
          const start=Number(range[1]),end=range[2]?Number(range[2]):silentWav.length-1;
          await route.fulfill({status:206,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${silentWav.length}`},body:silentWav.subarray(start,end+1)});
        } else await route.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body:silentWav});
      } else if (route.request().url().includes('/ajax/get_cdn_series/')) {
        const episode = new URLSearchParams(route.request().postData()).get('episode');
        await new Promise(r=>setTimeout(r,episode === '2' ? 600 : 50));
        await route.fulfill({contentType:'application/json',body:JSON.stringify(config(episode))});
      } else await route.fulfill({contentType:'text/html',body:fixture});
    });
    await context.route('https://static.voidboost.com/test/**',async route => {
      const url=route.request().url();
      let text=url.includes('/en')?en1:ru1;
      if (url.includes('3.vtt')) text=text.replace('A little practice every day.','The next episode.').replace('Немного практики каждый день.','Следующая серия.');
      await route.fulfill({contentType:'text/vtt',headers:{'Access-Control-Allow-Origin':'*'},body:text});
    });
    const page = context.pages()[0] || await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://hdrezka.sb/series/test.html');
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
    await page.locator('#time26').click();
    const ui=page.locator('#rezka-dual-subtitles');
    try { await ui.locator('#en').waitFor({state:'visible',timeout:8000}); }
    catch (error) {
      console.error('UI diagnostics:',await ui.locator('#status').textContent(),await ui.locator('#enTrack').innerHTML(),errors);
      console.error('Media diagnostics:',await page.locator('video').evaluate(v=>({time:v.currentTime,readyState:v.readyState,duration:v.duration,error:v.error?.message,seekable:v.seekable.length,seekableEnd:v.seekable.length?v.seekable.end(0):null,src:v.currentSrc,rect:v.getBoundingClientRect().toJSON()})));
      console.error('Caption state:',await ui.locator('#captions').evaluate(e=>({hidden:e.hidden,text:e.textContent})));
      throw error;
    }
    assert.equal(await ui.locator('#en').textContent(),'A little practice every day.');
    assert.equal(await ui.locator('#ru').isVisible(),false);
    await ui.locator('#en').click();
    assert.equal(await ui.locator('#ru').textContent(),'Немного практики каждый день.');
    assert.equal(await ui.locator('#ru').isVisible(),true);
    console.log('PASS declarative MV3 injection, metadata discovery, CORS loading, click-to-reveal');

    await page.locator('#time31').click();
    await page.waitForFunction(()=>document.querySelector('#rezka-dual-subtitles')?.shadowRoot?.querySelector('#en')?.textContent==='Now I understand.');
    assert.equal(await ui.locator('#en').textContent(),'Now I understand.');
    assert.equal(await ui.locator('#ru').isVisible(),false);
    await page.locator('#time26').click();
    await page.waitForFunction(()=>document.querySelector('#rezka-dual-subtitles')?.shadowRoot?.querySelector('#en')?.textContent==='A little practice every day.');
    assert.equal(await ui.locator('#ru').isVisible(),false);
    await page.locator('#time25').click();
    await ui.locator('#en').click();
    assert.equal(await ui.locator('#ru').isVisible(),true);
    console.log('PASS seek/reveal reset and small EN/RU timing differences');

    await ui.locator('#launcher').click();
    await ui.locator('#mode').selectOption('dual');
    await page.locator('#time26').click();
    await ui.locator('#ru').waitFor({state:'visible'});
    assert.equal(await ui.locator('#ru').isVisible(),true);
    assert.equal(await page.locator('video').evaluate(v=>v.textTracks[0].mode),'hidden');
    await ui.locator('#enabled').uncheck();
    assert.equal(await ui.locator('#captions').isVisible(),false);
    assert.equal(await page.locator('video').evaluate(v=>v.textTracks[0].mode),'showing');
    await ui.locator('#enabled').check();
    await ui.locator('#en').waitFor({state:'visible'});
    console.log('PASS dual mode, disable/re-enable, native text-track restoration');

    await ui.locator('#enFile').setInputFiles({name:'personal.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:25,000 --> 00:00:28,000\nMy own subtitles.\n')});
    await page.waitForFunction(()=>document.querySelector('#rezka-dual-subtitles')?.shadowRoot?.querySelector('#en')?.textContent==='My own subtitles.');
    console.log('PASS local SRT import');

    await ui.locator('#launcher').click();
    await page.locator('#episode2').click();
    await page.locator('#episode3').click();
    await page.waitForFunction(()=>document.querySelector('#rezka-dual-subtitles')?.shadowRoot?.querySelector('#en')?.textContent==='The next episode.');
    await page.waitForTimeout(800);
    assert.equal(await ui.locator('#en').textContent(),'The next episode.');
    console.log('PASS episode reset, local-file clearing, late-response rejection');

    await page.locator('#replace').click();
    await page.waitForTimeout(1200);
    assert.equal(await ui.locator('#en').isVisible(),true);
    await page.locator('#full').click();
    await page.waitForFunction(()=>!!document.fullscreenElement);
    assert.equal(await ui.locator('#en').isVisible(),true);
    await page.evaluate(()=>document.exitFullscreen());
    console.log('PASS video replacement and DOM fullscreen');

    await ui.locator('#launcher').click();
    await ui.locator('#mode').selectOption('reveal');
    await ui.locator('#launcher').click();
    await ui.locator('#en').click();
    const previewPath = process.env.RDS_PREVIEW_PATH || path.resolve(root,'test-results/preview.png');
    await fs.mkdir(path.dirname(previewPath),{recursive:true});
    await page.locator('#oframecdnplayer').screenshot({path:previewPath});
    assert.deepEqual(errors,[]);
    console.log('PASS no page JavaScript errors; preview captured');
  } finally {
    if (context) await context.close();
    await fs.rm(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
