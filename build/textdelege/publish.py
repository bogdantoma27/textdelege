import gzip
import hashlib
import json
import sys
from collections.abc import Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, fields
from pathlib import Path

from .d1 import SCHEMA_PATH, SCHEMA_VERSION, D1Client, render_statement
from .r2 import R2Client

MAX_WORKERS = 16
STATEMENT_LIMIT = 100_000
CONTENT_TYPE = "application/json; charset=utf-8"
MANIFEST_KEY = "manifest.json"
SNAPSHOT_KEY = "snapshot.json"
CHECKPOINT_UNITS = 2000
LEGACY_PREFIX = "b/"

UNIT_COLUMNS = {
    "acts": ("path",),
    "articles": ("act_path", "file"),
    "versions": ("act_path", "file", "idx"),
    "laws": ("key",),
    "events": ("act_path", "file"),
    "rulings": ("key",),
    "ruling_subjects": ("ruling_key",),
    "articles_fts": ("act_path", "file"),
}
INTEGER_COLUMNS = {"idx"}
MULTI_ROW_TABLES = ("events", "ruling_subjects")


class PublishError(Exception):
    pass


@dataclass
class IndexRows:
    acts: list[dict] = field(default_factory=list)
    articles: list[dict] = field(default_factory=list)
    versions: list[dict] = field(default_factory=list)
    laws: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    rulings: list[dict] = field(default_factory=list)
    ruling_subjects: list[dict] = field(default_factory=list)
    articles_fts: list[dict] = field(default_factory=list)


TABLES = tuple(f.name for f in fields(IndexRows))


def schema_statements() -> list[str]:
    text = SCHEMA_PATH.read_text(encoding="utf-8")
    statements = []
    for part in text.split(";"):
        lines = [line for line in part.splitlines() if not line.startswith("--")]
        if "".join(lines).strip():
            statements.append("\n".join(lines).strip())
    return statements


def _subject(table: str, row: dict) -> str:
    act = row.get("act_path") or row.get("path") or row.get("ruling_key") or ""
    name = row.get("file") or row.get("key") or ""
    return f"{table} row of {act} {name}".strip()


def _checked(rendered: str, subject: str) -> str:
    size = len(rendered.encode("utf-8"))
    if size > STATEMENT_LIMIT:
        raise PublishError(f"SQL statement for {subject} is {size} bytes, over the limit of {STATEMENT_LIMIT}")
    return rendered


def fts_rowid(key: str) -> int:
    return int.from_bytes(hashlib.sha256(key.encode("utf-8")).digest()[:8], "big") >> 1


def _insert(table: str, row: dict) -> str:
    columns, values = list(row), [row[column] for column in row]
    if table == "articles_fts":
        columns.insert(0, "rowid")
        values.insert(0, fts_rowid(f"{row['act_path']}|{row['file']}"))
    verb = "INSERT" if table in MULTI_ROW_TABLES else "INSERT OR REPLACE"
    sql = f"{verb} INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})"
    return _checked(render_statement(sql, values), _subject(table, row))


def _delete(table: str, key: str) -> str:
    if table == "articles_fts":
        return _checked(render_statement(f"DELETE FROM {table} WHERE rowid = ?", [fts_rowid(key)]), f"{table} unit {key}")
    columns = UNIT_COLUMNS[table]
    values = [int(part) if column in INTEGER_COLUMNS else part for column, part in zip(columns, key.split("|"))]
    sql = f"DELETE FROM {table} WHERE " + " AND ".join(f"{column} = ?" for column in columns)
    return _checked(render_statement(sql, values), f"{table} unit {key}")


def index_statements(rows: IndexRows) -> Iterator[str]:
    for statement in schema_statements():
        yield render_statement(statement, [])
    for table in TABLES:
        for row in getattr(rows, table):
            yield _insert(table, row)


def write_index_sql(path: Path, rows: IndexRows) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for statement in index_statements(rows):
            handle.write(statement + ";\n")


def encode(obj: dict) -> bytes:
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return gzip.compress(text.encode("utf-8"), mtime=0)


def digest(value) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _upload(r2: R2Client, key: str, obj: dict) -> None:
    r2.put(key, encode(obj), CONTENT_TYPE, "gzip")


def _warn(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)


def _read_json(r2: R2Client, key: str):
    body = r2.get(key)
    if body is None:
        return None
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return json.loads(body)


def empty_snapshot() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "build": None,
        "objects": {},
        "rows": {table: {} for table in TABLES},
    }


def read_snapshot(r2: R2Client) -> dict | None:
    try:
        snapshot = _read_json(r2, SNAPSHOT_KEY)
        if (
            not isinstance(snapshot, dict)
            or snapshot.get("schema_version") != SCHEMA_VERSION
            or not isinstance(snapshot.get("objects"), dict)
            or not isinstance(snapshot.get("rows"), dict)
        ):
            return None
        snapshot["rows"] = {table: dict(snapshot["rows"].get(table) or {}) for table in TABLES}
        snapshot.setdefault("build", None)
        return snapshot
    except Exception:
        return None


def units_of(rows: IndexRows) -> dict[str, dict[str, list[dict]]]:
    units: dict[str, dict[str, list[dict]]] = {}
    for table in TABLES:
        columns = UNIT_COLUMNS[table]
        grouped: dict[str, list[dict]] = {}
        for row in getattr(rows, table):
            grouped.setdefault("|".join(str(row[column]) for column in columns), []).append(row)
        units[table] = grouped
    return units


def _upload_all(r2: R2Client, objects: list[tuple[str, dict]]) -> None:
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(_upload, r2, key, obj) for key, obj in objects]
        try:
            for future in as_completed(futures):
                future.result()
        except BaseException:
            for future in futures:
                future.cancel()
            raise


def _manifest_is_current(r2: R2Client, manifest: dict) -> bool:
    try:
        live = _read_json(r2, MANIFEST_KEY)
    except Exception:
        return False
    if not isinstance(live, dict):
        return False
    ignored = ("build", "generated")
    return {k: v for k, v in live.items() if k not in ignored} == {
        k: v for k, v in manifest.items() if k not in ignored
    }


def publish(
    objects: Iterable[tuple[str, dict]],
    rows: IndexRows,
    manifest: dict,
    state: dict[str, str],
    r2: R2Client,
    d1: D1Client,
) -> str:
    previous = read_snapshot(r2)
    full = previous is None
    snapshot = empty_snapshot() if full else previous

    new_objects = dict(objects)
    object_hashes = {key: digest(obj) for key, obj in new_objects.items()}
    to_put = [key for key in sorted(object_hashes) if snapshot["objects"].get(key) != object_hashes[key]]
    to_delete = sorted(set(snapshot["objects"]) - set(object_hashes))

    units = units_of(rows)
    unit_hashes = {table: {key: digest(items) for key, items in units[table].items()} for table in TABLES}
    rewrite = {
        table: [key for key in sorted(unit_hashes[table]) if snapshot["rows"][table].get(key) != unit_hashes[table][key]]
        for table in TABLES
    }
    remove = {table: sorted(set(snapshot["rows"][table]) - set(unit_hashes[table])) for table in TABLES}

    changed = (
        snapshot["build"] is None
        or bool(to_put or to_delete)
        or any(rewrite[table] or remove[table] for table in TABLES)
    )
    live_build = manifest["build"] if changed else snapshot["build"]

    def rewritten(table: str, key: str) -> list[str]:
        inserts = [_insert(table, row) for row in units[table][key]]
        return [_delete(table, key), *inserts] if table in MULTI_ROW_TABLES else inserts

    statements: dict[str, dict[str, list[str]]] = {
        table: {
            **{key: [_delete(table, key)] for key in remove[table]},
            **{key: rewritten(table, key) for key in rewrite[table]},
        }
        for table in TABLES
    }

    def save() -> None:
        _upload(r2, SNAPSHOT_KEY, snapshot)

    schema = [render_statement(statement, []) for statement in schema_statements()]
    if full:
        d1.execute_batch([f"DROP TABLE IF EXISTS {table}" for table in TABLES] + schema)
        save()
    else:
        d1.execute_batch(schema)

    if to_put:
        _upload_all(r2, [(key, new_objects[key]) for key in to_put])
    if to_put or to_delete:
        snapshot["objects"] = object_hashes
        save()

    applied = 0
    for table in TABLES:
        pending: list[str] = []
        done: list[tuple[str, str | None]] = []

        def flush() -> None:
            d1.execute_batch(pending)
            for key, value in done:
                if value is None:
                    snapshot["rows"][table].pop(key, None)
                else:
                    snapshot["rows"][table][key] = value
            save()
            pending.clear()
            done.clear()

        for key in sorted(statements[table]):
            pending.extend(statements[table][key])
            done.append((key, unit_hashes[table].get(key)))
            applied += 1
            if applied % CHECKPOINT_UNITS == 0:
                flush()
        if done:
            flush()

    if live_build != snapshot["build"] or not _manifest_is_current(r2, manifest):
        _upload(r2, MANIFEST_KEY, {**manifest, "build": live_build})
    if live_build != snapshot["build"]:
        snapshot["build"] = live_build
        save()

    state["build"] = live_build
    keys = list(state)
    d1.query(
        "INSERT INTO meta (key, value) VALUES "
        + ", ".join("(?, ?)" for _ in keys)
        + " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [item for key in keys for item in (key, state[key])],
    )
    _clean_up(r2, to_delete)
    return live_build


def _clean_up(r2: R2Client, gone: list[str]) -> None:
    for key in gone:
        try:
            r2.delete(key)
        except Exception as error:
            _warn(f"could not delete {key}: {error}")
    try:
        if r2.list(LEGACY_PREFIX):
            r2.delete_prefix(LEGACY_PREFIX)
    except Exception as error:
        _warn(f"could not delete {LEGACY_PREFIX}: {error}")
