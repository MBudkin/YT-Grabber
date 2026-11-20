import { getSettings, DEFAULT_SETTINGS, QUALITIES, sendBg, t, I18N, fmtDate } from "./common.js";

const $ = s => document.querySelector(s);
async function bg(message) {
  const r = await sendBg(message);
  if (!r?.ok) throw new Error(r?.error || t("noReply"));
  return r.data;
}
const host = payload => bg({ action: "host", payload });
const saveSettings = (patch, replace = false) => bg({ action: "saveSettings", patch, replace });

function validSettings(value, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(value) && value.every(item => typeof item === "string");
  if (typeof defaults !== "object") return typeof value === typeof defaults;
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([key, entry]) => Object.hasOwn(defaults, key) &&
      (key === "quality" ? QUALITIES.some(q => q.v === entry) : validSettings(entry, defaults[key])));
}

const s = await getSettings();
I18N.apply(document);
document.title = t("optionsTitle");
$("#extId").textContent = chrome.runtime.id;
$("#extVersion").textContent = "v" + chrome.runtime.getManifest().version;

async function check() {
  $("#stHost").textContent = t("checking"); $("#stHost").className = "";
  try {
    const { config } = await host({ cmd: "get_config" });
    $("#cfgDir").value = config.defaultDir || "";
    $("#cfgYtdlp").value = config.ytdlpPath || "";
    $("#cfgFfmpeg").value = config.ffmpegPath || "";
    $("#cfgConcurrent").value = String(config.maxConcurrent || 2);
    const p = await host({ cmd: "ping" });
    $("#stHost").textContent = t("working", p.hostVersion); $("#stHost").className = "ok";
    $("#stYtdlp").textContent = `${p.ytdlpVersion} — ${p.ytdlpPath}`;
    $("#stFfmpeg").textContent = p.ffmpeg ? p.ffmpegPath || t("found") : t("ffmpegNotFound");
    $("#stFfmpeg").className = p.ffmpeg ? "ok" : "bad";
    $("#installHelp").hidden = true;
  } catch (e) {
    $("#stHost").textContent = e.message; $("#stHost").className = "bad";
    $("#stYtdlp").textContent = $("#stFfmpeg").textContent = "—";
    $("#stFfmpeg").className = "";
    $("#installHelp").hidden = e.message !== t("errNotInstalled");
  }
}

$("#recheck").onclick = check;
$("#updateYtdlp").onclick = async () => {
  const out = $("#updateOut"); out.hidden = false; out.textContent = t("updatingYtdlp");
  const button = $("#updateYtdlp");
  button.disabled = true;
  try { const r = await host({ cmd: "update_ytdlp" }); out.textContent = r.output || t("done"); await check(); }
  catch (e) { out.textContent = t("errorPrefix", e.message); }
  finally { button.disabled = false; }
};
$("#pickDir").onclick = async () => {
  try { const r = await host({ cmd: "pick_folder", initial: $("#cfgDir").value }); if (r.path) $("#cfgDir").value = r.path; }
  catch (e) { $("#cfgMsg").textContent = e.message; }
};
$("#saveCfg").onclick = async () => {
  try {
    await host({ cmd: "set_config", config: {
      defaultDir: $("#cfgDir").value.trim(), ytdlpPath: $("#cfgYtdlp").value.trim(),
      ffmpegPath: $("#cfgFfmpeg").value.trim(), maxConcurrent: Number($("#cfgConcurrent").value)
    } });
    $("#cfgMsg").textContent = t("saved"); check();
  } catch (e) { $("#cfgMsg").textContent = t("errorPrefix", e.message); }
};

$("#shortcuts").onclick = e => { e.preventDefault(); chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); };

// ---------------------------------------------------------------- language & behavior
$("#language").value = s.language;
$("#language").onchange = async e => { await saveSettings({ language: e.target.value }); location.reload(); };
$("#setNotify").checked = s.notifications;
$("#setButton").checked = s.pageButton;
$("#setAutoUpdate").checked = s.autoUpdate;
$("#setAutoYtdlp").checked = s.autoUpdateYtdlp;
$("#setNotify").onchange = e => saveSettings({ notifications: e.target.checked });
$("#setButton").onchange = e => saveSettings({ pageButton: e.target.checked });
$("#setAutoUpdate").onchange = e => saveSettings({ autoUpdate: e.target.checked });
$("#setAutoYtdlp").onchange = e => saveSettings({ autoUpdateYtdlp: e.target.checked });

// ---------------------------------------------------------------- updates
async function renderUpdate(error) {
  const { update, updateState } = await chrome.storage.local.get(["update", "updateState"]);
  const msg = $("#updateMsg"), btn = $("#installUpdate");
  btn.hidden = !update?.available;
  if (update?.available) btn.textContent = t("installUpdate", "v" + update.latest);
  if (error) msg.textContent = t("checkFailed", error);
  else if (updateState?.status === "installing" && Date.now() - updateState.at < 5 * 60000) msg.textContent = t("updating", updateState.version);
  else if (updateState?.status === "error") msg.textContent = t("updateError", updateState.error);
  else if (update && !update.available) msg.textContent = t("upToDate") + " " + t("lastChecked", fmtDate(update.checkedAt));
  else msg.textContent = update ? t("lastChecked", fmtDate(update.checkedAt)) : "";
}
$("#checkUpdates").onclick = async () => {
  const b = $("#checkUpdates"); b.disabled = true;
  try { await bg({ action: "checkUpdate" }); await renderUpdate(); }
  catch (e) { await renderUpdate(e.message); }
  finally { b.disabled = false; }
};
$("#installUpdate").onclick = async () => {
  $("#installUpdate").disabled = true;
  try { await bg({ action: "installUpdate" }); }
  catch (e) { $("#updateMsg").textContent = t("updateError", e.message); $("#installUpdate").disabled = false; }
};
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.update || ch.updateState)) renderUpdate(); });
renderUpdate();

// ---------------------------------------------------------------- data
$("#exportBtn").onclick = async () => {
  const data = { settings: await getSettings() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "yt-grabber-settings.json" });
  a.click(); URL.revokeObjectURL(a.href);
};
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async e => {
  try {
    if (!e.target.files.length) return;
    const data = JSON.parse(await e.target.files[0].text());
    if (!validSettings(data?.settings, DEFAULT_SETTINGS)) throw new Error(t("badSettingsFile"));
    await saveSettings(data.settings, true);
    $("#dataMsg").textContent = t("imported"); setTimeout(() => location.reload(), 600);
  } catch (err) { $("#dataMsg").textContent = t("errorPrefix", err.message); }
  finally { e.target.value = ""; }
};
$("#clearHistory").onclick = async () => {
  if (!confirm(t("confirmClear"))) return;
  await bg({ action: "clearHistory" }); $("#dataMsg").textContent = t("historyCleared");
};
$("#resetAll").onclick = async () => {
  if (!confirm(t("confirmReset"))) return;
  await saveSettings(DEFAULT_SETTINGS, true); location.reload();
};

check();
