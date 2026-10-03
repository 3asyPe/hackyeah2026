"""Bundled sample reports (samples/samples.json) and their replay fixtures. samples.json is re-read when it changes."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from . import config
from .assessor import fixture_key

log = logging.getLogger("samples")

MEDIA_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
_cache: dict = {"stamp": None, "samples": []}
_keys: dict[tuple, str] = {}


def load() -> list[dict]:
    """Entries of samples.json that have an id; [] when the file is missing or invalid."""
    path = config.SAMPLES_DIR / "samples.json"
    try:
        st = path.stat()
    except OSError:
        return []
    stamp = (st.st_mtime_ns, st.st_size)
    if _cache["stamp"] != stamp:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            samples = [s for s in data if isinstance(s, dict) and isinstance(s.get("id"), str)]
        except Exception as e:
            log.warning("cannot read %s: %s", path, e)
            samples = []
        _cache.update(stamp=stamp, samples=samples)
    return _cache["samples"]


def get(sample_id: str) -> Optional[dict]:
    return next((s for s in load() if s["id"] == sample_id), None)


def photo_path(s: dict) -> Optional[Path]:
    """The sample's photo, only if it is a plain image filename that exists in SAMPLES_DIR."""
    name = s.get("photo")
    if not isinstance(name, str) or not name or Path(name).name != name:
        return None
    if Path(name).suffix.lower() not in MEDIA_TYPES:
        return None
    p = config.SAMPLES_DIR / name
    return p if p.is_file() else None


def key(s: dict) -> Optional[str]:
    """Fixture key for submitting this sample unchanged; None when its photo file is missing."""
    p = photo_path(s)
    if p is None:
        return None if s.get("photo") else fixture_key(s.get("description"), None)
    st = p.stat()
    ck = (str(p), st.st_mtime_ns, st.st_size, s.get("description"))
    if ck not in _keys:
        _keys[ck] = fixture_key(s.get("description"), p.read_bytes())
    return _keys[ck]


def fixture(s: dict) -> Optional[dict]:
    """The recorded fixture for this sample, or None."""
    k = key(s)
    path = config.FIXTURES_DIR / f"{k}.json" if k else None
    if path is None or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        log.warning("unreadable fixture %s", path.name)
        return None
