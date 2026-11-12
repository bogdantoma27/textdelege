import hashlib
import io
import json
import sqlite3
import tempfile
import re
import unittest
import urllib.error
from pathlib import Path

from build.tests.test_r2 import FakeOpener, FakeResponse
from build.textdelege.d1 import SCHEMA_PATH, SCHEMA_VERSION, D1Client, D1Error, D1QuotaExceeded, render_statement, retryable

SCHEMA_HASHES = {
    1: "86c5b1fb6cc35829e8922d0b4b73751248aa016ac63ec3c3c92e2851603c2bc2",
    2: "596056aee3c6c20c9967066a62b16baede6b22625ed8e1b4b53f5fd26aded83f",
    3: "b81fc31511853f7a51830b865276491714382fcdb8ce988008e58fcb3f25ac53",
}


class D1Tests(unittest.TestCase):
    def test_schema_is_pinned_to_its_declared_version(self):
        text = SCHEMA_PATH.read_text(encoding="utf-8")
        body = re.sub(r"\A-- schema_version: \d+\n", "", text)
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        self.assertEqual(
            SCHEMA_HASHES.get(SCHEMA_VERSION),
            digest,
            "schema.sql changed: bump `-- schema_version` on its first line (the live tables are "
            f"only rebuilt on a new version) and add `{SCHEMA_VERSION + 1}: \"{digest}\"` to "
            "SCHEMA_HASHES; if the version was bumped already, pin its hash",
        )

    def test_d1_query_returns_results_and_raises_on_failure(self):
        ok = {"success": True, "errors": [], "result": [{"results": [{"a": 1}], "success": True, "meta": {}}]}
        bad = {"success": False, "errors": [{"message": "boom"}], "result": []}
        op = FakeOpener(
            FakeResponse(json.dumps(ok).encode()),
            FakeResponse(json.dumps(bad).encode()),
            urllib.error.HTTPError("u", 500, "e", {}, io.BytesIO(b"{}")),
        )
        c = D1Client("acct", "db", "tok", opener=op)
        self.assertEqual(c.query("SELECT ?", [1]), [{"a": 1}])
        req = op.requests[0]
        self.assertEqual(req.full_url, "https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db/query")
        self.assertEqual(json.loads(req.data), {"sql": "SELECT ?", "params": [1]})
        self.assertEqual(req.get_header("Authorization"), "Bearer tok")
        with self.assertRaises(D1Error):
            c.query("x")
        with self.assertRaises(D1Error):
            c.query("x")

    def test_quota_errors_raise_quota_exceeded_and_are_never_retried(self):
        bodies = [
            urllib.error.HTTPError("u", 429, "e", {}, io.BytesIO(b'{"errors": [{"message": "Daily write limit exceeded"}]}')),
            urllib.error.HTTPError("u", 400, "e", {}, io.BytesIO(b'{"errors": [{"message": "D1 Quota reached"}]}')),
        ]
        refused = {"success": False, "errors": [{"message": "rows written exceeded"}], "result": []}
        op = FakeOpener(bodies[0], bodies[1], FakeResponse(json.dumps(refused).encode()))
        c = D1Client("acct", "db", "tok", opener=op, sleep=lambda s: None)
        for _ in range(3):
            with self.assertRaises(D1QuotaExceeded) as caught:
                c.query("x")
            self.assertIsInstance(caught.exception, D1Error)
        self.assertEqual(len(op.requests), 3)
        self.assertFalse(retryable(D1QuotaExceeded("limit", 429)))
        self.assertTrue(retryable(D1Error("busy", 429)))

    def test_other_failures_stay_plain_d1_errors(self):
        op = FakeOpener(urllib.error.HTTPError("u", 500, "e", {}, io.BytesIO(b'{"errors": "syntax error"}')))
        with self.assertRaises(D1Error) as caught:
            D1Client("acct", "db", "tok", opener=op).query("x")
        self.assertNotIsInstance(caught.exception, D1QuotaExceeded)

    def test_render_statement_escapes_literals(self):
        text = render_statement("INSERT INTO t VALUES (?, ?, ?, ?, ?, ?)", ["it's", None, 3, 1.5, True, False])
        self.assertEqual(text, "INSERT INTO t VALUES ('it''s', NULL, 3, 1.5, 1, 0)")

    def batch_client(self, *responses):
        ok = FakeResponse(json.dumps({"success": True, "errors": [], "result": []}).encode())
        opener = FakeOpener(*(responses or (ok, ok, ok, ok)))
        return D1Client("acct", "db", "tok", opener=opener), opener

    def sent(self, opener):
        return [json.loads(request.data) for request in opener.requests]

    def test_execute_batch_chunks_by_bytes(self):
        client, opener = self.batch_client()
        client.execute_batch(["a" * 10, "b" * 10, "c" * 10, "d" * 10], max_bytes=34)
        sent = self.sent(opener)
        self.assertEqual([b["sql"] for b in sent], ["a" * 10 + ";\n" + "b" * 10, "c" * 10 + ";\n" + "d" * 10])
        self.assertTrue(all(b["params"] == [] for b in sent))
        self.assertTrue(all(len(b["sql"].encode()) <= 34 for b in sent))

    def test_execute_batch_exact_fit_stays_in_one_chunk(self):
        client, opener = self.batch_client()
        client.execute_batch(["a" * 10, "b" * 10], max_bytes=24)
        self.assertEqual(len(opener.requests), 1)

    def test_execute_batch_sends_oversize_statement_alone(self):
        client, opener = self.batch_client()
        client.execute_batch(["a", "b" * 50, "c"], max_bytes=20)
        self.assertEqual([b["sql"] for b in self.sent(opener)], ["a", "b" * 50, "c"])

    def test_execute_batch_counts_utf8_bytes_and_ignores_empty_input(self):
        client, opener = self.batch_client()
        client.execute_batch(["ș" * 5, "ț" * 5], max_bytes=20)
        self.assertEqual(len(opener.requests), 2)
        client.execute_batch([])
        self.assertEqual(len(opener.requests), 2)

    def test_execute_batch_propagates_errors_and_stops(self):
        bad = FakeResponse(json.dumps({"success": False, "errors": [{"message": "boom"}], "result": []}).encode())
        client, opener = self.batch_client(bad)
        with self.assertRaises(D1Error):
            client.execute_batch(["a" * 10, "b" * 10], max_bytes=15)
        self.assertEqual(len(opener.requests), 1)

    def retrying_client(self, *responses):
        sleeps = []
        opener = FakeOpener(*responses)
        return D1Client("acct", "db", "tok", opener=opener, sleep=sleeps.append), opener, sleeps

    def test_requests_carry_a_timeout(self):
        ok = FakeResponse(json.dumps({"success": True, "result": []}).encode())
        client, opener, _sleeps = self.retrying_client(ok)
        client.query("SELECT 1")
        self.assertEqual(opener.timeouts, [60])

    def test_retries_throttling_unavailable_and_refused_connections(self):
        ok = FakeResponse(json.dumps({"success": True, "result": []}).encode())
        for make in (
            lambda: urllib.error.HTTPError("u", 429, "e", {}, io.BytesIO(b"{}")),
            lambda: urllib.error.HTTPError("u", 503, "e", {}, io.BytesIO(b"{}")),
            lambda: urllib.error.URLError(ConnectionRefusedError("refused")),
        ):
            failure = make()
            with self.subTest(failure=repr(failure)):
                client, opener, sleeps = self.retrying_client(failure, FakeResponse(ok.read()))
                self.assertEqual(client.query("SELECT 1"), [])
                self.assertEqual(len(opener.requests), 2)
                self.assertEqual(len(sleeps), 1)

    def test_honours_retry_after(self):
        ok = FakeResponse(json.dumps({"success": True, "result": []}).encode())
        throttled = urllib.error.HTTPError("u", 429, "e", {"Retry-After": "3"}, io.BytesIO(b"{}"))
        client, _opener, sleeps = self.retrying_client(throttled, ok)
        client.query("SELECT 1")
        self.assertEqual(sleeps, [3.0])

    def test_gives_up_after_five_attempts_with_the_http_error(self):
        failures = [urllib.error.HTTPError("u", 429, "e", {}, io.BytesIO(b"{}")) for _ in range(5)]
        client, opener, sleeps = self.retrying_client(*failures)
        with self.assertRaises(D1Error) as ctx:
            client.query("SELECT 1")
        self.assertIn("HTTP 429", str(ctx.exception))
        self.assertEqual((len(opener.requests), len(sleeps)), (5, 4))

    def test_never_replays_a_request_that_may_have_run(self):
        ok = FakeResponse(json.dumps({"success": True, "result": []}).encode())
        for make in (
            lambda: urllib.error.HTTPError("u", 500, "e", {}, io.BytesIO(b"{}")),
            lambda: urllib.error.HTTPError("u", 502, "e", {}, io.BytesIO(b"{}")),
            lambda: urllib.error.HTTPError("u", 504, "e", {}, io.BytesIO(b"{}")),
            lambda: urllib.error.URLError(ConnectionResetError("reset")),
            lambda: urllib.error.URLError(TimeoutError("timed out")),
            lambda: TimeoutError("read timed out"),
        ):
            failure = make()
            with self.subTest(failure=repr(failure)):
                client, opener, sleeps = self.retrying_client(failure, FakeResponse(ok.read()))
                with self.assertRaises((D1Error, urllib.error.URLError, TimeoutError)):
                    client.query("INSERT INTO t VALUES (1)")
                self.assertEqual((len(opener.requests), sleeps), (1, []))

    def test_schema_statements_are_plain_and_execute(self):
        text = SCHEMA_PATH.read_text(encoding="utf-8")
        statements = [part.strip() for part in text.split(";") if part.strip()]
        self.assertEqual(text.count(";"), len(statements))
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        for statement in statements:
            db.execute("\n".join(l for l in statement.splitlines() if not l.startswith("--")))
        self.assertIsInstance(SCHEMA_VERSION, int)

    def test_render_statement_round_trips_multiline_and_cr(self):
        values = ["line1\nline2", "a\r\nb\rc", "it's \n ok", "ș"]
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        for i, v in enumerate(values):
            db.execute(render_statement("INSERT INTO meta (key,\n value) VALUES (?, ?)", [str(i), v]))
        got = [r[0] for r in db.execute("SELECT value FROM meta ORDER BY CAST(key AS INTEGER)")]
        self.assertEqual(got, values)

    def test_render_statement_rejects_bad_values(self):
        for value, error in [(float("nan"), ValueError), (float("inf"), ValueError), (b"x", TypeError), ("a\x00b", ValueError)]:
            with self.assertRaises(error):
                render_statement("INSERT INTO t VALUES (?)", [value])

    def test_schema_loads_and_fts_ignores_diacritics(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        sql = SCHEMA_PATH.read_text(encoding="utf-8")
        db.executescript(sql)
        db.executescript(sql)
        db.execute(
            "INSERT INTO articles_fts (act_path, file, state, number, title, text) "
            "VALUES ('a', 'art-1.json', 'in-force', '1', 't', 'moștenire')"
        )
        rows = db.execute("SELECT file FROM articles_fts WHERE articles_fts MATCH 'mostenire'").fetchall()
        self.assertEqual(rows, [("art-1.json",)])


if __name__ == "__main__":
    unittest.main()
