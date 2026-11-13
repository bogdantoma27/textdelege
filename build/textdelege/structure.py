"""Heading structure (Partea, Cartea, Titlul, Capitolul, Secțiunea, paragraf) of an act.

The source repository keeps no headings. The official portal marks them with classes:
containers ``S_PRT``, ``S_CRT``, ``S_TTL``, ``S_CAP``, ``S_SEC``, ``S_PRG`` with a label child
``S_<K>_TTL`` and a name child ``S_<K>_DEN``; articles are ``S_ART`` with ``S_ART_TTL``.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

from . import retry

USER_AGENT = "textdelege/1 (+https://textdelege.ro/despre)"
TIMEOUT = 120
PAUSE = 2.0

RANKS = {"PRT": 0, "CRT": 1, "TTL": 2, "CAP": 3, "SEC": 4, "PRG": 5}
KIND_NAMES = {"PRT": "prt", "CRT": "crt", "TTL": "ttl", "CAP": "cap", "SEC": "sec", "PRG": "prg"}
VOID = {"br", "img", "hr", "input", "meta", "link", "col", "area", "base", "wbr", "source", "param", "embed"}
UNIT = re.compile(r"^S_([A-Z]+)$")
PART = re.compile(r"^S_([A-Z]+)_(TTL|DEN)$")
NUMBER = re.compile(r"^\d+(\^\d+)?$")


def _collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


_CEDILLA = str.maketrans("şŞţŢ", "șȘțȚ")


def _heading_text(text: str) -> str:
    """Collapse spaces, use comma-below letters and drop footnote marks such as '*)'."""
    return re.sub(r"\s*\*+\)+$", "", _collapse(text).translate(_CEDILLA)).strip()


def article_number(label: str) -> str | None:
    """'Articolul 1.112' -> '1112', 'Articolul 52^1' -> '52^1'; anything else -> None."""
    text = _collapse(label)
    match = re.match(r"(?i)^articolul\s+(.+)$", text)
    if not match:
        return None
    number = re.sub(r"\s+", "", match.group(1))
    number = re.sub(r"(?<=\d)\.(?=\d)", "", number)
    number = re.sub(r"[*)\.]+$", "", number)
    return number if NUMBER.fullmatch(number) else None


class _Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.headings: list[dict] = []
        self.current: list[int | None] = [None] * len(RANKS)
        self.articles: list[dict] = []
        self.capture: dict | None = None
        self.annex: dict | None = None

    def _chain(self) -> list[int]:
        return [index for index in self.current if index is not None]

    def handle_starttag(self, tag, attrs):
        if self.annex is not None:
            if tag == self.annex["tag"] and tag not in VOID:
                self.annex["level"] += 1
            return
        if self.capture is not None and tag == self.capture["tag"] and tag not in VOID:
            self.capture["level"] += 1
        classes = (dict(attrs).get("class") or "").split()
        unit = part = None
        for name in classes:
            if m := UNIT.match(name):
                unit = m.group(1)
            if m := PART.match(name):
                part = (m.group(1), m.group(2))
        if unit == "ANX":
            self.annex = None if tag in VOID else {"tag": tag, "level": 1}
            self.capture = None
            return
        if unit in RANKS:
            rank = RANKS[unit]
            self.headings.append({
                "kind": KIND_NAMES[unit], "label": "", "name": "",
                "depth": sum(1 for index in self.current[:rank] if index is not None),
            })
            self.current[rank] = len(self.headings) - 1
            for later in range(rank + 1, len(self.current)):
                self.current[later] = None
        elif unit == "ART":
            chain = self._chain()
            self.articles.append({"label": "", "chain": chain})
        if part is None or tag in VOID:
            return
        owner, field = part
        key = "label" if field == "TTL" else "name"
        target = None
        if owner == "ART":
            target = self.articles[-1] if self.articles else None
        elif owner in RANKS and self.headings and self.headings[-1]["kind"] == KIND_NAMES[owner]:
            target = self.headings[-1]
        if target is not None and not target.get(key):
            self.capture = {"target": target, "key": key, "tag": tag, "level": 1}

    def handle_endtag(self, tag):
        if self.annex is not None:
            if tag == self.annex["tag"]:
                self.annex["level"] -= 1
                if self.annex["level"] <= 0:
                    self.annex = None
            return
        if self.capture is not None and tag == self.capture["tag"]:
            self.capture["level"] -= 1
            if self.capture["level"] <= 0:
                self.capture = None

    def handle_data(self, data):
        if self.capture is not None and self.annex is None:
            target, key = self.capture["target"], self.capture["key"]
            target[key] = target.get(key, "") + data


def parse_structure(html: str) -> dict:
    parser = _Parser()
    parser.feed(html)
    parser.close()
    headings = parser.headings
    articles: dict[str, list[int]] = {}
    for article in parser.articles:
        number = article_number(article["label"])
        if number is not None and number not in articles:
            articles[number] = article["chain"]
    used = sorted({index for chain in articles.values() for index in chain})
    remap = {old: new for new, old in enumerate(used)}
    return {
        "headings": [
            {
                "kind": headings[old]["kind"],
                "label": _heading_text(headings[old]["label"]),
                "name": _heading_text(headings[old]["name"]),
                "depth": headings[old]["depth"],
            }
            for old in used
        ],
        "articles": {number: remap[chain[-1]] for number, chain in articles.items() if chain},
    }


def fetch_page(url: str) -> bytes | None:
    def attempt() -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.read()

    def retryable(error: Exception) -> bool:
        if isinstance(error, urllib.error.HTTPError):
            return error.code == 429 or error.code >= 500
        return isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError))

    try:
        return retry.with_retries(attempt, retryable)
    finally:
        time.sleep(PAUSE)


def _cache_file(cache_dir: Path, path: str) -> Path:
    return Path(cache_dir) / "structure" / (path.replace("/", "_") + ".json")


def _usable(structure: dict | None) -> dict | None:
    return structure if structure and structure.get("headings") else None


def load(
    meta,
    latest: date | str,
    cache_dir: Path,
    fetch: Callable[[str], bytes | None] = fetch_page,
) -> dict | None:
    url = meta.portal
    day = latest if isinstance(latest, str) else latest.isoformat()
    if not url.startswith("http"):
        return None
    file = _cache_file(cache_dir, meta.path)
    try:
        stored = json.loads(file.read_text(encoding="utf-8"))
        if stored.get("url") == url and stored.get("latest") == day:
            return _usable(stored.get("structure"))
    except (OSError, ValueError):
        pass
    try:
        body = fetch(url)
        if body is None:
            raise ValueError("no content")
        structure = parse_structure(body.decode("utf-8", "replace"))
    except Exception as error:
        print(f"headings: {meta.path}: {error}", file=sys.stderr)
        return None
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(
        json.dumps({"url": url, "latest": day, "structure": structure}, ensure_ascii=False),
        encoding="utf-8",
    )
    return _usable(structure)
