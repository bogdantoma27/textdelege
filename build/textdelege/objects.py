from datetime import date
from pathlib import Path

from .acts import ActMeta, _is_code
from .events import Event, events_for
from .extract import ALIN, PCT, Article, Version
from .laws import Law
from .rulings import Ruling

MOST_AMENDED = 10
LEAD_MAX = 80


def object_key(kind: str, *parts: str) -> str:
    match kind, parts:
        case "act", (path,):
            return f"acts/{path}/act.json"
        case "article", (path, stem):
            return f"acts/{path}/art/{stem}.json"
        case "law", (key,):
            return f"laws/{key}.json"
        case "ruling", (key,):
            return f"rulings/{key}.json"
        case "act-index", ():
            return "acts/index.json"
        case "changes-site", ():
            return "changes/site.json"
        case "changes-act", (path,):
            return f"changes/acts/{path}.json"
    raise ValueError(f"unknown object kind {kind!r} with {len(parts)} parts")


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _law(key: str | None, label: str | None) -> dict | None:
    return {"key": key, "label": label or ""} if key else None


def _stem(article: Article) -> str:
    return Path(article.file).stem


def _version(version: Version) -> dict:
    return {
        "from": _iso(version.from_),
        "until": _iso(version.until),
        "commit": version.commit,
        "path": version.source_path,
        "law_commit": version.law_commit,
        "law": _law(version.law_key, version.law_label),
        "kind": version.kind,
        "lines": [
            {
                "id": line.id,
                "text": line.text,
                "since": _iso(line.since),
                "law": line.law_key,
            }
            for line in version.lines
        ],
    }


def _event(event: Event) -> dict:
    return {
        "date": _iso(event.date),
        "verb": event.verb,
        "units": list(event.units),
        "law": _law(event.law_key, event.law_label),
        "kind": event.kind,
        "from_version": event.from_version,
        "to_version": event.to_version,
    }


def _ruling_summary(ruling: Ruling) -> dict:
    return {
        "key": ruling.key,
        "label": ruling.label,
        "court": ruling.court,
        "date": _iso(ruling.date),
        "outcome": ruling.outcome,
        "finds_unconstitutional": ruling.finds_unconstitutional,
    }


def _neighbour(article: Article | None) -> dict | None:
    if article is None:
        return None
    return {
        "file": _stem(article),
        "number": article.number,
        "title": article.title,
        "state": article.state,
    }


def lead(article: Article) -> str | None:
    for version in reversed(article.versions):
        text = " ".join(" ".join(line.text for line in version.lines).split())
        for marker in (ALIN, PCT):
            if match := marker.match(text):
                text = text[match.end():].lstrip()
                break
        if not text:
            continue
        if len(text) <= LEAD_MAX:
            return text
        cut = text[: LEAD_MAX + 1].rsplit(" ", 1)[0] if " " in text[: LEAD_MAX + 1] else text[:LEAD_MAX]
        return cut.rstrip() + "…"
    return None


def article_object(
    act: ActMeta,
    article: Article,
    events: list[Event],
    rulings: list[Ruling],
    prev: Article | None,
    next: Article | None,
) -> dict:
    repealed = None
    if article.repealed_on is not None:
        repealed = {
            "on": _iso(article.repealed_on),
            "law": _law(article.repealed_by_key, article.repealed_by_label),
        }
    return {
        "schema": "textdelege/article/1",
        "act": {
            "path": act.path,
            "alias": act.alias,
            "title": act.title,
            "short": act.short,
            "kind": act.kind,
        },
        "file": _stem(article),
        "number": article.number,
        "title": article.title,
        "state": article.state,
        "repealed": repealed,
        "versions": [_version(version) for version in article.versions],
        "events": [_event(event) for event in events],
        "rulings": [_ruling_summary(ruling) for ruling in rulings],
        "prev": _neighbour(prev),
        "next": _neighbour(next),
    }


def _timeline(articles: list[Article]) -> list[dict]:
    days: dict[date, tuple[dict[str, dict], set[str]]] = {}
    for article in articles:
        for version in article.versions:
            laws, files = days.setdefault(version.from_, ({}, set()))
            if version.law_key:
                laws.setdefault(version.law_key, _law(version.law_key, version.law_label))
            files.add(article.file)
    return [
        {"date": _iso(day), "laws": list(laws.values()), "articles": len(files)}
        for day, (laws, files) in sorted(days.items())
    ]


def act_object(
    act: ActMeta,
    articles: list[Article],
    laws: list[Law],
    rulings: list[Ruling],
    freshness: dict | None,
    structure: dict | None = None,
) -> dict:
    headed = (structure or {}).get("articles", {})
    index = []
    per_year: dict[int, int] = {}
    for article in articles:
        events = events_for(article)
        changes = [event for event in events if event.verb != "entered"]
        for event in changes:
            per_year[event.date.year] = per_year.get(event.date.year, 0) + 1
        entry = {
            "file": _stem(article),
            "number": article.number,
            "title": article.title,
            "lead": lead(article) if article.title is None else None,
            "state": article.state,
            "versions": len(article.versions),
            "changes": len(changes),
            "first": _iso(article.versions[0].from_) if article.versions else None,
            "last_change": _iso(max((e.date for e in events), default=None)),
        }
        if article.number in headed:
            entry["heading"] = headed[article.number]
        index.append(entry)
    amended = sorted(
        (entry for entry in index if entry["changes"]), key=lambda entry: -entry["changes"]
    )
    result = {
        "schema": "textdelege/act/1",
        "path": act.path,
        "slug": act.slug,
        "alias": act.alias,
        "kind": act.kind,
        "year": act.year,
        "number": act.number,
        "title": act.title,
        "short": act.short,
        "code": act.code,
        "status": act.status,
        "portal": act.portal,
        "from": _iso(act.from_),
        "latest": _iso(act.latest),
        "freshness": freshness,
        "articles": index,
        "timeline": _timeline(articles),
        "stats": {
            "changes_per_year": {str(year): per_year[year] for year in sorted(per_year)},
            "most_amended": [
                {key: entry[key] for key in ("file", "number", "title", "changes")}
                for entry in amended[:MOST_AMENDED]
            ],
        },
        "rulings": [_ruling_summary(ruling) for ruling in rulings],
        "laws": [
            {"key": law.key, "label": law.label} for law in sorted(laws, key=lambda l: l.key)
        ],
    }
    if structure and structure.get("headings"):
        result["headings"] = structure["headings"]
    return result


def law_object(law: Law) -> dict:
    return {
        "schema": "textdelege/law/1",
        "key": law.key,
        "label": law.label,
        "kind": law.kind,
        "title": law.title,
        "enacted": _iso(law.enacted),
        "published": _iso(law.published),
        "in_force": [_iso(day) for day in law.in_force],
        "source": law.source,
        "mo": law.mo,
        "changes": [
            {
                "act_path": change.act_path,
                "file": change.file,
                "number": change.number,
                "verb": change.verb,
                "units": list(change.units),
                "date": _iso(change.date),
            }
            for change in law.changes
        ],
    }


def articles_by_ruling(
    by_article: dict[tuple[str, str], list[str]]
) -> dict[str, list[tuple[str, str]]]:
    grouped: dict[str, set[tuple[str, str]]] = {}
    for (path, stem), keys in by_article.items():
        if stem:
            for key in keys:
                grouped.setdefault(key, set()).add((path, stem))
    return {key: sorted(items) for key, items in grouped.items()}


def ruling_object(ruling: Ruling, articles_of: dict[str, list[tuple[str, str]]]) -> dict:
    articles = articles_of.get(ruling.key, [])
    return {
        "schema": "textdelege/ruling/1",
        "key": ruling.key,
        "label": ruling.label,
        "court": ruling.court,
        "court_name": ruling.court_name,
        "kind": ruling.kind,
        "heading": ruling.heading,
        "subtitle": ruling.subtitle,
        "date": _iso(ruling.date),
        "binding_from": _iso(ruling.binding_from),
        "mo": ruling.mo,
        "outcome": ruling.outcome,
        "finds_unconstitutional": ruling.finds_unconstitutional,
        "dossiers": list(ruling.dossiers),
        "operative": list(ruling.operative),
        "text": ruling.text,
        "subjects": [
            {"act_path": subject.act_path, "articles": list(subject.articles)}
            for subject in ruling.subjects
        ],
        "source": ruling.source,
        "folder": ruling.folder,
        "articles": [{"act_path": path, "file": stem} for path, stem in articles],
    }


def _feed_item(item: dict) -> dict:
    result = {key: value for key, value in item.items() if key not in ("law_key", "law_label")}
    result["law"] = _law(item["law_key"], item["law_label"])
    return result


def changes_object(scope: str, items: list[dict], upcoming: list[dict]) -> dict:
    return {
        "schema": "textdelege/changes/1",
        "scope": scope,
        "items": [_feed_item(item) for item in items],
        "upcoming": [_feed_item(item) for item in upcoming],
    }


def act_index_object(acts: list[ActMeta], stats: dict[str, dict[str, int]]) -> dict:
    return {
        "schema": "textdelege/act-index/1",
        "acts": [
            {
                "path": act.path,
                "alias": act.alias,
                "title": act.title,
                "short": act.short,
                "kind": act.kind,
                "status": act.status,
                "from": _iso(act.from_),
                "latest": _iso(act.latest),
                "articles": (stats.get(act.path) or {}).get("articles", 0),
            }
            for act in acts
        ],
    }


def manifest_object(
    build_id: str,
    source_head: str,
    generated: str,
    counts: dict[str, int],
    acts: list[ActMeta],
    stats: dict[str, dict[str, int]],
    freshness: dict[str, dict],
    freshness_summary: dict,
    status: dict,
) -> dict:
    return {
        "schema": "textdelege/manifest/1",
        "build": build_id,
        "source_head": source_head,
        "generated": generated,
        "counts": counts,
        "acts": [
            {
                "path": act.path,
                "alias": act.alias,
                "title": act.title,
                "short": act.short,
                "status": act.status,
                "from": _iso(act.from_),
                "latest": _iso(act.latest),
                "articles": (stats.get(act.path) or {}).get("articles", 0),
                "versions": (stats.get(act.path) or {}).get("versions", 0),
                "freshness_status": (freshness.get(act.path) or {}).get("status"),
            }
            for act in acts
            if _is_code(act)
        ],
        "freshness": {
            "as_of": freshness_summary.get("as_of"),
            "checked_against_official_source": freshness_summary.get(
                "checked_against_official_source"
            ),
        },
        "status": status,
    }
