import subprocess
import tempfile
import unittest
from pathlib import Path

from build.tests.fixture import FixtureRepo


def git(path: Path, *args: str, input: str | None = None) -> str:
    return subprocess.run(
        ["git", *args], cwd=path, input=input, check=True, capture_output=True, text=True
    ).stdout


class FixtureRepoTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = Path(self._tmp.name)
        self.repo = FixtureRepo(self.path)

    def test_commit_sets_trailers_and_author(self):
        sha = self.repo.commit(
            {"lege/2009/287/art-0001.md": "# Articolul 1\nText.\n"},
            author="Legea nr. 71/2011",
            trailers={"In-force": "2011-10-01", "Kind": "law", "Law": "Legea nr. 71/2011"},
            message="Apply Legea nr. 71/2011",
        )
        self.assertEqual(git(self.path, "rev-parse", "HEAD").strip(), sha)
        self.assertEqual(git(self.path, "log", "-1", "--format=%aN").strip(), "Legea nr. 71/2011")
        self.assertEqual(
            git(self.path, "log", "-1", "--format=%aE").strip(), "legea-71-2011@legislatie.invalid"
        )
        self.assertEqual(git(self.path, "log", "-1", "--format=%cN").strip(), "Lexifina")
        body = git(self.path, "log", "-1", "--format=%B")
        trailers = git(self.path, "interpret-trailers", "--parse", input=body)
        self.assertIn("In-force: 2011-10-01", trailers.splitlines())

    def test_none_deletes_file(self):
        meta = dict(author="Lexifina", trailers={"Kind": "law"}, message="m")
        self.repo.commit({"a.md": "x\n"}, **meta)
        self.repo.commit({"a.md": None}, **meta)
        self.assertFalse((self.path / "a.md").exists())
        self.assertEqual(git(self.path, "ls-files").strip(), "")

    def test_tag_and_write_json(self):
        sha = self.repo.commit({"a.md": "x\n"}, author="Lexifina", trailers={"Kind": "law"}, message="m")
        self.repo.tag("v1", sha)
        self.assertEqual(git(self.path, "rev-parse", "v1^{commit}").strip(), sha)
        self.repo.write_json("data/acts.json", [{"id": "codul-civil"}])
        self.assertIn("Kind: documentation", git(self.path, "log", "-1", "--format=%B"))
        self.assertEqual(git(self.path, "log", "-1", "--format=%aN").strip(), "Lexifina")
        self.assertIn('"codul-civil"', (self.path / "data/acts.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
