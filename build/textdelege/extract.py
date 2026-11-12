import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from difflib import SequenceMatcher
from typing import Literal

from .gitrepo import BlobReader, Commit, GitRepo
from .selection import (
    act_commits,
    commit_for_day,
    in_force_days,
    in_force_of,
    kind_of,
    tree_and_folder_for_day,
)

UNEXPLAINED_LABEL = "unexplained"
HEADING = re.compile(r"^#\s*Articolul\s+(\S.*?)\s*$")
FILE_STEM = re.compile(r"art-(\d+)(?:-(\d+))?\.md")
ALIN = re.compile(r"^\((\d+)(?:\^(\d+))?\)")
LIT = re.compile(r"^([a-z])(?:\^(\d+))?\)")
PCT_SUB = re.compile(r"^(\d+)\.(\d+)\.(?=\s|$)")
PCT = re.compile(r"^(\d+)(?:\^(\d+))?\.(?=\s|$)")
ALIN_ID = re.compile(r"^alin-(\d+(?:_\d+)?)")
UNMARKED_ID = re.compile(r"^p-\d+$")
TITLE_END_BLOCKERS = (".", ";", ":")


@dataclass
class Line:
    text: str
    id: str
    since: date
    law_key: str


@dataclass
class Version:
    from_: date
    until: date | None
    commit: str
    law_commit: str
    law_key: str
    law_label: str
    kind: str
    lines: list[Line] = field(default_factory=list)
    source_path: str = ""


@dataclass
class Article:
    file: str
    number: str
    title: str | None
    versions: list[Version]
    state: Literal["in-force", "repealed", "future"]
    repealed_on: date | None
    repealed_by_key: str | None = None
    repealed_by_label: str | None = None


def law_key_from_email(email: str) -> str:
    return email.partition("@")[0]


def _has_marker(text: str) -> bool:
    return any(pattern.match(text) for pattern in (ALIN, LIT, PCT_SUB, PCT))


def _with_insertion(match: re.Match) -> str:
    base, insertion = match.group(1), match.group(2)
    return base if insertion is None else f"{base}_{insertion}"


def line_id(text: str, previous_ids: list[str]) -> str:
    if match := ALIN.match(text):
        candidate = f"alin-{_with_insertion(match)}"
    elif match := LIT.match(text):
        candidate = f"lit-{_with_insertion(match)}"
        for previous in reversed(previous_ids):
            if alin := ALIN_ID.match(previous):
                candidate = f"alin-{alin.group(1)}-{candidate}"
                break
    elif match := PCT_SUB.match(text):
        candidate = f"pct-{match.group(1)}-{match.group(2)}"
    elif match := PCT.match(text):
        candidate = f"pct-{_with_insertion(match)}"
    else:
        candidate = f"p-{sum(1 for p in previous_ids if UNMARKED_ID.match(p)) + 1}"
    unique, counter = candidate, 1
    while unique in previous_ids:
        counter += 1
        unique = f"{candidate}-{counter}"
    return unique


def split_body(text: str) -> tuple[str | None, list[str]]:
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    if lines and HEADING.match(lines[0]):
        lines = lines[1:]
    title = None
    if len(lines) >= 2:
        candidate = lines[0]
        if not _has_marker(candidate) and not candidate.endswith(TITLE_END_BLOCKERS):
            title, lines = candidate, lines[1:]
    return title, lines


def _heading_number(text: str) -> str | None:
    for line in text.splitlines():
        if line.strip():
            match = HEADING.match(line)
            return match.group(1) if match else None
    return None


def _number_from_file(name: str) -> str:
    match = FILE_STEM.fullmatch(name)
    if not match:
        return name
    number = str(int(match.group(1)))
    return f"{number}^{int(match.group(2))}" if match.group(2) is not None else number


ROMAN = re.compile(r"m*(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})")
ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}


def _roman_value(text: str) -> int:
    total = 0
    for current, following in zip(text, text[1:] + " "):
        value = ROMAN_VALUES[current]
        total += -value if ROMAN_VALUES.get(following, 0) > value else value
    return total


def _suffix_key(groups: list[str]) -> tuple:
    return tuple((0, int(g), "") if g.isdigit() else (1, 0, g) for g in groups)


def _group_key(groups: list[str]) -> tuple:
    first, rest = groups[0], groups[1:]
    if first.isdigit():
        return (0, int(first), "", _suffix_key(rest))
    if first == "unic":
        return (-1, 0, "", _suffix_key(rest))
    if ROMAN.fullmatch(first):
        return (1, _roman_value(first), "", _suffix_key(rest))
    return (2, 0, first, _suffix_key(rest))


def _sort_key(name: str) -> tuple:
    groups = name.removeprefix("art-").removesuffix(".md").split("-")
    if len(groups) > 1 and re.fullmatch(r"t\d+", groups[0]):
        return (3, int(groups[0][1:]), _group_key(groups[1:]), name)
    return (*_group_key(groups), name)


def version_on(article: Article, day: date) -> Version | None:
    for version in article.versions:
        if version.from_ <= day and (version.until is None or day <= version.until):
            return version
    return None


@dataclass
class _Span:
    blob: str
    from_: date
    until: date | None = None


def _spans_per_file(
    days: list[date], trees: dict[date, dict[str, str]]
) -> tuple[dict[str, list[_Span]], dict[str, date]]:
    spans: dict[str, list[_Span]] = {}
    absent_since: dict[str, date] = {}
    for day in days:
        tree = trees[day]
        for name, history in spans.items():
            current = history[-1]
            if name not in tree:
                if current.until is None:
                    current.until = day - timedelta(days=1)
                    absent_since[name] = day
        for name, blob in tree.items():
            history = spans.setdefault(name, [])
            absent_since.pop(name, None)
            if history and history[-1].until is None and history[-1].blob == blob:
                continue
            if history and history[-1].until is None:
                history[-1].until = day - timedelta(days=1)
            history.append(_Span(blob, day))
    return spans, absent_since


@dataclass
class ArticleCore:
    file: str
    number: str
    title: str | None
    versions: list[Version]
    absent_since: date | None
    removed_by_key: str | None
    removed_by_label: str | None


def extract_act(
    repo: GitRepo,
    folder: str,
    old_folder: str | None,
    *,
    credits: dict[tuple[str, str], str],
    law_labels: dict[str, str],
    today: date,
) -> list[Article]:
    return finalize_act(extract_core(repo, folder, old_folder, credits=credits, law_labels=law_labels), today)


def extract_core(
    repo: GitRepo,
    folder: str,
    old_folder: str | None,
    *,
    credits: dict[tuple[str, str], str],
    law_labels: dict[str, str],
) -> list[ArticleCore]:
    with repo.blobs() as reader:
        return _extract_core(
            repo, reader, folder, old_folder, credits=credits, law_labels=law_labels
        )


def _extract_core(
    repo: GitRepo,
    reader: BlobReader,
    folder: str,
    old_folder: str | None,
    *,
    credits: dict[tuple[str, str], str],
    law_labels: dict[str, str],
) -> list[ArticleCore]:
    commits = act_commits(repo, folder, old_folder)
    days = in_force_days(commits)
    listings = {day: tree_and_folder_for_day(repo, commits, day, folder, old_folder) for day in days}
    trees = {day: listing[0] for day, listing in listings.items()}
    used_folders = {day: listing[1] for day, listing in listings.items()}
    spans, absent_since = _spans_per_file(days, trees)

    act_shas = {commit.sha for commit in commits}
    folders = [folder.rstrip("/")] + ([old_folder.rstrip("/")] if old_folder else [])
    touching: dict[str, list[Commit]] = {}
    for commit, paths in repo.log_with_paths([folder] + ([old_folder] if old_folder else [])):
        if commit.sha not in act_shas:
            continue
        for path in paths:
            for base in folders:
                if path.startswith(base + "/"):
                    touching.setdefault(path.removeprefix(base + "/"), []).append(commit)

    blob_text: dict[str, str] = {}

    def text_of(blob: str) -> str:
        if blob not in blob_text:
            blob_text[blob] = reader.read(blob)
        return blob_text[blob]

    def attribute(name: str, day: date, fallback: Commit) -> tuple[Commit, str, str]:
        source = next(
            (c for c in touching.get(name, []) if in_force_of(c) <= day),
            fallback,
        )
        law_key = law_key_from_email(source.author_email)
        law_label = source.author
        credited = credits.get((in_force_of(source).isoformat(), name.removesuffix(".md")))
        if credited is not None:
            if credited:
                law_key, law_label = credited, law_labels.get(credited, credited)
            else:
                law_key, law_label = "", UNEXPLAINED_LABEL
        return source, law_key, law_label

    cores = []
    for name in sorted(spans, key=_sort_key):
        versions = []
        for span in spans[name]:
            selected = commit_for_day(commits, span.from_)
            source, law_key, law_label = attribute(name, span.from_, selected)
            _title, body = split_body(text_of(span.blob))
            ids: list[str] = []
            lines = []
            for text in body:
                ids.append(line_id(text, ids))
                lines.append(Line(text, ids[-1], span.from_, law_key))
            versions.append(
                Version(
                    from_=span.from_,
                    until=span.until,
                    commit=selected.sha,
                    law_commit=source.sha,
                    law_key=law_key,
                    law_label=law_label,
                    kind=kind_of(source),
                    source_path=f"{used_folders[span.from_].rstrip('/')}/{name}",
                    lines=lines,
                )
            )
        _apply_blame(versions)

        last_text = text_of(spans[name][-1].blob)
        title, _body = split_body(last_text)
        number = _heading_number(last_text) or _number_from_file(name)
        absent = absent_since.get(name)
        removed_by_key = removed_by_label = None
        if absent is not None:
            _remover, removed_by_key, removed_by_label = attribute(
                name, absent, commit_for_day(commits, absent)
            )
        cores.append(ArticleCore(name, number, title, versions, absent, removed_by_key, removed_by_label))
    return cores


def finalize_act(cores: list[ArticleCore], today: date) -> list[Article]:
    articles = []
    for core in cores:
        versions = core.versions
        repealed_on = core.absent_since
        repealed_by_key = repealed_by_label = None
        if versions[0].from_ > today:
            state = "future"
        elif repealed_on is not None and versions[-1].until < today:
            state = "repealed"
            repealed_by_key, repealed_by_label = core.removed_by_key, core.removed_by_label
        else:
            state = "in-force"
            current = version_on(Article(core.file, "", None, versions, state, None), today)
            current = current or versions[-1]
            if [line.text for line in current.lines] == ["Abrogat."]:
                state = "repealed"
                repealed_on = current.from_
                repealed_by_key, repealed_by_label = current.law_key, current.law_label
        articles.append(
            Article(
                file=core.file,
                number=core.number,
                title=core.title,
                versions=versions,
                state=state,
                repealed_on=repealed_on if state == "repealed" else None,
                repealed_by_key=repealed_by_key,
                repealed_by_label=repealed_by_label,
            )
        )
    return articles


def _apply_blame(versions: list[Version]) -> None:
    for previous, current in zip(versions, versions[1:]):
        matcher = SequenceMatcher(
            None,
            [line.text for line in previous.lines],
            [line.text for line in current.lines],
            autojunk=False,
        )
        for block in matcher.get_matching_blocks():
            for offset in range(block.size):
                old = previous.lines[block.a + offset]
                new = current.lines[block.b + offset]
                new.since, new.law_key = old.since, old.law_key
