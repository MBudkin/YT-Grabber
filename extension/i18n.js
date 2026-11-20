// YT Grabber — UI strings. Plain script (no import/export) so it works as a content script,
// as a side-effect ES module import and in the service worker. Exposes globalThis.YTG_I18N.
// Re-running it (content-script reinjection after an update) replaces the old dictionaries.
(() => {

  const ru = {
    // shared
    download: "Скачать", downloadPlaylistBtn: "Скачать плейлист", settings: "Настройки", error: "Ошибка",
    errorPrefix: "Ошибка: {0}", done: "Готово", cancelled: "Отменено", loading: "Загрузка…", playlist: "Плейлист",
    noReply: "Нет ответа от расширения", modeVideo: "Видео", modeAudio: "Только аудио", browse: "Обзор…",
    // popup
    hostChecking: "Проверка помощника…", tabGrab: "Скачать", tabJobs: "Загрузки",
    noVideoPrompt: "Откройте видео на YouTube или вставьте ссылку:", find: "Найти",
    downloadWholePlaylist: "Скачать весь плейлист", quality: "Качество", format: "Формат",
    audioFormat: "Формат аудио", original: "Оригинал", subtitles: "Субтитры", folderTitle: "Папка для сохранения",
    advanced: "Расширенные настройки", legendFormat: "Формат и кодеки",
    optCompat: "Максимальная совместимость (H.264 + AAC)", optFps60: "Разрешить 60 fps",
    optVideoOnly: "Только видео, без звука", optFormatId: "Точный формат (вручную)",
    formatAuto: "— авто по настройкам выше —", audioBitrate: "Битрейт аудио", abrMax: "Максимальный (VBR 0)",
    kbps: "{0} кбит/с", legendSubs: "Субтитры", optSubAuto: "Включать автоматические (сгенерированные) субтитры",
    optSubEmbed: "Встроить в видеофайл (иначе — отдельным файлом)", optSubLangs: "Языки (через запятую, «all» — все)",
    subFormat: "Формат файла", legendSection: "Фрагмент видео", start: "Начало", end: "Конец", endPh: "конец",
    useCurrentTime: "Взять текущую позицию плеера как начало", legendSponsor: "SponsorBlock — вырезать",
    legendMeta: "Метаданные и файлы", optEmbedThumb: "Встроить обложку",
    optEmbedMeta: "Встроить метаданные (название, автор)", optEmbedChapters: "Встроить главы",
    optSplitChapters: "Разделить на файлы по главам", optWriteThumb: "Сохранить обложку отдельно",
    optWriteDesc: "Сохранить описание (.description)", optWriteInfo: "Сохранить info.json",
    optTemplate: "Шаблон имени файла", optRestrict: "Только латиница в именах файлов",
    optNoOverwrite: "Не перезаписывать существующие", legendNet: "Плейлист и сеть",
    optItems: "Элементы плейлиста (напр. 1-5,8)", itemsPh: "все", optRate: "Ограничение скорости",
    ratePh: "без ограничения, напр. 5M", optFragments: "Параллельных фрагментов",
    optCookies: "Cookies из браузера (для приватных / 18+ видео)", cookiesNone: "Не использовать",
    optExtra: "Дополнительные параметры сети и повторов yt-dlp", resetDefaults: "Сбросить настройки по умолчанию",
    active: "Активные", clearFinished: "Убрать завершённые", jobsEmpty: "Сейчас ничего не скачивается.",
    recent: "Недавние", search: "Поиск…", historyEmpty: "История пуста.", nothingFound: "Ничего не найдено.",
    hostTooltip: "Помощник v{0} · yt-dlp {1}", ffmpegOk: " · ffmpeg ✓", ffmpegMissing: " · ffmpeg не найден",
    bannerFfmpeg: "<b>ffmpeg не найден.</b> Без него нельзя склеить видео выше 720p, конвертировать аудио и встраивать субтитры. Укажите путь в настройках.",
    bannerHost: "<b>Помощник недоступен.</b> {0}", fetchingFormats: "Получаю список форматов…",
    upTo: "до {0}p", chapters: " · глав: {0}", formatsFailed: "Не удалось получить форматы: {0}",
    notYouTube: "Это не похоже на ссылку YouTube", settingsReset: "Настройки сброшены",
    subManual: "Ручные субтитры", subAuto: "Автоматические", subNone: "Нет на этом видео",
    defaultMark: "(по умолчанию)", openingFolder: "Открываю окно выбора папки…",
    needTab: "Откройте это видео во вкладке YouTube, чтобы взять позицию плеера",
    noTime: "Не удалось прочитать позицию плеера (обновите вкладку YouTube)", added: "Загрузка добавлена ✓",
    stQueued: "в очереди", stDownloading: "загрузка", stMerging: "склейка", stPostprocessing: "обработка",
    left: "осталось {0}", actOpen: "Открыть", actReveal: "Показать в папке", actRetry: "Повторить",
    actLog: "Журнал", actCancel: "Отменить", actDismiss: "Убрать", logTitle: "Журнал — {0}", empty: "(пусто)",
    actOpenFile: "Открыть файл", actPage: "Открыть на YouTube", actAgain: "Скачать снова",
    actRemove: "Удалить из истории", fileMissing: "Файл не найден — возможно, он был перемещён или удалён",
    updateAvailable: "Доступна новая версия {0}.", updateNow: "Обновить", updateDetails: "Что нового",
    updating: "Устанавливаю обновление {0}… Расширение перезапустится само.",
    updateError: "Обновление не удалось: {0}",
    // common
    qBest: "Лучшее", sbSponsor: "Спонсорская реклама", sbSelfpromo: "Самореклама",
    sbInteraction: "Просьбы подписаться", sbIntro: "Заставка", sbOutro: "Концовка", sbPreview: "Превью/повтор",
    sbMusic: "Не-музыка в клипах", sbFiller: "Отступления", units: "Б,КБ,МБ,ГБ", today: "сегодня, {0}",
    dFormat: "формат {0}", dAudio: "аудио", dBest: "лучшее", dNoAudio: "без звука", dSubs: "субт. {0}",
    dSection: "фрагмент", dPlaylist: "плейлист",
    // background
    errLost: "Соединение с помощником потеряно.",
    errNotInstalled: "Помощник (native host) не установлен. Распакуйте YT-Grabber.zip и запустите Install.bat.",
    errExited: "Помощник неожиданно завершился. Проверьте %LOCALAPPDATA%\\YT Grabber\\host.log.",
    errTimeout: "Помощник не ответил вовремя.", errHost: "Ошибка помощника", errUnexpected: "Неожиданный ответ помощника.",
    notifDone: "Загрузка завершена", notifError: "Ошибка загрузки", errUnknown: "Неизвестная ошибка",
    errInterrupted: "Загрузка прервана (расширение было перезапущено).", errNotVideo: "Это не ссылка на видео YouTube.",
    errForbidden: "Команда недоступна на этой странице.", errUnknownCmd: "Неизвестная команда: {0}",
    menuVideo: "Скачать видео (текущие настройки)", menuSubs: "Скачать видео с субтитрами", menuAudio: "Скачать только аудио",
    noLink: "Не нашёл ссылку на видео YouTube.", openVideo: "Откройте видео на YouTube.",
    updateNotifTitle: "Доступно обновление YT Grabber", updateNotifMsg: "Версия {0}. Откройте расширение, чтобы обновить.",
    updateInstalled: "YT Grabber обновлён до версии {0}", updateBusy: "Дождитесь окончания загрузок и повторите.",
    updateNone: "Обновлений нет.", updateTimeout: "новая версия помощника не запустилась (см. update.log)",
    // content script
    cReloaded: "Расширение перезагружено — обновите страницу",
    cMainTitle: "Скачать с текущими настройками YT Grabber (Alt+Shift+D)", cMore: "Другие варианты",
    cVideo: "Видео (текущие настройки)", cSubs: "Видео с субтитрами", cStarting: "Запуск…", cQueued: "В очереди",
    cDownloading: "Загрузка…", cMerging: "Склейка…", cProcessing: "Обработка…", cDone: "Скачано ✓",
    // options
    optionsTitle: "YT Grabber — настройки", hostStatus: "Состояние помощника", helper: "Помощник", checking: "проверка…",
    recheck: "Проверить снова", updateYtdlp: "Обновить yt-dlp",
    installHelp: "Помощник не установлен. Распакуйте YT-Grabber.zip, запустите <code>Install.bat</code> и снова откройте настройки.",
    extIdLabel: "ID расширения:", paths: "Пути и загрузка", defaultDir: "Папка по умолчанию",
    ffmpegLbl: "ffmpeg (папка или exe)", bundled: "из комплекта", concurrent: "Одновременных загрузок", save: "Сохранить",
    behavior: "Поведение", setNotify: "Уведомления о завершении загрузки", setButton: "Кнопка «Скачать» на странице YouTube",
    behaviorHint: "Кнопка на странице, контекстное меню и горячая клавиша <code>Alt+Shift+D</code> используют настройки, выбранные в последний раз в окне расширения. Изменить клавишу:",
    language: "Язык интерфейса", langAuto: "Автоматически (как в браузере)",
    updates: "Обновления", version: "Версия", checkUpdates: "Проверить обновления",
    autoUpdate: "Устанавливать обновления YT Grabber автоматически",
    autoYtdlp: "Обновлять yt-dlp автоматически (раз в сутки)", upToDate: "Установлена последняя версия.",
    installUpdate: "Установить {0}", checkFailed: "Не удалось проверить: {0}", lastChecked: "Проверено: {0}",
    data: "Данные", exportSettings: "Экспорт настроек", importSettings: "Импорт настроек",
    clearHistory: "Очистить историю", resetAll: "Сбросить всё", working: "работает, v{0}", found: "найден",
    ffmpegNotFound: "не найден — укажите путь ниже", updatingYtdlp: "Обновление yt-dlp…", saved: "Сохранено ✓",
    badSettingsFile: "Неверный файл настроек", imported: "Настройки импортированы ✓",
    confirmClear: "Очистить историю загрузок? Файлы на диске останутся.", historyCleared: "История очищена",
    confirmReset: "Сбросить все настройки расширения?"
  };

  const en = {
    download: "Download", downloadPlaylistBtn: "Download playlist", settings: "Settings", error: "Error",
    errorPrefix: "Error: {0}", done: "Done", cancelled: "Cancelled", loading: "Loading…", playlist: "Playlist",
    noReply: "No response from the extension", modeVideo: "Video", modeAudio: "Audio only", browse: "Browse…",
    hostChecking: "Checking helper…", tabGrab: "Download", tabJobs: "Downloads",
    noVideoPrompt: "Open a YouTube video or paste a link:", find: "Find",
    downloadWholePlaylist: "Download the whole playlist", quality: "Quality", format: "Format",
    audioFormat: "Audio format", original: "Original", subtitles: "Subtitles", folderTitle: "Save folder",
    advanced: "Advanced settings", legendFormat: "Format & codecs",
    optCompat: "Maximum compatibility (H.264 + AAC)", optFps60: "Allow 60 fps",
    optVideoOnly: "Video only, no audio", optFormatId: "Exact format (manual)",
    formatAuto: "— auto, based on the settings above —", audioBitrate: "Audio bitrate", abrMax: "Maximum (VBR 0)",
    kbps: "{0} kbps", legendSubs: "Subtitles", optSubAuto: "Include automatic (generated) subtitles",
    optSubEmbed: "Embed into the video file (otherwise save as a separate file)",
    optSubLangs: "Languages (comma-separated, “all” for every language)",
    subFormat: "File format", legendSection: "Video section", start: "Start", end: "End", endPh: "end",
    useCurrentTime: "Use the current player position as start", legendSponsor: "SponsorBlock — cut out",
    legendMeta: "Metadata & files", optEmbedThumb: "Embed thumbnail",
    optEmbedMeta: "Embed metadata (title, author)", optEmbedChapters: "Embed chapters",
    optSplitChapters: "Split into files by chapter", optWriteThumb: "Save thumbnail as a file",
    optWriteDesc: "Save description (.description)", optWriteInfo: "Save info.json",
    optTemplate: "Filename template", optRestrict: "ASCII-only filenames",
    optNoOverwrite: "Don't overwrite existing files", legendNet: "Playlist & network",
    optItems: "Playlist items (e.g. 1-5,8)", itemsPh: "all", optRate: "Speed limit",
    ratePh: "unlimited, e.g. 5M", optFragments: "Parallel fragments",
    optCookies: "Browser cookies (for private / age-restricted videos)", cookiesNone: "Don't use",
    optExtra: "Extra yt-dlp network and retry options", resetDefaults: "Reset to defaults",
    active: "Active", clearFinished: "Clear finished", jobsEmpty: "Nothing is downloading right now.",
    recent: "Recent", search: "Search…", historyEmpty: "History is empty.", nothingFound: "Nothing found.",
    hostTooltip: "Helper v{0} · yt-dlp {1}", ffmpegOk: " · ffmpeg ✓", ffmpegMissing: " · ffmpeg not found",
    bannerFfmpeg: "<b>ffmpeg not found.</b> Without it, videos above 720p can't be merged, audio can't be converted and subtitles can't be embedded. Set the path in Settings.",
    bannerHost: "<b>Helper unavailable.</b> {0}", fetchingFormats: "Fetching available formats…",
    upTo: "up to {0}p", chapters: " · {0} chapters", formatsFailed: "Couldn't fetch formats: {0}",
    notYouTube: "That doesn't look like a YouTube link", settingsReset: "Settings reset",
    subManual: "Manual subtitles", subAuto: "Automatic", subNone: "Not available for this video",
    defaultMark: "(default)", openingFolder: "Opening the folder picker…",
    needTab: "Open this video in a YouTube tab to use the player position",
    noTime: "Couldn't read the player position (reload the YouTube tab)", added: "Download added ✓",
    stQueued: "queued", stDownloading: "downloading", stMerging: "merging", stPostprocessing: "processing",
    left: "{0} left", actOpen: "Open", actReveal: "Show in folder", actRetry: "Retry",
    actLog: "Log", actCancel: "Cancel", actDismiss: "Dismiss", logTitle: "Log — {0}", empty: "(empty)",
    actOpenFile: "Open file", actPage: "Open on YouTube", actAgain: "Download again",
    actRemove: "Remove from history", fileMissing: "File not found — it may have been moved or deleted",
    updateAvailable: "Version {0} is available.", updateNow: "Update", updateDetails: "What's new",
    updating: "Installing update {0}… The extension will restart by itself.",
    updateError: "Update failed: {0}",
    qBest: "Best", sbSponsor: "Sponsor", sbSelfpromo: "Self-promotion",
    sbInteraction: "Subscribe reminders", sbIntro: "Intro", sbOutro: "Outro / end cards", sbPreview: "Preview / recap",
    sbMusic: "Non-music section", sbFiller: "Filler / tangents", units: "B,KB,MB,GB", today: "today, {0}",
    dFormat: "format {0}", dAudio: "audio", dBest: "best", dNoAudio: "no audio", dSubs: "subs {0}",
    dSection: "section", dPlaylist: "playlist",
    errLost: "Connection to the helper was lost.",
    errNotInstalled: "The helper (native host) is not installed. Extract YT-Grabber.zip and run Install.bat.",
    errExited: "The helper exited unexpectedly. Check %LOCALAPPDATA%\\YT Grabber\\host.log.",
    errTimeout: "The helper didn't respond in time.", errHost: "Helper error", errUnexpected: "Unexpected response from the helper.",
    notifDone: "Download complete", notifError: "Download failed", errUnknown: "Unknown error",
    errInterrupted: "Download interrupted (the extension was restarted).", errNotVideo: "This is not a YouTube video link.",
    errForbidden: "This command isn't available on this page.", errUnknownCmd: "Unknown command: {0}",
    menuVideo: "Download video (current settings)", menuSubs: "Download video with subtitles", menuAudio: "Download audio only",
    noLink: "No YouTube video link found.", openVideo: "Open a YouTube video first.",
    updateNotifTitle: "YT Grabber update available", updateNotifMsg: "Version {0}. Open the extension to update.",
    updateInstalled: "YT Grabber was updated to version {0}", updateBusy: "Wait for downloads to finish and try again.",
    updateNone: "No updates available.", updateTimeout: "the new helper version didn't start (see update.log)",
    cReloaded: "The extension was reloaded — refresh the page",
    cMainTitle: "Download with your current YT Grabber settings (Alt+Shift+D)", cMore: "More options",
    cVideo: "Video (current settings)", cSubs: "Video with subtitles", cStarting: "Starting…", cQueued: "Queued",
    cDownloading: "Downloading…", cMerging: "Merging…", cProcessing: "Processing…", cDone: "Downloaded ✓",
    optionsTitle: "YT Grabber — settings", hostStatus: "Helper status", helper: "Helper", checking: "checking…",
    recheck: "Check again", updateYtdlp: "Update yt-dlp",
    installHelp: "The helper is not installed. Extract YT-Grabber.zip, run <code>Install.bat</code> and reopen this page.",
    extIdLabel: "Extension ID:", paths: "Paths & downloads", defaultDir: "Default folder",
    ffmpegLbl: "ffmpeg (folder or exe)", bundled: "bundled", concurrent: "Concurrent downloads", save: "Save",
    behavior: "Behavior", setNotify: "Notify when a download finishes", setButton: "“Download” button on YouTube pages",
    behaviorHint: "The page button, context menu and the <code>Alt+Shift+D</code> hotkey use the settings you last chose in the extension popup. Change the hotkey:",
    language: "Interface language", langAuto: "Automatic (browser language)",
    updates: "Updates", version: "Version", checkUpdates: "Check for updates",
    autoUpdate: "Install YT Grabber updates automatically",
    autoYtdlp: "Update yt-dlp automatically (daily)", upToDate: "You have the latest version.",
    installUpdate: "Install {0}", checkFailed: "Check failed: {0}", lastChecked: "Last checked: {0}",
    data: "Data", exportSettings: "Export settings", importSettings: "Import settings",
    clearHistory: "Clear history", resetAll: "Reset everything", working: "running, v{0}", found: "found",
    ffmpegNotFound: "not found — set the path below", updatingYtdlp: "Updating yt-dlp…", saved: "Saved ✓",
    badSettingsFile: "Invalid settings file", imported: "Settings imported ✓",
    confirmClear: "Clear download history? Files on disk will be kept.", historyCleared: "History cleared",
    confirmReset: "Reset all extension settings?"
  };

  const MESSAGES = { ru, en };
  let lang = "en";

  function detect() {
    let ui = "en";
    try { ui = chrome.i18n.getUILanguage(); } catch { ui = globalThis.navigator?.language || "en"; }
    return /^(ru|be|kk)\b/i.test(ui) ? "ru" : "en";
  }

  function t(key, ...args) {
    const s = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
    return args.length ? s.replace(/\{(\d)\}/g, (_, i) => args[i] ?? "") : s;
  }

  /** Fills [data-i18n], [data-i18n-html], [data-i18n-title], [data-i18n-placeholder] in a DOM tree. */
  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    if (root.documentElement) root.documentElement.lang = lang;
  }

  globalThis.YTG_I18N = {
    t, apply,
    setLanguage(pref) { lang = pref === "ru" || pref === "en" ? pref : detect(); return lang; },
    get lang() { return lang; },
    get locale() { return lang === "ru" ? "ru-RU" : "en-US"; }
  };
  globalThis.YTG_I18N.setLanguage("auto");
})();
