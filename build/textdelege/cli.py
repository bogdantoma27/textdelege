import argparse
import csv
import difflib
import hashlib
import io
import json
import os
import sys
import time
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from . import extractcache
from .acts import ActMeta, old_folder_for, select_acts
from .config import Config, load_config
from .d1 import SCHEMA_VERSION, D1Client, D1Error, D1QuotaExceeded
from .events import events_for
from .extract import Article, extract_core, finalize_act, version_on
from .freshness import INDEX, load_freshness, load_freshness_summary, shard_files
from .gitrepo import GitError, GitRepo, remove_tree
from .laws import changes_feed, laws_from, parse_laws_csv, upcoming
from .objects import (
    act_object,
    article_object,
    changes_object,
    law_object,
    manifest_object,
    object_key,
    ruling_object,
)
from .publish import MANIFEST_KEY, IndexRows, publish, write_index_sql
from .r2 import R2Client
from .rulings import (
    Ruling,
    decision_ids,
    load_rulings,
    rulings_by_article,
)
from .verify import Mismatch, Sample, sample, verify

PACKAGE = Path(__file__).resolve().parent
DEFAULT_CONFIG = PACKAGE.parent / "config.toml"
READER = "tools/on.py"
DATA_FILES = (
    "data/rulings-by-provision.json",
    "data/decisions.csv",
    "data/laws.csv",
    "data/credits.csv",
    "data/status.json",
    "data/freshness.json",
    "data/freshness/index.json",
)
REPO_DIR = "romania-law"
FEED_LIMIT = 100
NEWEST_WORKERS = 8
STATE_KEYS = (
    "source_head", "fingerprint", "build", "today", "selection", "source_url", "schema_version"
)
NOOP_KEYS = ("source_head", "fingerprint", "today", "selection", "source_url")
REWRITTEN = "history rewritten: full rebuild"
NO_CHANGES = "no changes"
QUOTA_NOTE = "D1 daily write limit reached; the next run continues from the checkpoint"
RECLONED_URL = "source URL changed: fresh clone"
RECLONED_BROKEN = "cached clone could not be fetched: fresh clone"
BUCHAREST = ZoneInfo("Europe/Bucharest")
DIFF_LINES = 40


class PipelineError(Exception):
    pass


@dataclass
class Extracted:
    metas: list[ActMeta]
    old_folders: dict[str, str | None]
    articles_by_act: dict[str, list[Article]]
    laws_csv: str
    rulings_by_provision: dict
    rulings: list[Ruling]
    history_blobs: int = 0
    head_blobs: int = 0
    fresh_acts: set[str] | None = None
    pending_cache: list[tuple[str, str, list]] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)


def fingerprint() -> str:
    digest = hashlib.sha256()
    files = sorted(PACKAGE.glob("*.py")) + [PACKAGE / "schema.sql"]
    for path in sorted(files, key=lambda p: p.name):
        digest.update(path.name.encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


def timing_line(fetch: float, extract: float, events: float, verify: float, publish: float) -> str:
    phases = (
        ("fetch", fetch), ("extract", extract), ("events", events),
        ("verify", verify), ("publish", publish),
    )
    return ", ".join(f"{name} {seconds:.1f} s" for name, seconds in phases)


def build_day(now: datetime) -> date:
    return now.astimezone(BUCHAREST).date()


def make_build_id(now: datetime, head: str) -> str:
    return f"{now.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{head[:7]}"


def read_state(config: Config, d1: D1Client | None) -> dict[str, str] | None:
    if d1 is None:
        path = config.cache_dir / "state.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    try:
        rows = d1.query(
            f"SELECT key, value FROM meta WHERE key IN ({', '.join('?' * len(STATE_KEYS))})",
            list(STATE_KEYS),
        )
    except D1Error as error:
        if "no such table" in str(error):
            return None
        raise
    return {row["key"]: row["value"] for row in rows} or None


def state_client(config: Config, d1) -> D1Client | None:
    if d1 is None and config.d1 is not None:
        d1 = D1Client(**asdict(config.d1))
    return d1


def clients(config: Config, r2, d1, dry_run: bool) -> tuple:
    if dry_run:
        return None, None
    if r2 is None:
        if config.r2 is None:
            raise PipelineError("R2 credentials are not configured (set the variables named in [r2])")
        r2 = R2Client(**asdict(config.r2))
    if d1 is None:
        if config.d1 is None:
            raise PipelineError("D1 credentials are not configured (set the variables named in [d1])")
        d1 = D1Client(**asdict(config.d1))
    return r2, d1


def open_source(config: Config, stored_head: str | None) -> tuple[GitRepo, bool, str | None]:
    dest = config.cache_dir / REPO_DIR
    existed = dest.exists()
    recloned = None
    if existed:
        repo = GitRepo(dest)
        try:
            if repo.remote_url() != config.source_url:
                recloned = RECLONED_URL
            else:
                repo.fetch()
        except GitError:
            recloned = RECLONED_BROKEN
        if recloned:
            remove_tree(dest)
            existed = False
            repo = GitRepo.clone(config.source_url, dest)
    else:
        repo = GitRepo.clone(config.source_url, dest)
    if stored_head is None:
        return repo, False, recloned
    try:
        descends = repo.is_ancestor(stored_head, repo.head())
    except GitError:
        descends = False
    if descends:
        return repo, False, recloned
    if existed:
        remove_tree(dest)
        repo = GitRepo.clone(config.source_url, dest)
    return repo, True, recloned


def _require(repo: GitRepo, head: str, path: str) -> str:
    text = repo.show_file(head, path)
    if text is None:
        raise PipelineError(f"{path} is missing from the source repository")
    return text


def extract_source(
    repo: GitRepo, config: Config, today: date, *, use_cache: bool = False
) -> Extracted:
    fetch_started = time.monotonic()
    head = repo.head()
    head_blobs = repo.prefetch_head(["data/acts.json", "data/paths.json"])
    acts_json = json.loads(_require(repo, head, "data/acts.json"))
    paths_json = json.loads(_require(repo, head, "data/paths.json"))
    metas = select_acts(acts_json, paths_json, config.selection)
    if not metas:
        raise PipelineError(f"no acts selected with selection = {config.selection!r}")
    old_folders = {meta.path: old_folder_for(meta, paths_json) for meta in metas}
    act_folders = []
    for meta in metas:
        act_folders.append(meta.path)
        if old_folders[meta.path]:
            act_folders.append(old_folders[meta.path])
    history_blobs = repo.prefetch_history(act_folders)
    head_blobs += repo.prefetch_head([*DATA_FILES, READER])
    freshness_index = repo.show_file(head, INDEX)
    shards = shard_files(json.loads(freshness_index), metas) if freshness_index else []

    raw = repo.show_file(head, "data/rulings-by-provision.json")
    rulings_by_provision = json.loads(raw) if raw else {"acts": {}}
    decisions_csv = repo.show_file(head, "data/decisions.csv") or ""
    selected = {meta.path for meta in metas}
    folders = {
        row["key"]: row["folder"]
        for row in csv.DictReader(io.StringIO(decisions_csv, newline=""))
    }
    decision_folders = [
        folders[key] for key in decision_ids(rulings_by_provision, selected) if key in folders
    ]
    head_blobs += repo.prefetch_head([*shards, *decision_folders])

    laws_csv = repo.show_file(head, "data/laws.csv") or ""
    labels = {key: row["label"] for key, row in parse_laws_csv(laws_csv).items()}
    credits = parse_credits(repo.show_file(head, "data/credits.csv") or "")
    fetch_seconds = time.monotonic() - fetch_started
    extract_started = time.monotonic()
    articles_by_act = {}
    fresh: set[str] = set()
    pending = []
    code = extractcache.code_hash()
    newest: dict[str, str | None] = {}
    if use_cache:
        with ThreadPoolExecutor(max_workers=NEWEST_WORKERS) as pool:
            for meta, sha in zip(metas, pool.map(
                lambda m: repo.newest_commit(
                    [m.path] + ([old_folders[m.path]] if old_folders[m.path] else [])
                ),
                metas,
            )):
                newest[meta.path] = sha
    for meta in metas:
        act_credits = {**credits.get(meta.slug, {}), **credits.get(meta.path, {})}
        cores = None
        if use_cache:
            key = extractcache.act_fingerprint(
                newest_commit=newest[meta.path],
                folders=[meta.path] + ([old_folders[meta.path]] if old_folders[meta.path] else []),
                credits=act_credits,
                law_labels=labels,
                code=code,
            )
            cores = extractcache.load(config.cache_dir, meta.path, key)
        if cores is None:
            cores = extract_core(
                repo, meta.path, old_folders[meta.path],
                credits=act_credits, law_labels=labels,
            )
            fresh.add(meta.path)
            if use_cache:
                pending.append((meta.path, key, cores))
        articles_by_act[meta.path] = finalize_act(cores, today)
    rulings, warnings = load_rulings(repo, selected, rulings_by_provision, decisions_csv)
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    return Extracted(
        metas, old_folders, articles_by_act, laws_csv, rulings_by_provision, rulings,
        history_blobs, head_blobs,
        fresh_acts=fresh if use_cache and len(fresh) < len(metas) else None,
        pending_cache=pending,
        timings={"fetch": fetch_seconds, "extract": time.monotonic() - extract_started},
    )


def parse_credits(text: str) -> dict[str, dict[tuple[str, str], str]]:
    result: dict[str, dict[tuple[str, str], str]] = {}
    for row in csv.DictReader(io.StringIO(text, newline="")):
        result.setdefault(row["act"], {})[(row["in_force"], row["provision"])] = row["law"]
    return result


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def build_outputs(
    repo: GitRepo, data: Extracted, build_id: str, now: datetime, today: date
) -> tuple[list[tuple[str, dict]], IndexRows, dict, dict[str, int]]:
    head = repo.head()
    articles_by_act = data.articles_by_act
    selected = {meta.path for meta in data.metas}
    laws = laws_from(data.laws_csv, articles_by_act)
    by_article = rulings_by_article(data.rulings_by_provision, selected)
    ruling_by_key = {ruling.key: ruling for ruling in data.rulings}
    freshness = load_freshness(repo, data.metas)

    def rulings_for(path: str, stem: str) -> list[Ruling]:
        return [ruling_by_key[k] for k in by_article.get((path, stem), []) if k in ruling_by_key]

    objects: list[tuple[str, dict]] = []
    rows = IndexRows()
    for meta in data.metas:
        articles = articles_by_act[meta.path]
        act_laws = [law for law in laws.values() if any(c.act_path == meta.path for c in law.changes)]
        status = (freshness.get(meta.path) or {}).get("status")
        objects.append((
            object_key("act", meta.path),
            act_object(meta, articles, act_laws, rulings_for(meta.path, ""), freshness.get(meta.path)),
        ))
        rows.acts.append({
            "path": meta.path, "alias": meta.alias, "slug": meta.slug,
            "kind": meta.kind, "title": meta.title, "short": meta.short, "status": meta.status,
            "freshness_status": status,
        })
        for position, article in enumerate(articles):
            stem = Path(article.file).stem
            events = events_for(article)
            prev = articles[position - 1] if position else None
            following = articles[position + 1] if position + 1 < len(articles) else None
            objects.append((
                object_key("article", meta.path, stem),
                article_object(meta, article, events, rulings_for(meta.path, stem), prev, following),
            ))
            _add_article_rows(rows, meta.path, stem, article, events, today)
        objects.append((
            object_key("changes-act", meta.path),
            changes_object(
                meta.path,
                changes_feed({meta.path: articles}, FEED_LIMIT, today),
                upcoming({meta.path: articles}, today),
            ),
        ))
    for law in laws.values():
        objects.append((object_key("law", law.key), law_object(law)))
        rows.laws.append({
            "key": law.key, "label": law.label, "kind": law.kind,
            "published": _iso(law.published),
        })
    for ruling in data.rulings:
        objects.append((object_key("ruling", ruling.key), ruling_object(ruling, by_article)))
        rows.rulings.append({
            "key": ruling.key, "label": ruling.label, "court": ruling.court,
            "date": _iso(ruling.date), "outcome": ruling.outcome,
        })
    for (path, stem), keys in sorted(by_article.items()):
        for key in keys:
            if stem and key in ruling_by_key:
                rows.ruling_subjects.append(
                    {"ruling_key": key, "act_path": path, "file": stem}
                )
    objects.append((
        object_key("changes-site"),
        changes_object(
            "site", changes_feed(articles_by_act, FEED_LIMIT, today), upcoming(articles_by_act, today)
        ),
    ))
    counts = {
        "acts": len(data.metas),
        "articles": sum(len(items) for items in articles_by_act.values()),
        "versions": sum(len(a.versions) for items in articles_by_act.values() for a in items),
        "laws": len(laws),
        "rulings": len(data.rulings),
    }
    stats = {
        path: {"articles": len(items), "versions": sum(len(a.versions) for a in items)}
        for path, items in articles_by_act.items()
    }
    status_text = repo.show_file(head, "data/status.json")
    manifest = manifest_object(
        build_id, head, now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), counts,
        data.metas, stats, freshness, load_freshness_summary(repo),
        json.loads(status_text) if status_text else {},
    )
    return objects, rows, manifest, counts


_SNIPPET_MARKERS = str.maketrans("", "", "\ue000\ue001")


def _searchable(value: str | None) -> str | None:
    return None if value is None else value.translate(_SNIPPET_MARKERS)


def _add_article_rows(
    rows: IndexRows, path: str, stem: str, article: Article, events, today: date
) -> None:
    versions = article.versions
    rows.articles.append({
        "act_path": path, "file": stem, "number": article.number,
        "title": article.title, "state": article.state, "versions": len(versions),
        "first_date": _iso(versions[0].from_) if versions else None,
        "last_change": _iso(max((e.date for e in events), default=None)),
    })
    for index, version in enumerate(versions):
        rows.versions.append({
            "act_path": path, "file": stem, "idx": index,
            "from_date": _iso(version.from_), "until_date": _iso(version.until),
            "law_key": version.law_key or None, "kind": version.kind,
        })
    for event in events:
        rows.events.append({
            "act_path": path, "file": stem, "date": _iso(event.date),
            "verb": event.verb, "law_key": event.law_key or None, "kind": event.kind,
        })
    current = (version_on(article, today) or versions[-1]) if versions else None
    rows.articles_fts.append({
        "act_path": path, "file": stem, "state": article.state,
        "number": _searchable(article.number), "title": _searchable(article.title),
        "text": _searchable(
            " ".join(" ".join(line.text.split()) for line in current.lines) if current else ""
        ),
    })


def write_step_summary(fields: list[tuple[str, object]], note: str | None) -> None:
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if target:
        table = ["| Field | Value |", "| --- | --- |"]
        table += [f"| {label} | {value} |" for label, value in fields]
        text = "\n".join(table) + "\n" + (f"\n{note}\n" if note else "")
        with open(target, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(text + "\n")


def report(fields: list[tuple[str, object]], note: str | None) -> None:
    lines = [f"{label}: {value}" for label, value in fields]
    if note:
        lines.append(note)
    print("\n".join(lines))
    write_step_summary(fields, note)


def print_mismatches(mismatches: list[Mismatch]) -> None:
    for item in mismatches:
        s = item.sample
        print(f"mismatch: {s.act_path} {s.file} {s.day.isoformat()} {item.reason}")
        diff = list(
            difflib.unified_diff(
                (item.ours or "").splitlines(),
                (item.oracle or "").splitlines(),
                "ours",
                "oracle",
                lineterm="",
            )
        )
        for line in diff[:DIFF_LINES]:
            print(f"  {line}")
        if len(diff) > DIFF_LINES:
            print(f"  ... {len(diff) - DIFF_LINES} more diff lines")


def run_checks(
    repo: GitRepo, data: Extracted, n: int, seed: int | None, today: date, oracle
) -> tuple[list[Sample], list[Mismatch], int]:
    seed = int(repo.head()[:8], 16) if seed is None else seed
    samples = sample(data.articles_by_act, n, seed, today, fresh=data.fresh_acts)
    mismatches = verify(
        repo, data.articles_by_act, samples, old_folders=data.old_folders, oracle=oracle
    )
    return samples, mismatches, seed


def cmd_build(args, *, today, now, oracle, r2, d1) -> int:
    started = time.monotonic()
    config = load_config(args.config)
    r2, d1 = clients(config, r2, d1, args.dry_run)
    config.cache_dir.mkdir(parents=True, exist_ok=True)
    state = read_state(config, d1)
    repo, rewritten, recloned = open_source(config, state["source_head"] if state else None)
    if rewritten or recloned:
        extractcache.wipe(config.cache_dir)
    open_seconds = time.monotonic() - started
    head = repo.head()
    new_state = {
        "source_head": head,
        "fingerprint": fingerprint(),
        "build": make_build_id(now, head),
        "today": today.isoformat(),
        "selection": config.selection,
        "source_url": config.source_url,
        "schema_version": str(SCHEMA_VERSION),
    }
    note = "; ".join(part for part in (REWRITTEN if rewritten else None, recloned) if part) or None
    unchanged = not rewritten and state and all(state.get(k) == new_state[k] for k in NOOP_KEYS)
    if unchanged and not (args.dry_run and not (config.cache_dir / "out").exists()):
        noop = "; ".join(part for part in (recloned, NO_CHANGES) if part)
        report([("Source head", head[:7]), ("Build", state.get("build", ""))], noop)
        return 0

    data = extract_source(repo, config, today, use_cache=True)
    verify_started = time.monotonic()
    samples, mismatches, _seed = run_checks(repo, data, args.sample, args.seed, today, oracle)
    verify_seconds = time.monotonic() - verify_started
    if not mismatches:
        for act_path, key, cores in data.pending_cache:
            extractcache.store(config.cache_dir, act_path, key, cores)
    build_id = new_state["build"]
    events_started = time.monotonic()
    objects, rows, manifest, counts = build_outputs(repo, data, build_id, now, today)
    events_seconds = time.monotonic() - events_started
    publish_started = time.monotonic()

    def finish(failed: bool, live_build: str = build_id, extra: str | None = None) -> None:
        fields = [
            ("Build", live_build), ("Source head", head[:7]), ("Acts", counts["acts"]),
            ("Articles", counts["articles"]), ("Versions", counts["versions"]),
            ("Laws", counts["laws"]), ("Rulings", counts["rulings"]),
            ("Prefetched", f"{data.history_blobs} history blobs, {data.head_blobs} head blobs"),
            ("Sample size", len(samples)), ("Mismatches", len(mismatches)),
            ("Timing", timing_line(
                data.timings["fetch"] + open_seconds, data.timings["extract"], events_seconds,
                verify_seconds, time.monotonic() - publish_started,
            )),
            ("Duration", f"{time.monotonic() - started:.1f} s"),
        ]
        extra = extra or (
            "verification failed: nothing published" if failed else ("dry run" if args.dry_run else None)
        )
        report(fields, "; ".join(part for part in (note, extra) if part) or None)

    if mismatches:
        print_mismatches(mismatches)
        finish(True)
        return 1

    if args.dry_run:
        write_dry_run(config.cache_dir, objects, rows, manifest, new_state)
    else:
        try:
            build_id = publish(objects, rows, manifest, new_state, r2, d1)
        except D1QuotaExceeded as error:
            print(f"error: {error}", file=sys.stderr)
            finish(True, state.get("build", "") if state else "", QUOTA_NOTE)
            return 1
    finish(False, build_id)
    return 0


def write_dry_run(cache_dir: Path, objects, rows: IndexRows, manifest: dict, state: dict) -> None:
    out = cache_dir / "out"
    (cache_dir / "state.json").unlink(missing_ok=True)
    if out.exists():
        remove_tree(out)
    out.mkdir(parents=True)
    for key, obj in [*objects, (MANIFEST_KEY, manifest)]:
        target = out / key
        target.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
        target.write_text(text, encoding="utf-8", newline="\n")
    write_index_sql(out / "index.sql", rows)
    (cache_dir / "state.json").write_text(
        json.dumps(state, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


def cmd_verify(args, *, today, oracle, d1, **_unused) -> int:
    config = load_config(args.config)
    config.cache_dir.mkdir(parents=True, exist_ok=True)
    state = read_state(config, state_client(config, d1))
    repo, rewritten, recloned = open_source(config, state.get("source_head") if state else None)
    for note in (recloned, REWRITTEN if rewritten else None):
        if note:
            print(note)
    data = extract_source(repo, config, today)
    samples, mismatches, seed = run_checks(repo, data, args.sample, args.seed, today, oracle)
    print_mismatches(mismatches)
    print(f"verified {len(samples)} samples (seed {seed}): {len(mismatches)} mismatches")
    return 1 if mismatches else 0


def cmd_status(args, *, r2, d1, **_unused) -> int:
    config = load_config(args.config)
    state = read_state(config, state_client(config, d1))
    if state is None:
        print("no build exists")
        return 0
    for key in STATE_KEYS:
        print(f"{key}: {state.get(key, '')}")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="textdelege")
    commands = root.add_subparsers(dest="command", required=True)
    for name, func in (("build", cmd_build), ("verify", cmd_verify), ("status", cmd_status)):
        sub = commands.add_parser(name)
        sub.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
        sub.set_defaults(func=func)
        if name != "status":
            sub.add_argument("--sample", type=int, default=200)
            sub.add_argument("--seed", type=int, default=None)
        if name == "build":
            sub.add_argument("--dry-run", action="store_true")
    return root


def main(
    argv: list[str] | None = None,
    *,
    today: date | None = None,
    now: datetime | None = None,
    oracle: Callable[[Sample], str | None] | None = None,
    r2=None,
    d1=None,
) -> int:
    try:
        args = parser().parse_args(argv)
    except SystemExit as exit_:
        return exit_.code if isinstance(exit_.code, int) else 2
    now = now or datetime.now(timezone.utc)
    today = today or build_day(now)
    try:
        return args.func(args, today=today, now=now, oracle=oracle, r2=r2, d1=d1)
    except Exception as error:
        if os.environ.get("TEXTDELEGE_DEBUG") == "1":
            traceback.print_exc()
        print(f"error: {error}", file=sys.stderr)
        message = " ".join(str(error).replace("|", "\\|").split())
        try:
            write_step_summary([("Error", message)], None)
        except OSError:
            pass
        return 2


if __name__ == "__main__":
    sys.exit(main())
