# Rezka · Dual Subtitles

A Manifest V3 extension for **Google Chrome** that shows English and Russian subtitles together, or reveals the Russian translation when you click an English line. Version 0.1.0.

Compatible browsers: **Google Chrome**, Microsoft Edge, and Yandex Browser. Automated browser testing was performed in Chromium; Microsoft Edge and Yandex Browser have not been tested separately.

- [Download ZIP for Google Chrome / Microsoft Edge](https://github.com/stormrvge/rezka-dual-subtitles/raw/refs/heads/main/dist/rezka-dual-subtitles.zip)
- [Download the signed CRX3 package](https://github.com/stormrvge/rezka-dual-subtitles/raw/refs/heads/main/dist/rezka-dual-subtitles.crx)

![Preview in the test player](docs/preview.png)

## Install in Google Chrome

1. Download and extract the ZIP archive. Find the `rezka-dual-subtitles` folder containing `manifest.json`.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**, then click **Load unpacked**.
4. Select the `rezka-dual-subtitles` folder.
5. Reload HDRezka and select the original-audio option with subtitles.

[Official Google Chrome installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Usage

The extension currently uses Russian interface labels. The steps below describe what each control does.

- Click **EN ↔ RU** in the upper-right corner of the video to open settings.
- By default, only English is shown. Click a line to reveal its Russian translation below it. Click again to hide it. The translation is hidden when the next English line appears.
- Choose the mode that always displays **EN + RU** to keep both languages visible.
- Disable subtitles in the site's own player to avoid duplicate text. PlayerJS renders those subtitles in a separate layer.
- English and Russian tracks are selected automatically when available. You can choose other tracks in settings.
- Adjust the delay for each language independently. A positive value shows subtitles later.
- **Alt+R** reveals or hides the translation. **Alt+S** switches modes. These shortcuts are inactive while you type in an input field.
- If a track is missing, import your own **SRT/VTT** file in settings. Files are read locally, never uploaded, and cleared when you change episodes.

Automatic activation is enabled on `rezka.ag`, `hdrezka.sb`, `hdrezka.ag`, `hdrezka.me`, and their subdomains. On another mirror, click the extension icon in the browser toolbar and use the button that connects it to the current page. Repeat this after a full page reload on that mirror.

If CORS blocks subtitle loading, open the extension's toolbar popup and use the button that allows subtitle downloads. It requests access to the specific server hosting the detected tracks, then lets the extension download them. The tested files on `static.voidboost.com` provide `Access-Control-Allow-Origin: *`, so no additional permission was needed there.

## How it works

The extension reads `subtitle` and `subtitle_lns` from the initial `sof.tv.initCDNSeriesEvents` configuration and from the site's existing `/ajax/get_cdn_series/` requests. It does not make additional requests to obtain video streams.

Track lists use the format `[Russian]URL,[English]URL`, with labels supplied by the site. The extension downloads subtitle files, parses their timestamps, and renders text over the HTML video using `video.currentTime`. English and Russian cues are matched by time. Cue numbers and counts may differ; revealing a translation allows for small timing differences.

Changing episodes clears old cues and ignores late responses. Mode, text size, and delay settings are stored locally. Subtitle text and imported files are not saved to persistent storage.

References: [PlayerJS subtitle format](https://playerjs.com/docs/en=subtitles) and [PlayerJS API](https://playerjs.com/docs/en=apicommands).

## Validation and limitations

The player DOM and first-episode configuration were inspected on [this HDRezka page](https://hdrezka.sb/series/thriller/1931-proslushka-2002-latest.html). It provides Russian, English, and Ukrainian VTT tracks and uses a regular `<video>` in the main document with an empty standard `textTracks` list. The Russian and English files were successfully parsed: 934 and 848 cues, respectively. Full episode subtitle files are not included in this project.

Manifest V3 installation and interactions were tested on a representative fixture page. Playback on the real site with the extension installed has not been verified end to end.

Completed checks: **38/38 Node tests**, JavaScript syntax checks, and extension installation and UI scenarios in **Chrome for Testing 151.0.7922.34**. Browser checks covered both modes, click-to-reveal, seeking, small timing differences, local SRT import, episode changes, late-response rejection, video replacement, DOM fullscreen, and restoring standard text tracks when the extension is disabled. The CRX3 format, RSA signature, and agreement between its packaged runtime files and the source were also verified.

- The extension targets series and the standard HDRezka player. Movie initialization is not implemented separately.
- Both tracks must be available for the selected episode or supplied by the user. There is no automatic machine translation.
- Supported formats are SRT and VTT. Convert ASS/SSA files to SRT/VTT first.
- DOM fullscreen is supported. System Picture-in-Picture and players inside third-party iframes may not display the extension's overlay.
- Site changes may require adapter updates. The extension does not unlock restricted or paid sources.

## Permissions and privacy

- `storage`: saves settings on this computer.
- `activeTab` and `scripting`: connects to a mirror opened by the user when they click the activation button.
- Static content scripts: run only on the listed HDRezka domains.
- `optional_host_permissions`: lets the extension request access to a specific subtitle server when loading from the page fails. Access to all websites is not granted automatically.

There is no analytics, remote executable code, API key requirement, or translation service. Subtitle downloads omit cookies and reject redirects. The maximum file size is 5 MiB.

## Development checks

Node.js 20+ is required to run the tests:

```sh
node --test tests/*.test.cjs
```

The browser test also requires Playwright and Chromium:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser-smoke.cjs
```

The browser test uses a separate temporary profile with the extension installed and supplies a fixture page with short original subtitle samples. No real video is downloaded. Node.js and Playwright are not required to use the packaged extension.
