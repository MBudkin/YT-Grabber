// YT Grabber — in-page download button on YouTube watch / shorts pages.
(() => {
  // Each injection takes over from the previous one (re-injection after an extension update):
  // the previous instance is disposed synchronously, and any instance that is orphaned or no longer
  // owns the token tears itself down. Pre-1.1 buttons (no .ytg-v2 class) are hidden by content.css.
  try { window.__ytGrabberDispose?.(); } catch { /* orphaned instance */ }
  const token = Symbol("ytGrabber");
  window.__ytGrabber = token;
  window.__ytGrabberDispose = () => teardown();
  document.querySelectorAll(".ytg-wrap.ytg-v2, .ytg-menu.ytg-v2").forEach(el => el.remove());
  const life = new AbortController();
  const on = { signal: life.signal };
  const alive = () => {
    if (window.__ytGrabber === token && chrome.runtime?.id) return true;
    teardown();
    return false;
  };
  function teardown() {
    if (life.signal.aborted) return;
    life.abort();
    mo.disconnect();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorage);
    } catch { /* extension context already gone */ }
    menu?.remove(); menu = null;
    root?.remove(); root = null;
  }

  const I18N = globalThis.YTG_I18N;
  const t = (...a) => I18N.t(...a);

  let enabled = true;
  let jobs = [];
  let root = null;
  let menu = null;
  let starting = false;

  const ICON_DOWNLOAD = "M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-4.9z";
  const ICON_CARET = "m7 10 5 5 5-5z";
  const ICON_VIDEO = "M10 8v8l6-4-6-4zm11-5v18H3V3h18zm-1 1H4v16h16V4z";
  const ICON_SUBS = "M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm1 14c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v12zM6 11h2v2H6v-2zm0 3h8v2H6v-2zm4-3h8v2h-8v-2zm6 3h2v2h-2v-2z";
  const ICON_AUDIO = "M12 3v9.28a4.39 4.39 0 0 0-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7zm-1.5 17C8.57 20 7 18.43 7 16.5S8.57 13 10.5 13s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z";

  const videoId = () => {
    const u = new URL(location.href);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  };
  const isShorts = () => location.pathname.startsWith("/shorts/");

  function send(msg) {
    return new Promise(res => {
      try { chrome.runtime.sendMessage(msg, r => res(chrome.runtime.lastError ? { ok: false, error: t("cReloaded") } : r)); }
      catch { res({ ok: false, error: t("cReloaded") }); }
    });
  }

  function icon(size, shape) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", shape);
    svg.append(path);
    return svg;
  }

  function button(className, title) {
    return Object.assign(document.createElement("button"), { type: "button", className, title });
  }

  // ------------------------------------------------------------ dropdown menu
  // The menu lives in <body> with fixed positioning: YouTube's action bar clips overflowing children.
  function buildMenu() {
    const m = Object.assign(document.createElement("div"), { className: "ytg-menu ytg-v2", hidden: true });
    m.setAttribute("role", "menu");
    for (const [kind, key, shape] of [[null, "cVideo", ICON_VIDEO], ["subs", "cSubs", ICON_SUBS], ["audio", "modeAudio", ICON_AUDIO]]) {
      const item = button("ytg-item", "");
      item.setAttribute("role", "menuitem");
      item.append(icon(24, shape), Object.assign(document.createElement("span"), { textContent: t(key) }));
      item.addEventListener("click", e => {
        if (!e.isTrusted) return;
        closeMenu();
        start(kind);
      });
      m.append(item);
    }
    m.addEventListener("click", e => e.stopPropagation());
    document.body.append(m);
    return m;
  }

  function openMenu() {
    if (!root) return;
    menu = menu?.isConnected ? menu : buildMenu();
    menu.hidden = false;
    const r = root.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const shorts = root.classList.contains("ytg-shorts");
    let left = shorts ? r.left - w - 8 : r.right - w;
    let top = shorts ? r.bottom - h : r.bottom + 4;
    if (!shorts && top + h > innerHeight - 8) top = r.top - h - 4;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    top = Math.max(8, Math.min(top, innerHeight - h - 8));
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    root.querySelector(".ytg-more")?.setAttribute("aria-expanded", "true");
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (menu) menu.hidden = true;
    root?.querySelector(".ytg-more")?.setAttribute("aria-expanded", "false");
  }

  const menuOpen = () => menu && !menu.hidden;
  document.addEventListener("click", closeMenu, on);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && menuOpen()) closeMenu(); }, on);
  window.addEventListener("resize", closeMenu, on);
  window.addEventListener("scroll", () => { if (menuOpen()) closeMenu(); }, { passive: true, capture: true, signal: life.signal });

  // ------------------------------------------------------------ button
  function build() {
    const el = document.createElement("div");
    el.className = "ytg-wrap ytg-v2";
    const main = button("ytg-main", t("cMainTitle"));
    const fill = Object.assign(document.createElement("span"), { className: "ytg-fill" });
    const label = Object.assign(document.createElement("span"), { className: "ytg-label", textContent: t("download") });
    main.append(fill, icon(24, ICON_DOWNLOAD), label);
    const more = button("ytg-more", t("cMore"));
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.append(icon(24, ICON_CARET));
    el.append(main, more);
    main.addEventListener("click", e => { if (e.isTrusted) start(null); });
    more.addEventListener("click", e => {
      e.stopPropagation();
      menuOpen() ? closeMenu() : openMenu();
    });
    return el;
  }

  async function start(kind) {
    const id = videoId();
    if (!id || starting || jobs.some(j => j.videoId === id && ["running", "queued"].includes(j.status))) return;
    starting = true;
    setLabel(t("cStarting"));
    const r = await send({ action: "quick", url: location.href, kind, title: document.title });
    starting = false;
    if (!r?.ok) flash(r?.error || t("error"));
    else {
      const job = r.data;
      if (!jobs.some(j => j.jobId === job.jobId)) jobs.push(job);
      render();
    }
  }

  function setLabel(text) { const l = root?.querySelector(".ytg-label"); if (l) l.textContent = text; }
  function flash(text) {
    if (!root) return;
    root.classList.add("ytg-err");
    root.title = text;
    setLabel(t("error"));
    setTimeout(() => { root?.classList.remove("ytg-err"); if (root) root.title = ""; render(); }, 4000);
    alertBubble(text);
  }
  function alertBubble(text) {
    const b = document.createElement("div");
    b.className = "ytg-bubble"; b.textContent = text;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 6000);
  }

  function render() {
    if (!root || starting || root.classList.contains("ytg-err")) return;
    const id = videoId();
    const mine = jobs.filter(j => j.videoId === id);
    const active = mine.find(j => j.status === "running" || j.status === "queued");
    const fill = root.querySelector(".ytg-fill");
    root.classList.toggle("ytg-busy", !!active);
    if (active) {
      const p = active.stage === "downloading" && active.percent != null ? Math.floor(active.percent) : null;
      setLabel(active.status === "queued" ? t("cQueued") : p != null ? p + "%" : active.stage === "downloading" ? t("cDownloading") :
        active.stage === "merging" ? t("cMerging") : t("cProcessing"));
      fill.style.width = (p ?? 100) + "%";
      root.classList.toggle("ytg-indet", p == null);
    } else {
      fill.style.width = "0";
      root.classList.remove("ytg-indet");
      const done = mine.find(j => j.status === "done");
      setLabel(done ? t("cDone") : t("download"));
    }
  }

  function findAnchor() {
    if (isShorts()) {
      const a = document.querySelector("ytd-reel-video-renderer[is-active] #actions, ytd-shorts [is-active] #actions");
      return a ? { parent: a, mode: "prepend" } : null;
    }
    const top = document.querySelector("ytd-watch-metadata #top-level-buttons-computed");
    if (top) return { parent: top.parentElement, before: top, mode: "before" };
    const actions = document.querySelector("ytd-watch-metadata #actions-inner, ytd-watch-metadata #actions, ytm-slim-video-action-bar-renderer");
    if (actions) return { parent: actions, mode: "prepend" };
    return null;
  }

  function ensure() {
    if (!alive()) return;
    if (!enabled || !videoId()) { closeMenu(); root?.remove(); return; }
    const a = findAnchor();
    if (!a) { closeMenu(); root?.remove(); return; }
    if (root?.parentElement === a.parent) return;
    root = root || build();
    root.classList.toggle("ytg-shorts", isShorts());
    if (a.mode === "before") a.parent.insertBefore(root, a.before);
    else a.parent.prepend(root);
    render();
  }

  function rebuild() {
    closeMenu();
    menu?.remove(); menu = null;
    root?.remove(); root = null;
    ensure();
  }

  let pend = false;
  const mo = new MutationObserver(() => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => { pend = false; ensure(); });
  });

  function onMessage(msg, _s, reply) {
    if (!alive()) return;
    if (msg.event === "jobs") { jobs = msg.jobs; render(); }
    if (msg.action === "currentTime") {
      const v = document.querySelector("video");
      reply({ time: v ? v.currentTime : null });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  chrome.storage.local.get("settings", ({ settings }) => {
    if (!alive()) return;
    enabled = settings?.pageButton !== false;
    I18N.setLanguage(settings?.language);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    ensure();
  });
  function onStorage(ch) {
    if (!ch.settings || !alive()) return;
    const next = ch.settings.newValue || {};
    enabled = next.pageButton !== false;
    if (I18N.lang !== I18N.setLanguage(next.language) || !root) rebuild();
    else ensure();
  }
  chrome.storage.onChanged.addListener(onStorage);
  window.addEventListener("yt-navigate-start", closeMenu, on);
  window.addEventListener("yt-navigate-finish", () => { ensure(); render(); }, on);
  send({ action: "jobsForTab" }).then(r => { if (r?.ok && alive()) { jobs = r.data.jobs; render(); } });
})();
