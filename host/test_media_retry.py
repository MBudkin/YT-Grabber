import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import ytdl_host as host


class MediaRetryTest(unittest.TestCase):
    def run_job(self, errors, *, playlist=False):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "video.mp4"
            path.touch()
            commands = []

            def launch(args):
                commands.append(list(args))
                message = errors[len(commands) - 1]
                line = message or "__F__" + json.dumps(str(path))
                return Mock(stdout=io.StringIO(line), wait=lambda: int(bool(message)))

            job = host.Job({"url": "https://example.org/video", "options": {"playlist": playlist}},
                           {"defaultDir": folder})
            with patch.object(host, "media_command", return_value=["yt-dlp"]), \
                 patch.object(host, "launch", launch), patch.object(job, "event"):
                try:
                    result = job.download()["type"]
                except ValueError as exc:
                    result = str(exc)
            return result, commands

    def test_refreshes_media_urls_and_reuses_temporary_directory(self):
        result, commands = self.run_job(["ERROR: unable to download video data: HTTP Error 403", None])
        self.assertEqual(result, "done")
        self.assertEqual(commands[1], [commands[0][0], "--check-formats", *commands[0][1:]])

    def test_stops_after_two_retries(self):
        error = "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        result, commands = self.run_job([error] * 3)
        self.assertEqual((result, len(commands)), (error, 3))

    def test_does_not_replay_playlist_or_retry_subtitle_failure(self):
        for error, playlist in [("ERROR: unable to download video data: HTTP Error 403", True),
                                ("ERROR: Unable to download video subtitles: HTTP Error 403", False)]:
            result, commands = self.run_job([error], playlist=playlist)
            self.assertEqual((result, len(commands)), (error, 1))
