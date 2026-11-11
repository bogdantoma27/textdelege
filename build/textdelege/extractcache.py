import hashlib
import json
from datetime import date
from pathlib import Path

from .extract import ArticleCore, Line, Version
from .gitrepo import remove_tree

CACHE_DIR = "extract"
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


def wipe(cache_dir: Path) -> None:
    target = Path(cache_dir) / CACHE_DIR
    if target.exists():
        remove_tree(target)


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


def load(cache_dir: Path, act_path: str, fingerprint: str) -> list[ArticleCore] | None:
    path = cache_path(cache_dir, act_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["fingerprint"] != fingerprint:
            return None
        return decode_cores(data["articles"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def store(cache_dir: Path, act_path: str, fingerprint: str, cores: list[ArticleCore]) -> None:
    path = cache_path(cache_dir, act_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({"fingerprint": fingerprint, "articles": encode_cores(cores)}, ensure_ascii=False)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    temporary.replace(path)
