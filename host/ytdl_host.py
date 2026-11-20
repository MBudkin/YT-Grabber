import collections
import hashlib
import json
import logging
import logging.handlers
import os
from pathlib import Path, PureWindowsPath
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
import zipfile
from urllib.parse import urlsplit

HOME = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
DATA = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "YT Grabber"
DATA.mkdir(parents=True, exist_ok=True)
CONFIG = DATA / "config.json"
DEFAULT_EXE = HOME / "bin" / "yt-dlp.exe"
DEFAULT_FFMPEG = HOME / "bin" / "ffmpeg"
JS_RUNTIME = HOME / "bin" / "qjs.exe"
LIMIT = 1024 * 1024
WRITE = threading.Lock()
STATE = threading.RLock()
PENDING = collections.deque()
ACTIVE = {}
CHILDREN = set()
STOP = threading.Event()
FLAGS = subprocess.CREATE_NO_WINDOW
if getattr(sys, "frozen", False) and os.name == "nt":
    # PyInstaller's bootloader calls SetDllDirectory(_internal); child processes inherit it,
    # so the PyInstaller-built yt-dlp.exe would load OUR python DLL and crash. Reset it.
    import ctypes
    ctypes.windll.kernel32.SetDllDirectoryW(None)

# Child tools (yt-dlp.exe is itself a PyInstaller app) must not inherit this frozen
# host's bootloader variables, otherwise they fail with "Failed to execute script".
ENV = {k: v for k, v in os.environ.items()
       if not k.upper().startswith(("_PYI", "_MEI", "_PYINSTALLER")) and k.upper() not in ("TCL_LIBRARY", "TK_LIBRARY")}
ENV.update(PYTHONIOENCODING="utf-8", PYINSTALLER_RESET_ENVIRONMENT="1")
# Winsock (used by yt-dlp) fails with WinError 10106 when core Windows variables are missing,
# so make sure they exist even if the browser launched us with a stripped environment.
_root = ENV.get("SYSTEMROOT") or ENV.get("WINDIR") or os.path.expandvars("%SystemRoot%")
if "%" in _root or not _root:
    _root = r"C:\Windows"
_local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
_defaults = {
    "SYSTEMROOT": _root, "WINDIR": _root, "SYSTEMDRIVE": _root[:2],
    "COMSPEC": os.path.join(_root, "System32", "cmd.exe"),
    "PATHEXT": ".COM;.EXE;.BAT;.CMD", "LOCALAPPDATA": _local,
    "APPDATA": str(Path(_local).parent / "Roaming"), "USERPROFILE": str(Path.home()),
    "USERNAME": os.environ.get("USERNAME") or Path.home().name,
    "TEMP": os.path.join(_local, "Temp"), "TMP": os.path.join(_local, "Temp"),
}
for _k, _v in _defaults.items():
    if not ENV.get(_k):
        ENV[_k] = _v
_sys32 = os.path.join(_root, "System32")
if _sys32.lower() not in ENV.get("PATH", "").lower():
    ENV["PATH"] = _sys32 + ";" + _root + (";" + ENV["PATH"] if ENV.get("PATH") else "")
VERSION = "1.1.0"
REPO = "MBudkin/YT-Grabber"
LOCAL = threading.local()               # per-thread UI language of the current request/job
UPDATING = threading.Event()            # set while a self-update is downloading; blocks new jobs
UPDATE_STATUS_DIR = DATA / "update-status"   # one <attempt>.json per update attempt
MAX_UPDATE_BYTES = 600 * 1024 * 1024
MAX_UNPACKED_BYTES = 1536 * 1024 * 1024
UPDATE_HOSTS = ("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
EN = {
    "Некорректная конфигурация": "Invalid configuration",
    "maxConcurrent должен быть положительным целым числом": "maxConcurrent must be a positive integer",
    "Некорректное поле конфигурации": "Invalid configuration field",
    "Ответ превышает 1 МБ": "Response exceeds 1 MB",
    "Хост завершает работу": "The helper is shutting down",
    "Ошибка yt-dlp": "yt-dlp error",
    "Превышено время ожидания yt-dlp": "yt-dlp timed out",
    "Не удалось остановить процесс yt-dlp": "Could not stop the yt-dlp process",
    "Укажите значение для {0}": "Specify a value for {0}",
    "Дополнительный аргумент не поддерживается: {0}": "Unsupported extra argument: {0}",
    "Шаблон должен задавать имя файла без папок": "The template must be a file name without folders",
    "Укажите ссылку HTTP или HTTPS": "Specify an HTTP or HTTPS link",
    "Укажите полный путь к yt-dlp.exe в настройках": "Set the full path to yt-dlp.exe in Settings",
    "yt-dlp сообщил недопустимый путь к файлу": "yt-dlp reported an invalid file path",
    "yt-dlp не сообщил путь к файлу": "yt-dlp did not report a file path",
    "Выберите папку для загрузок": "Choose a download folder",
    "Задание уже завершено или не найдено": "The job has already finished or was not found",
    "Укажите путь к папке": "Specify a folder path",
    "Укажите путь к файлу": "Specify a file path",
    "Неизвестная команда": "Unknown command",
    "Некорректный JSON": "Invalid JSON",
    "Недопустимый адрес обновления": "Invalid update URL",
    "Нет контрольной суммы обновления": "The update has no checksum",
    "Автообновление работает только в установленной версии": "Auto-update works only in the installed version",
    "Контрольная сумма обновления не совпала": "Update checksum mismatch",
    "Архив обновления повреждён": "The update archive is damaged",
    "Дождитесь окончания загрузок": "Wait for downloads to finish",
    "Идёт обновление YT Grabber": "YT Grabber is being updated",
    "Архив обновления слишком большой": "The update archive is too large",
    "Версия в архиве ({0}) не совпадает с ожидаемой ({1})": "The archive version ({0}) does not match the expected one ({1})",
    "Не удалось запустить установщик обновления": "Could not start the update installer",
}


def tr(text, *args):
    if getattr(LOCAL, "lang", "ru") == "en":
        text = EN.get(text, text)
    return text.format(*args) if args else text
PROGRESS = ("download:__P__%(progress.status)s|%(progress._percent_str)s|"
            "%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s|"
            "%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|"
            "%(info.playlist_index)s|%(info.n_entries)s")
logger = logging.getLogger("host")
logger.setLevel(logging.INFO)
handler = logging.handlers.RotatingFileHandler(
    DATA / "host.log", maxBytes=LIMIT, backupCount=1, encoding="utf-8", delay=True)
handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(handler)


def save_config(config):
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=DATA, delete=False) as tmp:
        json.dump(config, tmp, ensure_ascii=False, indent=2)
    try:
        os.replace(tmp.name, CONFIG)
    finally:
        Path(tmp.name).unlink(missing_ok=True)


def get_config(updates=None):
    with STATE:
        config = dict(ytdlpPath=str(DEFAULT_EXE),
                      ffmpegPath=str(DEFAULT_FFMPEG),
                      defaultDir=str(Path.home() / "Downloads" / "YT Grabber"), maxConcurrent=2)
        exists = CONFIG.exists()
        if exists:
            config.update(json.loads(CONFIG.read_text(encoding="utf-8-sig")))
        if updates is not None:
            if not isinstance(updates, dict):
                raise ValueError(tr("Некорректная конфигурация"))
            for key, value in updates.items():
                if key == "maxConcurrent":
                    if type(value) != int or value < 1:
                        raise ValueError(tr("maxConcurrent должен быть положительным целым числом"))
                elif key not in ("ytdlpPath", "ffmpegPath", "defaultDir") or not isinstance(value, str):
                    raise ValueError(tr("Некорректное поле конфигурации"))
                config[key] = value
        if updates is not None or not exists:
            save_config(config)
        return config


def encode(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def send(**msg):
    data = encode(msg)
    if len(data) > LIMIT:
        # Drop complete records from large lists, preserving the info schema.
        if msg["type"] == "info":
            info = msg["data"]
            for records in (info["subtitles"], (info["playlist"] or {}).get("entries", []),
                            info["formats"], info["autoCaptions"]):
                while records and len(data) > LIMIT:
                    del records[len(records) // 2:]
                    data = encode(msg)
        if len(data) > LIMIT:
            key = "id" if "id" in msg else "jobId"
            data = encode({key: msg[key], "type": "error", "message": tr("Ответ превышает 1 МБ")})
    if len(data) <= LIMIT:
        with WRITE:
            sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
            sys.stdout.buffer.flush()


def launch(args):
    with STATE:
        if STOP.is_set():
            raise RuntimeError(tr("Хост завершает работу"))
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                   errors="replace", creationflags=FLAGS, env=ENV)
        CHILDREN.add(process)
        return process


def forget(process):
    with STATE:
        CHILDREN.discard(process)


def meaningful(output):
    lines = output.splitlines()
    return next((s for s in reversed(lines) if "ERROR:" in s),
                next((s for s in reversed(lines) if s.strip()), tr("Ошибка yt-dlp")))[-4000:]


def capture(args, timeout=85):
    proc = launch(args)
    try:
        try:
            output, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            kill(proc)
            proc.communicate()
            raise ValueError(tr("Превышено время ожидания yt-dlp"))
        if proc.returncode:
            logger.error("Command failed (%s): %s " + chr(10) + "%s", proc.returncode, args[1:4], output[-6000:])
            raise ValueError(meaningful(output))
        return output.strip()
    finally:
        forget(proc)


def kill(process):
    if process and process.poll() is None:
        result = subprocess.run(["taskkill.exe", "/T", "/F", "/PID", str(process.pid)],
                                creationflags=FLAGS, capture_output=True)
        if result.returncode and process.poll() is None:
            raise RuntimeError(tr("Не удалось остановить процесс yt-dlp"))


def fields(record, names):
    return {key: value[:8192] if isinstance(value, str) else value
            for key in names.split() for value in (record.get(key),)}


def metadata(data):
    result = fields(data, "id title uploader channel duration thumbnail webpage_url is_live")
    formats = [f for f in data.get("formats") or [] if f.get("ext") != "mhtml"]
    result["heights"] = sorted({f["height"] for f in formats if f.get("height")
                                and f.get("vcodec") != "none"}, reverse=True)
    result["formats"] = []
    for f in formats[-80:]:
        row = fields(f, "format_id ext height width fps vcodec acodec abr tbr format_note dynamic_range")
        row["filesize"] = f.get("filesize") or f.get("filesize_approx")
        result["formats"].append(row)
    for key, name in (("subtitles", "subtitles"), ("automatic_captions", "autoCaptions")):
        tracks = data.get(key) or {}
        langs = list(tracks)
        if name == "autoCaptions":
            common = {data.get("language"), "en", "ru", "uk", "de", "fr", "es"}
            langs = sorted(langs, key=lambda lang: lang.split("-")[0] not in common)[:30]
        result[name] = [dict(lang=lang, name=next((t["name"][:512] for t in tracks[lang]
                                                  if t.get("name")), lang)) for lang in langs]
    result["chapters"] = len(data.get("chapters") or [])
    result["playlist"] = None
    if isinstance(data.get("entries"), list):
        entries = data["entries"]
        result["playlist"] = dict(title=result["title"], count=data.get("playlist_count") or len(entries),
                                  entries=[fields(e, "id title duration") for e in entries[:200] if e])
    return result


EXTRA_SWITCHES = {
    "--abort-on-error", "--ignore-errors", "--no-mtime", "--mtime",
    "--no-check-formats", "--check-formats", "--check-all-formats",
}
EXTRA_VALUES = {
    "--limit-rate", "-r", "--throttled-rate", "--retries", "-R", "--fragment-retries",
    "--file-access-retries", "--extractor-retries", "--socket-timeout",
    "--sleep-requests", "--sleep-interval", "--max-sleep-interval", "--sleep-subtitles",
    "--buffer-size", "--http-chunk-size",
}


def extra_arguments(text):
    tokens = iter(shlex.split(text or "", posix=False))
    args = []
    for token in tokens:
        flag, sep, value = token.partition("=")
        if flag in EXTRA_SWITCHES and not sep:
            args.append(flag)
        elif flag in EXTRA_VALUES:
            value = value if sep else next(tokens, "")
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            if not value or value.startswith("-"):
                raise ValueError(tr("Укажите значение для {0}", flag))
            args.extend([flag, value])
        else:
            raise ValueError(tr("Дополнительный аргумент не поддерживается: {0}", flag))
    return args


def filename_template(template):
    path = PureWindowsPath(template)
    # yt-dlp expands environment variables and a leading tilde in output templates.
    if (path.name != template or path.anchor or ":" in template or template.rstrip(" .") in ("", "-")
            or template.startswith("~") or re.search(r"\$(?:\w|\{)|%[\w ]+%", template)):
        raise ValueError(tr("Шаблон должен задавать имя файла без папок"))
    return template


def ffmpeg_location(config):
    for value in (config.get("ffmpegPath"), DEFAULT_FFMPEG, shutil.which("ffmpeg.exe")):
        if not isinstance(value, (str, Path)) or not value:
            continue
        path = Path(value)
        if path.name.lower() == "ffmpeg.exe":
            path = path.parent
        if path.is_absolute() and all((path / exe).is_file() for exe in ("ffmpeg.exe", "ffprobe.exe")):
            return path
    return None


def web_url(value):
    url = urlsplit(value)
    if url.scheme not in ("http", "https") or not url.hostname:
        raise ValueError(tr("Укажите ссылку HTTP или HTTPS"))
    return value


def ytdlp_executable(config):
    for value in (config.get("ytdlpPath"), DEFAULT_EXE, shutil.which("yt-dlp.exe")):
        if isinstance(value, (str, Path)) and value:
            path = Path(value)
            if path.is_absolute() and path.suffix.lower() == ".exe" and path.is_file():
                return str(path)
    raise ValueError(tr("Укажите полный путь к yt-dlp.exe в настройках"))


def media_command(config):
    exe = ytdlp_executable(config)
    args = [exe, "--ignore-config"]
    plugins = HOME / "bin" / "yt-dlp-plugins"
    if Path(exe).parent != plugins.parent and plugins.is_dir():
        args += ["--plugin-dirs", str(plugins)]
    if JS_RUNTIME.is_file():
        args += ["--js-runtimes", f"quickjs:{JS_RUNTIME}"]
    ffmpeg = ffmpeg_location(config)
    if ffmpeg:
        args += ["--ffmpeg-location", str(ffmpeg)]
    return args


def argv(config, url, opts, work):
    get = opts.get
    container = get("container") or "mp4"
    mode = get("mode") or "video"
    args = media_command(config) + ["--newline", "--no-colors", "--encoding", "utf-8",
            "--print", "after_move:__F__%(filepath)j", "--print", "after_move:__T__%(title)j",
            "--no-simulate", "--no-quiet", "--progress",
            "--progress-template", PROGRESS, "-P", str(work.parent), "-P", "temp:" + str(work),
            "-o", filename_template(get("filenameTemplate") or "%(title)s [%(id)s].%(ext)s")]
    fmt = get("formatId")
    if fmt:
        mode = "custom"
    else:
        quality = get("quality", "best")
        height = "" if quality in ("best", "", None) else "[height<=" + str(int(quality)) + "]"
        fmt = {"audio": "ba/b", "video_only": "bv" + height,
               "video": "bv" + height + "+ba/b" + height}[mode]
    args += ["-f", fmt]
    if mode == "audio":
        args += ["-x", "--audio-format", get("audioFormat") or "best",
                 "--audio-quality", str(get("audioQuality", "0"))]
    else:
        args += ["--merge-output-format", container]
        if mode != "custom":
            args += ["--remux-video", container]
        sort = []
        if container == "mp4" and get("preferCompat", True):
            sort.append("vcodec:h264")
        if not get("fps60", True):
            sort.append("fps:30")
        sort.append("res")
        if container == "mp4" and get("preferCompat", True):
            sort.append("acodec:m4a")
        args += ["-S", ",".join(sort)]
    subs = get("subtitles") or {}
    if subs.get("enabled"):
        args += ["--write-subs", "--sub-langs", ",".join(subs.get("langs") or ["en"])]
        if subs.get("auto"):
            args.append("--write-auto-subs")
        if subs.get("format"):
            args += ["--convert-subs", subs["format"]]
        if subs.get("embed") and mode != "audio" and container in ("mp4", "mkv"):
            args.append("--embed-subs")
    for option, flag, default in [
        ("embedThumbnail", "--embed-thumbnail", False), ("splitChapters", "--split-chapters", False),
        ("embedMetadata", "--embed-metadata", True), ("writeDescription", "--write-description", False),
        ("writeInfoJson", "--write-info-json", False), ("writeThumbnail", "--write-thumbnail", False),
        ("restrictFilenames", "--restrict-filenames", False)
    ]:
        if get(option, default):
            args.append(flag)
    args.append("--embed-chapters" if get("embedChapters", True) else "--no-embed-chapters")
    args.append("--no-overwrites" if get("noOverwrites", True) else "--force-overwrites")
    args.append("--yes-playlist" if get("playlist") else "--no-playlist")
    if get("playlist") and get("playlistItems"):
        args += ["-I", get("playlistItems")]
    if get("sponsorblock"):
        args += ["--sponsorblock-remove", ",".join(get("sponsorblock"))]
    for option, flag in [("rateLimit", "-r"),
                         ("cookiesFromBrowser", "--cookies-from-browser")]:
        if get(option):
            args += [flag, get(option)]
    section = get("section") or {}
    if section.get("start") or section.get("end"):
        args += ["--download-sections", "*" + (section.get("start") or "0") + "-" +
                 (section.get("end") or "inf"), "--force-keyframes-at-cuts"]
    args += ["-N", str(get("concurrentFragments", 4))]
    args += extra_arguments(get("extraArgs"))
    return args + ["--", url]


def progress(stage, values=None):
    data = dict(stage=stage, percent=None, speed="", eta="", downloaded=None, total=None)
    if values and len(values) == 9:
        _, percent, speed, eta, size, total, estimate, index, count = [v.strip() for v in values]
        data.update(speed=speed, eta=eta, downloaded=int(size) if size.isdecimal() else None,
                    total=next((int(v) for v in (total, estimate) if v.isdecimal()), None))
        if re.fullmatch(r"\d+(\.\d+)?%", percent):
            data["percent"] = min(100., float(percent[:-1]))
        if index.isdecimal() and count.isdecimal():
            data["item"] = index + "/" + count
    return data


class Job:
    def __init__(self, request, config):
        self.id = uuid.uuid4().hex
        self.request = request
        self.config = config
        self.cancelled = False
        self.process = None
        self.last_progress = self.last_log = float("-inf")
        self.stage = None
        self.lang = getattr(LOCAL, "lang", "ru")

    def event(self, kind, **data):
        send(type=kind, jobId=self.id, **data)

    def report(self, stage, values=None):
        delay = .25 - (time.monotonic() - self.last_progress)
        if delay > 0:
            if stage == self.stage:
                return
            time.sleep(delay)
        self.event("progress", **progress(stage, values))
        self.last_progress = time.monotonic()
        self.stage = stage

    def download(self):
        opts = self.request.get("options") or {}
        folder = Path(opts.get("outputDir") or self.config["defaultDir"]).resolve()
        folder.mkdir(parents=True, exist_ok=True)
        files = []
        last = error = title = ""
        with tempfile.TemporaryDirectory(prefix=".ytgrabber-", dir=folder) as tmp:
            args = argv(self.config, self.request["url"], opts, Path(tmp))
            with STATE:
                if self.cancelled:
                    return {}
                proc = self.process = launch(args)
            try:
                with proc.stdout:
                    for raw in proc.stdout:
                        line = raw.strip()
                        if line.startswith("__P__"):
                            self.report("downloading", line[5:].split("|"))
                        elif line.startswith("__F__"):
                            path = Path(json.loads(line[5:])).resolve()
                            if not path.is_relative_to(folder) or not path.is_file():
                                raise ValueError(tr("yt-dlp сообщил недопустимый путь к файлу"))
                            if str(path) not in files:
                                files.append(str(path))
                        elif line.startswith("__T__"):
                            title = json.loads(line[5:])
                        elif line:
                            last = line
                            if "ERROR:" in line:
                                error = line
                            if line.startswith("[Merger]"):
                                self.report("merging")
                            elif line.startswith(("[ExtractAudio]", "[EmbedSubtitle", "[FFmpeg", "[SponsorBlock]",
                                                  "[ModifyChapters]", "[Metadata]", "[EmbedThumbnail]", "[VideoRemuxer]")):
                                self.report("postprocessing")
                            if time.monotonic() - self.last_log >= .25:
                                self.event("log", line=line[-4000:])
                                self.last_log = time.monotonic()
                if proc.wait():
                    raise ValueError((error or last or tr("Ошибка yt-dlp"))[-4000:])
            finally:
                if proc.poll() is None:
                    kill(proc)
                    proc.wait()
                forget(proc)
        if not files:
            raise ValueError(tr("yt-dlp не сообщил путь к файлу"))
        return dict(type="done", files=files, title=title or Path(files[-1]).stem)

    def run(self):
        LOCAL.lang = self.lang
        logger.info("Starting job %s", self.id)
        try:
            result = self.download()
        except Exception as exc:
            result = dict(type="error", message=str(exc))
        with STATE:
            try:
                logger.info("Job %s: %s", self.id, "cancelled" if self.cancelled else
                            result.get("message", result.get("type")))
                if not STOP.is_set():
                    send(jobId=self.id, **(dict(type="cancelled") if self.cancelled else result))
            finally:
                ACTIVE.pop(self.id)
                schedule()


def schedule():
    while PENDING and not STOP.is_set() and len(ACTIVE) < get_config()["maxConcurrent"]:
        job = PENDING.popleft()
        ACTIVE[job.id] = job
        threading.Thread(target=job.run, daemon=True).start()


def folder_dialog(initial):
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    try:
        root.overrideredirect(True)
        root.geometry("1x1+0+0")
        root.attributes("-alpha", 0)
        root.attributes("-topmost", True)
        root.lift()
        root.update()
        return filedialog.askdirectory(parent=root, initialdir=initial, mustexist=True,
                                       title=tr("Выберите папку для загрузок")) or None
    finally:
        root.destroy()


def launch_detached(args):
    """Starts a process that outlives this host and Chrome's job object."""
    base = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(args, creationflags=base | subprocess.CREATE_BREAKAWAY_FROM_JOB, env=ENV,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         close_fds=True)
        return
    except OSError:
        logger.info("Job breakaway denied, launching the installer through WMI")
    # Processes created by WMI are children of WmiPrvSE, outside any job of ours.
    env = dict(ENV, YTG_UPDATE_CMD=subprocess.list2cmdline(args))
    result = subprocess.run([args[0], "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                             "try { $r = Invoke-CimMethod -ErrorAction Stop -ClassName Win32_Process "
                             "-MethodName Create -Arguments @{CommandLine=$env:YTG_UPDATE_CMD} } catch { exit 98 }; "
                             "if ($null -eq $r -or $null -eq $r.ReturnValue) { exit 99 }; exit [int]$r.ReturnValue"],
                            env=env, creationflags=subprocess.CREATE_NO_WINDOW, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(tr("Не удалось запустить установщик обновления"))


def valid_attempt(attempt):
    return isinstance(attempt, str) and re.fullmatch(r"[a-z0-9]{8,32}", attempt) is not None


def update_status(attempt):
    if not valid_attempt(attempt):
        return None
    try:
        return json.loads((UPDATE_STATUS_DIR / f"{attempt}.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


class SafeRedirects(urllib.request.HTTPRedirectHandler):
    """Refuses to follow a redirect to anything but GitHub's HTTPS download hosts."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != "https" or target.hostname not in UPDATE_HOSTS:
            raise ValueError(tr("Недопустимый адрес обновления"))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def self_update(url, digest, version, attempt):
    """Downloads a release archive, verifies it and starts a detached installer.

    The installer (setup/update.ps1 from the new package) waits for this process to exit,
    then runs the regular install.ps1, which replaces the host and the extension files.
    """
    if (not isinstance(url, str) or not url.startswith(f"https://github.com/{REPO}/releases/download/")
            or not url.endswith(".zip")):
        raise ValueError(tr("Недопустимый адрес обновления"))
    if not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError(tr("Нет контрольной суммы обновления"))
    if not getattr(sys, "frozen", False):
        raise ValueError(tr("Автообновление работает только в установленной версии"))
    if (not isinstance(version, str) or not re.fullmatch(r"\d+(\.\d+){1,3}", version)
            or not valid_attempt(attempt)):
        raise ValueError(tr("Недопустимый адрес обновления"))
    with STATE:
        if ACTIVE or PENDING:
            raise ValueError(tr("Дождитесь окончания загрузок"))
        if UPDATING.is_set():
            raise ValueError(tr("Идёт обновление YT Grabber"))
        UPDATING.set()          # reserved under the same lock that admits download jobs
    work = None
    try:
        work = Path(tempfile.mkdtemp(prefix="ytgrabber-update-"))
        archive = work / "update.zip"
        sha = hashlib.sha256()
        request = urllib.request.Request(url, headers={"User-Agent": f"YT-Grabber/{VERSION}"})
        opener = urllib.request.build_opener(SafeRedirects)
        with opener.open(request, timeout=60) as response, open(archive, "wb") as out:
            final = urlsplit(response.geturl())
            if final.scheme != "https" or final.hostname not in UPDATE_HOSTS:
                raise ValueError(tr("Недопустимый адрес обновления"))
            size = 0
            while chunk := response.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPDATE_BYTES:
                    raise ValueError(tr("Архив обновления слишком большой"))
                sha.update(chunk)
                out.write(chunk)
        if "sha256:" + sha.hexdigest() != digest:
            raise ValueError(tr("Контрольная сумма обновления не совпала"))
        target = (work / "pkg").resolve()
        with zipfile.ZipFile(archive) as z:
            if sum(m.file_size for m in z.infolist()) > MAX_UNPACKED_BYTES:
                raise ValueError(tr("Архив обновления слишком большой"))
            for member in z.infolist():
                if not (target / member.filename).resolve().is_relative_to(target):
                    raise ValueError(tr("Архив обновления повреждён"))
            z.extractall(target)
        archive.unlink()
        package = target / "YT-Grabber"
        script = package / "setup" / "update.ps1"
        manifest = package / "app" / "extension" / "manifest.json"
        if not (package / "app" / "ytdl_host.exe").is_file() or not script.is_file() or not manifest.is_file():
            raise ValueError(tr("Архив обновления повреждён"))
        packaged = json.loads(manifest.read_text(encoding="utf-8-sig")).get("version")
        if packaged != version:
            raise ValueError(tr("Версия в архиве ({0}) не совпадает с ожидаемой ({1})", packaged, version))
        powershell = Path(_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        args = [str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-WindowStyle", "Hidden", "-File", str(script), "-WaitPid", str(os.getpid()),
                "-Version", version, "-Attempt", attempt, "-Cleanup", str(work)]
        UPDATE_STATUS_DIR.mkdir(exist_ok=True)
        (UPDATE_STATUS_DIR / f"{attempt}.json").write_text(
            json.dumps(dict(version=version, attempt=attempt, status="pending", at=time.time())), encoding="utf-8")
        launch_detached(args)
    except Exception:
        UPDATING.clear()
        if work:
            shutil.rmtree(work, ignore_errors=True)
        raise
    logger.info("Update installer started from %s", work)


def handle(req):
    rid = req.get("id")
    LOCAL.lang = req["lang"] if req.get("lang") in ("ru", "en") else "ru"
    try:
        cmd = req["cmd"]
        cfg = get_config()
        if cmd == "ping":
            exe = ytdlp_executable(cfg)
            ffmpeg = ffmpeg_location(cfg)
            send(id=rid, type="pong", hostVersion=VERSION,
                 ytdlpVersion=capture([exe, "--ignore-config", "--version"], timeout=20),
                 ffmpeg=ffmpeg is not None, ffmpegPath=str(ffmpeg or cfg["ffmpegPath"]),
                 defaultDir=cfg["defaultDir"], ytdlpPath=exe, update=update_status(req.get("attempt")))
        elif cmd == "info":
            url = web_url(req["url"])
            args = media_command(cfg) + ["-J", "--no-warnings", "--encoding", "utf-8",
                    "--flat-playlist" if req.get("playlist") else "--no-playlist", "--", url]
            send(id=rid, type="info", data=metadata(json.loads(capture(args))))
        elif cmd in ("get_config", "set_config"):
            if cmd == "set_config":
                cfg = get_config(req["config"])
                with STATE:
                    schedule()
            send(id=rid, type="config", config=cfg)
        elif cmd == "download":
            web_url(req["url"])
            job = Job(req, cfg)
            with STATE:
                if UPDATING.is_set():
                    raise ValueError(tr("Идёт обновление YT Grabber"))
                send(id=rid, type="started", jobId=job.id)
                PENDING.append(job)
                if len(ACTIVE) >= cfg["maxConcurrent"]:
                    job.report("queued")
                schedule()
        elif cmd == "cancel":
            with STATE:
                jid = req["jobId"]
                job = next((j for j in PENDING if j.id == jid), None)
                if job:
                    PENDING.remove(job)
                    send(id=rid, type="ok")
                    job.event("cancelled")
                elif jid in ACTIVE:
                    job = ACTIVE[jid]
                    kill(job.process)
                    job.cancelled = True
                    send(id=rid, type="ok")
                else:
                    raise ValueError(tr("Задание уже завершено или не найдено"))
        elif cmd == "pick_folder":
            send(id=rid, type="folder", path=folder_dialog(req.get("initial") or cfg["defaultDir"]))
        elif cmd in ("open_folder", "reveal", "open_file"):
            path = Path(req["path"]).resolve(strict=True)
            if cmd == "reveal":
                subprocess.Popen(f'explorer.exe /select,"{path}"', creationflags=FLAGS,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                if cmd == "open_folder" and not path.is_dir():
                    raise ValueError(tr("Укажите путь к папке"))
                if cmd == "open_file" and not path.is_file():
                    raise ValueError(tr("Укажите путь к файлу"))
                os.startfile(path)
            send(id=rid, type="ok")
        elif cmd == "update_ytdlp":
            exe = ytdlp_executable(cfg)
            output = capture([exe, "--ignore-config", "-U"], timeout=300)
            send(id=rid, type="updated", output=output[-16000:],
                 ytdlpVersion=capture([exe, "--ignore-config", "--version"], timeout=20))
        elif cmd == "self_update":
            self_update(req.get("url"), req.get("digest"), req.get("version"), req.get("attempt"))
            send(id=rid, type="update_started")
            # Exit so the installer can replace our files; Chrome reconnects to the new host.
            threading.Timer(.5, lambda: os._exit(0)).start()
        else:
            raise ValueError(tr("Неизвестная команда"))
    except Exception as exc:
        logger.exception("Request %s", req.get("cmd"))
        send(id=rid, type="error", message=str(exc)[:4000])


def main():
    import msvcrt
    for stream in (sys.stdin, sys.stdout):
        msvcrt.setmode(stream.fileno(), os.O_BINARY)
    get_config()
    logger.info("Host %s connected", VERSION)
    stream = sys.stdin.buffer
    workers = []
    try:
        while header := stream.read(4):
            if len(header) != 4:
                break
            size, = struct.unpack("<I", header)
            if size > 64 * LIMIT:
                break
            raw = stream.read(size)
            if len(raw) != size:
                break
            try:
                req = json.loads(raw)
                if not isinstance(req, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                send(id=None, type="error", message=tr("Некорректный JSON"))
                continue
            if req.get("cmd") in ("info", "ping", "pick_folder", "update_ytdlp", "self_update"):
                worker = threading.Thread(target=handle, args=(req,), daemon=True)
                workers = [w for w in workers if w.is_alive()]
                workers.append(worker)
                worker.start()
            else:
                handle(req)
    finally:
        with STATE:
            STOP.set()
            PENDING.clear()
            children = list(CHILDREN)
        for proc in children:
            try:
                kill(proc)
            except Exception:
                logger.exception("Could not stop child process %s", proc.pid)
        # Give download workers time to remove their private temporary directories.
        deadline = time.monotonic() + 5
        while ACTIVE and time.monotonic() < deadline:
            time.sleep(.02)


if __name__ == "__main__":
    main()
