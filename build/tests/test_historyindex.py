import gzip
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from build.tests.fixture import FixtureRepo
from build.textdelege import historyindex
from build.textdelege.gitrepo import GitRepo

FOLDER = "lege/2020/1"
OLD = "legea-1-2020"
OTHER = "lege/2021/2"
LAW = "Legea nr. 1/2020"


class FakeR2:
    def __init__(self):
        self.store, self.log = {}, []

    def get(self, key):
        self.log.append(("get", key))
        return self.store.get(key)

    def put(self, key, body, content_type, content_encoding=None):
        self.log.append(("put", key))
        self.store[key] = body

    def delete(self, key):
        self.log.append(("delete", key))
        self.store.pop(key, None)


class HistoryIndexTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.fixture = FixtureRepo(self.tmp / "src")
        self.repo = GitRepo(self.tmp / "src")
        self.cache = self.tmp / "cache"
        self.commit({f"{OLD}/art-0001.md": "a\n"}, "2020-01-01")
        self.commit({f"{FOLDER}/art-0001.md": "b\n", f"{OLD}/art-0001.md": None}, "2020-02-01")
        self.commit({f"{OTHER}/art-0001.md": "x\n"}, "2021-01-01")
        self.commit({f"{FOLDER}/art-0002.md": "c\n"}, None, kind="ruling")
        self.commit({f"{FOLDER}/art-0001.md": "d\n"}, "2020-03-01", kind="correction")

    def commit(self, files, in_force, kind="amendment"):
        trailers = {"Kind": kind, "Law": LAW}
        if in_force:
            trailers["In-force"] = in_force
        files = {name: text for name, text in files.items() if text is not None}
        return self.fixture.commit(files, author=LAW, trailers=trailers, message="Change")

    def folders(self):
        return [FOLDER, OLD, OTHER]

    def expected(self, paths):
        return self.repo.log(paths), self.repo.log_with_paths(paths), self.repo.newest_commit(paths)

    def assert_matches_git(self, index):
        for paths in ([FOLDER, OLD], [OTHER], [FOLDER], [OLD]):
            commits, entries, newest = self.expected(paths)
            self.assertEqual(index.log(self.repo, paths), commits)
            self.assertEqual(index.newest_commit(self.repo, paths), newest)
            got = index.log_with_paths(self.repo, paths)
            self.assertEqual([c for c, _ in got], [c for c, _ in entries])
            self.assertEqual(
                [sorted(p for p in names if not p.startswith(OLD) or True) for _, names in got],
                [sorted(names) for _, names in entries],
            )

    def test_index_gives_the_commits_of_the_path_limited_functions(self):
        index = historyindex.build(self.repo, self.repo.head(), self.folders())
        self.assert_matches_git(index)
        self.assertEqual(len(index.log(self.repo, [FOLDER, OLD])), 4)
        self.assertEqual(index.newest_commit(self.repo, ["missing"]), None)

    def test_the_repository_uses_the_index_only_for_covered_paths(self):
        self.repo.history = historyindex.build(self.repo, self.repo.head(), self.folders())
        self.assertTrue(self.repo.history.covers([FOLDER, OLD]))
        self.assertFalse(self.repo.history.covers([FOLDER, "elsewhere"]))
        with mock.patch.object(GitRepo, "_git", side_effect=AssertionError("git used")):
            self.assertEqual(len(self.repo.log([OTHER])), 1)
            self.assertIsNotNone(self.repo.newest_commit([FOLDER]))

    def test_incremental_update_equals_a_full_rebuild(self):
        index = historyindex.ensure(self.repo, self.cache, self.folders())
        self.commit({f"{FOLDER}/art-0003.md": "e\n"}, "2020-04-01")
        self.commit({f"{OTHER}/art-0002.md": "y\n"}, "2021-02-01")
        updated = historyindex.ensure(self.repo, self.cache, self.folders())
        self.assertEqual(updated.head, self.repo.head())
        full = historyindex.build(self.repo, self.repo.head(), self.folders())
        self.assertEqual(updated.to_json(), full.to_json())
        self.assert_matches_git(updated)
        self.assertIsNot(index, updated)

    def test_a_new_folder_gets_its_whole_history(self):
        historyindex.ensure(self.repo, self.cache, [FOLDER, OLD])
        index = historyindex.ensure(self.repo, self.cache, self.folders())
        self.assertEqual(index.touch.keys(), historyindex.build(self.repo, self.repo.head(), self.folders()).touch.keys())
        self.assert_matches_git(index)

    def test_unchanged_head_walks_nothing(self):
        historyindex.ensure(self.repo, self.cache, self.folders())
        with mock.patch.object(historyindex, "_walk", side_effect=AssertionError("walked")):
            index = historyindex.ensure(self.repo, self.cache, self.folders())
        self.assertEqual(index.head, self.repo.head())

    def test_a_head_that_is_no_longer_an_ancestor_discards_the_index(self):
        index = historyindex.ensure(self.repo, self.cache, self.folders())
        index.head = "0" * 40
        historyindex._save(self.cache, index, None)
        rebuilt = historyindex.ensure(self.repo, self.cache, self.folders())
        self.assertEqual(rebuilt.head, self.repo.head())
        self.assert_matches_git(rebuilt)

    def test_the_index_is_backed_by_r2_and_never_reuploaded_when_unchanged(self):
        r2 = FakeR2()
        historyindex.ensure(self.repo, self.cache, self.folders(), r2)
        self.assertEqual([c for c in r2.log if c[0] == "put"], [("put", historyindex.REMOTE_KEY)])
        self.assertEqual(
            historyindex.HistoryIndex.from_json(gzip.decompress(r2.store[historyindex.REMOTE_KEY]).decode("utf-8")).head,
            self.repo.head(),
        )
        historyindex.ensure(self.repo, self.cache, self.folders(), r2)
        self.assertEqual(len([c for c in r2.log if c[0] == "put"]), 1)
        fresh = self.tmp / "fresh"
        with mock.patch.object(historyindex, "_walk", side_effect=AssertionError("walked")):
            index = historyindex.ensure(self.repo, fresh, self.folders(), r2)
        self.assertEqual(index.head, self.repo.head())

    def test_wipe_removes_both_copies(self):
        r2 = FakeR2()
        historyindex.ensure(self.repo, self.cache, self.folders(), r2)
        historyindex.wipe(self.cache, r2)
        self.assertFalse(historyindex.local_path(self.cache).exists())
        self.assertEqual(r2.store, {})

    def test_folders_for_adds_old_folders_of_moved_acts(self):
        acts = {"acts": [
            {"path": FOLDER, "slug": OLD},
            {"path": OTHER, "slug": "other"},
            {"path": "constitutie/1991", "slug": "constitutia"},
        ]}
        paths = {"paths": {OLD: FOLDER, "constitutia": "constitutie/1991"}}
        self.assertEqual(
            historyindex.folders_for(acts, paths),
            sorted([FOLDER, OLD, OTHER, "constitutie/1991", "constitutia"]),
        )


if __name__ == "__main__":
    unittest.main()
