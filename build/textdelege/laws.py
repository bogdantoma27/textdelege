import csv
import io
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .events import Event, Verb, events_for
from .extract import Article

MO_MARKER = "Monitorul Oficial"


@dataclass
class Change:
    act_path: str
    file: str
    number: str
    verb: Verb
    units: list[str]
    date: date


@dataclass
class Law:
    key: str
    label: str
    kind: str
    title: str
    enacted: date | None
    published: date | None
    in_force: list[date]
    source: str | None
    mo: str | None
    changes: list[Change] = field(default_factory=list)


def _date(value: str) -> date | None:
    return date.fromisoformat(value) if value else None


def parse_laws_csv(text: str) -> dict[str, dict]:
    laws: dict[str, dict] = {}
    for row in csv.DictReader(io.StringIO(text, newline="")):
        title = row["title"]
        start = title.find(MO_MARKER)
        laws[row["key"]] = {
            "key": row["key"],
            "label": row["label"],
            "kind": row["kind"],
            "title": title,
            "enacted": _date(row["enacted"]),
            "published": _date(row["published"]),
            "in_force": [date.fromisoformat(day) for day in row["in_force_days"].split()],
            "source": row["url"] or None,
            "mo": " ".join(title[start:].split()) if start >= 0 else None,
        }
    return laws


def _referenced(articles_by_act: dict[str, list[Article]]) -> dict[str, str]:
    labels: dict[str, str] = {}
    for articles in articles_by_act.values():
        for article in articles:
            for version in article.versions:
                if version.law_key:
                    labels.setdefault(version.law_key, version.law_label)
            if article.repealed_by_key:
                labels.setdefault(article.repealed_by_key, article.repealed_by_label or "")
    return labels


def _all_events(articles_by_act: dict[str, list[Article]]):
    for act_path, articles in articles_by_act.items():
        for order, article in enumerate(articles):
            for event in events_for(article):
                yield act_path, order, article, event


def laws_from(laws_csv: str, articles_by_act: dict[str, list[Article]]) -> dict[str, Law]:
    rows = parse_laws_csv(laws_csv)
    laws: dict[str, Law] = {}
    for key, label in _referenced(articles_by_act).items():
        if key in rows:
            laws[key] = Law(**rows[key])
        else:
            laws[key] = Law(key, label, "", "", None, None, [], None, None)
    ordered = []
    for act_path, order, article, event in _all_events(articles_by_act):
        if event.law_key in laws:
            change = Change(
                act_path,
                Path(article.file).stem,
                article.number,
                event.verb,
                event.units,
                event.date,
            )
            ordered.append(((act_path, order, event.date), event.law_key, change))
    ordered.sort(key=lambda item: item[0])
    for _, key, change in ordered:
        laws[key].changes.append(change)
    return laws


def _entry(act_path: str, article: Article, event: Event) -> dict:
    return {
        "date": event.date.isoformat(),
        "act_path": act_path,
        "file": Path(article.file).stem,
        "number": article.number,
        "title": article.title,
        "verb": event.verb,
        "units": event.units,
        "law_key": event.law_key,
        "law_label": event.law_label,
    }


def changes_feed(articles_by_act: dict[str, list[Article]], limit: int, today: date) -> list[dict]:
    events = [item for item in _all_events(articles_by_act) if item[3].date <= today]
    events.sort(key=lambda item: (item[0], item[1]))
    events.sort(key=lambda item: item[3].date, reverse=True)
    return [_entry(path, article, event) for path, _, article, event in events[:limit]]


def upcoming(
    articles_by_act: dict[str, list[Article]], today: date, limit: int | None = None
) -> list[dict]:
    events = [item for item in _all_events(articles_by_act) if item[3].date > today]
    events.sort(key=lambda item: (item[3].date, item[0], item[1]))
    return [_entry(path, article, event) for path, _, article, event in events[:limit]]
