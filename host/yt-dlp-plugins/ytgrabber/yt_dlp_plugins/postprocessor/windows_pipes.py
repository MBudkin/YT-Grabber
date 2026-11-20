"""Keep the host's no-console launch policy for FFmpeg grandchildren of yt-dlp."""
import os
import subprocess
from functools import wraps

from yt_dlp.utils import Popen


# FFmpeg postprocessors and downloaders import the same Popen class. yt-dlp
# already sets SW_HIDE, but only its caller can supply creationflags.
def with_ffmpeg_flags(launch):
    @wraps(launch)
    def start(process, args, *rest, **kwargs):
        if isinstance(args, (list, tuple)) and args:
            name = os.path.basename(os.fsdecode(args[0])).lower()
            if name in {"ffmpeg", "ffmpeg.exe", "ffprobe", "ffprobe.exe"}:
                kwargs["creationflags"] = kwargs.get("creationflags", 0) | subprocess.CREATE_NO_WINDOW
        return launch(process, args, *rest, **kwargs)

    return start


if os.name == "nt":
    Popen.__init__ = with_ffmpeg_flags(Popen.__init__)
