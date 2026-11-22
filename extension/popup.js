import {
  DEFAULT_OPTIONS, QUALITIES, SUB_LANGS, SPONSOR_CATS, getSettings, parseYouTube,
  fmtDuration, fmtBytes, fmtDate, describeOptions, deepMerge, sendBg, t, I18N
} from "./common.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let settings, opts;          // opts = current working options (persisted as settings.options)
let target = null;           // parseYouTube result
let info = null;             // host info.data
let hostInfo = null;         // pong
let activeTab = null;
let history = [];
let starting = false;

// ------------------------------------------------------------ messaging
async function bg(msg) {
  const r = await sendBg(msg);
  if (!r) throw new Error(t("noReply"));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
const host = payload => bg({ action: "host", payload });
const saveSettings = patch => bg({ action: "saveSettings", patch });

function toast(text, ms = 2400) {
  const t = $("#toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ------------------------------------------------------------ init
init();

async function init() {
  settings = await getSettings();
  opts = deepMerge(DEFAULT_OPTIONS, settings.options);
  I18N.apply(document);
  buildStaticControls();
  bindControls();
  renderControls();

  const state = await bg({ action: "state" }).catch(() => ({ jobs: [], history: [] }));
  history = state.history || [];
  renderJobs(state.jobs || []);
  renderHistory();

  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const yt = activeTab?.url && parseYouTube(activeTab.url);
  if (yt) setTarget(yt, activeTab.title);
  else {
    $("#noVideo").hidden = false;
  }
  checkHost();
  renderUpdate();
}

async function checkHost() {
  try {
    hostInfo = await host({ cmd: "ping" });
    $("#hostDot").className = "dot ok";
    $("#hostDot").title = t("hostTooltip", hostInfo.hostVersion, hostInfo.ytdlpVersion) + t(hostInfo.ffmpeg ? "ffmpegOk" : "ffmpegMissing");
    if (!hostInfo.ffmpeg) showBanner(t("bannerFfmpeg"));
    fillFolders();
    updateDownloadBtn();
  } catch (e) {
    $("#hostDot").className = "dot err";
    $("#hostDot").title = e.message;
    showBanner(t("bannerHost", escapeHtml(e.message)));
    updateDownloadBtn();
  }
}

function showBanner(html) { const b = $("#hostBanner"); b.innerHTML = html; b.hidden = false; }

// ------------------------------------------------------------ target video
async function setTarget(yt, pageTitle) {
  target = yt; info = null;
  $("#noVideo").hidden = true;
  $("#videoCard").hidden = false;
  const title = pageTitle?.replace(/ - YouTube$/, "").replace(/^\(\d+\)\s*/, "");
  $("#vTitle").textContent = (yt.kind === "playlist" ? t("playlist") : title) || t("loading");
  $("#vTitle").classList.toggle("skeleton", !title);
  $("#vChannel").textContent = "";
  $("#vStatus").textContent = t("fetchingFormats");
  $("#vThumb").src = yt.id ? `https://i.ytimg.com/vi/${yt.id}/mqdefault.jpg` : "icons/icon128.png";
  $("#vDur").textContent = "";
  $("#playlistRow").hidden = !yt.playlistId;
  $("#plCount").textContent = "";
  renderControls();
  updateDownloadBtn();

  try {
    const r = await host({ cmd: "info", url: yt.url, playlist: yt.kind === "playlist" });
    if (target !== yt) return;
    info = r.data;
    $("#vTitle").classList.remove("skeleton");
    $("#vTitle").textContent = info.playlist && yt.kind === "playlist" ? info.playlist.title : info.title;
    $("#vChannel").textContent = info.channel || info.uploader || "";
    $("#vDur").textContent = info.is_live ? "LIVE" : fmtDuration(info.duration);
    $("#vStatus").textContent = info.heights?.length ? t("upTo", info.heights[0]) + (info.chapters ? t("chapters", info.chapters) : "") : "";
    if (info.thumbnail && !yt.id) $("#vThumb").src = info.thumbnail;
    if (info.playlist) $("#plCount").textContent = `(${info.playlist.count})`;
    renderControls();
  } catch (e) {
    if (target !== yt) return;
    $("#vTitle").classList.remove("skeleton");
    if (!title) $("#vTitle").textContent = yt.url;
    $("#vStatus").textContent = t("formatsFailed", e.message);
  }
  updateDownloadBtn();
}

// ------------------------------------------------------------ controls
function buildStaticControls() {
  $("#qualityChips").innerHTML = QUALITIES.map(q => `<button data-v="${q.v}">${q.v === "best" ? t(q.label) : q.label}</button>`).join("");
  $("#sponsorList").innerHTML = SPONSOR_CATS.map(([v, l]) =>
    `<label class="check"><input type="checkbox" value="${v}"> ${escapeHtml(t(l))}</label>`).join("");
}

const bindings = [
  // [selector, path, kind]
  ["#optCompat", "preferCompat", "check"], ["#optFps60", "fps60", "check"],
  ["#optFormatId", "formatId", "value"], ["#optAudioQuality", "audioQuality", "value"],
  ["#optSubAuto", "subtitles.auto", "check"], ["#optSubEmbed", "subtitles.embed", "check"],
  ["#optSubFormat", "subtitles.format", "value"],
  ["#optStart", "section.start", "value"], ["#optEnd", "section.end", "value"],
  ["#optEmbedThumb", "embedThumbnail", "check"], ["#optEmbedMeta", "embedMetadata", "check"],
  ["#optEmbedChapters", "embedChapters", "check"], ["#optSplitChapters", "splitChapters", "check"],
  ["#optWriteThumb", "writeThumbnail", "check"], ["#optWriteDesc", "writeDescription", "check"],
  ["#optWriteInfo", "writeInfoJson", "check"], ["#optTemplate", "filenameTemplate", "value"],
  ["#optRestrict", "restrictFilenames", "check"], ["#optNoOverwrite", "noOverwrites", "check"],
  ["#optItems", "playlistItems", "value"], ["#optRate", "rateLimit", "value"],
  ["#optFragments", "concurrentFragments", "number"], ["#optCookies", "cookiesFromBrowser", "value"],
  ["#optExtra", "extraArgs", "value"], ["#optSubs", "subtitles.enabled", "check"],
  ["#optPlaylist", "playlist", "check"]
];
const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

function bindControls() {
  $$(".tab").forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  $("#openOptions").onclick = () => chrome.runtime.openOptionsPage();

  $("#urlForm").onsubmit = e => {
    e.preventDefault();
    const yt = parseYouTube($("#urlInput").value.trim());
    if (!yt) return toast(t("notYouTube"));
    setTarget(yt, "");
  };

  $$("#modeSeg button").forEach(b => b.onclick = () => {
    opts.mode = b.dataset.mode === "audio" ? "audio" : ($("#optVideoOnly").checked ? "video_only" : "video");
    opts.formatId = "";
    commit();
  });
  $("#optVideoOnly").onchange = e => { if (opts.mode !== "audio") opts.mode = e.target.checked ? "video_only" : "video"; commit(); };
  $("#qualityChips").onclick = e => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    opts.quality = b.dataset.v === "best" ? "best" : Number(b.dataset.v); opts.formatId = ""; commit();
  };
  $("#containerChips").onclick = e => { const b = e.target.closest("button"); if (b) { opts.container = b.dataset.v; commit(); } };
  $("#audioChips").onclick = e => { const b = e.target.closest("button"); if (b) { opts.audioFormat = b.dataset.v; commit(); } };
  $("#subLangChips").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const set = new Set(opts.subtitles.langs);
    set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
    opts.subtitles.langs = [...set];
    if (opts.subtitles.langs.length) opts.subtitles.enabled = true;
    commit();
  };
  $("#optSubLangs").onchange = e => {
    opts.subtitles.langs = e.target.value.split(/[,\s]+/).filter(Boolean); commit();
  };
  $("#sponsorList").onchange = () => {
    opts.sponsorblock = $$("#sponsorList input:checked").map(i => i.value); commit();
  };

  for (const [sel, path, kind] of bindings) {
    const el = $(sel);
    el.addEventListener("change", () => {
      setPath(opts, path, kind === "check" ? el.checked : kind === "number" ? Number(el.value) : el.value.trim());
      commit();
    });
  }

  $("#folderSelect").onchange = e => { opts.outputDir = e.target.value; commit(); };
  $("#pickFolder").onclick = pickFolder;
  $("#useCurrentTime").onclick = useCurrentTime;
  $("#resetAdvanced").onclick = () => {
    const dir = opts.outputDir;
    opts = deepMerge(DEFAULT_OPTIONS, { outputDir: dir });
    commit(); toast(t("settingsReset"));
  };
  $("#downloadBtn").onclick = download;

  $("#clearFinished").onclick = async () => {
    const st = await bg({ action: "state" });
    const ids = st.jobs.filter(j => !["running", "queued"].includes(j.status)).map(j => j.jobId);
    await bg({ action: "dismiss", jobIds: ids });
  };
  $("#historySearch").oninput = renderHistory;

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.event === "jobs") renderJobs(msg.jobs);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.history) { history = changes.history.newValue || []; renderHistory(); }
    if (area === "local" && (changes.update || changes.updateState)) renderUpdate();
    // The helper was blocked while an update installed; recheck once the install gate clears.
    const st = changes.updateState?.newValue?.status;
    if (area === "local" && changes.updateState && !hostInfo && !["downloading", "installing", "reloading"].includes(st)) {
      $("#hostBanner").hidden = true;
      checkHost();
      if (target && !info) setTarget(target, "");   // formats request was blocked by the update gate
    }
  });
}

function commit() {
  renderControls();
  saveSettings({ options: opts }).catch(e => toast(e.message));
}

function renderControls() {
  const audio = opts.mode === "audio";
  $$("#modeSeg button").forEach(b => b.classList.toggle("active", (b.dataset.mode === "audio") === audio));
  $("#videoOpts").hidden = audio;
  $("#audioOpts").hidden = !audio;
  $("#audioQualityRow").hidden = !audio;
  $("#optVideoOnly").checked = opts.mode === "video_only";

  const heights = info?.heights || [];
  const maxH = heights[0] || 0;
  $$("#qualityChips button").forEach(b => {
    const v = b.dataset.v;
    b.classList.toggle("active", String(opts.quality) === v && !opts.formatId);
    b.disabled = !!info && v !== "best" && maxH > 0 && Number(v) > maxH && String(opts.quality) !== v;
  });
  $$("#containerChips button").forEach(b => b.classList.toggle("active", b.dataset.v === opts.container));
  $$("#audioChips button").forEach(b => b.classList.toggle("active", b.dataset.v === opts.audioFormat));

  // subtitle languages: show available ones if known, otherwise defaults
  // The visible set and its order depend only on the video (and on the UI language), never on
  // the current selection, so toggling a chip doesn't move it. Selected languages that don't fit
  // into the first slots are appended at the end in the same stable order.
  const avail = info ? new Set([...(info.subtitles || []), ...(opts.subtitles.auto ? info.autoCaptions || [] : [])].map(s => s.lang)) : null;
  const selected = opts.subtitles.langs;
  const preferred = I18N.lang === "ru" ? ["ru", "en"] : ["en", "ru"];
  const known = [...new Set([...preferred, ...SUB_LANGS.map(([c]) => c)])];
  let base = avail
    ? [...new Set([...known.filter(c => avail.has(c)), ...(info.subtitles || []).map(s => s.lang)])]
    : preferred;
  base = base.slice(0, 6);
  // Extras stay rendered (in the order they first appeared) until the video changes, so
  // deselecting one doesn't shift its neighbours.
  const extrasKey = (target?.url || "") + "|" + base.join(",");
  if (renderControls.extrasKey !== extrasKey) { renderControls.extrasKey = extrasKey; renderControls.extras = []; }
  const extras = renderControls.extras;
  for (const c of [...known, ...selected]) if (selected.includes(c) && !base.includes(c) && !extras.includes(c)) extras.push(c);
  const langs = [...base, ...extras];
  $("#subLangChips").replaceChildren(...langs.map(l => {
    const manual = info?.subtitles?.some(s => s.lang === l);
    const chip = document.createElement("button");
    chip.dataset.v = l;
    chip.classList.toggle("active", opts.subtitles.langs.includes(l));
    chip.title = info ? t(manual ? "subManual" : avail.has(l) ? "subAuto" : "subNone") : "";
    chip.textContent = l + (!manual && avail?.has(l) ? "*" : "");
    return chip;
  }));
  $("#subLangChips").style.visibility = opts.subtitles.enabled ? "visible" : "hidden";

  for (const [sel, path, kind] of bindings) {
    const el = $(sel), v = getPath(opts, path);
    if (kind === "check") el.checked = !!v; else if (document.activeElement !== el) el.value = v ?? "";
  }
  $("#optPlaylist").disabled = target?.kind === "playlist";
  $("#optPlaylist").checked = target?.kind === "playlist" || opts.playlist;
  if (document.activeElement !== $("#optSubLangs")) $("#optSubLangs").value = opts.subtitles.langs.join(",");
  $$("#sponsorList input").forEach(i => (i.checked = opts.sponsorblock.includes(i.value)));

  // explicit formats from info
  const sel = $("#optFormatId");
  if (sel.formats !== info?.formats) {
    sel.formats = info?.formats;
    const fmts = (info?.formats || []).filter(f => f.vcodec !== "none" || f.acodec !== "none");
    sel.replaceChildren(new Option(t("formatAuto"), ""), ...fmts.map(f => {
      const kind = f.vcodec === "none" ? "🎵" : f.acodec === "none" ? "🎞" : "🎬";
      const res = f.height ? `${f.height}p${f.fps > 30 ? f.fps : ""}` : (f.abr ? Math.round(f.abr) + "k" : "");
      const codec = (f.vcodec !== "none" ? f.vcodec : f.acodec || "").split(".")[0];
      const size = fmtBytes(f.filesize);
      return new Option(`${kind} ${f.format_id} · ${res} · ${f.ext} · ${codec}${size ? " · " + size : ""}${f.dynamic_range && f.dynamic_range !== "SDR" ? " · " + f.dynamic_range : ""}`,
        f.format_id + (f.acodec === "none" ? "+bestaudio" : ""));
    }));
  }
  if (info && opts.formatId && ![...sel.options].some(o => o.value === opts.formatId)) opts.formatId = "";
  sel.value = opts.formatId || "";

  $("#advanced").querySelector("summary").textContent = t("advanced") + (advancedCount() ? ` (${advancedCount()})` : "");
  updateDownloadBtn();
}

function advancedCount() {
  const d = DEFAULT_OPTIONS; let n = 0;
  if (opts.formatId) n++;
  if (opts.sponsorblock.length) n++;
  if (opts.section.start || opts.section.end) n++;
  if (opts.rateLimit || opts.cookiesFromBrowser || opts.extraArgs) n++;
  if (opts.splitChapters || opts.writeDescription || opts.writeInfoJson || opts.writeThumbnail) n++;
  if (opts.filenameTemplate !== d.filenameTemplate || opts.restrictFilenames) n++;
  return n;
}

function estimateSize() {
  if (!info?.formats || info.is_live || opts.section.start || opts.section.end) return null;
  const formats = info.formats;
  const size = f => f && (f.filesize || (info.duration * (f.tbr || (f.vcodec === "none" ? f.abr : f.vbr)) * 125)) || null;
  const compat = opts.container === "mp4" && opts.preferCompat;
  const audio = formats.filter(f => f.vcodec === "none" && f.acodec !== "none");
  const bestAudio = (compat && opts.mode !== "audio" && audio.filter(f => f.ext === "m4a").at(-1)) || audio.at(-1);
  const combinedSize = video => size(video) && size(bestAudio) ? size(video) + size(bestAudio) : null;
  if (opts.formatId) {
    const [id, addAudio] = opts.formatId.split("+");
    const chosen = formats.find(f => f.format_id === id);
    return addAudio ? combinedSize(chosen) : size(chosen);
  }
  if (opts.mode === "audio") {
    if (opts.audioFormat === "best") return size(bestAudio);
    const bitrate = /^(\d+)K$/i.exec(opts.audioQuality);
    return bitrate && info.duration ? Number(bitrate[1]) * 125 * info.duration : null;
  }
  const cap = opts.quality === "best" ? Infinity : opts.quality;
  const videos = formats.filter(f => f.vcodec !== "none" && f.height > 0 && f.height <= cap);
  const separate = videos.filter(f => f.acodec === "none");
  const candidates = opts.mode === "video_only" || (separate.length && bestAudio)
    ? separate : videos.filter(f => f.acodec !== "none");
  // yt-dlp returns formats in ascending preference. Retain that order for ties.
  candidates.sort((a, b) => a.height - b.height ||
    (compat && Number(/^avc|^h264/.test(a.vcodec)) - Number(/^avc|^h264/.test(b.vcodec))) ||
    (!opts.fps60 && Number(a.fps <= 30) - Number(b.fps <= 30)));
  const video = candidates.at(-1);
  return video?.acodec === "none" && opts.mode !== "video_only" ? combinedSize(video) : size(video);
}

function updateDownloadBtn() {
  const btn = $("#downloadBtn");
  const playlist = target?.kind === "playlist" || !!(opts.playlist && target?.playlistId);
  btn.disabled = !target || !hostInfo || starting;
  $("#dlMain").textContent = t(playlist ? "downloadPlaylistBtn" : "download");
  const size = estimateSize();
  $("#dlSub").textContent = describeOptions({ ...opts, playlist }) + (!playlist && size ? " · ≈" + fmtBytes(size) : "");
}

function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $("#tab-grab").hidden = name !== "grab";
  $("#tab-jobs").hidden = name !== "jobs";
}

// ------------------------------------------------------------ folders
function fillFolders() {
  const def = hostInfo?.defaultDir || "";
  const dirs = [...new Set([opts.outputDir, def, ...(settings.recentDirs || [])].filter(Boolean))];
  $("#folderSelect").innerHTML = dirs.map(d =>
    `<option value="${escapeHtml(d === def ? "" : d)}" title="${escapeHtml(d)}">${escapeHtml(shortPath(d))}${d === def ? " " + escapeHtml(t("defaultMark")) : ""}</option>`).join("");
  $("#folderSelect").value = opts.outputDir && opts.outputDir !== def ? opts.outputDir : "";
}
function shortPath(p) { return p.length > 46 ? p.slice(0, 3) + "…" + p.slice(-40) : p; }

async function pickFolder() {
  toast(t("openingFolder"));
  try {
    const r = await host({ cmd: "pick_folder", initial: opts.outputDir || hostInfo?.defaultDir || "" });
    if (r.path) {
      opts.outputDir = r.path;
      settings.recentDirs = [r.path, ...(settings.recentDirs || []).filter(d => d !== r.path)].slice(0, 5);
      await saveSettings({ options: opts, recentDirs: settings.recentDirs });
      fillFolders(); updateDownloadBtn();
    }
  } catch (e) { toast(e.message); }
}

async function useCurrentTime() {
  if (!activeTab || !target?.id || parseYouTube(activeTab.url)?.id !== target.id)
    return toast(t("needTab"));
  const r = await chrome.tabs.sendMessage(activeTab.id, { action: "currentTime" }).catch(() => null);
  if (r?.time != null) { opts.section.start = fmtDuration(r.time); commit(); }
  else toast(t("noTime"));
}

// ------------------------------------------------------------ download
async function download() {
  if (!target || starting) return;
  const usePlaylist = target.kind === "playlist" || !!(opts.playlist && target.playlistId);
  const url = usePlaylist ? (target.playlistUrl || target.url) : target.url;
  const options = { ...opts, playlist: usePlaylist };
  starting = true;
  updateDownloadBtn();
  try {
    await saveSettings({ options: opts });
    await bg({
      action: "download", url, options,
      meta: {
        title: usePlaylist ? info?.playlist?.title : info?.title,
        thumbnail: info?.thumbnail && !target.id ? info.thumbnail : undefined
      }
    });
    toast(t("added"));
    switchTab("jobs");
  } catch (e) { toast(e.message, 4000); }
  finally { starting = false; updateDownloadBtn(); }
}

// ------------------------------------------------------------ jobs
const ICONS = {
  x: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  log: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>'
};
const STAGES = { queued: "stQueued", downloading: "stDownloading", merging: "stMerging", postprocessing: "stPostprocessing" };

function renderJobs(jobs) {
  const active = jobs.filter(j => ["running", "queued"].includes(j.status)).length;
  $("#jobsCount").hidden = !active; $("#jobsCount").textContent = active;
  $("#jobsEmpty").hidden = jobs.length > 0;
  $("#clearFinished").hidden = !jobs.some(j => !["running", "queued"].includes(j.status));
  $("#jobsList").innerHTML = jobs.map(j => {
    const running = ["running", "queued"].includes(j.status);
    const indet = running && (j.stage !== "downloading" || j.percent == null);
    let meta;
    if (j.status === "done") meta = `<span class="status-ok">${t("done")}</span>`;
    else if (j.status === "cancelled") meta = `<span>${t("cancelled")}</span>`;
    else if (j.status === "error") meta = `<span class="status-err">${t("error")}</span>`;
    else meta = `<span>${t(STAGES[j.stage] || "stDownloading")}${j.item ? " " + escapeHtml(j.item) : ""}</span>` +
      (j.stage === "downloading" && j.percent != null ? `<span>${j.percent.toFixed(1)}%</span>` : "") +
      (j.speed ? `<span>${escapeHtml(j.speed)}</span>` : "") + (j.eta ? `<span>${escapeHtml(t("left", j.eta))}</span>` : "");
    return `<div class="item ${j.status === "error" ? "error" : ""}" data-job="${escapeHtml(j.jobId)}">
      <img class="ithumb" src="${escapeHtml(j.thumbnail || "icons/icon128.png")}" alt="">
      <div class="ibody">
        <div class="ititle" title="${escapeHtml(j.title)}">${escapeHtml(j.title)}</div>
        <div class="imeta">${meta}<span>${escapeHtml(j.options ? describeOptions(j.options) : j.label || "")}</span></div>
        ${running ? `<div class="bar ${indet ? "indet" : ""}"><i style="width:${j.percent || 0}%"></i></div>` : ""}
        ${j.status === "error" ? `<div class="ierr" title="${escapeHtml(j.error)}">${escapeHtml(j.error)}</div>` : ""}
      </div>
      <div class="iact">
        ${j.status === "done" && j.files?.length ? `<button data-act="open" title="${t("actOpen")}">${ICONS.play}</button><button data-act="reveal" title="${t("actReveal")}">${ICONS.folder}</button>` : ""}
        ${["error", "cancelled"].includes(j.status) ? `<button data-act="retry" title="${t("actRetry")}">${ICONS.retry}</button>` : ""}
        <button data-act="log" title="${t("actLog")}">${ICONS.log}</button>
        <button data-act="${running ? "cancel" : "dismiss"}" title="${t(running ? "actCancel" : "actDismiss")}">${ICONS.x}</button>
      </div></div>`;
  }).join("");
  $("#jobsList").onclick = async e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const id = b.closest("[data-job]").dataset.job;
    const j = jobs.find(x => x.jobId === id);
    try {
      switch (b.dataset.act) {
        case "cancel": await bg({ action: "cancel", jobId: id }); break;
        case "dismiss": await bg({ action: "dismiss", jobIds: [id] }); break;
        case "open": await host({ cmd: "open_file", path: j.files[0] }); break;
        case "reveal": await host({ cmd: "reveal", path: j.files[0] }); break;
        case "retry": await bg({ action: "download", url: j.url, options: j.options, meta: { title: j.title, thumbnail: j.thumbnail } });
          await bg({ action: "dismiss", jobIds: [id] }); break;
        case "log": {
          const { lines } = await bg({ action: "logs", jobId: id });
          const w = window.open("", "_blank", "width=720,height=480");
          if (w) { w.document.title = t("logTitle", j.title); w.document.body.innerHTML = `<pre style="white-space:pre-wrap;font:12px Consolas,monospace">${escapeHtml(lines.join("\n") || t("empty"))}</pre>`; }
          break;
        }
      }
    } catch (err) { toast(err.message, 4000); }
  };
}

function renderHistory() {
  const q = $("#historySearch").value.trim().toLowerCase();
  const list = history.filter(h => !q || (h.title || "").toLowerCase().includes(q));
  $("#historyEmpty").hidden = list.length > 0;
  $("#historyEmpty").textContent = t(history.length ? "nothingFound" : "historyEmpty");
  $("#historyList").innerHTML = list.map(h => `
    <div class="item" data-key="${escapeHtml(h.key)}">
      <img class="ithumb" src="${escapeHtml(h.thumbnail || "icons/icon128.png")}" alt="">
      <div class="ibody">
        <div class="ititle" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</div>
        <div class="imeta"><span>${fmtDate(h.date)}</span><span>${escapeHtml(h.options ? describeOptions(h.options) : h.label || "")}</span></div>
      </div>
      <div class="iact">
        ${h.files?.length ? `<button data-act="open" title="${t("actOpenFile")}">${ICONS.play}</button><button data-act="reveal" title="${t("actReveal")}">${ICONS.folder}</button>` : ""}
        <button data-act="page" title="${t("actPage")}">${ICONS.link}</button>
        <button data-act="again" title="${t("actAgain")}">${ICONS.retry}</button>
        <button data-act="remove" title="${t("actRemove")}">${ICONS.x}</button>
      </div></div>`).join("");
  $("#historyList").onclick = async e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const key = b.closest("[data-key]").dataset.key;
    const h = history.find(x => x.key === key);
    try {
      switch (b.dataset.act) {
        case "open": await host({ cmd: "open_file", path: h.files[0] }); break;
        case "reveal": await host({ cmd: "reveal", path: h.files[0] }); break;
        case "page": chrome.tabs.create({ url: h.url }); break;
        case "again": await bg({ action: "download", url: h.url, options: h.options, meta: { title: h.title, thumbnail: h.thumbnail } }); toast(t("added")); break;
        case "remove": await bg({ action: "removeHistory", key }); break;
      }
    } catch (err) { toast(/not exist|не найден|No such|cannot find/i.test(err.message) ? t("fileMissing") : err.message, 4000); }
  };
}

// ------------------------------------------------------------ self-update banner
async function renderUpdate() {
  const { update, updateState } = await chrome.storage.local.get(["update", "updateState"]);
  const b = $("#updateBanner");
  const installing = ["downloading", "installing", "reloading"].includes(updateState?.status) && Date.now() - updateState.at < 30 * 60000;
  if (installing) {
    b.textContent = t("updating", updateState.version);
  } else if (update?.available) {
    b.replaceChildren();
    const text = document.createElement("span");
    text.textContent = t("updateAvailable", update.latest) + " ";
    b.append(text);
    if (updateState?.status === "error") {
      const err = document.createElement("div");
      err.className = "status-err";
      err.textContent = t("updateError", updateState.error);
      b.append(err);
    }
    const actions = document.createElement("div");
    actions.className = "banner-actions";
    const go = Object.assign(document.createElement("button"), { className: "btn primary small", textContent: t("updateNow") });
    go.onclick = async () => {
      go.disabled = true;
      try { await bg({ action: "installUpdate" }); } catch (e) { toast(e.message, 4000); go.disabled = false; }
    };
    const more = Object.assign(document.createElement("button"), { className: "link-btn", textContent: t("updateDetails") });
    more.onclick = () => chrome.tabs.create({ url: update.page });
    actions.append(go, more);
    b.append(actions);
  } else { b.hidden = true; return; }
  b.hidden = false;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
