import contextlib
import gzip
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from build.textdelege import publish as publish_module
from build.textdelege.d1 import SCHEMA_VERSION, D1QuotaExceeded
from build.textdelege.publish import (
    SNAPSHOT_KEY,
    TABLES,
    IndexRows,
    PublishError,
    digest,
    fts_rowid,
    publish,
    read_snapshot,
    schema_statements,
    write_index_sql,
)

FIRST = "20261108T060000Z-abc1234"
SECOND = "20261109T060000Z-def5678"
THIRD = "20261110T060000Z-0123456"
ACT = "acts/x/act.json"


def state():
    return {"source_head": "a" * 40, "fingerprint": "f" * 64, "build": FIRST}


def art_key(n):
    return f"acts/x/art/art-{n:04d}.json"


def dataset(articles):
    objects = [(ACT, {"path": "x"})]
    rows = IndexRows(acts=[{
        "path": "x", "alias": "x", "slug": "x", "kind": "lege", "title": "T", "short": None,
        "status": "in-force", "freshness_status": None,
    }])
    for n, versions in articles.items():
        file = f"art-{n:04d}"
        objects.append((art_key(n), {"n": n, "versions": versions, "t": "șț"}))
        rows.articles.append({
            "act_path": "x", "file": file, "number": str(n), "title": None, "state": "in-force",
            "versions": len(versions), "first_date": None, "last_change": None,
        })
        for index, text in enumerate(versions):
            rows.versions.append({
                "act_path": "x", "file": file, "idx": index, "from_date": None,
                "until_date": None, "law_key": None, "kind": "amendment",
            })
            rows.events.append({
                "act_path": "x", "file": file, "date": None, "verb": "amended",
                "law_key": None, "kind": "amendment",
            })
        rows.articles_fts.append({
            "act_path": "x", "file": file, "state": "in-force", "number": str(n),
            "title": None, "text": versions[-1],
        })
    return objects, rows


def manifest(build, **extra):
    return {"schema": "m", "build": build, "generated": f"at-{build}", "counts": {"acts": 1}, **extra}


BASE = {1: ["one"], 2: ["two"], 3: ["three"], 4: ["four"], 5: ["five"]}


class FakeR2:
    def __init__(self, log, fail_on=None, listing=(), fail_delete=False):
        self.log, self.fail_on, self.listing, self.fail_delete = log, fail_on, list(listing), fail_delete
        self.store, self.snapshots = {}, []

    def get(self, key):
        self.log.append(("get", key))
        entry = self.store.get(key)
        return entry if entry is None or isinstance(entry, bytes) else entry[0]

    def list(self, prefix):
        self.log.append(("list", prefix))
        return [key for key in self.listing if key.startswith(prefix)]

    def put(self, key, body, content_type, content_encoding=None):
        if key == self.fail_on:
            raise OSError("upload refused")
        self.store[key] = (body, content_type, content_encoding)
        self.log.append(("put", key))
        if key == SNAPSHOT_KEY:
            self.snapshots.append(json.loads(gzip.decompress(body)))

    def delete(self, key):
        if self.fail_delete:
            raise OSError("delete refused")
        self.log.append(("delete", key))

    def delete_prefix(self, prefix):
        if self.fail_delete:
            raise OSError("delete refused")
        self.log.append(("delete_prefix", prefix))
        return 0

    def read(self, key):
        return json.loads(gzip.decompress(self.get(key)))


class FakeD1:
    def __init__(self, log, fail_when=None, error=RuntimeError("D1 down")):
        self.log, self.batches, self.queries = log, [], []
        self.fail_when, self.error = fail_when, error

    def execute_batch(self, statements):
        statements = list(statements)
        if self.fail_when and any(self.fail_when(s) for s in statements):
            raise self.error
        self.batches.append(statements)
        self.log.append(("execute", statements))

    def query(self, sql, params=None):
        self.queries.append((" ".join(sql.split()), params))
        self.log.append(("query", " ".join(sql.split())))
        return []

    def row_statements(self, start=0):
        return [
            s for batch in self.batches[start:] for s in batch
            if s.startswith(("INSERT", "DELETE FROM"))
        ]


class SqliteD1:
    def __init__(self):
        self.db = sqlite3.connect(":memory:", isolation_level=None)

    def execute_batch(self, statements):
        for statement in statements:
            self.db.execute(statement)

    def query(self, sql, params=None):
        cursor = self.db.execute(sql, params or [])
        names = [c[0] for c in cursor.description or []]
        return [dict(zip(names, row)) for row in cursor.fetchall()]

    def count(self, table):
        return self.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


class PublishTest(unittest.TestCase):
    def setUp(self):
        self.log = []
        self.r2 = FakeR2(self.log)
        self.d1 = FakeD1(self.log)

    def run_publish(self, articles=None, build=FIRST, r2=None, d1=None, **extra):
        objects, rows = dataset(BASE if articles is None else articles)
        self.state = state()
        result = publish(objects, rows, manifest(build, **extra), self.state, r2 or self.r2, d1 or self.d1)
        return result

    def puts(self, start=0):
        return [call[1] for call in self.log[start:] if call[0] == "put"]

    def test_full_mode_builds_next_tables_then_writes_an_empty_snapshot_before_rows(self):
        self.assertEqual(self.run_publish(), FIRST)
        first = self.d1.batches[0]
        drops = [s for s in first if s.startswith("DROP")]
        self.assertEqual(drops, [f"DROP TABLE IF EXISTS {t}_next" for t in TABLES])
        self.assertIn("CREATE TABLE IF NOT EXISTS meta", first[len(drops)])
        creates = first[len(drops) + 1:]
        tables = [s for s in creates if not s.startswith("CREATE INDEX")]
        self.assertEqual(len(tables), len(TABLES))
        self.assertTrue(all("_next" in s.splitlines()[0] for s in creates))
        self.assertEqual(
            [s for s in first if s.startswith("CREATE INDEX")],
            [
                "CREATE INDEX IF NOT EXISTS events_next_unit ON events_next (act_path, file)",
                "CREATE INDEX IF NOT EXISTS ruling_subjects_next_unit ON ruling_subjects_next (ruling_key)",
            ],
        )
        empty = self.r2.snapshots[0]
        self.assertEqual(
            empty,
            {"schema_version": SCHEMA_VERSION, "build": None, "objects": {},
             "rows": {t: {} for t in TABLES}},
        )
        order = [c[0] if c[0] != "put" else c[1] for c in self.log if c[0] in ("execute", "put")]
        self.assertEqual(order[:2], ["execute", SNAPSHOT_KEY])

    def test_full_mode_publish_order_and_final_snapshot(self):
        self.run_publish()
        calls = [c for c in self.log if c[0] in ("put", "execute", "query")]
        names = [c[1] if c[0] == "put" else c[0] for c in calls]
        self.assertLess(names.index(art_key(1)), names.index("manifest.json"))
        self.assertLess(names.index("manifest.json"), len(names) - names[::-1].index(SNAPSHOT_KEY) - 1)
        self.assertEqual(names[-1], "query")
        self.assertIn("INSERT INTO meta", calls[-1][1])
        self.assertEqual(
            self.d1.queries[-1][1],
            ["source_head", "a" * 40, "fingerprint", "f" * 64, "build", FIRST],
        )
        objects, rows = dataset(BASE)
        final = self.r2.snapshots[-1]
        self.assertEqual(final["build"], FIRST)
        self.assertEqual(final["schema_version"], SCHEMA_VERSION)
        self.assertEqual(final["objects"], {key: digest(obj) for key, obj in objects})
        self.assertEqual(final["rows"]["acts"], {"x": digest(rows.acts)})
        self.assertEqual(
            final["rows"]["events"]["x|art-0003"], digest([r for r in rows.events if r["file"] == "art-0003"])
        )
        self.assertEqual(set(final["rows"]), set(TABLES))
        self.assertEqual(len(final["rows"]["articles_fts"]), 5)
        self.assertEqual(self.state["build"], FIRST)
        self.assertEqual(self.r2.read("manifest.json")["build"], FIRST)

    def test_uploads_are_gzip_json_with_headers(self):
        self.run_publish()
        body, content_type, encoding = self.r2.store[art_key(3)]
        self.assertEqual(content_type, "application/json; charset=utf-8")
        self.assertEqual(encoding, "gzip")
        self.assertEqual(json.loads(gzip.decompress(body))["t"], "șț")
        self.assertEqual(self.r2.store[SNAPSHOT_KEY][2], "gzip")
        self.assertEqual(self.r2.store["manifest.json"][2], "gzip")

    def test_incremental_mode_writes_only_the_changed_article(self):
        self.run_publish()
        batches, puts = len(self.d1.batches), len(self.log)
        changed = {**BASE, 2: ["two", "two again"]}
        self.assertEqual(self.run_publish(changed, SECOND), SECOND)
        self.assertEqual(
            [p for p in self.puts(puts) if p not in (SNAPSHOT_KEY, "manifest.json")], [art_key(2)]
        )
        self.assertFalse(any(s.startswith("DROP") for b in self.d1.batches[batches:] for s in b))
        statements = self.d1.row_statements(batches)
        self.assertEqual(len(statements), 6)
        expected = [
            ("INSERT OR REPLACE INTO articles ", "'art-0002'"),
            ("INSERT OR REPLACE INTO versions ", "'art-0002'"),
            ("DELETE FROM events WHERE act_path = 'x' AND file = 'art-0002'", None),
            ("INSERT INTO events ", "'art-0002'"),
            ("INSERT INTO events ", "'art-0002'"),
            ("INSERT OR REPLACE INTO articles_fts (rowid, act_path, file, state, number, title, text) VALUES (%d, "
             % fts_rowid("x|art-0002"), "two again"),
        ]
        for statement, (start, contains) in zip(statements, expected):
            self.assertTrue(statement.startswith(start), statement)
            if contains:
                self.assertIn(contains, statement)
        self.assertIn(("put", "manifest.json"), self.log[puts:])
        self.assertEqual(self.r2.read("manifest.json")["build"], SECOND)
        self.assertEqual(self.r2.snapshots[-1]["build"], SECOND)

    def test_removed_units_and_objects_are_deleted(self):
        self.run_publish()
        batches = len(self.d1.batches)
        self.log.clear()
        smaller = {n: v for n, v in BASE.items() if n != 3}
        self.assertEqual(self.run_publish(smaller, SECOND), SECOND)
        statements = self.d1.row_statements(batches)
        self.assertEqual(
            statements,
            [
                "DELETE FROM articles WHERE act_path = 'x' AND file = 'art-0003'",
                "DELETE FROM versions WHERE act_path = 'x' AND file = 'art-0003' AND idx = 0",
                "DELETE FROM events WHERE act_path = 'x' AND file = 'art-0003'",
                f"DELETE FROM articles_fts WHERE rowid = {fts_rowid('x|art-0003')}",
            ],
        )
        self.assertIn(("delete", art_key(3)), self.log)
        final = self.r2.snapshots[-1]
        self.assertNotIn(art_key(3), final["objects"])
        self.assertNotIn("x|art-0003", final["rows"]["articles"])
        self.assertEqual(len(final["rows"]["versions"]), 4)

    def test_nothing_changed_writes_nothing_but_meta(self):
        self.run_publish()
        batches = len(self.d1.batches)
        self.log.clear()
        self.assertEqual(self.run_publish(build=SECOND, generated="later"), FIRST)
        self.assertEqual(self.puts(), [])
        self.assertEqual(self.d1.row_statements(batches), [])
        self.assertEqual(self.r2.read("manifest.json")["build"], FIRST)
        self.assertEqual(self.state["build"], FIRST)
        self.assertEqual(self.d1.queries[-1][1][-2:], ["build", FIRST])
        self.assertIn("INSERT INTO meta", self.d1.queries[-1][0])
        self.assertNotIn("delete_prefix", [c[0] for c in self.log])

    def test_changed_manifest_with_unchanged_data_keeps_the_old_build(self):
        self.run_publish()
        self.log.clear()
        batches = len(self.d1.batches)
        self.assertEqual(self.run_publish(build=SECOND, counts={"acts": 2}), FIRST)
        self.assertEqual(self.puts(), ["manifest.json"])
        self.assertEqual(self.r2.read("manifest.json")["build"], FIRST)
        self.assertEqual(self.r2.read("manifest.json")["counts"], {"acts": 2})
        self.assertEqual(self.d1.row_statements(batches), [])

    def test_snapshot_without_build_counts_the_data_as_changed(self):
        self.run_publish()
        pending = self.r2.read(SNAPSHOT_KEY)
        pending["build"] = None
        self.r2.store[SNAPSHOT_KEY] = (gzip.compress(json.dumps(pending).encode()), "", "gzip")
        self.log.clear()
        batches = len(self.d1.batches)
        self.assertEqual(self.run_publish(build=SECOND), SECOND)
        self.assertEqual(self.d1.row_statements(batches), [])
        self.assertIn("manifest.json", self.puts())
        self.assertEqual(self.r2.read("manifest.json")["build"], SECOND)
        self.assertEqual(self.r2.read(SNAPSHOT_KEY)["build"], SECOND)

    def test_unreadable_or_foreign_snapshots_start_a_full_load(self):
        for body in (b"not json", gzip.compress(b"[]"), gzip.compress(
            json.dumps({"schema_version": SCHEMA_VERSION + 1, "build": FIRST, "objects": {}, "rows": {}}).encode()
        )):
            with self.subTest(body=body[:8]):
                log = []
                r2, d1 = FakeR2(log), FakeD1(log)
                r2.store[SNAPSHOT_KEY] = body
                self.run_publish(r2=r2, d1=d1)
                self.assertTrue(d1.batches[0][0].startswith("DROP TABLE IF EXISTS acts"))

    def test_a_failed_snapshot_read_stops_the_publish_instead_of_a_full_load(self):
        log = []
        r2, d1 = FakeR2(log), FakeD1(log)
        with mock.patch.object(r2, "get", side_effect=OSError("connection reset")):
            with self.assertRaises(OSError):
                self.run_publish(r2=r2, d1=d1)
        self.assertEqual(d1.batches, [])
        self.assertEqual(r2.store, {})

    def test_read_snapshot_returns_none_only_for_a_missing_or_unusable_object(self):
        r2 = FakeR2([])
        self.assertIsNone(read_snapshot(r2))
        r2.store[SNAPSHOT_KEY] = b"\x1f\x8bnot gzip"
        self.assertIsNone(read_snapshot(r2))
        r2.store[SNAPSHOT_KEY] = json.dumps(
            {"schema_version": SCHEMA_VERSION, "objects": {}, "rows": {"acts": 3}}
        ).encode()
        self.assertIsNone(read_snapshot(r2))
        r2.store[SNAPSHOT_KEY] = json.dumps(
            {"schema_version": SCHEMA_VERSION, "objects": {}, "rows": {}}
        ).encode()
        self.assertEqual(read_snapshot(r2)["rows"], {table: {} for table in TABLES})
        with mock.patch.object(r2, "get", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                read_snapshot(r2)

    def test_plain_json_snapshot_is_read_too(self):
        self.run_publish()
        self.r2.store[SNAPSHOT_KEY] = json.dumps(self.r2.read(SNAPSHOT_KEY)).encode()
        batches = len(self.d1.batches)
        self.run_publish(build=SECOND)
        self.assertFalse(any(s.startswith("DROP") for b in self.d1.batches[batches:] for s in b))

    def test_checkpoints_every_n_units_and_at_table_ends(self):
        with mock.patch.object(publish_module, "CHECKPOINT_UNITS", 3):
            self.run_publish()
        counts = [{t: len(s["rows"][t]) for t in TABLES} for s in self.r2.snapshots]
        self.assertEqual(self.r2.snapshots[0]["rows"]["acts"], {})
        self.assertEqual(counts[1]["acts"], 0)
        seen = [(c["acts"], c["articles"]) for c in counts]
        for expected in ((1, 0), (1, 2), (1, 5)):
            self.assertIn(expected, seen)
        self.assertEqual([c for c in seen if c[1] == 2], [(1, 2)])
        totals = [sum(c.values()) for c in counts]
        self.assertEqual(totals, sorted(totals))
        self.assertEqual(totals[-1], 21)
        self.assertEqual(self.r2.snapshots[-1]["build"], FIRST)
        self.assertEqual(sum(1 for s in self.r2.snapshots if s["build"] is None), len(self.r2.snapshots) - 1)

    def test_failure_mid_table_resumes_from_the_checkpoint(self):
        failing = FakeD1(self.log, fail_when=lambda s: s.startswith("INSERT INTO events"))
        with mock.patch.object(publish_module, "CHECKPOINT_UNITS", 3), self.assertRaises(RuntimeError):
            self.run_publish(d1=failing)
        saved = self.r2.read(SNAPSHOT_KEY)
        self.assertIsNone(saved["build"])
        self.assertEqual([len(saved["rows"][t]) for t in ("acts", "articles", "versions")], [1, 5, 5])
        self.assertEqual(saved["rows"]["events"], {})
        self.assertEqual(saved["rows"]["articles_fts"], {})
        self.assertNotIn("manifest.json", self.r2.store)
        self.assertFalse(any("INSERT INTO meta" in q[0] for q in failing.queries))

        healthy = FakeD1(self.log)
        self.log.clear()
        self.assertEqual(self.run_publish(build=SECOND, d1=healthy), SECOND)
        statements = healthy.row_statements()
        self.assertFalse(any(" acts" in s or "articles " in s or "versions" in s for s in statements))
        self.assertEqual(len([s for s in statements if s.startswith("INSERT INTO events")]), 5)
        self.assertEqual(len([s for s in statements if s.startswith("INSERT OR REPLACE INTO articles_fts")]), 5)
        self.assertFalse(any(s.startswith("DROP") and s.endswith("_next") for b in healthy.batches for s in b))
        self.assertEqual([p for p in self.puts() if p.startswith("acts/")], [])
        self.assertEqual(self.r2.read(SNAPSHOT_KEY)["build"], SECOND)
        self.assertEqual(self.r2.read("manifest.json")["build"], SECOND)

    def test_interrupted_full_publish_leaves_the_live_tables_intact_and_resumes_into_next(self):
        d1, r2 = SqliteD1(), FakeR2([])
        objects, rows = dataset(BASE)
        publish(objects, rows, manifest(FIRST), state(), r2, d1)
        r2.store.pop(SNAPSHOT_KEY)
        newer = {**BASE, 6: ["six"]}
        objects, rows = dataset(newer)

        class Interrupting(SqliteD1):
            def __init__(self, db):
                self.db = db

            def execute_batch(self, statements):
                if any(s.startswith("INSERT OR REPLACE INTO articles_fts_next") for s in statements):
                    raise RuntimeError("D1 down")
                super().execute_batch(statements)

        with mock.patch.object(publish_module, "CHECKPOINT_UNITS", 2), self.assertRaises(RuntimeError):
            publish(objects, rows, manifest(SECOND), state(), r2, Interrupting(d1.db))
        self.assertEqual([d1.count(t) for t in ("acts", "articles", "versions", "events", "articles_fts")],
                         [1, 5, 5, 5, 5])
        self.assertEqual(d1.count("articles_next"), 6)
        self.assertEqual(d1.count("articles_fts_next"), 0)
        self.assertIsNone(r2.read(SNAPSHOT_KEY)["build"])

        publish(objects, rows, manifest(SECOND), state(), r2, d1)
        self.assertEqual([d1.count(t) for t in ("acts", "articles", "versions", "events", "articles_fts")],
                         [1, 6, 6, 6, 6])
        tables = {row["name"] for row in d1.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertFalse(any(name.endswith("_next") for name in tables))
        indexes = {row["name"] for row in d1.query("SELECT name FROM sqlite_master WHERE type = 'index'")}
        self.assertIn("events_by_date", indexes)
        self.assertFalse(any(name.endswith("_next_unit") for name in indexes))
        self.assertEqual(
            d1.query("SELECT file FROM articles_fts WHERE articles_fts MATCH 'six'"), [{"file": "art-0006"}]
        )
        self.assertEqual(r2.read(SNAPSHOT_KEY)["build"], SECOND)
        self.assertNotIn("swapped", r2.read(SNAPSHOT_KEY))

    def test_a_crash_right_after_the_swap_keeps_the_swapped_tables(self):
        d1, r2 = SqliteD1(), FakeR2([])
        objects, rows = dataset(BASE)
        publish(objects, rows, manifest(FIRST), state(), r2, d1)
        r2.store.pop(SNAPSHOT_KEY)
        newer = {**BASE, 6: ["six"]}
        objects, rows = dataset(newer)

        class CrashAfterSwap(SqliteD1):
            def __init__(self, db):
                self.db = db

            def execute_batch(self, statements):
                super().execute_batch(statements)
                if any(s.startswith("ALTER TABLE") for s in statements):
                    raise RuntimeError("runner killed")

        with self.assertRaises(RuntimeError):
            publish(objects, rows, manifest(SECOND), state(), r2, CrashAfterSwap(d1.db))
        self.assertEqual(d1.count("articles"), 6)
        self.assertTrue(r2.read(SNAPSHOT_KEY)["swapping"])

        publish(objects, rows, manifest(SECOND), state(), r2, d1)
        self.assertEqual([d1.count(t) for t in ("acts", "articles", "versions", "events", "articles_fts")],
                         [1, 6, 6, 6, 6])
        self.assertEqual(r2.read(SNAPSHOT_KEY)["build"], SECOND)
        self.assertNotIn("swapping", r2.read(SNAPSHOT_KEY))

    def test_a_second_full_publish_after_a_swap_keeps_working(self):
        d1, r2 = SqliteD1(), FakeR2([])
        objects, rows = dataset(BASE)
        publish(objects, rows, manifest(FIRST), state(), r2, d1)
        r2.store.pop(SNAPSHOT_KEY)
        publish(objects, rows, manifest(SECOND), state(), r2, d1)
        self.assertEqual([d1.count(t) for t in ("acts", "articles", "articles_fts")], [1, 5, 5])

    def test_quota_error_propagates_and_keeps_the_checkpoint(self):
        quota = D1QuotaExceeded("D1 query failed: daily write limit exceeded")
        failing = FakeD1(self.log, fail_when=lambda s: s.startswith("INSERT OR REPLACE INTO articles_fts"), error=quota)
        with self.assertRaises(D1QuotaExceeded):
            self.run_publish(d1=failing)
        self.assertEqual(len(failing.batches), 5)
        self.assertNotIn("manifest.json", self.r2.store)
        self.assertEqual(len(self.r2.read(SNAPSHOT_KEY)["rows"]["events"]), 5)

    def test_object_upload_failure_stops_before_rows_and_manifest(self):
        r2 = FakeR2(self.log, fail_on=art_key(2))
        with self.assertRaises(OSError):
            self.run_publish(r2=r2)
        self.assertEqual(self.d1.row_statements(), [])
        self.assertNotIn("manifest.json", r2.store)
        self.assertEqual(self.d1.queries, [])

    def test_legacy_prefix_is_deleted_only_when_something_is_there(self):
        self.run_publish()
        self.assertIn(("list", "b/"), self.log)
        self.assertNotIn(("delete_prefix", "b/"), self.log)
        log = []
        r2 = FakeR2(log, listing=[f"b/{FIRST}/acts/x/act.json"])
        self.run_publish(r2=r2, d1=FakeD1(log))
        self.assertIn(("delete_prefix", "b/"), log)

    def test_cleanup_failure_is_a_warning(self):
        self.run_publish()
        r2 = FakeR2(self.log, fail_delete=True, listing=["b/old/x.json"])
        r2.store = self.r2.store
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.run_publish({n: v for n, v in BASE.items() if n != 2}, SECOND, r2=r2)
        self.assertIn("warning:", err.getvalue())
        self.assertEqual(self.d1.queries[-1][1][-2:], ["build", SECOND])

    def test_statement_over_limit_raises_before_anything_is_written(self):
        big = {**BASE, 6: ["x" * 100_001]}
        with self.assertRaises(PublishError) as caught:
            self.run_publish(big)
        self.assertIn("art-0006", str(caught.exception))
        self.assertEqual([c for c in self.log if c[0] != "get"], [])

    def test_write_index_sql_lists_every_insert_without_drops(self):
        _, rows = dataset(BASE)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "index.sql"
            write_index_sql(path, rows)
            text = path.read_bytes().decode("utf-8")
        self.assertNotIn("DROP", text)
        self.assertNotIn("DELETE", text)
        self.assertNotIn("\r", text)
        self.assertEqual(text.count("INSERT OR REPLACE INTO articles_fts (rowid,"), 5)
        self.assertTrue(text.startswith("CREATE TABLE IF NOT EXISTS meta"))

    def test_write_index_sql_refuses_oversize_statements(self):
        _, big = dataset({1: ["x" * 100_001]})
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(PublishError) as caught:
            write_index_sql(Path(tmp) / "index.sql", big)
        self.assertIn("art-0001", str(caught.exception))


class SqliteTest(unittest.TestCase):
    def test_schema_statements_run_in_sqlite(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        for statement in schema_statements() + schema_statements():
            self.assertNotIn(";", statement)
            db.execute(statement)
        columns = [row[1] for row in db.execute("PRAGMA table_info(articles)")]
        self.assertNotIn("build_id", columns)

    def sqlite(self):
        d1 = SqliteD1()
        self.addCleanup(d1.db.close)
        return d1

    def publish(self, d1, r2, articles, build):
        objects, rows = dataset(articles)
        return publish(objects, rows, manifest(build), state(), r2, d1)

    def test_load_update_and_removal_in_sqlite(self):
        d1, r2 = self.sqlite(), FakeR2([])
        self.publish(d1, r2, BASE, FIRST)
        self.assertEqual([d1.count(t) for t in ("acts", "articles", "versions", "events", "articles_fts")],
                         [1, 5, 5, 5, 5])
        self.publish(d1, r2, {**BASE, 2: ["two", "two again"]}, SECOND)
        self.assertEqual([d1.count(t) for t in ("acts", "articles", "versions", "events", "articles_fts")],
                         [1, 5, 6, 6, 5])
        self.assertEqual(
            d1.query("SELECT file FROM articles_fts WHERE articles_fts MATCH 'again'"), [{"file": "art-0002"}]
        )
        self.assertEqual(d1.query("SELECT versions FROM articles WHERE file = 'art-0002'"), [{"versions": 2}])
        self.publish(d1, r2, {1: BASE[1]}, THIRD)
        self.assertEqual([d1.count(t) for t in ("articles", "versions", "events", "articles_fts")], [1, 1, 1, 1])
        meta = {row["key"]: row["value"] for row in d1.query("SELECT key, value FROM meta")}
        self.assertEqual(meta["build"], THIRD)

    def test_fts_insert_or_replace_by_rowid_replaces_the_row(self):
        d1 = self.sqlite()
        for statement in schema_statements():
            d1.db.execute(statement)
        row = {"act_path": "x", "file": "art-0001", "state": "in-force", "number": "1", "title": None}
        d1.execute_batch([
            publish_module._insert("articles_fts", {**row, "text": "first text"}),
            publish_module._insert("articles_fts", {**row, "text": "second text"}),
        ])
        self.assertEqual(d1.count("articles_fts"), 1)
        self.assertEqual(d1.query("SELECT file FROM articles_fts WHERE articles_fts MATCH 'second'"), [{"file": "art-0001"}])
        self.assertEqual(d1.query("SELECT file FROM articles_fts WHERE articles_fts MATCH 'first'"), [])
        d1.execute_batch([publish_module._delete("articles_fts", "x|art-0001")])
        self.assertEqual(d1.count("articles_fts"), 0)
        self.assertTrue(0 <= fts_rowid("x|art-0001") < 2**63)

    def test_a_publish_run_again_after_a_crash_leaves_no_duplicates(self):
        d1, r2 = self.sqlite(), FakeR2([])
        self.publish(d1, r2, BASE, FIRST)
        d1.execute_batch(["INSERT INTO events (act_path, file, verb) VALUES ('x', 'art-0002', 'amended')"])
        stale = r2.read(SNAPSHOT_KEY)
        stale["rows"]["events"]["x|art-0002"] = "0" * 64
        r2.store[SNAPSHOT_KEY] = (gzip.compress(json.dumps(stale).encode()), "", "gzip")
        self.publish(d1, r2, BASE, SECOND)
        self.assertEqual(d1.count("events"), 5)


class QueryPlanTest(unittest.TestCase):
    """Every delete the publisher can emit must find its rows through an index.

    A full load once ran 78,683 deletes against a staging table without one; each scanned
    the whole table and the load read 8.7 billion rows in D1.
    """

    KEYS = {
        "acts": "lege/2009/287", "articles": "lege/2009/287|art-0001", "versions": "lege/2009/287|art-0001|0",
        "laws": "legea-71-2011", "events": "lege/2009/287|art-0001", "rulings": "ccr/2016/405",
        "ruling_subjects": "ccr/2016/405", "articles_fts": "lege/2009/287|art-0001",
    }

    def plans(self, suffix):
        db = sqlite3.connect(":memory:")
        for statement in publish_module.schema_statements():
            db.execute(statement)
        if suffix:
            for statement in publish_module.next_schema_statements() + publish_module.staging_index_statements():
                db.execute(statement)
        for table in publish_module.TABLES:
            statement = publish_module._delete(table, self.KEYS[table], suffix)
            detail = " / ".join(row[3] for row in db.execute("EXPLAIN QUERY PLAN " + statement))
            yield table, statement, detail

    def check(self, suffix):
        for table, statement, detail in self.plans(suffix):
            with self.subTest(table=table, suffix=suffix):
                self.assertIn(f"{table}{suffix}", statement)
                if table == "articles_fts":
                    # FTS5 reports a rowid lookup as a "scan" with the equality constraint 0:=.
                    self.assertIn("VIRTUAL TABLE INDEX 0:=", detail, f"{statement}: {detail}")
                else:
                    self.assertNotIn("SCAN", detail, f"{statement} scans the table: {detail}")

    def test_deletes_on_the_live_tables_use_an_index(self):
        self.check("")

    def test_deletes_on_the_staging_tables_use_an_index(self):
        self.check(publish_module.NEXT_SUFFIX)

    def test_the_keys_cover_every_table(self):
        self.assertEqual(set(self.KEYS), set(publish_module.TABLES))


if __name__ == "__main__":
    unittest.main()
