import tempfile
import unittest
from datetime import date
from pathlib import Path

from build.tests.fixture import FixtureRepo
from build.textdelege.acts import ActMeta
from build.textdelege.freshness import load_freshness, load_freshness_summary, shard_files
from build.textdelege.gitrepo import GitRepo

HEADER = (
    "act,status,last_verified,check_due,method,newest_change,newest_change_date,"
    "change_in_repo,official_url\n"
)
CIVIL = (
    "codul-civil,stale,2026-06-25,2026-07-02,consolidated-form,legea-57-2026,2026-05-03,yes,"
    "https://legislatie.just.ro/Public/DetaliiDocument/109884\n"
)
FISCAL = "legea-207-2015,current,2026-06-25,2026-07-02,consolidated-form,,,no,\n"
OTHER = "alta-lege,current,2026-06-25,2026-07-02,consolidated-form,,,no,\n"


def meta(path, slug, alias=None):
    kind, year = path.split("/")[:2]
    return ActMeta(path, slug, kind, int(year), "1", "T", None, None, alias, "in-force",
                   "p", 1, date(2011, 1, 1), date(2011, 1, 1))


class FreshnessTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fixture = FixtureRepo(Path(tmp.name) / "src")
        self.repo = GitRepo(Path(tmp.name) / "src")

    def commit(self, files):
        self.fixture.commit(files, author="Lexifina", trailers={"Kind": "documentation"},
                            message="data")

    def test_shard_files_lists_only_the_shards_of_the_given_acts(self):
        index = {"shards": [
            {"shard": "lege/2009", "file": "lege-2009.csv"},
            {"shard": "lege/2015", "file": "data/freshness/lege-2015.csv"},
            {"shard": "lege/2020", "file": "lege-2020.csv"},
        ]}
        metas = [meta("lege/2009/287", "a"), meta("lege/2009/9", "b"), meta("lege/2015/207", "c")]
        self.assertEqual(
            shard_files(index, metas),
            ["data/freshness/lege-2009.csv", "data/freshness/lege-2015.csv"],
        )

    def test_load_freshness_matches_slug_and_parses_bool(self):
        self.commit({
            "data/freshness/index.json": '{"shards": [{"shard": "lege/2009", '
            '"file": "lege-2009.csv"}, {"shard": "lege/2015", "file": "lege-2015.csv"}]}',
            "data/freshness/lege-2009.csv": HEADER + CIVIL + OTHER,
            "data/freshness/lege-2015.csv": HEADER + FISCAL,
        })
        result = load_freshness(self.repo, [
            meta("lege/2009/287", "codul-civil", "codul-civil"),
            meta("lege/2015/207", "legea-207-2015", "codul-procedura-fiscala"),
        ])
        self.assertEqual(sorted(result), ["lege/2009/287", "lege/2015/207"])
        row = result["lege/2009/287"]
        self.assertEqual(row["status"], "stale")
        self.assertIs(row["change_in_repo"], True)
        self.assertEqual(row["newest_change"], "legea-57-2026")
        self.assertEqual(row["official_url"],
                         "https://legislatie.just.ro/Public/DetaliiDocument/109884")
        fiscal = result["lege/2015/207"]
        self.assertEqual(fiscal["status"], "current")
        self.assertIs(fiscal["change_in_repo"], False)
        self.assertIsNone(fiscal["newest_change"])
        self.assertIsNone(fiscal["official_url"])

    def test_unselected_shard_and_unknown_act_are_skipped(self):
        self.commit({
            "data/freshness/index.json": '{"shards": [{"shard": "lege/2009", '
            '"file": "lege-2009.csv"}]}',
            "data/freshness/lege-2009.csv": HEADER + CIVIL,
        })
        self.assertEqual(load_freshness(self.repo, [meta("lege/2009/5", "nu-exista")]), {})
        self.assertEqual(load_freshness(self.repo, [meta("lege/2010/5", "codul-civil")]), {})

    def test_summary(self):
        self.commit({"data/freshness.json": '{"as_of": "2026-06-25", '
                     '"checked_against_official_source": "2026-11-08", "x": 1}'})
        self.assertEqual(load_freshness_summary(self.repo),
                         {"as_of": "2026-06-25",
                          "checked_against_official_source": "2026-11-08"})
