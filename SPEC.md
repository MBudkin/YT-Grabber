# YT Grabber — Chrome extension + native host for yt-dlp

## Architecture
```
Chrome extension (MV3)  <--native messaging (stdio JSON)-->  host/ytdl_host.py  -->  yt-dlp.exe (+ ffmpeg)
```
- Extension ID (fixed via "key" in manifest): `ielgkfmkaipmjgmgabobogdjcgdmaejm`
- Native host name: `com.ytgrabber.host`
- The packaged host runs on Windows 10/11 x64. Install.bat registers the executable in HKCU.
- The extension service worker owns a long-lived port via `chrome.runtime.connectNative("com.ytgrabber.host")`.

## Distribution

`build/build.ps1` freezes the host with PyInstaller and creates `dist/YT-Grabber.zip`.
Install.bat copies the app to `%LOCALAPPDATA%\YT Grabber`. That directory contains
the console-subsystem host, its runtime, config.json, host.log, the native manifest,
the unpacked extension, and bin/ with yt-dlp, QuickJS-NG and the shared FFmpeg tools.
The native manifest points directly at ytdl_host.exe. The browser user loads extension/ once.

## Native messaging framing
4-byte little-endian length + UTF-8 JSON, both directions. Host must use binary stdin/stdout
(`sys.stdin.buffer`, `sys.stdout.buffer`), flush after each message, and serialize writes with a lock
(several threads send). Max message host->Chrome is 1 MB: trim `info` payloads (no raw `formats` dump, no `http_headers`).
Nothing else may be printed to stdout. Log to `%LOCALAPPDATA%\YT Grabber\host.log` (rotate/truncate at ~1 MB).

## Protocol
Every request has `id` (string, from extension) and optional `lang` (`"ru"|"en"`, language of error messages). Every direct reply echoes `id`.
Async job events carry `jobId` (and no `id`).

### Requests -> replies
| request | reply |
|---|---|
| `{id, cmd:"ping"}` | `{id, type:"pong", hostVersion, ytdlpVersion, ffmpeg: bool, ffmpegPath, ytdlpPath, defaultDir}` |
| `{id, cmd:"info", url, playlist?:bool}` | `{id, type:"info", data}` (see below) or `{id, type:"error", message}` |
| `{id, cmd:"download", url, options}` | `{id, type:"started", jobId}` then job events |
| `{id, cmd:"cancel", jobId}` | `{id, type:"ok"}` (+ job emits `cancelled`) |
| `{id, cmd:"pick_folder", initial?}` | `{id, type:"folder", path}` (`path:null` if cancelled). Native Windows folder dialog, must appear on top (use PowerShell `System.Windows.Forms.FolderBrowserDialog` with a TopMost owner form, or tkinter with `-topmost`). |
| `{id, cmd:"open_folder", path}` | `{id, type:"ok"}` — opens Explorer at folder |
| `{id, cmd:"reveal", path}` | `{id, type:"ok"}` — `explorer /select,"file"` |
| `{id, cmd:"open_file", path}` | `{id, type:"ok"}` — `os.startfile` |
| `{id, cmd:"update_ytdlp"}` | `{id, type:"updated", output, ytdlpVersion}` (runs `yt-dlp -U`) |
| `{id, cmd:"self_update", url, digest}` | `{id, type:"update_started"}` — downloads a `github.com/MBudkin/YT-Grabber/releases/download/…zip`, verifies `sha256:` digest, starts detached `setup/update.ps1 -WaitPid <host pid>` from the new package, then the host exits. Refused while jobs are active. |
| `{id, cmd:"get_config"}` / `{id, cmd:"set_config", config}` | `{id, type:"config", config}` — keys: `ytdlpPath`, `ffmpegPath`, `defaultDir`, `maxConcurrent` (default 2) |
| unknown | `{id, type:"error", message}` |

`info.data`:
```json
{ "id","title","uploader","channel","duration"(sec),"thumbnail","webpage_url","is_live",
  "heights":[2160,1440,1080,720,...]  // distinct video heights available, desc
  "formats":[{"format_id","ext","height","width","fps","vcodec","acodec","abr","tbr","filesize"(or filesize_approx),"format_note","dynamic_range"}] // max ~80 entries, skip storyboards (mhtml)
  "subtitles":   [{"lang","name"}],  // manual
  "autoCaptions":[{"lang","name"}],  // automatic; keep only original-language + common (en, ru, uk, de, fr, es, ...) or cap at 30
  "chapters": int, "playlist": null | {"title","count","entries":[{"id","title","duration"}] (max 200)} }
```
Use `yt-dlp -J --no-warnings` (with `--flat-playlist` when playlist URL and playlist=true; add `--no-playlist` otherwise).

### Job events
- `{type:"progress", jobId, percent (number 0-100|null), speed (str), eta (str), downloaded (bytes|null), total (bytes|null), stage, item?: "2/10"}`
  `stage` ∈ `"queued" | "downloading" | "merging" | "postprocessing"`. Throttle to ≤ 4 msgs/sec per job.
- `{type:"log", jobId, line}` — non-progress stderr/stdout lines (throttled, only last ~200 kept by UI).
- `{type:"done", jobId, files:[absolute paths], title}`
- `{type:"error", jobId, message}` — last meaningful `ERROR:` line from yt-dlp
- `{type:"cancelled", jobId}` — kill the whole process tree (`taskkill /T /F /PID`), then try deleting `*.part` / `*.ytdl` files of this job.

### download `options` (all optional; build a yt-dlp argv list — never shell=True)
```js
{
  outputDir: "C:\\...",          // default config.defaultDir (= %USERPROFILE%\\Downloads\\YT Grabber)
  filenameTemplate: "%(title)s [%(id)s].%(ext)s",
  mode: "video" | "audio" | "video_only",
  quality: "best" | 2160 | 1440 | 1080 | 720 | 480 | 360 | 240 | 144,  // max height
  container: "mp4" | "mkv" | "webm",   // video: --merge-output-format; mp4 prefers avc1/m4a for compatibility when preferCompat
  preferCompat: true,                   // mp4: prefer h264+aac (-S "vcodec:h264,res,acodec:m4a") so it plays everywhere
  fps60: true,                          // allow >30fps (false -> -S fps:30 style: prefer <=30)
  audioFormat: "mp3"|"m4a"|"opus"|"flac"|"wav"|"best", audioQuality: "0".."10" or "192K"
  formatId: "",                         // advanced: raw -f string; overrides mode/quality
  subtitles: { enabled:false, langs:["ru","en"], auto:true, embed:true, format:"srt" },
      // --write-subs, --write-auto-subs (if auto), --sub-langs "ru,en", --convert-subs srt, --embed-subs (if embed and container mp4/mkv)
  embedThumbnail:false, embedMetadata:true, embedChapters:true, splitChapters:false,
  sponsorblock: [] ,                    // categories to REMOVE: "sponsor","intro","outro","selfpromo","interaction","preview","music_offtopic","filler"
  playlist: false, playlistItems: "",   // false -> --no-playlist; items -> -I "1-5,8"
  section: { start:"", end:"" },        // e.g. "1:30","2:45" -> --download-sections "*1:30-2:45" --force-keyframes-at-cuts
  rateLimit: "",                        // "2M" -> -r
  cookiesFromBrowser: "",               // "chrome"|"edge"|"firefox"|"" -> --cookies-from-browser
  writeDescription:false, writeInfoJson:false, writeThumbnail:false,
  restrictFilenames:false, noOverwrites:true, concurrentFragments: 4,  // -N
  extraArgs: ""                         // allowed network/retry flags (e.g. --limit-rate 1M --retries 5)
}
```
Additional arguments are split with shlex (posix=False) and appended before the URL.
The host accepts a fixed set of flags for download tuning. Output locations, configuration
loading, external programs and lifecycle hooks are controlled by the host. Filename templates
produce a single filename in the selected download folder.
Always add: `--newline --no-colors --encoding utf-8 --ffmpeg-location <ffmpeg dir if known> -P <outputDir> -o <template>`
`--progress-template "download:__P__%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(info.playlist_index)s|%(info.n_entries)s"`
`--print after_move:__F__%(filepath)s` (collect files) — note `--print` implies quiet/simulate unless `--no-simulate`; use `--no-simulate` or `--print-to-file`-free alternative: `--exec` is NOT wanted. Verify the chosen combination actually downloads AND prints.
Detect stage from lines: `[Merger]` -> merging; `[ExtractAudio]`, `[EmbedSubtitle]`, `[FFmpeg...]`, `[SponsorBlock]`, `[ModifyChapters]`, `[Metadata]`, `[EmbedThumbnail]` -> postprocessing.
Subprocess: `creationflags=CREATE_NO_WINDOW`, stdout+stderr merged, decode utf-8 errors=replace, env `PYTHONIOENCODING=utf-8`.
Concurrency: queue jobs beyond `maxConcurrent` (emit progress stage "queued").

## Extension (Opus)
- Popup: current YouTube tab detected -> preview (thumb/title/duration), Quick tab (preset chips: "Лучшее MP4", "1080p", "720p", "Аудио MP3", subtitles toggle + lang), Advanced tab (all options), folder picker, Download button.
  Active downloads with progress + cancel; recent history (last 30) with open file / show in folder / re-download / remove.
- Button injected on YouTube watch page next to like/share -> one-click download with default preset.
- Context menu on YouTube links: "Скачать видео (YT Grabber)" / "Скачать аудио".
- Badge shows number of active downloads; desktop notification on done/error.
- Options page: defaults, host status/diagnostics, update yt-dlp, clear history, export/import settings.
- UI language: English and Russian (`extension/i18n.js`); setting `language` = `auto` (browser UI language) | `en` | `ru`.

## Self-update
The background worker checks `api.github.com/repos/MBudkin/YT-Grabber/releases/latest` every 6 h.
A release `vX.Y.Z` must carry the asset `YT-Grabber.zip` (GitHub supplies its sha256 digest).
If newer than the manifest version, the popup shows a banner (or installs automatically when
`autoUpdate` is on and nothing is downloading): host `self_update` → installer replaces
`%LOCALAPPDATA%\YT Grabber` → background waits until `ping.hostVersion` equals the new version →
`chrome.runtime.reload()`. Manifest `version` and host `VERSION` must always match (build.ps1 enforces it;
the host also checks the packaged manifest version against the release tag).
Each attempt has a random id (`self_update.attempt`). `update.ps1` (single instance, mutex) writes
`%LOCALAPPDATA%\YT Grabber\update-status\<attempt>.json` `{version, attempt, status: installing|ok|failed, error}`;
`{cmd:"ping", attempt}` returns that record as `update`. While installing, the
extension refuses to start the helper except for the poller; the host refuses new downloads while it
fetches an update. After reload the extension re-injects the content script into open YouTube tabs.
yt-dlp itself is updated daily (`autoUpdateYtdlp`).
