import re

from yt_dlp.extractor.youtube import YoutubeIE


class ManualSubtitlesIE(YoutubeIE, plugin_name="ytgrabber"):
    def _real_extract(self, url):
        info = super()._real_extract(url)
        tracks = info.get("subtitles") or {}
        # YouTube appends a track ID to some creator-provided language codes.
        # Keep the full key for explicit selections and offer the base language too.
        for key, formats in list(tracks.items()):
            match = re.fullmatch(r"([a-z]{2,3})-[A-Za-z0-9_-]{11}", key)
            if match:
                tracks.setdefault(match[1], formats)
        return info
