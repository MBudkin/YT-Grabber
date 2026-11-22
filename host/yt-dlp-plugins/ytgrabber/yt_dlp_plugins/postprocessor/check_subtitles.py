import re
from pathlib import Path

from yt_dlp.postprocessor.ffmpeg import FFmpegPostProcessor
from yt_dlp.utils import ExtractorError, ISO639Utils, PostProcessingError


class CheckSubtitlesPP(FFmpegPostProcessor):
    def __init__(self, downloader=None, language="ru", output=None):
        super().__init__(downloader)
        self.language = language
        self.output = output

    def run(self, info):
        selected = info.get("requested_subtitles") or {}
        requested = self.get_param("subtitleslangs") or []
        missing = [code for code in requested if code != "all" and re.fullmatch(r"[\w][\w-]*", code)
                   and code not in selected]
        if missing or not selected:
            message = "Selected subtitles unavailable" if self.language == "en" else "Выбранные субтитры недоступны"
            # yt-dlp can continue downloading after a preprocessing PostProcessingError.
            raise ExtractorError(f"{message}: {', '.join(missing or requested)}", expected=True)

        if self.output == "embed":
            streams = self.get_metadata_object(info["filepath"], ["-select_streams", "s"])["streams"]
            for code, sub in selected.items():
                expected = ISO639Utils.short2long(code) or code
                for index, stream in enumerate(streams):
                    tags = stream.get("tags", {})
                    if tags.get("language") == expected or (sub.get("name") and
                            sub["name"] in (tags.get("handler_name"), tags.get("title"))):
                        streams.pop(index)
                        break
                else:
                    missing.append(code)
        elif self.output == "sidecar":
            folder = Path(info["filepath"]).parent
            for code, sub in selected.items():
                path = folder / Path(sub.get("filepath") or "").name
                if not path.is_file() or not path.stat().st_size:
                    missing.append(code)

        if missing:
            message = "Subtitles missing from output" if self.language == "en" else "В результате отсутствуют субтитры"
            raise PostProcessingError(f"{message}: {', '.join(missing)}")
        return [], info
