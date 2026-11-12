import re
import unicodedata
from dataclasses import dataclass, replace
from datetime import date
from typing import Literal

PRIMARY_KINDS = (
    "constitutie", "lege", "oug", "og", "decret", "decret-lege", "hotarare-parlament", "cod", "alte",
)
CONSOLIDATED_KINDS = (
    "lege", "oug", "og", "decret-lege", "hotarare-parlament", "cod", "constitutie",
)
DROPPED_WORDS = {"de", "al", "romaniei"}
IN_FORCE = "in force"


@dataclass(frozen=True)
class ActMeta:
    path: str
    slug: str
    kind: str
    year: int
    number: str
    title: str
    code: str | None
    short: str | None
    alias: str | None
    status: str
    portal: str
    versions: int
    from_: date
    latest: date


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    words = re.sub(r"[^a-z0-9]+", "-", text).strip("-").split("-")
    return "-".join(w for w in words if w and w not in DROPPED_WORDS)


def _is_code(meta: ActMeta) -> bool:
    return bool(meta.code) or meta.kind == "constitutie"


def alias_for(meta: ActMeta) -> str | None:
    if not _is_code(meta):
        return None
    if meta.slug.startswith("cod") or meta.slug == "constitutia":
        return meta.slug
    return _slugify(meta.code or "") or None


def aliases_for(metas: list[ActMeta]) -> dict[str, str]:
    base = {m.path: alias_for(m) for m in metas}
    counts: dict[str, int] = {}
    for alias in base.values():
        if alias:
            counts[alias] = counts.get(alias, 0) + 1
    result: dict[str, str] = {}
    owners: dict[str, str] = {}
    for m in metas:
        alias = base[m.path]
        if not alias:
            continue
        if counts[alias] > 1 and m.status != IN_FORCE:
            alias = f"{alias}-{m.year}"
        if alias in owners:
            raise ValueError(
                f"alias {alias!r} is shared by {owners[alias]} and {m.path}"
            )
        owners[alias] = m.path
        result[m.path] = alias
    return result


def _clean_name(meta: ActMeta) -> str | None:
    short = re.sub(r"\s*\([^)]*\)", "", meta.short or "").strip()
    if short and not re.search(r"\bnr\.\s*\d", short):
        return short
    code = re.sub(r"\s+al\s+Rom[aâ]niei$", "", (meta.code or "").strip(), flags=re.I)
    return code[:1].upper() + code[1:].lower() if code else None


def short_names_for(metas: list[ActMeta]) -> dict[str, str]:
    clean = {m.path: _clean_name(m) for m in metas if _is_code(m)}
    counts: dict[str, int] = {}
    for name in clean.values():
        if name:
            counts[name] = counts.get(name, 0) + 1
    result: dict[str, str] = {}
    for m in metas:
        name = clean.get(m.path)
        if not name:
            continue
        if counts[name] > 1 and m.status != IN_FORCE:
            name = f"{name} din {m.year}"
        result[m.path] = name
    return result


def old_folder_for(meta: ActMeta, paths_json: dict) -> str | None:
    if meta.slug != meta.path and paths_json.get("paths", {}).get(meta.slug) == meta.path:
        return meta.slug
    return None


def select_acts(
    acts_json: dict, paths_json: dict, selection: Literal["codes", "primary", "consolidated"]
) -> list[ActMeta]:
    metas = []
    for r in acts_json["acts"]:
        if r.get("withdrawn_by") is not None:
            continue
        if selection == "codes":
            wanted = bool(r.get("code")) or r["kind"] == "constitutie"
        elif selection == "consolidated":
            wanted = (
                bool(r.get("code"))
                or r["kind"] == "constitutie"
                or (r["status"] == IN_FORCE and r["kind"] in CONSOLIDATED_KINDS)
            )
        elif selection == "primary":
            wanted = r["kind"] in PRIMARY_KINDS
        else:
            raise ValueError(f"unknown selection: {selection!r}")
        if not wanted:
            continue
        metas.append(ActMeta(
            path=r["path"], slug=r["slug"], kind=r["kind"], year=int(r["year"]),
            number=str(r["number"]), title=r["title"], code=r.get("code"),
            short=r.get("short"), alias=None, status=r["status"],
            portal=r["portal"], versions=int(r["versions"]),
            from_=date.fromisoformat(r["from"]),
            latest=date.fromisoformat(r["latest"]),
        ))
    metas.sort(key=lambda m: (m.kind != "constitutie", m.path))
    aliases = aliases_for(metas)
    shorts = short_names_for(metas)
    return [
        replace(m, alias=aliases.get(m.path), short=shorts.get(m.path, m.short))
        for m in metas
    ]
