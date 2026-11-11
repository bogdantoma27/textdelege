import json
import tempfile
import unittest
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from build.tests.fixture import FixtureRepo
from build.tests.sourcerepo import CIVIL, PROCEDURE, SourceRepo
from build.tests.test_cli import TODAY, run
from build.textdelege import cli, extractcache
from build.textdelege.extract import (
    Article,
    Line,
    Version,
    extract_act,
    extract_core,
    finalize_act,
)
from build.textdelege.gitrepo import GitRepo
from build.textdelege.selection import act_commits
from build.textdelege.verify import CACHED_FLOOR, sample

SAMPLE = ["--sample", "3"]
FOLDER = "act"
LAW_A = "Legea nr. 1/2020"
LAW_B = "Legea nr. 2/2021"
LAW_C = "Legea nr. 3/2022"


def article(number, *lines):
    return "\n".join([f"# Articolul {number}", *lines]) + "\n"


def key_for(**overrides):
    values = {
        "newest_commit": "a" * 40,
        "credits": {("2020-01-01", "art-0001"): "legea-1-2020"},
        "law_labels": {"legea-1-2020": "Legea nr. 1/2020", "legea-9-2020": "Legea nr. 9/2020"},
        "code": "code",
    }
    values.update(overrides)
    return extractcache.act_fingerprint(**values)


class FingerprintTest(unittest.TestCase):
    def test_same_inputs_give_the_same_key(self):
        self.assertEqual(key_for(), key_for())

    def test_each_input_changes_the_key(self):
        base = key_for()
        self.assertNotEqual(base, key_for(newest_commit="b" * 40))
        self.assertNotEqual(base, key_for(code="other"))
        self.assertNotEqual(base, key_for(credits={("2020-01-01", "art-0001"): "legea-9-2020"}))
        self.assertNotEqual(base, key_for(credits={}))
        self.assertNotEqual(
            base,
            key_for(law_labels={"legea-1-2020": "Renamed", "legea-9-2020": "Legea nr. 9/2020"}),
        )

    def test_unused_labels_do_not_change_the_key(self):
        labels = {"legea-1-2020": "Legea nr. 1/2020", "legea-9-2020": "Renamed", "new": "New"}
        self.assertEqual(key_for(), key_for(law_labels=labels))

    def test_code_hash_follows_the_package_sources(self):
        first = extractcache.code_hash()
        self.assertEqual(first, extractcache.code_hash())
        with mock.patch.object(Path, "read_bytes", return_value=b"changed"):
            self.assertNotEqual(first, extractcache.code_hash())


class RoundTripTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.fixture = FixtureRepo(self.tmp / "src")
        self.repo = GitRepo(self.tmp / "src")

    def commit(self, files, in_force, author, kind="amendment"):
        files = {f"{FOLDER}/{name}": text for name, text in files.items()}
        return self.fixture.commit(
            files,
            author=author,
            trailers={"Kind": kind, "Law": author, "In-force": in_force},
            message="Change",
        )

    def populate(self):
        self.commit(
            {
                "art-0001.md": article(1, "one"),
                "art-0002.md": article(2, "two"),
                "art-0003.md": article(3, "three"),
                "art-0004.md": article(4, "(1) four", "(2) more"),
            },
            "2020-01-01",
            LAW_A,
        )
        self.commit({"art-0002.md": None}, "2021-01-01", LAW_B)
        self.commit({"art-0003.md": article(3, "Abrogat.")}, "2022-01-01", LAW_C)
        self.commit({"art-0004.md": article(4, "(1) four", "(2) changed")}, "2023-01-01", LAW_C)
        self.commit({"art-0005.md": article(5, "future")}, "2030-01-01", LAW_B)
        self.commit({"art-0001.md": article(1, "one again")}, "2031-06-01", LAW_C)

    def full(self, today, credits=None, labels=None):
        return extract_act(
            self.repo, FOLDER, None, credits=credits or {}, law_labels=labels or {}, today=today
        )

    def test_cached_core_finalizes_like_a_full_extraction_on_any_day(self):
        self.populate()
        credits = {("2022-01-01", "art-0003"): "legea-99-2022", ("2021-01-01", "art-0002"): ""}
        labels = {"legea-99-2022": "Legea nr. 99/2022"}
        core = extract_core(self.repo, FOLDER, None, credits=credits, law_labels=labels)
        extractcache.store(self.tmp / "cache", "lege/2020/1", "key", core)
        loaded = extractcache.load(self.tmp / "cache", "lege/2020/1", "key")
        days = [date(2019, 1, 1), date(2022, 6, 1), date(2026, 11, 8), date(2030, 1, 1), date(2032, 1, 1)]
        for today in days:
            expected = self.full(today, credits, labels)
            actual = finalize_act(loaded, today)
            self.assertEqual(actual, expected, today)
            self.assertEqual(
                json.dumps([asdict(a) for a in actual], default=str, sort_keys=True),
                json.dumps([asdict(a) for a in expected], default=str, sort_keys=True),
            )
        states = {a.file: a.state for a in finalize_act(loaded, date(2026, 11, 8))}
        self.assertEqual(states["art-0002.md"], "repealed")
        self.assertEqual(states["art-0003.md"], "repealed")
        self.assertEqual(states["art-0005.md"], "future")
        later = {a.file: a.state for a in finalize_act(loaded, date(2032, 1, 1))}
        self.assertEqual(later["art-0005.md"], "in-force")

    def test_load_misses_on_other_key_and_on_damaged_files(self):
        self.populate()
        core = extract_core(self.repo, FOLDER, None, credits={}, law_labels={})
        cache = self.tmp / "cache"
        extractcache.store(cache, "lege/2020/1", "key", core)
        self.assertIsNotNone(extractcache.load(cache, "lege/2020/1", "key"))
        self.assertIsNone(extractcache.load(cache, "lege/2020/1", "other"))
        self.assertIsNone(extractcache.load(cache, "lege/2020/2", "key"))
        extractcache.cache_path(cache, "lege/2020/1").write_text("{", encoding="utf-8")
        self.assertIsNone(extractcache.load(cache, "lege/2020/1", "key"))

    def test_new_commit_changes_the_newest_commit(self):
        self.populate()
        before = self.repo.newest_commit([FOLDER])
        self.assertEqual(before, act_commits(self.repo, FOLDER, None)[0].sha)
        self.commit({"art-0001.md": article(1, "newer")}, "2031-07-01", LAW_A)
        after = self.repo.newest_commit([FOLDER])
        self.assertNotEqual(before, after)
        self.assertIsNone(self.repo.newest_commit(["missing"]))

    def test_wipe_removes_every_cached_act(self):
        cache = self.tmp / "cache"
        extractcache.store(cache, "lege/2020/1", "key", [])
        extractcache.wipe(cache)
        self.assertFalse((cache / extractcache.CACHE_DIR).exists())
        extractcache.wipe(cache)


class IncrementalBuildTest(unittest.TestCase):
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
        self.day = TODAY

    def build(self, advance=1, **injections):
        self.day += timedelta(days=advance)
        injections.setdefault("today", self.day)
        calls = []
        real = cli.extract_core

        def counting(repo, folder, *args, **kwargs):
            calls.append(folder)
            return real(repo, folder, *args, **kwargs)

        with mock.patch.object(cli, "extract_core", side_effect=counting):
            code, stdout, stderr = run(
                ["build", "--config", str(self.config), "--dry-run", *SAMPLE], **injections
            )
        self.assertEqual((code, stderr), (0, ""), stdout)
        return sorted(calls), stdout

    def out(self, key):
        return (self.cache / "out" / key).read_text(encoding="utf-8")

    def snapshot(self):
        root = self.cache / "out"
        return {
            path.relative_to(root): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file() and path.name != "manifest.json"
        }

    def test_first_build_extracts_every_act_and_prints_the_timing_line(self):
        calls, stdout = self.build()
        self.assertEqual(calls, sorted([CIVIL, PROCEDURE]))
        timing = [line for line in stdout.splitlines() if line.startswith("Timing: ")]
        self.assertEqual(len(timing), 1)
        for phase in ("fetch", "extract", "events", "verify", "publish"):
            self.assertIn(f"{phase} ", timing[0])

    def test_unchanged_source_on_a_new_day_extracts_nothing(self):
        self.build()
        calls, _stdout = self.build()
        self.assertEqual(calls, [])

    def test_cached_build_output_equals_a_full_build_of_the_same_day(self):
        self.build()
        calls, _ = self.build(advance=4000)
        self.assertEqual(calls, [])
        cached = self.snapshot()
        extractcache.wipe(self.cache)
        (self.cache / "state.json").unlink()
        calls, _ = self.build(advance=0)
        self.assertEqual(calls, sorted([CIVIL, PROCEDURE]))
        self.assertEqual(cached, self.snapshot())

    def test_a_new_commit_touching_one_act_extracts_only_that_act(self):
        self.build()
        self.source.amend_article("Titlu\n(1) Al treilea text.\n", "2026-12-01")
        calls, _ = self.build()
        self.assertEqual(calls, [CIVIL])
        self.assertIn("Al treilea text", self.out(f"acts/{CIVIL}/art/art-0001.json"))

    def test_a_code_change_invalidates_every_act(self):
        self.build()
        with mock.patch.object(extractcache, "code_hash", return_value="changed"):
            calls, _ = self.build()
        self.assertEqual(calls, sorted([CIVIL, PROCEDURE]))

    def test_a_credits_change_invalidates_only_the_credited_act(self):
        self.build()
        self.source.fixture.commit(
            {
                "data/credits.csv": "act,in_force,provision,law,was_law,was_commit\n"
                "codul-civil,2023-07-09,art-0001,legea-200-2023,,abc1234\n",
            },
            author="Lexifina", trailers={"Kind": "documentation"}, message="Credit",
        )
        self.source.push()
        calls, _ = self.build()
        self.assertEqual(calls, [CIVIL])

    def test_a_rewritten_history_wipes_the_cache(self):
        self.build()
        stale = self.cache / extractcache.CACHE_DIR / "stale.json"
        stale.write_text("{}", encoding="utf-8")
        self.source.rewrite_history()
        calls, stdout = self.build()
        self.assertIn("history rewritten", stdout)
        self.assertEqual(calls, sorted([CIVIL, PROCEDURE]))
        self.assertFalse(stale.exists())

    def test_a_failed_verification_stores_nothing(self):
        self.day += timedelta(days=1)
        code, _stdout, _stderr = run(
            ["build", "--config", str(self.config), "--dry-run", *SAMPLE],
            today=self.day,
            oracle=lambda s: "text that differs\n",
        )
        self.assertEqual(code, 1)
        self.assertFalse((self.cache / extractcache.CACHE_DIR).exists())

    def test_verify_subcommand_neither_reads_nor_writes_the_cache(self):
        argv = ["verify", "--config", str(self.config), *SAMPLE]
        self.assertEqual(run(argv)[0], 0)
        self.assertFalse((self.cache / extractcache.CACHE_DIR).exists())


def make_articles(acts, count=3):
    start = date(2020, 1, 1)
    result = {}
    for act in acts:
        items = []
        for number in range(3):
            versions = [
                Version(
                    start + timedelta(days=30 * i), None, "c", "c", "k", "L", "amendment",
                    [Line("t", "p-1", start, "k")],
                )
                for i in range(count)
            ]
            items.append(Article(f"art-000{number}.md", str(number), None, versions, "in-force", None))
        result[act] = items
    return result


class SampleTest(unittest.TestCase):
    def setUp(self):
        self.articles = make_articles(["a", "b", "c"])

    def test_without_a_fresh_set_the_sample_is_unchanged(self):
        self.assertEqual(
            sample(self.articles, 20, 1, TODAY), sample(self.articles, 20, 1, TODAY, None)
        )

    def test_nothing_fresh_samples_only_the_floor_across_all_acts(self):
        picked = sample(self.articles, 200, 1, TODAY, set())
        self.assertGreater(len(picked), 0)
        self.assertLessEqual(len(picked), CACHED_FLOOR)
        self.assertEqual(sample(self.articles, 200, 1, TODAY, set()), picked)
        self.assertGreater(len({s.act_path for s in picked}), 1)

    def test_fresh_acts_get_the_full_sample_and_the_boundaries(self):
        picked = sample(self.articles, 30, 1, TODAY, {"b"})
        fresh = [s for s in picked if s.act_path == "b"]
        other = [s for s in picked if s.act_path != "b"]
        self.assertGreaterEqual(len(fresh), 30)
        self.assertGreater(len(other), 0)
        self.assertLessEqual(len(other), CACHED_FLOOR)
