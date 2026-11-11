from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from .extract import ALIN, LIT, PCT, PCT_SUB, Article, Line, Version

Verb = Literal["entered", "modified", "completed", "repealed", "unconstitutional", "restated"]

ABROGAT = "Abrogat."
STRUCK_DOWN = "Încetat efecte juridice."
DAY = timedelta(days=1)


@dataclass
class Event:
    date: date
    verb: Verb
    units: list[str]
    law_key: str
    law_label: str
    kind: str
    from_version: int | None
    to_version: int


def _after_marker(text: str) -> str:
    for pattern in (ALIN, LIT, PCT_SUB, PCT):
        if match := pattern.match(text):
            return text[match.end() :].strip()
    return text.strip()


def _diff(previous: list[Line], current: list[Line]) -> tuple[list[Line], list[Line], list[Line]]:
    old = {line.id: line for line in previous}
    new = {line.id: line for line in current}
    changed = [line for line in current if line.id in old and old[line.id].text != line.text]
    added = [line for line in current if line.id not in old]
    removed = [line for line in previous if line.id not in new]
    return changed, added, removed


def _verb_and_units(previous: Version, current: Version) -> tuple[Verb, list[str]]:
    changed, added, removed = _diff(previous.lines, current.lines)
    changed_ids = [line.id for line in changed]
    if current.kind == "correction":
        return "restated", changed_ids
    only_changed = bool(changed) and not added and not removed
    if current.kind == "court" and only_changed:
        if all(_after_marker(line.text) == STRUCK_DOWN for line in changed):
            return "unconstitutional", changed_ids
    if [line.text for line in current.lines] == [ABROGAT] and (
        [line.text for line in previous.lines] != [ABROGAT]
    ):
        return "repealed", []
    if only_changed and all(_after_marker(line.text) == ABROGAT for line in changed):
        return "repealed", changed_ids
    if added and not changed and not removed:
        return "completed", [line.id for line in added]
    in_current = {line.id for line in changed} | {line.id for line in added}
    units = [line.id for line in current.lines if line.id in in_current]
    return "modified", units + [line.id for line in removed]


def events_for(article: Article) -> list[Event]:
    events: list[Event] = []
    versions = article.versions
    for index, version in enumerate(versions):
        previous = versions[index - 1] if index else None
        if previous is not None and previous.until is not None:
            if version.from_ > previous.until + DAY:
                events.append(
                    Event(previous.until + DAY, "repealed", [], "", "", "", index - 1, -1)
                )
        if previous is None or (
            previous.until is not None and version.from_ > previous.until + DAY
        ):
            verb, units = "entered", []
            from_version = None
        else:
            verb, units = _verb_and_units(previous, version)
            from_version = index - 1
        events.append(
            Event(
                version.from_,
                verb,
                units,
                version.law_key,
                version.law_label,
                version.kind,
                from_version,
                index,
            )
        )
    last = versions[-1] if versions else None
    if (
        article.state == "repealed"
        and article.repealed_on is not None
        and last is not None
        and last.until == article.repealed_on - DAY
    ):
        events.append(
            Event(
                article.repealed_on,
                "repealed",
                [],
                article.repealed_by_key or "",
                article.repealed_by_label or "",
                "",
                len(versions) - 1,
                -1,
            )
        )
    events.sort(key=lambda event: event.date, reverse=True)
    return events
