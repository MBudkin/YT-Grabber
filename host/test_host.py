"""Live Windows native-messaging integration test. Requires YouTube and ffmpeg."""
import contextlib
import argparse
import json
import os
from pathlib import Path
import queue
import struct
import subprocess
import tempfile
import threading
import time

INSTALLED = Path(os.environ["LOCALAPPDATA"]) / "YT Grabber" / "ytdl_host.exe"
URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
VIDEO_URL = "https://www.youtube.com/watch?v=M7lc1UVf-VE"


class Client:
    def __init__(self, launcher):
        self.proc = subprocess.Popen([str(launcher)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     cwd=launcher.parent, creationflags=subprocess.CREATE_NO_WINDOW,
                                     env=dict(os.environ, PATH=str(Path(os.environ["SystemRoot"]) / "System32")))
        self.incoming = queue.Queue()
        self.pending = []
        self.seq = 0
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        try:
            while header := self.proc.stdout.read(4):
                size, = struct.unpack("<I", header)
                assert size <= 1024 * 1024
                self.incoming.put(json.loads(self.proc.stdout.read(size)))
        finally:
            self.incoming.put(None)

    def wait(self, predicate, timeout=240):
        deadline = time.monotonic() + timeout
        while True:
            for idx, msg in enumerate(self.pending):
                if predicate(msg):
                    return self.pending.pop(idx)
            msg = self.incoming.get(timeout=max(.001, deadline - time.monotonic()))
            assert msg is not None, "Host exited before reply"
            self.pending.append(msg)

    def request(self, cmd, expected, **fields):
        self.seq += 1
        rid = str(self.seq)
        payload = json.dumps(dict(id=rid, cmd=cmd, **fields)).encode()
        self.proc.stdin.write(struct.pack("<I", len(payload)) + payload)
        self.proc.stdin.flush()
        msg = self.wait(lambda m: m.get("id") == rid)
        assert msg["type"] == expected, msg
        return msg

    def start(self, folder, url=URL, **options):
        return self.request("download", "started", url=url, options=dict(outputDir=str(folder), **options))["jobId"]

    def terminal(self, job, expected):
        msg = self.wait(lambda m: m.get("jobId") == job and m["type"] in ("done", "error", "cancelled"))
        assert "id" not in msg and msg["type"] == expected, msg
        return msg

    def close(self):
        self.proc.stdin.close()
        assert self.proc.wait(timeout=20) == 0
        self.proc.stdout.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("exe", type=Path, nargs="?", default=INSTALLED)
    exe = parser.parse_args().exe.resolve(strict=True)
    with tempfile.TemporaryDirectory() as directory:
        tmp = Path(directory)
        with contextlib.closing(Client(exe)) as c, contextlib.ExitStack() as cleanup:
            pong = c.request("ping", "pong")
            assert pong["ffmpeg"] and Path(pong["ffmpegPath"]) == exe.parent / "bin" / "ffmpeg", pong
            assert Path(pong["ytdlpPath"]) == exe.parent / "bin" / "yt-dlp.exe", pong
            print("ping OK:", pong["ytdlpVersion"], flush=True)
            cfg = c.request("get_config", "config")["config"]
            cleanup.callback(c.request, "set_config", "config", config=cfg)
            c.request("set_config", "config", config={"maxConcurrent": 1})
            print("get_config OK: maxConcurrent =", cfg["maxConcurrent"], flush=True)
            data = c.request("info", "info", url=URL)["data"]
            assert data["id"] == "jNQXAC9IVRw" and data["formats"] and data["heights"]
            print("info OK:", data["title"], len(data["formats"]), "formats", flush=True)
            audio = c.start(tmp / "audio", mode="audio", audioFormat="mp3")
            video = c.start(tmp / "video", url=VIDEO_URL, mode="video", quality=360, container="mp4",
                            subtitles=dict(enabled=True, langs=["en"], auto=True, embed=True, format="srt"))
            c.wait(lambda m: m.get("jobId") == video and m.get("stage") == "queued")
            for job, ext in ((audio, ".mp3"), (video, ".mp4")):
                result = c.terminal(job, "done")
                assert result["title"], result
                files = result["files"]
                assert files and all(Path(f).is_absolute() and Path(f).is_file() for f in files)
                file = Path(files[0])
                assert file.suffix == ext and file.stat().st_size > 0
                probe = Path(pong["ffmpegPath"]) / "ffprobe.exe"
                streams = json.loads(subprocess.check_output([probe, "-v", "error", "-of", "json",
                                     "-show_streams", file], encoding="utf-8"))["streams"]
                if ext == ".mp3":
                    assert any(s["codec_name"] == "mp3" for s in streams)
                else:
                    assert any(s["codec_type"] == "video" and s["height"] == 360 for s in streams)
                    assert any(s["codec_type"] == "subtitle" and s.get("tags", {}).get("language") in
                               ("en", "eng") for s in streams), streams
                print("after_move + ffprobe OK:", ext, file.stat().st_size, "bytes", flush=True)
            job = c.start(tmp / "cancel", rateLimit="8K")
            queued = c.start(tmp / "queued")
            c.wait(lambda m: m.get("jobId") == queued and m.get("stage") == "queued")
            c.request("cancel", "ok", jobId=queued)
            c.terminal(queued, "cancelled")
            c.wait(lambda m: m.get("jobId") == job and m.get("stage") == "downloading")
            c.request("cancel", "ok", jobId=job)
            c.terminal(job, "cancelled")
            assert not list((tmp / "cancel").iterdir())
            print("cancel OK: queued and running, no partial files", flush=True)


if __name__ == "__main__":
    main()
