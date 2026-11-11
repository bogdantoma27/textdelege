import csv
import io
import json

from .acts import ActMeta
from .gitrepo import GitRepo

INDEX = "data/freshness/index.json"
SUMMARY = "data/freshness.json"
FOLDER = "data/freshness/"


def _shard_of(path: str) -> str:
    return "/".join(path.split("/")[:2])


def _row(row: dict[str, str]) -> dict:
    def text(name: str) -> str | None:
        return row.get(name) or None

    return {
        "status": text("status"),
        "last_verified": text("last_verified"),
        "check_due": text("check_due"),
        "method": text("method"),
        "newest_change": text("newest_change"),
        "newest_change_date": text("newest_change_date"),
        "change_in_repo": {"yes": True, "no": False}.get(row.get("change_in_repo", "")),
        "official_url": text("official_url"),
    }


def shard_files(index_json: dict, metas: list[ActMeta]) -> list[str]:
    wanted = {_shard_of(meta.path) for meta in metas}
    return [_shard_path(shard) for shard in index_json["shards"] if shard["shard"] in wanted]


def _shard_path(shard: dict) -> str:
    name = shard["file"]
    return name if name.startswith("data/") else FOLDER + name


def load_freshness(repo: GitRepo, metas: list[ActMeta]) -> dict[str, dict]:
    head = repo.head()
    raw = repo.show_file(head, INDEX)
    if raw is None:
        return {}
    wanted: dict[str, list[ActMeta]] = {}
    for meta in metas:
        wanted.setdefault(_shard_of(meta.path), []).append(meta)
    result: dict[str, dict] = {}
    for shard in json.loads(raw)["shards"]:
        selected = wanted.get(shard["shard"])
        if not selected:
            continue
        text = repo.show_file(head, _shard_path(shard))
        if text is None:
            continue
        rows = {row["act"]: row for row in csv.DictReader(io.StringIO(text, newline=""))}
        for meta in selected:
            row = rows.get(meta.slug) or rows.get(meta.path)
            if row is not None:
                result[meta.path] = _row(row)
    return result


def load_freshness_summary(repo: GitRepo) -> dict:
    raw = repo.show_file(repo.head(), SUMMARY)
    data = json.loads(raw) if raw is not None else {}
    return {
        "as_of": data.get("as_of"),
        "checked_against_official_source": data.get("checked_against_official_source"),
    }
