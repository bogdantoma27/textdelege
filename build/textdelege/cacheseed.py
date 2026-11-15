"""Copy local extract cache entries that R2 does not have yet.

A dry run stores its entries only on this computer, and a later publish reads them from
here, so without this step the daily GitHub build would find them missing and extract
those acts again. Kept outside extractcache.py on purpose: that file is part of the
extraction code hash, and changing it would invalidate every cached entry.
"""

import gzip
import hashlib
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import extractcache

WORKERS = 16


def _needs_upload(path: Path) -> bool:
    marker = path.with_suffix(".sha")
    try:
        return marker.stat().st_mtime < path.stat().st_mtime
    except FileNotFoundError:
        return path.exists()


def _upload(cache_dir: Path, act_path: str, r2) -> bool:
    path = extractcache.cache_path(cache_dir, act_path)
    try:
        text = path.read_text(encoding="utf-8")
        body = gzip.compress(text.encode("utf-8"), mtime=0)
        r2.put(extractcache.remote_key(act_path), body, extractcache.REMOTE_TYPE, None)
        path.with_suffix(".sha").write_text(hashlib.sha256(body).hexdigest(), encoding="utf-8")
        return True
    except Exception as error:
        print(f"warning: could not upload the cache entry of {act_path}: {error}", file=sys.stderr)
        return False


def seed(cache_dir: Path, act_paths: list[str], r2) -> int:
    """Upload the entries of these acts that have no up-to-date upload marker; returns how many."""
    todo = [p for p in act_paths if _needs_upload(extractcache.cache_path(cache_dir, p))]
    if not todo:
        return 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return sum(pool.map(lambda p: _upload(cache_dir, p, r2), todo))
