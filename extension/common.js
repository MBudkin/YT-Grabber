// Shared helpers for background, popup and options (ES module).
import "./i18n.js";

export const I18N = globalThis.YTG_I18N;
export const t = (key, ...args) => I18N.t(key, ...args);
export const GITHUB_REPO = "MBudkin/YT-Grabber";

export const HOST_NAME = "com.ytgrabber.host";
export const HISTORY_LIMIT = 30;

export const DEFAULT_OPTIONS = {
  outputDir: "",                       // "" -> host default
  filenameTemplate: "%(title)s [%(id)s].%(ext)s",
  mode: "video",                       // video | audio | video_only
  quality: "best",
  container: "mp4",
  preferCompat: true,
  fps60: true,
  audioFormat: "mp3",
  audioQuality: "0",
  formatId: "",
  subtitles: { enabled: false, langs: ["ru", "en"], auto: true, embed: true, format: "srt" },
  embedThumbnail: false,
  embedMetadata: true,
  embedChapters: true,
  splitChapters: false,
  sponsorblock: [],
  playlist: false,
  playlistItems: "",
  section: { start: "", end: "" },
  rateLimit: "",
  cookiesFromBrowser: "",
  writeDescription: false,
  writeInfoJson: false,
  writeThumbnail: false,
  restrictFilenames: false,
  noOverwrites: true,
  concurrentFragments: 4,
  extraArgs: ""
};

export const DEFAULT_SETTINGS = {
  options: DEFAULT_OPTIONS,
  notifications: true,
  pageButton: true,
  language: "auto",                    // auto | ru | en
  autoUpdate: true,                    // install YT Grabber releases automatically
  autoUpdateYtdlp: true,               // run "yt-dlp -U" once a day
  recentDirs: []
};

export const QUALITIES = [
  { v: "best", label: "qBest" },
  { v: 2160, label: "4K" },
  { v: 1440, label: "1440p" },
  { v: 1080, label: "1080p" },
  { v: 720, label: "720p" },
  { v: 480, label: "480p" },
  { v: 360, label: "360p" },
  { v: 240, label: "240p" },
  { v: 144, label: "144p" }
];

export const SUB_LANGS = [
  ["ru", "Русский"], ["en", "English"], ["uk", "Українська"], ["de", "Deutsch"],
  ["fr", "Français"], ["es", "Español"], ["it", "Italiano"], ["pt", "Português"],
  ["pl", "Polski"], ["tr", "Türkçe"], ["ja", "日本語"], ["ko", "한국어"], ["zh-Hans", "中文"]
];

export const SPONSOR_CATS = [
  ["sponsor", "sbSponsor"], ["selfpromo", "sbSelfpromo"], ["interaction", "sbInteraction"],
  ["intro", "sbIntro"], ["outro", "sbOutro"], ["preview", "sbPreview"],
  ["music_offtopic", "sbMusic"], ["filler", "sbFiller"]
];

export function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (["__proto__", "constructor", "prototype"].includes(k)) continue;
    const b = base[k], o = over[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && o && typeof o === "object" && !Array.isArray(o)
      ? deepMerge(b, o) : o;
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const merged = deepMerge(DEFAULT_SETTINGS, settings || {});
  I18N.setLanguage(merged.language);
  return merged;
}

/** Compares dotted versions: 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = deepMerge(cur, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** Returns {id, kind, url, playlistId} for YouTube video/playlist URLs, else null. */
export function parseYouTube(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["https:", "http:"].includes(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id = null, kind = "video";
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const p = u.pathname.split("/").filter(Boolean);
    if (p[0] === "watch") id = u.searchParams.get("v");
    else if (["shorts", "live", "embed", "v"].includes(p[0])) { id = p[1]; if (p[0] === "shorts") kind = "short"; }
    else if (p[0] === "playlist" && /^[\w-]+$/.test(u.searchParams.get("list") || "")) {
      const list = u.searchParams.get("list");
      return { id: null, kind: "playlist", playlistId: list, url: `https://www.youtube.com/playlist?list=${list}` };
    }
  } else return null;
  if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  const list = u.searchParams.get("list");
  const playlistId = /^[\w-]+$/.test(list || "") ? list : null;
  return {
    id, kind, playlistId,
    url: `https://www.youtube.com/watch?v=${id}`,
    playlistUrl: playlistId ? `https://www.youtube.com/playlist?list=${playlistId}` : null
  };
}

export function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}

export function fmtBytes(n) {
  if (!n) return "";
  const u = t("units").split(",");
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i >= 2 ? 1 : 0) + " " + u[i];
}

export function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const same = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(I18N.locale, { hour: "2-digit", minute: "2-digit" });
  return same ? t("today", time) : d.toLocaleDateString(I18N.locale, { day: "numeric", month: "short" }) + ", " + time;
}

/** Short human label for an options object, e.g. "1080p · MP4 · subs ru". */
export function describeOptions(o) {
  const parts = [];
  if (o.formatId) parts.push(t("dFormat", o.formatId));
  else if (o.mode === "audio") parts.push((o.audioFormat === "best" ? t("dAudio") : o.audioFormat.toUpperCase()));
  else {
    parts.push(o.quality === "best" ? t("dBest") : (o.quality >= 2160 ? "4K" : o.quality + "p"));
    parts.push(o.container.toUpperCase());
    if (o.mode === "video_only") parts.push(t("dNoAudio"));
  }
  if (o.subtitles?.enabled) parts.push(t("dSubs", (o.subtitles.langs || []).join(",")));
  if (o.sponsorblock?.length) parts.push("SponsorBlock");
  if (o.section?.start || o.section?.end) parts.push(t("dSection"));
  if (o.playlist) parts.push(t("dPlaylist"));
  return parts.join(" · ");
}

export function sendBg(msg) {
  return chrome.runtime.sendMessage(msg);
}
