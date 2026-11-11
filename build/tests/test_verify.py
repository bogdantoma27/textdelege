import os
import tempfile
import time
import unittest
import unittest.mock
from datetime import date, timedelta
from pathlib import Path

from build.tests.fixture import FixtureRepo
from build.textdelege.extract import Article, Line, Version
from build.textdelege.gitrepo import GitRepo
from build.textdelege.verify import (
    OracleError,
    Sample,
    normalise,
    oracle_environment,
    oracle_text,
    prepare_script,
    sample,
    verify,
)

ACT = "legea-1-2000"
FILE = "art-1.md"
D1 = date(2020, 1, 1)
D2 = date(2021, 1, 1)
TODAY = date(2022, 1, 1)
OLD = "# Articolul 1\n\nTitlu\n\n(1) Text vechi.\n"
NEW = "# Articolul 1\n\nTitlu\n\n(1) Text nou.\n"


def make_version(from_, until, commit, texts):
    lines = [Line(t, f"alin-{i}", from_, "k") for i, t in enumerate(texts, 1)]
    return Version(from_, until, commit, commit, "k", "L", "amendment", lines)


def make_article(file=FILE, versions=None):
    return Article(file, "1", "Titlu", versions or [], "in-force", None)


class NormaliseTest(unittest.TestCase):
    def test_normalise_ignores_line_endings_and_trailing_spaces(self):
        self.assertEqual(normalise("a  \r\n\r\nb\t\r\n"), normalise("a\nb\n"))
        self.assertEqual(normalise("ş"), "ș")


class VerifyTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.fixture = FixtureRepo(self.tmp / "src")
        self.c1 = self.fixture.commit(
            {f"{ACT}/{FILE}": OLD},
            author="Legea nr. 1/2000",
            trailers={"Kind": "amendment"},
            message="one",
        )
        self.c2 = self.fixture.commit(
            {f"{ACT}/{FILE}": NEW},
            author="Legea nr. 2/2001",
            trailers={"Kind": "amendment"},
            message="two",
        )
        self.repo = GitRepo(self.tmp / "src")
        self.article = make_article(
            versions=[
                make_version(D1, D2 - timedelta(days=1), self.c1, ["(1) Text vechi."]),
                make_version(D2, None, self.c2, ["(1) Text nou."]),
            ]
        )
        self.by_act = {ACT: [self.article]}

    def run_verify(self, samples, oracle, **kwargs):
        return verify(
            self.repo, self.by_act, samples, old_folders={ACT: None}, oracle=oracle, **kwargs
        )

    def test_both_none_is_ok(self):
        s = Sample(ACT, FILE, date(2019, 1, 1))
        self.assertEqual(self.run_verify([s], lambda *_: None), [])

    def test_matching_text_passes(self):
        samples = [Sample(ACT, FILE, D1), Sample(ACT, FILE, D2)]
        texts = {D1: OLD, D2: NEW}
        self.assertEqual(self.run_verify(samples, lambda s: texts[s.day]), [])

    def test_presence_mismatch_when_oracle_has_text_but_we_do_not(self):
        s = Sample(ACT, FILE, date(2019, 1, 1))
        [m] = self.run_verify([s], lambda *_: OLD)
        self.assertEqual((m.reason, m.ours), ("presence", None))
        self.assertEqual(m.oracle, OLD)

    def test_presence_mismatch_when_we_have_text_but_oracle_does_not(self):
        [m] = self.run_verify([Sample(ACT, FILE, D1)], lambda *_: None)
        self.assertEqual((m.reason, m.oracle), ("presence", None))
        self.assertEqual(m.ours, OLD)

    def test_selection_mismatch_reports_wrong_commit(self):
        s = Sample(ACT, FILE, D2)
        [m] = self.run_verify([s], lambda *_: OLD)
        self.assertEqual(m.reason, "selection")
        self.assertEqual(m.sample, s)

    def test_parsing_mismatch_reports_wrong_lines(self):
        self.article.versions[1].lines[0].text = "(1) Altceva."
        [m] = self.run_verify([Sample(ACT, FILE, D2)], lambda *_: NEW)
        self.assertEqual(m.reason, "parsing")

    def test_old_folder_used_when_current_path_missing(self):
        old = "legea-veche"
        sha = self.fixture.commit(
            {f"{old}/{FILE}": NEW, f"{ACT}/{FILE}": None},
            author="Legea nr. 3/2002",
            trailers={"Kind": "amendment"},
            message="three",
        )
        self.assertNotEqual(OLD, NEW)
        self.assertIsNone(self.repo.show_file(sha, f"{ACT}/{FILE}"))
        self.article.versions[1].commit = sha
        mismatches = verify(
            self.repo,
            self.by_act,
            [Sample(ACT, FILE, D2)],
            old_folders={ACT: old},
            oracle=lambda *_: NEW,
        )
        self.assertEqual(mismatches, [])

    def test_oracle_error_propagates_through_verify(self):
        def broken(_s):
            raise OracleError(Sample(ACT, FILE, D1), 1, "boom")

        with self.assertRaises(OracleError):
            self.run_verify([Sample(ACT, FILE, D1)], broken)

    def test_results_keep_sample_order_with_threads(self):
        days = [D1 + timedelta(days=i) for i in range(12)]
        samples = [Sample(ACT, FILE, d) for d in days]

        def slow(s):
            time.sleep(0.02 * (len(days) - (s.day - D1).days))
            return "# Articolul 1\n\nzzz\n"

        mismatches = self.run_verify(samples, slow, workers=8)
        self.assertEqual([m.sample for m in mismatches], samples)


class SampleTest(unittest.TestCase):
    def setUp(self):
        self.by_act = {}
        for i in range(7):
            starts = [date(2015, 1, 1) + timedelta(days=100 * j) for j in range(i + 1)]
            versions = [
                make_version(d, None, "c", ["(1) x."]) for d in starts
            ]
            self.by_act[f"act-{i}"] = [
                make_article("art-1.md", versions),
                make_article("art-2.md", versions[:1]),
            ]

    def test_sample_is_deterministic_for_seed_and_includes_boundaries(self):
        first = sample(self.by_act, 20, 7, TODAY)
        self.assertEqual(first, sample(self.by_act, 20, 7, TODAY))
        self.assertNotEqual(first, sample(self.by_act, 20, 8, TODAY))
        self.assertEqual(len(first), len(set(first)))
        start = date(2015, 1, 1) + timedelta(days=500)
        self.assertIn(Sample("act-6", "art-1.md", start), first)
        self.assertIn(Sample("act-6", "art-1.md", start - timedelta(days=1)), first)
        random_ones = [s for s in first if s.act_path == "act-0"]
        for s in random_ones:
            self.assertGreaterEqual(s.day, date(2015, 1, 1) - timedelta(days=30))
            self.assertLessEqual(s.day, TODAY)

    def test_boundary_extras_are_capped(self):
        versions = [
            make_version(date(2000, 1, 1) + timedelta(days=j), None, "c", ["x"])
            for j in range(300)
        ]
        by_act = {"big": [make_article("art-1.md", versions)]}
        self.assertLessEqual(len(sample(by_act, 0, 1, TODAY)), 400)


class OracleTest(unittest.TestCase):
    def test_oracle_runs_script_from_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            fixture = FixtureRepo(tmp / "src")
            script = (
                "import sys\n"
                "if sys.argv[1:] == ['2020-05-05', 'act', 'art-1']:\n"
                "    print('# Articolul 1\\n\\ntext')\n"
                "else:\n"
                "    sys.exit('art-1 was not in the text on that day')\n"
            )
            fixture.commit(
                {"tools/on.py": script},
                author="Lexifina",
                trailers={"Kind": "documentation"},
                message="reader",
            )
            repo = GitRepo(tmp / "src")
            path = prepare_script(repo, tmp / "bin")
            self.assertEqual(path, tmp / "bin" / "on.py")
            hit = oracle_text(repo.path, Sample("act", "art-1.md", date(2020, 5, 5)), path)
            self.assertEqual(hit, "# Articolul 1\n\ntext\n")
            miss = oracle_text(repo.path, Sample("act", "art-1.md", date(2020, 5, 6)), path)
            self.assertIsNone(miss)

    def write_script(self, body):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        script = Path(tmp.name) / "on.py"
        script.write_text(body, encoding="utf-8", newline="\n")
        return Path(tmp.name), script

    def test_absence_message_means_none(self):
        cwd, script = self.write_script(
            "import sys\nsys.exit('x is not in the record on 2000-01-01')\n"
        )
        self.assertIsNone(oracle_text(cwd, Sample("act", "art-1.md", D1), script))

    def test_oracle_crash_raises(self):
        cwd, script = self.write_script("raise RuntimeError('boom')\n")
        with self.assertRaises(OracleError) as caught:
            oracle_text(cwd, Sample("act", "art-1.md", D1), script)
        self.assertIn("boom", str(caught.exception))


if __name__ == "__main__":
    unittest.main()


class OracleEnvironmentTests(unittest.TestCase):
    def test_keeps_only_the_variables_the_reader_needs(self):
        environment = {
            "PATH": "/usr/bin",
            "HOME": "/home/runner",
            "R2_SECRET_ACCESS_KEY": "secret",
            "CF_API_TOKEN": "token",
            "GITHUB_TOKEN": "gh",
        }
        self.assertEqual(oracle_environment(environment), {"PATH": "/usr/bin", "HOME": "/home/runner"})

    def test_the_reader_does_not_see_the_secrets_of_the_build(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "on.py"
            script.write_text("import os, sys\nsys.exit(3 if 'R2_SECRET_ACCESS_KEY' in os.environ else 0)\n", encoding="utf-8")
            with unittest.mock.patch.dict(os.environ, {"R2_SECRET_ACCESS_KEY": "secret"}):
                self.assertEqual(oracle_text(Path(directory), Sample("act", "art-1.md", date(2020, 5, 5)), script), "")
