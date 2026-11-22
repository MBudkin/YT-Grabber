"""Offline Windows integration test using the installed yt-dlp and FFmpeg."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ytdl_host as host


class DownloadVariantsTest(unittest.TestCase):
    def test_quality_and_subtitle_variants(self):
        tools = Path(os.environ["LOCALAPPDATA"]) / "YT Grabber" / "bin"
        config = {"ytdlpPath": str(tools / "yt-dlp.exe"), "ffmpegPath": str(tools / "ffmpeg")}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "downloads"
            formats = []
            for height in (720, 1080):
                clip = root / f"{height}.mp4"
                subprocess.run([tools / "ffmpeg/ffmpeg.exe", "-loglevel", "error", "-f", "lavfi", "-i",
                                f"color=s=1920x{height}", "-frames:v", "1", "-c:v", "libx264", clip], check=True)
                formats.append(dict(format_id=str(height), height=height, url=clip.as_uri(), ext="mp4",
                                    vcodec="h264", acodec="none"))
            sub = root / "en.vtt"
            sub.write_text("WEBVTT\n\n00:00:00.000 --> 00:00:00.040\nHello\n", encoding="utf-8")
            fixture = root / "info.json"
            fixture.write_text(json.dumps(dict(id="fixture", title="Clip", extractor="generic",
                                               extractor_key="Generic", webpage_url="https://example.org/clip",
                                               formats=formats, subtitles={"en": [dict(url=sub.as_uri(), ext="vtt")]})))
            command = host.media_command(config) + ["--enable-file-urls", "--load-info-json", str(fixture)]

            def download(height, langs=None, embed=True):
                options = dict(quality=height, mode="video_only", outputDir=str(folder),
                               subtitles=dict(enabled=langs is not None, langs=langs, embed=embed, format="srt"))
                job = host.Job(dict(url="https://example.org/clip", options=options), config)
                with patch.object(host, "media_command", return_value=command), patch.object(job, "event"):
                    return Path(job.download()["files"][0])

            plain = download(720)
            other = download(1080)
            embedded = download(720, ["en"])
            external = download(720, ["en"], False)
            self.assertEqual(len({plain, other, embedded, external}), 4)
            self.assertTrue(external.with_suffix(".en.srt").is_file())
            for file, height, count in [(plain, 720, 0), (other, 1080, 0), (embedded, 720, 1)]:
                streams = json.loads(subprocess.check_output([tools / "ffmpeg/ffprobe.exe", "-v", "error",
                                     "-show_streams", "-of", "json", file]))["streams"]
                self.assertEqual(streams[0]["height"], height)
                self.assertEqual(sum(s["codec_type"] == "subtitle" for s in streams), count)
            with self.assertRaisesRegex(ValueError, "ru"):
                download(720, ["en", "ru"])
