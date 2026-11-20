import {
  HOST_NAME, HISTORY_LIMIT, GITHUB_REPO, getSettings, saveSettings, parseYouTube, deepMerge, describeOptions,
  compareVersions, t, I18N
} from "./common.js";

// Resolve the UI language before anything user-visible is produced.
const languageReady = getSettings().catch(() => null);

// ---------------------------------------------------------------- native host
let port = null;
let reqSeq = 0;
const pending = new Map();          // id -> {resolve, reject, timer}
let lastHostError = null;
let idleTimer = null;

const jobs = new Map();             // jobId -> job
const logs = new Map();             // jobId -> string[]
let jobsReady;
let historyWrites = Promise.resolve();
let settingsWrites = Promise.resolve();

function friendlyHostError(msg) {
  if (!msg) return t("errLost");
  if (/not found|not registered|forbidden/i.test(msg)) return t("errNotInstalled");
  if (/exited/i.test(msg)) return t("errExited");
  return msg;
}

function connect() {
  if (port) return port;
  lastHostError = null;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    lastHostError = friendlyHostError(chrome.runtime.lastError?.message);
    port = null;
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(lastHostError)); }
    pending.clear();
    for (const j of jobs.values()) {
      if (j.status === "running" || j.status === "queued") {
        Object.assign(j, { status: "error", error: lastHostError, finishedAt: Date.now() });
      }
    }
    changed();
  });
  return port;
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  if (pending.size || [...jobs.values()].some(isActive)) return;
  idleTimer = setTimeout(() => {
    if (!pending.size && ![...jobs.values()].some(isActive) && port) {
      port.disconnect();
      port = null;
    }
  }, 120000);
}

const NO_TIMEOUT = new Set(["pick_folder", "update_ytdlp", "self_update"]);
const REPLY_TYPE = {
  ping: "pong", info: "info", download: "started", cancel: "ok", pick_folder: "folder",
  open_folder: "ok", reveal: "ok", open_file: "ok", update_ytdlp: "updated",
  get_config: "config", set_config: "config", self_update: "update_started"
};

// While an update is being installed, don't start the helper (it would lock files being replaced);
// only the update poller may talk to it.
let updateGate = null;              // version being installed, or null
const gateReady = chrome.storage.local.get("updateState").then(({ updateState }) => {
  // At worker start a leftover "downloading" may mean the installer is already running.
  if (updateState?.status === "installing" || (updateState?.status === "downloading" && updateState.attempt))
    updateGate = updateState.version;
}).catch(() => {});

async function hostRequest(payload, { poll = false } = {}) {
  await gateReady;
  if (updateGate && !poll) throw new Error(t("updating", updateGate));
  return rawHostRequest(payload);
}

function rawHostRequest(payload) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = connect(); } catch (e) { return reject(new Error(friendlyHostError(e.message))); }
    const id = "r" + (++reqSeq) + "_" + Date.now();
    const timer = NO_TIMEOUT.has(payload.cmd) ? null : setTimeout(() => {
      pending.delete(id);
      reject(new Error(t("errTimeout")));
      scheduleIdle();
    }, payload.cmd === "info" ? 90000 : 30000);
    pending.set(id, { resolve, reject, timer, expected: REPLY_TYPE[payload.cmd] });
    try { p.postMessage({ ...payload, id, lang: I18N.lang }); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(new Error(friendlyHostError(e.message))); }
    scheduleIdle();
  });
}

function onHostMessage(msg) {
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type === "error") p.reject(new Error(msg.message || t("errHost")));
    else if (msg.type !== p.expected || (msg.type === "started" && !msg.jobId))
      p.reject(new Error(t("errUnexpected")));
    else p.resolve(msg);
    scheduleIdle();
    return;
  }
  if (!msg.jobId) return;
  const j = jobs.get(msg.jobId);
  if (!j) return;
  switch (msg.type) {
    case "progress":
      j.status = msg.stage === "queued" ? "queued" : "running";
      j.stage = msg.stage;
      j.percent = msg.percent ?? null;
      j.speed = msg.speed || "";
      j.eta = msg.eta || "";
      j.downloaded = msg.downloaded; j.total = msg.total;
      j.item = msg.item || null;
      changed(true);
      break;
    case "log": {
      const arr = logs.get(j.jobId) || [];
      arr.push(msg.line);
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      logs.set(j.jobId, arr);
      break;
    }
    case "done":
      Object.assign(j, { status: "done", percent: 100, files: msg.files || [], finishedAt: Date.now() });
      if (msg.title && !j.titleFromPage) j.title = msg.title;
      addHistory(j).catch(console.error);
      notify(j, t("notifDone"), j.title);
      changed();
      scheduleIdle();
      break;
    case "error":
      Object.assign(j, { status: "error", error: msg.message || t("errUnknown"), finishedAt: Date.now() });
      notify(j, t("notifError"), (j.title ? j.title + "\n" : "") + j.error);
      changed();
      scheduleIdle();
      break;
    case "cancelled":
      Object.assign(j, { status: "cancelled", finishedAt: Date.now() });
      changed();
      scheduleIdle();
      break;
  }
}

// ---------------------------------------------------------------- state & broadcast
let bcTimer = null;
function changed(throttle = false) {
  updateBadge();
  if (throttle && bcTimer) return;
  clearTimeout(bcTimer);
  bcTimer = setTimeout(() => {
    bcTimer = null;
    const list = jobList();
    chrome.storage.session.set({ jobs: list }).catch(() => {});
    chrome.runtime.sendMessage({ event: "jobs", jobs: list }).catch(() => {});
    broadcastToTabs(list);
  }, throttle ? 250 : 0);
}

const isActive = j => j.status === "running" || j.status === "queued";

function jobList() {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function loadJobs() {
  return jobsReady ??= chrome.storage.session.get("jobs").then(({ jobs: saved }) => {
    for (const j of saved || []) {
      if (isActive(j)) {
        Object.assign(j, { status: "error", error: t("errInterrupted"),
          finishedAt: Date.now() });
      }
      jobs.set(j.jobId, j);
    }
    updateBadge();
  });
}

function updateBadge() {
  const n = [...jobs.values()].filter(j => j.status === "running" || j.status === "queued").length;
  chrome.action.setBadgeText({ text: n ? String(n) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#ff5a36" });
}

async function broadcastToTabs(list) {
  const brief = list.filter(j => j.videoId).map(j => ({
    videoId: j.videoId, status: j.status, percent: j.percent, stage: j.stage, jobId: j.jobId
  }));
  const tabs = await chrome.tabs.query({ url: ["*://www.youtube.com/*", "*://m.youtube.com/*"] }).catch(() => []);
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { event: "jobs", jobs: brief }).catch(() => {});
}

function updateHistory(transform) {
  const write = historyWrites.then(async () => {
    const { history = [] } = await chrome.storage.local.get("history");
    await chrome.storage.local.set({ history: transform(history) });
  });
  historyWrites = write.catch(() => {});
  return write;
}

function addHistory(j) {
  const entry = {
    key: j.jobId, url: j.url, videoId: j.videoId, title: j.title, thumbnail: j.thumbnail,
    files: j.files, label: j.label, options: j.options, date: Date.now()
  };
  return updateHistory(history => [entry, ...history.filter(h => h.key !== j.jobId)].slice(0, HISTORY_LIMIT));
}

function updateSettings(patch, replace = false) {
  const write = settingsWrites.then(() => replace
    ? chrome.storage.local.set({ settings: patch })
    : saveSettings(patch));
  settingsWrites = write.catch(() => {});
  return write;
}

async function notify(j, title, message) {
  const s = await getSettings();
  if (!s.notifications) return;
  chrome.notifications.create("job:" + j.jobId, {
    type: "basic", iconUrl: "icons/icon128.png", title, message: message || "", priority: 0
  });
}

chrome.notifications.onClicked.addListener(async id => {
  if (!id.startsWith("job:")) return;
  await loadJobs();
  const j = jobs.get(id.slice(4));
  if (j?.files?.length) hostRequest({ cmd: "reveal", path: j.files[0] }).catch(() => {});
  chrome.notifications.clear(id);
});

// ---------------------------------------------------------------- downloads
async function startDownload({ url, options, meta = {} }) {
  await loadJobs();
  const settings = await getSettings();
  const opts = deepMerge(settings.options, options || {});
  const yt = parseYouTube(url);
  if (!yt) throw new Error(t("errNotVideo"));
  opts.playlist = yt.kind === "playlist" || !!(opts.playlist && yt.playlistId);
  const job = {
    url: (opts.playlist && yt.playlistUrl) || yt.url, videoId: opts.playlist ? null : yt.id,
    title: meta.title || (opts.playlist ? t("playlist") : url),
    titleFromPage: opts.playlist || !!meta.title,
    thumbnail: meta.thumbnail || (yt?.id ? `https://i.ytimg.com/vi/${yt.id}/mqdefault.jpg` : ""),
    label: describeOptions(opts), options: opts,
    status: "queued", stage: "queued", percent: 0, speed: "", eta: "", startedAt: Date.now()
  };
  const reply = await hostRequest({ cmd: "download", url: job.url, options: opts });
  job.jobId = reply.jobId;
  jobs.set(job.jobId, job);
  scheduleIdle();
  changed();
  return job;
}

async function quickDownload(url, kind, title) {
  const yt = parseYouTube(url);
  if (!yt) throw new Error(t("errNotVideo"));
  const over = {};
  if (kind === "audio") Object.assign(over, { mode: "audio", formatId: "" });
  if (kind === "video") Object.assign(over, { mode: "video", formatId: "" });
  if (kind === "subs") Object.assign(over, { mode: "video", formatId: "", subtitles: { enabled: true } });
  return startDownload({
    url: yt.url,
    options: { ...over, playlist: false, section: { start: "", end: "" } },
    meta: { title: title ? title.replace(/ - YouTube$/, "").replace(/^\(\d+\)\s*/, "") : "" }
  });
}

// ---------------------------------------------------------------- messaging API
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.action) return;
  (async () => {
    await languageReady;
    const fromExtension = sender.url?.startsWith(chrome.runtime.getURL(""));
    if (!fromExtension) {
      const origin = sender.origin || (sender.url && new URL(sender.url).origin);
      if (!sender.tab || !["https://www.youtube.com", "https://m.youtube.com"].includes(origin)
          || !["quick", "jobsForTab"].includes(msg.action)) {
        throw new Error(t("errForbidden"));
      }
    }
    await loadJobs();
    switch (msg.action) {
      case "host": return await hostRequest(msg.payload);
      case "download": return await startDownload(msg);
      case "quick": return await quickDownload(msg.url, msg.kind, msg.title || sender.tab?.title);
      case "cancel": return await hostRequest({ cmd: "cancel", jobId: msg.jobId });
      case "dismiss":
        for (const id of msg.jobIds) {
          if (jobs.has(id) && !isActive(jobs.get(id))) { jobs.delete(id); logs.delete(id); }
        }
        changed(); return { ok: true };
      case "removeHistory": return updateHistory(history => history.filter(h => h.key !== msg.key));
      case "clearHistory": return updateHistory(() => []);
      case "saveSettings": return updateSettings(msg.patch, msg.replace);
      case "logs": return { lines: logs.get(msg.jobId) || [] };
      case "state": {
        await historyWrites;
        const { history = [] } = await chrome.storage.local.get("history");
        return { jobs: jobList(), history, hostError: lastHostError };
      }
      case "checkUpdate": return await checkForUpdate({ manual: true });
      case "installUpdate": return await installUpdate();
      case "jobsForTab": return { jobs: jobList().filter(j => j.videoId).map(j => ({ videoId: j.videoId, status: j.status, percent: j.percent, stage: j.stage, jobId: j.jobId })) };
      default: throw new Error(t("errUnknownCmd", msg.action));
    }
  })().then(r => sendResponse({ ok: true, data: r }), e => sendResponse({ ok: false, error: e.message }));
  return true;
});

// ---------------------------------------------------------------- context menus & hotkey
function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    const youtube = ["*://*.youtube.com/*", "*://youtu.be/*"];
    for (const contexts of [ ["link"], ["page", "video"] ]) {
      const id = contexts[0] === "link" ? "ytg-link" : "ytg-page";
      const patterns = id === "ytg-link" ? { targetUrlPatterns: youtube } : { documentUrlPatterns: youtube };
      chrome.contextMenus.create({ id, title: "YT Grabber", contexts, ...patterns });
      for (const [kind, key] of [["video", "menuVideo"], ["subs", "menuSubs"], ["audio", "menuAudio"]]) {
        chrome.contextMenus.create({ id: id + "-" + kind, parentId: id, title: t(key), contexts, ...patterns });
      }
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const kind = /^ytg-(?:link|page)-(video|subs|audio)$/.exec(info.menuItemId)?.[1];
  if (!kind) return;
  const url = [info.linkUrl, info.srcUrl, info.pageUrl, tab?.url].find(u => u && parseYouTube(u));
  if (!url) return toast(t("noLink"));
  const fromPage = url === info.pageUrl || url === tab?.url;
  try { await quickDownload(url, kind === "video" ? null : kind, fromPage ? tab?.title : ""); }
  catch (e) { toast(e.message); }
});

chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== "quick-download") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !parseYouTube(tab.url)) return toast(t("openVideo"));
  try { await quickDownload(tab.url, null, tab.title); } catch (e) { toast(e.message); }
});

function toast(message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title: "YT Grabber", message });
}


// ---------------------------------------------------------------- self-update (GitHub releases)
// Flow: checkForUpdate → installUpdate (host downloads + verifies the release and launches the
// detached installer, then exits) → pollUpdatedHost waits for update-status.json "ok" reported by
// the new helper's ping → chrome.runtime.reload() → onInstalled verifies the loaded version.
const RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const ASSET_NAME = "YT-Grabber.zip";
const ASSET_PREFIX = `https://github.com/${GITHUB_REPO}/releases/download/`;
const CURRENT_VERSION = chrome.runtime.getManifest().version;
const INSTALL_DEADLINE_MS = 5 * 60000;
const POLL_ALARM = "ytg-update-poll";

async function checkForUpdate({ manual = false } = {}) {
  const r = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (r.status === 404) {
    const update = { checkedAt: Date.now(), latest: CURRENT_VERSION, available: false };
    await chrome.storage.local.set({ update });
    return update;
  }
  if (!r.ok) throw new Error("GitHub: HTTP " + r.status);
  const rel = await r.json();
  const latest = String(rel.tag_name || "").replace(/^v/i, "");
  const asset = (rel.assets || []).find(a => a.name === ASSET_NAME);
  const assetUrl = `${ASSET_PREFIX}${rel.tag_name}/${ASSET_NAME}`;
  const valid = /^\d+(\.\d+){1,3}$/.test(latest) && asset?.browser_download_url === assetUrl
    && /^sha256:[0-9a-f]{64}$/.test(asset?.digest || "");
  const update = {
    checkedAt: Date.now(), latest: latest || CURRENT_VERSION,
    available: !!valid && !rel.draft && !rel.prerelease && compareVersions(latest, CURRENT_VERSION) > 0,
    assetUrl: valid ? assetUrl : "", digest: asset?.digest || "",
    page: rel.html_url || `https://github.com/${GITHUB_REPO}/releases`
  };
  await chrome.storage.local.set({ update });
  if (update.available && !manual) {
    const s = await getSettings();
    const { notifiedVersion, updateState } = await chrome.storage.local.get(["notifiedVersion", "updateState"]);
    // Never retry automatically a version that already failed; the user can retry from the popup.
    const failedBefore = updateState?.status === "error" && updateState.version === update.latest;
    await loadJobs();
    if (s.autoUpdate && !failedBefore && ![...jobs.values()].some(isActive)) {
      installUpdate({ auto: true }).catch(e => console.warn("auto-update failed", e));
    } else if (notifiedVersion !== update.latest) {
      await chrome.storage.local.set({ notifiedVersion: update.latest });
      chrome.notifications.create("update", { type: "basic", iconUrl: "icons/icon128.png",
        title: t("updateNotifTitle"), message: t("updateNotifMsg", update.latest) });
    }
  }
  return update;
}

let installing = false;
async function installUpdate({ auto = false } = {}) {
  await loadJobs();
  const { update, updateState } = await chrome.storage.local.get(["update", "updateState"]);
  if (!update?.available) throw new Error(t("updateNone"));
  if (auto && updateState?.status === "error" && updateState.version === update.latest) return { status: "skipped" };
  const busy = ["downloading", "installing"].includes(updateState?.status) && Date.now() - updateState.at < INSTALL_DEADLINE_MS;
  if (installing || updateGate || busy) return { status: "installing" };
  if ([...jobs.values()].some(isActive)) throw new Error(t("updateBusy"));
  installing = true;
  const version = update.latest;
  // The attempt id ties this request to the installer's own status record, so results of other
  // attempts (another browser profile, an earlier try) are never mistaken for ours.
  const attempt = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");
  try {
    // Download phase: the open native port keeps this worker alive until the host replies.
    await chrome.storage.local.set({ updateState: { status: "downloading", version, attempt, at: Date.now() } });
    await hostRequest({ cmd: "self_update", url: update.assetUrl, digest: update.digest, version, attempt });
  } catch (e) {
    await chrome.storage.local.set({ updateState: { status: "error", version, attempt, error: e.message, at: Date.now() } });
    throw e;
  } finally { installing = false; }
  await enterInstallPhase(version, attempt);
  return { status: "installing" };
}

// Install phase: separate deadline; survives worker restarts via storage + alarm.
async function enterInstallPhase(version, attempt) {
  updateGate = version;
  await chrome.storage.local.set({ updateState: { status: "installing", version, attempt, at: Date.now() } });
  chrome.alarms.create(POLL_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  setTimeout(pollUpdatedHost, 20000);
}

async function failUpdate(version, error) {
  updateGate = null;
  chrome.alarms.clear(POLL_ALARM);
  await chrome.storage.local.set({ updateState: { status: "error", version, error, at: Date.now() } });
}

let polling = false;
async function pollUpdatedHost() {
  const { updateState: st } = await chrome.storage.local.get("updateState");
  if (st?.status !== "installing") { updateGate = null; chrome.alarms.clear(POLL_ALARM); return; }
  if (!st.attempt) return await failUpdate(st.version, t("updateTimeout"));   // legacy state: no way to match a result
  updateGate = st.version;
  if (polling) return;
  polling = true;
  try {
    while (true) {
      let pong = null;
      try { pong = await hostRequest({ cmd: "ping", attempt: st.attempt }, { poll: true }); } catch { /* installer busy */ }
      port?.disconnect(); port = null;      // never keep the helper running while files are replaced
      const rec = pong?.update;
      const result = rec && rec.attempt === st.attempt && rec.version === st.version ? rec : null;
      if (result?.status === "failed") return await failUpdate(st.version, result.error || t("errUnknown"));
      if (result?.status === "ok" && compareVersions(pong.hostVersion, st.version) >= 0) {
        updateGate = null;
        chrome.alarms.clear(POLL_ALARM);
        await chrome.storage.local.set({ updateState: { status: "reloading", version: st.version, at: Date.now() } });
        chrome.runtime.reload();            // loads the new extension files copied by the installer
        return;
      }
      if (Date.now() - st.at > INSTALL_DEADLINE_MS) return await failUpdate(st.version, t("updateTimeout"));
      await new Promise(r => setTimeout(r, 8000));
    }
  } finally { polling = false; }
}

async function autoUpdateYtdlp() {
  const s = await getSettings();
  const { ytdlpUpdatedAt = 0 } = await chrome.storage.local.get("ytdlpUpdatedAt");
  if (!s.autoUpdateYtdlp || Date.now() - ytdlpUpdatedAt < 20 * 3600000) return;
  await loadJobs();
  if ([...jobs.values()].some(isActive)) return;
  await hostRequest({ cmd: "update_ytdlp" });
  await chrome.storage.local.set({ ytdlpUpdatedAt: Date.now() });
}

function scheduleAlarms() {
  chrome.alarms.create("ytg-update-check", { delayInMinutes: 1, periodInMinutes: 360 });
  chrome.alarms.create("ytg-ytdlp", { delayInMinutes: 3, periodInMinutes: 720 });
}

/** Replaces the page button in already-open YouTube tabs (old scripts are orphaned on reload). */
async function reinjectContentScripts() {
  const tabs = await chrome.tabs.query({ url: ["*://www.youtube.com/*", "*://m.youtube.com/*"] }).catch(() => []);
  for (const tab of tabs) {
    const target = { tabId: tab.id };
    chrome.scripting.insertCSS({ target, files: ["content.css"] })
      .then(() => chrome.scripting.executeScript({ target, files: ["i18n.js", "content.js"] }))
      .catch(() => {});
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  await languageReady;
  if (alarm.name === "ytg-update-check") checkForUpdate().catch(e => console.warn("update check failed", e));
  if (alarm.name === "ytg-ytdlp") autoUpdateYtdlp().catch(e => console.warn("yt-dlp update failed", e));
  if (alarm.name === POLL_ALARM) pollUpdatedHost();
});

chrome.notifications.onClicked.addListener(id => {
  if (id !== "update") return;
  chrome.storage.local.get("update").then(({ update }) => update?.page && chrome.tabs.create({ url: update.page }));
  chrome.notifications.clear(id);
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.settings) return;
  const before = ch.settings.oldValue?.language, after = ch.settings.newValue?.language;
  if (before !== after) { I18N.setLanguage(after); setupMenus(); }
});

chrome.runtime.onInstalled.addListener(async details => {
  await languageReady;
  setupMenus(); updateBadge(); scheduleAlarms();
  reinjectContentScripts();
  if (details.reason !== "update") return;
  const { updateState } = await chrome.storage.local.get("updateState");
  if (updateState?.status !== "reloading") return;
  if (updateState.version === CURRENT_VERSION) {
    await chrome.storage.local.remove(["updateState", "update"]);
    chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title: "YT Grabber",
      message: t("updateInstalled", CURRENT_VERSION) });
  } else {
    // The package's extension files didn't match the release: stop instead of looping.
    await chrome.storage.local.set({ updateState: { status: "error", version: updateState.version,
      error: `extension ${CURRENT_VERSION} != ${updateState.version}`, at: Date.now() } });
  }
});
chrome.runtime.onStartup.addListener(async () => { await languageReady; setupMenus(); scheduleAlarms(); });
// An update may have been in progress when the service worker was suspended or the browser restarted.
chrome.storage.local.get("updateState").then(({ updateState }) => {
  if (updateState?.status === "installing") {
    chrome.alarms.create(POLL_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    pollUpdatedHost();
  } else if (updateState?.status === "downloading" && updateState.attempt) {
    // The worker (or browser) stopped mid-download: the host may already have launched the
    // installer. Treat it as installing; the poll fails cleanly if no installer reports back.
    enterInstallPhase(updateState.version, updateState.attempt);
  }
});
