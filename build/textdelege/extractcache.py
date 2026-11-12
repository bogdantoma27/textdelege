import gzip
import hashlib
import json
import sys
from datetime import date
from pathlib import Path

from .extract import ArticleCore, Line, Version
from .gitrepo import remove_tree

CACHE_DIR = "extract"
REMOTE_PREFIX = "build-cache/extract/"
REMOTE_TYPE = "application/gzip"
FORMAT = 1
PACKAGE = Path(__file__).resolve().parent


def code_hash() -> str:
    digest = hashlib.sha256()
    for path in sorted(PACKAGE.glob("*.py"), key=lambda p: p.name):
        digest.update(path.name.encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


def act_fingerprint(
    *,
    newest_commit: str | None,
    folders: list[str] | None = None,
    credits: dict[tuple[str, str], str],
    law_labels: dict[str, str],
    code: str,
) -> str:
    used_labels = {law: law_labels.get(law) for law in sorted(set(credits.values())) if law}
    payload = {
        "format": FORMAT,
        "code": code,
        "newest_commit": newest_commit,
        "folders": folders or [],
        "credits": sorted([list(key), value] for key, value in credits.items()),
        "labels": used_labels,
    }
    text = json.dumps(payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def cache_path(cache_dir: Path, act_path: str) -> Path:
    return Path(cache_dir) / CACHE_DIR / (act_path.replace("/", "_") + ".json")


def remote_key(act_path: str) -> str:
    return REMOTE_PREFIX + cache_path(Path(), act_path).name + ".gz"


def wipe(cache_dir: Path, r2=None) -> None:
    target = Path(cache_dir) / CACHE_DIR
    if target.exists():
        remove_tree(target)
    if r2 is not None:
        r2.delete_prefix(REMOTE_PREFIX)


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _encode_version(version: Version) -> dict:
    return {
        "from_": _iso(version.from_),
        "until": _iso(version.until),
        "commit": version.commit,
        "law_commit": version.law_commit,
        "law_key": version.law_key,
        "law_label": version.law_label,
        "kind": version.kind,
        "source_path": version.source_path,
        "lines": [[l.text, l.id, l.since.isoformat(), l.law_key] for l in version.lines],
    }


def _decode_version(data: dict) -> Version:
    lines = [Line(text, id_, date.fromisoformat(since), key) for text, id_, since, key in data["lines"]]
    return Version(**{**data, "from_": date.fromisoformat(data["from_"]), "until": _date(data["until"]), "lines": lines})


def encode_cores(cores: list[ArticleCore]) -> list[dict]:
    result = []
    for core in cores:
        result.append({
            "file": core.file,
            "number": core.number,
            "title": core.title,
            "versions": [_encode_version(v) for v in core.versions],
            "absent_since": _iso(core.absent_since),
            "removed_by_key": core.removed_by_key,
            "removed_by_label": core.removed_by_label,
        })
    return result


def decode_cores(items: list[dict]) -> list[ArticleCore]:
    return [
        ArticleCore(
            **{
                **item,
                "versions": [_decode_version(v) for v in item["versions"]],
                "absent_since": _date(item["absent_since"]),
            }
        )
        for item in items
    ]


def _marker(path: Path) -> Path:
    return path.with_suffix(".sha")


def _write_local(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    temporary.replace(path)


def _gzipped(text: str) -> bytes:
    return gzip.compress(text.encode("utf-8"), mtime=0)


def _load_remote(path: Path, act_path: str, fingerprint: str, r2) -> list[ArticleCore] | None:
    try:
        body = r2.get(remote_key(act_path))
        if body is None:
            return None
        text = gzip.decompress(body).decode("utf-8")
        data = json.loads(text)
        if data["fingerprint"] != fingerprint:
            return None
        cores = decode_cores(data["articles"])
    except Exception:
        return None
    try:
        _write_local(path, text)
        _marker(path).write_text(hashlib.sha256(body).hexdigest(), encoding="utf-8")
    except OSError:
        pass
    return cores


def load(cache_dir: Path, act_path: str, fingerprint: str, r2=None) -> list[ArticleCore] | None:
    path = cache_path(cache_dir, act_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["fingerprint"] == fingerprint:
            return decode_cores(data["articles"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    if r2 is None:
        return None
    return _load_remote(path, act_path, fingerprint, r2)


def store(cache_dir: Path, act_path: str, fingerprint: str, cores: list[ArticleCore], r2=None) -> None:
    path = cache_path(cache_dir, act_path)
    text = json.dumps({"fingerprint": fingerprint, "articles": encode_cores(cores)}, ensure_ascii=False)
    _write_local(path, text)
    if r2 is None:
        return
    body = _gzipped(text)
    digest = hashlib.sha256(body).hexdigest()
    marker = _marker(path)
    try:
        if marker.read_text(encoding="utf-8") == digest:
            return
    except OSError:
        pass
    try:
        r2.put(remote_key(act_path), body, REMOTE_TYPE, None)
        marker.write_text(digest, encoding="utf-8")
    except Exception as error:
        print(f"warning: could not upload the cache entry of {act_path}: {error}", file=sys.stderr)
