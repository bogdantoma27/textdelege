import csv
import io
import json
from dataclasses import dataclass
from datetime import date

from .gitrepo import BlobReader, GitRepo

TEXT_FILES = ("decizie.md", "hotarare.md")
REQUIRED = ("key", "label", "court", "date")


@dataclass(frozen=True)
class Subject:
    act_path: str
    articles: list[str]


@dataclass(frozen=True)
class Ruling:
    key: str
    label: str
    court: str
    court_name: str
    kind: str
    heading: str
    subtitle: str | None
    date: date
    binding_from: date | None
    mo: dict
    outcome: str
    finds_unconstitutional: bool
    dossiers: list[str]
    operative: list[str]
    text: str | None
    subjects: list[Subject]
    source: str | None
    folder: str


def _optional_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def decision_ids(rulings_by_provision: dict, selected_paths: set[str]) -> list[str]:
    ids: dict[str, None] = {}
    for path, entry in rulings_by_provision["acts"].items():
        if path not in selected_paths:
            continue
        for key in entry["act"]:
            ids.setdefault(key)
        for article in entry["articles"].values():
            for key in article["decisions"]:
                ids.setdefault(key)
    return list(ids)


def _load_one(
    reader: BlobReader, sha: str, key: str, folder: str, warnings: list[str]
) -> Ruling | str | None:
    try:
        raw = reader.read_or_none(f"{sha}:{folder}/meta.json")
    except UnicodeDecodeError:
        return "meta.json is not valid UTF-8"
    if raw is None:
        return None
    try:
        meta = json.loads(raw)
        missing = [name for name in REQUIRED if not meta.get(name)]
        if missing:
            return f"missing required field(s) {', '.join(missing)}"
        try:
            when = date.fromisoformat(meta["date"])
        except (TypeError, ValueError):
            return f"unparseable date {meta['date']!r}"
        binding_from = _optional_date(meta.get("binding_from"))
        subjects = [
            Subject(s["act"]["path"], [a["art"] for a in s["articles"]])
            for s in meta.get("subjects") or []
            if s["act"].get("path")
        ]
    except (AttributeError, KeyError, TypeError, ValueError) as error:
        return f"malformed meta.json ({type(error).__name__}: {error})"
    text = None
    for name in TEXT_FILES:
        try:
            text = reader.read_or_none(f"{sha}:{folder}/{name}")
        except UnicodeDecodeError:
            warnings.append(f"decision {key}: {name} is not valid UTF-8, text left out")
            break
        if text is not None:
            break
    return Ruling(
        key=key,
        label=meta["label"],
        court=meta["court"],
        court_name=meta.get("court_name") or "",
        kind=meta.get("kind") or "",
        heading=meta.get("heading") or "",
        subtitle=meta.get("subtitle"),
        date=when,
        binding_from=binding_from,
        mo=meta.get("mo") or {},
        outcome=meta.get("outcome") or "",
        finds_unconstitutional=bool(meta.get("finds_unconstitutional", False)),
        dossiers=list(meta.get("dossiers") or []),
        operative=list(meta.get("operative") or []),
        text=text,
        subjects=subjects,
        source=(meta.get("source") or {}).get("portal"),
        folder=folder,
    )


def load_rulings(
    repo: GitRepo,
    selected_paths: set[str],
    rulings_by_provision: dict,
    decisions_csv: str,
) -> tuple[list[Ruling], list[str]]:
    folders = {
        row["key"]: row["folder"]
        for row in csv.DictReader(io.StringIO(decisions_csv, newline=""))
    }
    sha = repo.head()
    rulings: list[Ruling] = []
    warnings: list[str] = []
    with repo.blobs() as reader:
        for key in decision_ids(rulings_by_provision, selected_paths):
            folder = folders.get(key)
            if folder is None:
                warnings.append(f"decision {key} is not listed in decisions.csv")
                continue
            ruling = _load_one(reader, sha, key, folder, warnings)
            if ruling is None:
                warnings.append(f"decision {key} has no meta.json in {folder}")
                continue
            if isinstance(ruling, str):
                warnings.append(f"decision {key} skipped: {ruling}")
                continue
            rulings.append(ruling)
    return rulings, warnings


def rulings_by_article(
    rulings_by_provision: dict, selected_paths: set[str]
) -> dict[tuple[str, str], list[str]]:
    result: dict[tuple[str, str], list[str]] = {}

    def add(key: tuple[str, str], ids: list[str]) -> None:
        if not ids:
            return
        bucket = result.setdefault(key, [])
        bucket.extend(i for i in dict.fromkeys(ids) if i not in bucket)

    for path, entry in rulings_by_provision["acts"].items():
        if path not in selected_paths:
            continue
        add((path, ""), entry["act"])
        for article_key, article in entry["articles"].items():
            name = article["file"].removesuffix(".md") if article["file"] else article_key
            add((path, name), article["decisions"])
    return result
