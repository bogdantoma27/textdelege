import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from build.tests.sourcerepo import ARTICLE_1, CIVIL, OTHER, PROCEDURE, RULING_KEY, SourceRepo
from build.textdelege import cli
from build.textdelege.acts import ActMeta
from build.textdelege.d1 import SCHEMA_VERSION, D1Error, D1QuotaExceeded
from build.textdelege.extract import Article, Line, Version
from build.textdelege.gitrepo import GitError
from build.textdelege.publish import IndexRows
from build.textdelege.verify import Mismatch, Sample

LAWS_CSV = (
    "key,label,kind,title,enacted,published,in_force_days,commits,url\n"
    "legea-200-2023,Legea nr. 200/2023,law,Legea nr. 200/2023,2023-07-05,2023-07-06,2023-07-09,1,\n"
    "legea-99-2023,Legea nr. 99/2023,law,Legea nr. 99/2023,2023-05-05,2023-05-06,2023-07-09,1,\n"
)
TODAY = date(2026, 11, 8)
NOW = datetime(2026, 11, 8, 6, 0, 0, tzinfo=timezone.utc)
SAMPLE = ["--sample", "3"]


def run(argv, **injections):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        injections.setdefault("today", TODAY)
        code = cli.main(argv, now=NOW, **injections)
    return code, out.getvalue(), err.getvalue()


class FakeR2:
    def __init__(self):
        self.puts, self.deleted = {}, []

    def get(self, key):
        return self.puts.get(key)

    def list(self, prefix):
        return []

    def put(self, key, body, content_type, content_encoding=None):
        self.puts[key] = body

    def delete_prefix(self, prefix):
        self.deleted.append(prefix)
        return 0


class FakeD1:
    def __init__(self):
        self.queries, self.batches = [], []

    def execute_batch(self, statements):
        self.batches.append(list(statements))

    def query(self, sql, params=None):
        self.queries.append((" ".join(sql.split()), params))
        return []


class MissingMetaD1(FakeD1):
    def query(self, sql, params=None):
        super().query(sql, params)
        raise D1Error("D1 query failed with HTTP 400: no such table: meta: SQLITE_ERROR")


class BuildDayTest(unittest.TestCase):
    def test_build_day_is_the_bucharest_date(self):
        winter = datetime(2026, 11, 8, 22, 30, tzinfo=timezone.utc)
        summer = datetime(2026, 7, 1, 21, 30, tzinfo=timezone.utc)
        self.assertEqual(cli.build_day(winter), date(2026, 11, 9))
        self.assertEqual(cli.build_day(summer), date(2026, 7, 2))
        self.assertEqual(cli.build_day(datetime(2026, 11, 8, 21, 59, tzinfo=timezone.utc)), date(2026, 11, 8))
        self.assertEqual(cli.build_day(datetime(2026, 7, 1, 20, 59, tzinfo=timezone.utc)), date(2026, 7, 1))

    def test_main_builds_for_the_bucharest_day_but_stamps_generated_in_utc(self):
        with mock.patch.object(cli, "cmd_status", return_value=0) as status:
            cli.main(["status"], now=datetime(2026, 11, 8, 22, 30, tzinfo=timezone.utc))
        self.assertEqual(status.call_args.kwargs["today"], date(2026, 11, 9))

    def test_make_build_id_stays_utc(self):
        now = datetime(2026, 11, 8, 22, 30, tzinfo=timezone.utc)
        self.assertEqual(cli.make_build_id(now, "abcdef0123"), "20261108T223000Z-abcdef0")


class MismatchOutputTest(unittest.TestCase):
    def sample(self):
        return Sample("lege/1/2", "art-0001", TODAY)

    def test_prints_a_unified_diff_of_the_two_texts(self):
        out = io.StringIO()
        item = Mismatch(self.sample(), "selection", "a\nb\nc\n", "a\nB\nc\n")
        with contextlib.redirect_stdout(out):
            cli.print_mismatches([item])
        text = out.getvalue()
        self.assertIn("mismatch: lege/1/2 art-0001 2026-11-08 selection", text)
        self.assertIn("--- ours", text)
        self.assertIn("+++ oracle", text)
        self.assertIn("-b", text)
        self.assertIn("+B", text)

    def test_caps_the_diff_and_handles_absent_text(self):
        out = io.StringIO()
        long = "".join(f"line {i}\n" for i in range(100))
        items = [Mismatch(self.sample(), "selection", long, ""), Mismatch(self.sample(), "presence", None, "x\n")]
        with contextlib.redirect_stdout(out):
            cli.print_mismatches(items)
        lines = out.getvalue().splitlines()
        first = lines.index("  ... 63 more diff lines")
        self.assertEqual(first, 1 + 40)
        self.assertIn("  +x", lines)


class ActRowTest(unittest.TestCase):
    def meta(self, **changes):
        base = ActMeta(
            "lege/1990/31", "lege-31", "lege", 1990, "31", "Legea 31", None, None, None,
            "in force", "https://x", 3, date(1990, 1, 2), date(2020, 3, 4),
        )
        return replace(base, **changes)

    def test_numbered_act_row_has_listing_columns(self):
        row = cli.act_row(self.meta(), "fresh", 7)
        self.assertEqual(
            {k: row[k] for k in ("year", "number", "from_date", "latest", "articles")},
            {"year": 1990, "number": "31", "from_date": "1990-01-02", "latest": "2020-03-04", "articles": 7},
        )

    def test_act_without_number_gets_null_number(self):
        row = cli.act_row(self.meta(path="constitutie/1991", kind="constitutie", year=1991, number=""), None, 0)
        self.assertEqual((row["year"], row["number"], row["articles"]), (1991, None, 0))


class SearchRowsTest(unittest.TestCase):
    def test_snippet_markers_are_stripped_from_search_rows(self):
        line = Line(text="Text \ue000forged\ue001 end", id="alin-1", since=TODAY, law_key="")
        version = Version(
            from_=TODAY, until=None, commit="c", law_commit="c", law_key="", law_label="",
            kind="law", lines=[line],
        )
        article = Article(
            file="art-1", number="1\ue000", title="Ti\ue001tlu", versions=[version],
            state="in-force", repealed_on=None,
        )
        rows = IndexRows()
        cli._add_article_rows(rows, "lege/1/1", "art-1", article, [], TODAY)
        row = rows.articles_fts[0]
        self.assertEqual((row["number"], row["title"], row["text"]), ("1", "Titlu", "Text forged end"))


class CliTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.source = SourceRepo(self.tmp / "source")
        self.cache = self.tmp / "work" / ".cache"
        self.config = self.tmp / "work" / "config.toml"
        self.config.parent.mkdir()
        self.config.write_text(
            f'source_url = "{self.source.uri}"\nselection = "codes"\ncache_dir = ".cache"\n',
            encoding="utf-8",
        )

    def build(self, *extra, **injections):
        return run(["build", "--config", str(self.config), "--dry-run", *SAMPLE, *extra],
                   **injections)

    def out(self, key):
        return json.loads((self.cache / "out" / key).read_text(encoding="utf-8"))

    def state(self):
        return json.loads((self.cache / "state.json").read_text(encoding="utf-8"))

    def test_dry_run_writes_objects_sql_and_state(self):
        code, stdout, stderr = self.build()
        self.assertEqual((code, stderr), (0, ""), stdout)
        state = self.state()
        build = state["build"]
        self.assertEqual(build, f"20261108T060000Z-{self.source.head()[:7]}")
        self.assertEqual(state["source_head"], self.source.head())
        out = self.cache / "out"
        for key in (
            "manifest.json",
            "acts/index.json",
            f"acts/{CIVIL}/act.json",
            f"acts/{CIVIL}/art/{ARTICLE_1}.json",
            f"acts/{CIVIL}/art/art-0002.json",
            f"acts/{PROCEDURE}/act.json",
            f"laws/legea-200-2023.json",
            f"rulings/{RULING_KEY}.json",
            f"changes/site.json",
            f"changes/acts/{CIVIL}.json",
            "index.sql",
        ):
            self.assertTrue((out / key).is_file(), key)
        self.assertFalse((out / "acts" / OTHER).exists())
        article = self.out(f"acts/{CIVIL}/art/{ARTICLE_1}.json")
        self.assertEqual(len(article["versions"]), 2)
        self.assertEqual(article["next"]["file"], "art-0002")
        self.assertEqual([r["key"] for r in article["rulings"]], [RULING_KEY])
        manifest = self.out("manifest.json")
        self.assertEqual(manifest["build"], build)
        self.assertEqual(
            manifest["counts"],
            {"acts": 2, "articles": 3, "versions": 4, "laws": 2, "rulings": 1},
        )
        self.assertEqual(manifest["status"]["schema"], "romania-law-status/1")
        index = self.out("acts/index.json")
        self.assertEqual(index["schema"], "textdelege/act-index/1")
        self.assertEqual([a["path"] for a in index["acts"]], [CIVIL, PROCEDURE])
        self.assertEqual(index["acts"][0]["articles"], 2)
        self.assertEqual(
            sorted(index["acts"][0]), ["alias", "articles", "from", "kind", "latest", "path", "short", "status", "title"],
        )
        sql = (out / "index.sql").read_bytes().decode("utf-8")
        self.assertIn("INSERT OR REPLACE INTO articles_fts (rowid, act_path", sql)
        self.assertNotIn("\r", sql)
        self.assertIn("(1) Primul text modificat. (2) Al doilea text.", sql)
        self.assertNotIn("DROP", sql)
        self.assertNotIn("build_id", sql)
        self.assertFalse((out / "snapshot.json").exists())

    def test_noop_when_head_and_fingerprint_unchanged(self):
        self.assertEqual(self.build()[0], 0)
        before = (self.cache / "state.json").read_text(encoding="utf-8")
        marker = self.cache / "out" / "marker"
        marker.write_text("x", encoding="utf-8")
        code, stdout, _ = self.build()
        self.assertEqual(code, 0)
        self.assertIn("no changes", stdout)
        self.assertTrue(marker.exists())
        self.assertEqual((self.cache / "state.json").read_text(encoding="utf-8"), before)

    def test_changed_fingerprint_rebuilds_same_head(self):
        self.build()
        with mock.patch.object(cli, "fingerprint", return_value="0" * 64):
            code, stdout, _ = self.build()
        self.assertEqual(code, 0)
        self.assertNotIn("no changes", stdout)
        self.assertEqual(self.state()["fingerprint"], "0" * 64)

    def test_new_source_commit_triggers_rebuild(self):
        self.build()
        self.source.amend_article("Titlu\n(1) Al treilea text.\n", "2026-12-01")
        code, stdout, _ = self.build()
        self.assertEqual(code, 0, stdout)
        self.assertNotIn("no changes", stdout)
        self.assertNotIn("history rewritten", stdout)
        state = self.state()
        self.assertEqual(state["source_head"], self.source.head())
        article = self.out(f"acts/{CIVIL}/art/{ARTICLE_1}.json")
        self.assertEqual(len(article["versions"]), 3)
        self.assertEqual(article["state"], "in-force")

    def test_rewritten_history_triggers_full_rebuild(self):
        self.build()
        new_head = self.source.rewrite_history()
        code, stdout, stderr = self.build()
        self.assertEqual((code, stderr), (0, ""), stdout)
        self.assertIn("history rewritten: full rebuild", stdout)
        self.assertEqual(self.state()["source_head"], new_head)

    def test_verification_mismatch_exits_1_and_publishes_nothing(self):
        code, stdout, _ = self.build(oracle=lambda sample: "text that differs\n")
        self.assertEqual(code, 1)
        self.assertIn("mismatch", stdout)
        self.assertIn(CIVIL, stdout)
        self.assertFalse((self.cache / "state.json").exists())
        self.assertFalse((self.cache / "out").exists())

    def test_verify_subcommand_checks_without_writing(self):
        argv = ["verify", "--config", str(self.config), "--sample", "3", "--seed", "1"]
        code, stdout, _ = run(argv)
        self.assertEqual(code, 0, stdout)
        code, _, _ = run(argv, oracle=lambda sample: "other\n")
        self.assertEqual(code, 1)
        self.assertFalse((self.cache / "out").exists())
        self.assertFalse((self.cache / "state.json").exists())

    def test_default_seed_comes_from_source_head(self):
        with mock.patch.object(cli, "sample", wraps=cli.sample) as spy:
            run(["verify", "--config", str(self.config), *SAMPLE])
            self.assertEqual(spy.call_args.args[2], int(self.source.head()[:8], 16))
            run(["verify", "--config", str(self.config), *SAMPLE, "--seed", "42"])
            self.assertEqual(spy.call_args.args[2], 42)

    def test_publishes_to_injected_clients(self):
        r2, d1 = FakeR2(), FakeD1()
        code, stdout, stderr = run(["build", "--config", str(self.config), *SAMPLE], r2=r2, d1=d1)
        self.assertEqual((code, stderr), (0, ""), stdout)
        build = f"20261108T060000Z-{self.source.head()[:7]}"
        self.assertIn("manifest.json", r2.puts)
        self.assertIn(f"acts/{CIVIL}/act.json", r2.puts)
        self.assertIn("snapshot.json", r2.puts)
        self.assertTrue(any(s.startswith("DROP TABLE IF EXISTS acts") for s in d1.batches[0]))
        self.assertTrue(any(s.startswith("INSERT OR REPLACE INTO articles_fts") for b in d1.batches for s in b))
        upsert = next(q for q in d1.queries if "INSERT INTO meta" in q[0])
        stored = dict(zip(upsert[1][::2], upsert[1][1::2]))
        self.assertEqual(stored["build"], build)
        self.assertEqual(stored["today"], "2026-11-08")
        self.assertEqual(stored["selection"], "codes")
        self.assertEqual(stored["source_url"], self.source.uri)
        self.assertEqual(stored["schema_version"], str(SCHEMA_VERSION))

    def test_second_publish_of_unchanged_data_keeps_the_live_build(self):
        r2, d1 = FakeR2(), FakeD1()
        argv = ["build", "--config", str(self.config), *SAMPLE]
        self.assertEqual(run(argv, r2=r2, d1=d1)[0], 0)
        first = f"20261108T060000Z-{self.source.head()[:7]}"
        stored = len(d1.queries)
        with mock.patch.object(cli, "make_build_id", return_value="20261109T060000Z-0000000"):
            code, stdout, stderr = run(argv, r2=r2, d1=d1, today=TODAY + timedelta(days=1))
        self.assertEqual((code, stderr), (0, ""), stdout)
        self.assertIn(first, stdout)
        self.assertNotIn("20261109", stdout)
        upsert = next(q for q in d1.queries[stored:] if "INSERT INTO meta" in q[0])
        self.assertEqual(dict(zip(upsert[1][::2], upsert[1][1::2]))["build"], first)

    def test_quota_exhaustion_exits_1_with_a_note(self):
        class QuotaD1(FakeD1):
            def execute_batch(self, statements):
                raise D1QuotaExceeded("D1 query failed: daily write limit exceeded")

        summary = self.tmp / "summary.md"
        with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
            code, _, stderr = run(["build", "--config", str(self.config), *SAMPLE], r2=FakeR2(), d1=QuotaD1())
        self.assertEqual(code, 1)
        self.assertIn("limit exceeded", stderr)
        self.assertIn(
            "D1 daily write limit reached; the next run continues from the checkpoint",
            summary.read_text(encoding="utf-8"),
        )

    def test_next_day_rebuilds_even_when_head_is_unchanged(self):
        self.build()
        code, stdout, _ = run(["build", "--config", str(self.config), "--dry-run", *SAMPLE],
                              today=TODAY + timedelta(days=1))
        self.assertEqual(code, 0)
        self.assertNotIn("no changes", stdout)
        self.assertEqual(self.state()["today"], "2026-11-09")

    def test_changed_selection_rebuilds(self):
        self.build()
        self.config.write_text(
            f'source_url = "{self.source.uri}"\nselection = "primary"\ncache_dir = ".cache"\n',
            encoding="utf-8",
        )
        code, stdout, _ = self.build()
        self.assertEqual(code, 0, stdout)
        self.assertNotIn("no changes", stdout)
        self.assertEqual(self.state()["selection"], "primary")
        self.assertEqual(self.out("manifest.json")["counts"]["acts"], 3)

    def test_credits_row_labels_the_credited_version(self):
        self.source.fixture.commit(
            {
                "data/credits.csv": "act,in_force,provision,law,was_law,was_commit\n"
                f"codul-civil,2023-07-09,{ARTICLE_1},legea-99-2023,,abc1234\n",
                "data/laws.csv": LAWS_CSV,
            },
            author="Lexifina", trailers={"Kind": "documentation"}, message="Credit",
        )
        self.source.push()
        self.assertEqual(self.build()[0], 0)
        build = self.state()["build"]
        article = self.out(f"acts/{CIVIL}/art/{ARTICLE_1}.json")
        self.assertEqual(article["versions"][1]["law"],
                         {"key": "legea-99-2023", "label": "Legea nr. 99/2023"})
        self.assertEqual(article["versions"][0]["law"]["key"], "legea-71-2011")
        self.assertIn("legea-99-2023", [e["law"]["key"] for e in article["events"] if e["law"]])
        self.assertTrue((self.cache / "out" / "laws" / "legea-99-2023.json").is_file())

    def test_verify_recovers_from_rewritten_history(self):
        self.build()
        self.source.rewrite_history()
        code, stdout, _ = run(["verify", "--config", str(self.config), *SAMPLE])
        self.assertEqual(code, 0, stdout)
        self.assertIn("history rewritten: full rebuild", stdout)

    def test_module_runs_from_build_directory(self):
        build_dir = Path(cli.__file__).resolve().parents[1]
        result = subprocess.run(
            [sys.executable, "-m", "textdelege.cli", "status", "--config", str(self.config)],
            cwd=build_dir, capture_output=True, text=True, encoding="utf-8", check=False,
        )
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertIn("no build exists", result.stdout)

    def test_prefetch_requests_only_the_needed_freshness_shards(self):
        requested = []
        real = cli.GitRepo.prefetch_head

        def recording(repo, paths):
            requested.append(list(paths))
            return real(repo, paths)

        with mock.patch.object(cli.GitRepo, "prefetch_head", recording):
            self.assertEqual(self.build()[0], 0)
        flat = [path for call in requested for path in call]
        self.assertIn("data/freshness/index.json", flat)
        self.assertIn("data/freshness/lege-2009.csv", flat)
        self.assertNotIn("data/freshness/", flat)

    def test_step_summary_written_when_env_set(self):
        summary = self.tmp / "summary.md"
        with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
            code, stdout, _ = self.build()
        self.assertEqual(code, 0)
        text = summary.read_text(encoding="utf-8")
        for label in ("Build", "Source head", "Acts", "Articles", "Versions", "Laws", "Rulings",
                      "Prefetched", "Sample size", "Mismatches", "Duration"):
            self.assertIn(f"| {label} |", text)
        self.assertRegex(text, r"\| Prefetched \| \d+ history blobs, [1-9]\d* head blobs \|")
        self.assertIn("| Acts | 2 |", text)
        self.assertIn("Acts: 2", stdout)

    def test_status_prints_stored_state(self):
        code, stdout, _ = run(["status", "--config", str(self.config)])
        self.assertEqual(code, 0)
        self.assertIn("no build exists", stdout)
        self.build()
        code, stdout, _ = run(["status", "--config", str(self.config)])
        self.assertIn(self.source.head(), stdout)

    def test_noop_dry_run_still_writes_when_the_output_directory_is_gone(self):
        self.build()
        remove = cli.remove_tree
        remove(self.cache / "out")
        code, stdout, _ = self.build()
        self.assertEqual(code, 0)
        self.assertNotIn("no changes", stdout)
        self.assertTrue((self.cache / "out" / "manifest.json").is_file())

    def test_changed_source_url_replaces_the_cached_clone(self):
        self.build()
        clone = self.cache / cli.REPO_DIR
        subprocess.run(["git", "remote", "set-url", "origin", "file:///nonexistent/old.git"],
                       cwd=clone, check=True, capture_output=True)
        (clone / "stale-marker").write_text("x", encoding="utf-8")
        with mock.patch.object(cli, "fingerprint", return_value="0" * 64):
            code, stdout, stderr = self.build()
        self.assertEqual((code, stderr), (0, ""), stdout)
        self.assertIn(cli.RECLONED_URL, stdout)
        self.assertFalse((clone / "stale-marker").exists())
        self.assertEqual(cli.GitRepo(clone).remote_url(), self.source.uri)

    def test_unfetchable_cached_clone_is_replaced_and_reported(self):
        self.build()
        clone = self.cache / cli.REPO_DIR
        (clone / "stale-marker").write_text("x", encoding="utf-8")
        summary = self.tmp / "summary.md"
        broken = GitError(["git", "fetch"], "unable to update ref", 128)
        with mock.patch.object(cli.GitRepo, "fetch", side_effect=broken), \
                mock.patch.object(cli, "fingerprint", return_value="0" * 64), \
                mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
            code, stdout, stderr = self.build()
        self.assertEqual((code, stderr), (0, ""), stdout)
        self.assertIn(cli.RECLONED_BROKEN, stdout)
        self.assertIn(cli.RECLONED_BROKEN, summary.read_text(encoding="utf-8"))
        self.assertFalse((clone / "stale-marker").exists())

    def test_cache_directory_that_is_not_a_repository_is_replaced(self):
        clone = self.cache / cli.REPO_DIR
        clone.mkdir(parents=True)
        (clone / "junk").write_text("x", encoding="utf-8")
        code, stdout, stderr = self.build()
        self.assertEqual((code, stderr), (0, ""), stdout)
        self.assertIn(cli.RECLONED_BROKEN, stdout)

    def test_mismatch_output_shows_the_differing_text(self):
        code, stdout, _ = self.build(oracle=lambda sample: "text that differs\n")
        self.assertEqual(code, 1)
        self.assertIn("--- ours", stdout)
        self.assertIn("+text that differs", stdout)

    def test_failure_writes_an_error_row_to_the_step_summary(self):
        self.config.write_text('source_url = "file:///nonexistent/repo.git"\n', encoding="utf-8")
        summary = self.tmp / "summary.md"
        with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
            code, _, stderr = self.build()
        self.assertEqual(code, 2)
        text = summary.read_text(encoding="utf-8")
        self.assertIn("| Error |", text)

    def test_status_does_not_create_the_meta_table(self):
        d1 = MissingMetaD1()
        code, stdout, _ = run(["status", "--config", str(self.config)], d1=d1)
        self.assertEqual(code, 0)
        self.assertIn("no build exists", stdout)
        self.assertFalse(any(q[0].startswith("CREATE") for q in d1.queries))

    def test_verify_without_a_meta_table_runs_as_a_first_build(self):
        d1 = MissingMetaD1()
        code, stdout, _ = run(["verify", "--config", str(self.config), *SAMPLE], d1=d1)
        self.assertEqual(code, 0, stdout)
        self.assertFalse(any(q[0].startswith("CREATE") for q in d1.queries))

    def test_other_d1_errors_while_reading_state_still_fail(self):
        class Broken(FakeD1):
            def query(self, sql, params=None):
                raise D1Error("D1 query failed with HTTP 500: boom")

        code, _, stderr = run(["status", "--config", str(self.config)], d1=Broken())
        self.assertEqual(code, 2)
        self.assertIn("boom", stderr)

    def test_failure_exits_2_with_message_and_no_traceback(self):
        self.config.write_text('source_url = "file:///nonexistent/repo.git"\n', encoding="utf-8")
        code, _, stderr = self.build()
        self.assertEqual(code, 2)
        self.assertIn("error:", stderr)
        self.assertNotIn("Traceback", stderr)

    def test_publishing_without_credentials_fails_closed(self):
        code, _, stderr = run(["build", "--config", str(self.config), *SAMPLE])
        self.assertEqual(code, 2)
        self.assertIn("R2", stderr)
