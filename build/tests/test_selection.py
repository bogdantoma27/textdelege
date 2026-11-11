import tempfile
import unittest
from datetime import date
from pathlib import Path

from build.tests.fixture import FixtureRepo
from build.textdelege.gitrepo import GitRepo
from build.textdelege.selection import (
    act_commits,
    commit_for_day,
    in_force_days,
    tree_for_day,
)

FOLDER = "act"
OLD_FOLDER = "old-act"


class SelectionTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fixture = FixtureRepo(Path(tmp.name) / "src")
        self.repo = GitRepo(Path(tmp.name) / "src")

    def commit(self, files, in_force, kind="amendment", author="Legea nr. 138/2014", **extra):
        trailers = {"Kind": kind, "Law": author, **extra}
        if in_force:
            trailers["In-force"] = in_force
        return self.fixture.commit(files, author=author, trailers=trailers, message="Change")

    def commits(self):
        return act_commits(self.repo, FOLDER, OLD_FOLDER)

    def test_commit_for_day_picks_newest_commit_with_in_force_on_or_before_day(self):
        first = self.commit({f"{FOLDER}/art-0001.md": "a\n"}, "2014-10-19")
        second = self.commit({f"{FOLDER}/art-0001.md": "b\n"}, "2021-03-13")
        commits = self.commits()
        self.assertEqual(commit_for_day(commits, date(2015, 1, 1)).sha, first)
        self.assertEqual(commit_for_day(commits, date(2022, 1, 1)).sha, second)
        self.assertIsNone(commit_for_day(commits, date(2013, 1, 1)))
        self.assertEqual(in_force_days(commits), [date(2014, 10, 19), date(2021, 3, 13)])

    def test_later_correction_with_earlier_in_force_wins_its_day(self):
        first = self.commit({f"{FOLDER}/art-0001.md": "a\n"}, "2014-10-19")
        self.commit({f"{FOLDER}/art-0001.md": "b\n"}, "2021-03-13")
        correction = self.commit(
            {f"{FOLDER}/art-0001.md": "c\n"}, "2014-10-19", kind="correction", Corrects=first
        )
        commits = self.commits()
        self.assertEqual(commit_for_day(commits, date(2014, 10, 19)).sha, correction)
        self.assertEqual(commit_for_day(commits, date(2021, 3, 13)).sha, correction)
        self.assertEqual(in_force_days(commits), [date(2014, 10, 19), date(2021, 3, 13)])

    def test_commit_without_in_force_never_supplies_text(self):
        first = self.commit({f"{FOLDER}/art-0001.md": "a\n"}, "2014-10-19")
        self.commit({f"{FOLDER}/art-0001.md": "b\n"}, None)
        self.assertEqual(
            commit_for_day(self.commits(), date(2030, 1, 1)).sha,
            first,
        )

    def test_ruling_commits_are_ignored(self):
        first = self.commit({f"{FOLDER}/art-0001.md": "a\n"}, "2014-10-19")
        self.commit({f"{FOLDER}/art-0001.md": "b\n"}, "2015-01-01", kind="ruling")
        self.commit({f"{FOLDER}/art-0001.md": "c\n"}, "2016-01-01", kind="documentation")
        commits = self.commits()
        self.assertEqual([c.sha for c in commits], [first])
        self.assertEqual(commit_for_day(commits, date(2020, 1, 1)).sha, first)

    def test_tree_for_day_reads_old_folder_before_layout_move(self):
        self.commit({f"{OLD_FOLDER}/art-0001.md": "old\n"}, "2014-10-19")
        self.commit(
            {
                f"{OLD_FOLDER}/art-0001.md": None,
                f"{FOLDER}/art-0001.md": "new\n",
                f"{FOLDER}/README.md": "x\n",
                f"{FOLDER}/sub/art-0002.md": "y\n",
            },
            "2021-03-13",
        )
        commits = self.commits()
        before = tree_for_day(self.repo, commits, date(2015, 1, 1), FOLDER, OLD_FOLDER)
        after = tree_for_day(self.repo, commits, date(2022, 1, 1), FOLDER, OLD_FOLDER)
        self.assertEqual(set(before), {"art-0001.md"})
        with self.repo.blobs() as reader:
            self.assertEqual(reader.read(before["art-0001.md"]), "old\n")
            self.assertEqual(set(after), {"art-0001.md"})
            self.assertEqual(reader.read(after["art-0001.md"]), "new\n")
        self.assertEqual(tree_for_day(self.repo, commits, date(2010, 1, 1), FOLDER, OLD_FOLDER), {})


if __name__ == "__main__":
    unittest.main()
