import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from build.tests.fixture import FixtureRepo
from build.textdelege import gitrepo
from build.textdelege.gitrepo import GitError, GitRepo

PATH = "legea-71-2011/text.md"


class GitRepoTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.fixture = FixtureRepo(self.tmp / "src")
        self.repo = GitRepo(self.tmp / "src")

    def commit(self, files, message="msg", trailers=None):
        return self.fixture.commit(
            files,
            author="Legea nr. 71/2011",
            trailers=trailers or {"Kind": "amendment"},
            message=message,
        )

    def test_log_parses_trailers_and_skips_merges(self):
        first = self.commit({PATH: "a\n"}, "First", {"Kind": "base", "Redates": "x"})
        self.fixture._git("checkout", "-q", "-b", "side")
        side = self.commit({"other.md": "o\n"}, "Side")
        self.fixture._git("checkout", "-q", "main")
        third = self.commit({PATH: "b\n"}, "Third", {"Redates": "y"})
        self.fixture._git("merge", "-q", "--no-ff", "-m", "Merge side", "side")
        commits = self.repo.log([])
        self.assertEqual([c.sha for c in commits], [third, side, first])
        self.assertEqual(commits[0].sha, third)
        self.assertEqual(commits[2].sha, first)
        self.assertEqual(commits[2].trailers, {"Kind": ["base"], "Redates": ["x"]})
        self.assertEqual(commits[0].trailers, {"Redates": ["y"]})
        self.assertEqual(commits[0].author, "Legea nr. 71/2011")
        self.assertEqual(commits[0].author_email, "legea-71-2011@legislatie.invalid")

    def test_log_with_paths_lists_touched_files_relative_to_root(self):
        first = self.commit({PATH: "a\n", "legea-71-2011/art-0001.md": "x\n"}, "First")
        second = self.commit({"legea-71-2011/art-0001.md": None, "other.md": "o\n"}, "Second")
        entries = self.repo.log_with_paths(["legea-71-2011"])
        self.assertEqual([c.sha for c, _ in entries], [second, first])
        self.assertEqual(entries[0][1], {"legea-71-2011/art-0001.md"})
        self.assertEqual(entries[1][1], {PATH, "legea-71-2011/art-0001.md"})
        self.assertEqual(entries[1][0].trailers, {"Kind": ["amendment"]})

    def test_log_filters_by_path(self):
        first = self.commit({PATH: "a\n"}, "First")
        self.commit({"other.md": "o\n"}, "Other")
        self.assertEqual([c.sha for c in self.repo.log([PATH])], [first])

    def test_ls_tree_maps_files_to_blobs(self):
        sha = self.commit({PATH: "a\n", "legea-71-2011/sub/x.md": "x\n", "other.md": "o\n"})
        tree = self.repo.ls_tree(sha, "legea-71-2011")
        self.assertEqual(set(tree), {"text.md", "sub/x.md"})
        with self.repo.blobs() as reader:
            self.assertEqual(reader.read(tree["text.md"]), "a\n")

    def test_blob_normalises_cedilla_to_comma_below(self):
        sha = self.commit({PATH: "Codul ţării şŞŢ\n"})
        with self.repo.blobs() as reader:
            text = reader.read(self.repo.ls_tree(sha, "legea-71-2011")["text.md"])
        self.assertIn("ț", text)
        self.assertEqual(text, "Codul țării șȘȚ\n")

    def test_blobs_reader_reads_many_oids(self):
        files = {f"d/f{i}.md": f"text {i} ţară\n" * (i + 1) for i in range(40)}
        sha = self.commit(files)
        tree = self.repo.ls_tree(sha, "d")
        with self.repo.blobs() as reader:
            for name, oid in tree.items():
                self.assertEqual(reader.read(oid), files[f"d/{name}"].replace("ţ", "ț"))
            self.assertEqual(reader.read(tree["f3.md"]), reader.read(tree["f3.md"]))

    def test_blobs_reader_normalises_cedilla_and_accepts_revision_paths(self):
        self.commit({PATH: "Codul ţării şŞŢ\n"})
        with self.repo.blobs() as reader:
            self.assertEqual(reader.read(f"HEAD:{PATH}"), "Codul țării șȘȚ\n")

    def test_blobs_reader_missing_oid_raises_and_reader_stays_usable(self):
        sha = self.commit({PATH: "a\n"})
        oid = self.repo.ls_tree(sha, "legea-71-2011")["text.md"]
        with self.repo.blobs() as reader:
            with self.assertRaises(GitError):
                reader.read("0" * 40)
            self.assertEqual(reader.read(oid), "a\n")
            self.assertIsNone(reader.read_or_none("HEAD:nope.md"))
            self.assertEqual(reader.read(oid), "a\n")

    def test_blobs_reader_terminates_process_on_exit_even_on_error(self):
        self.commit({PATH: "a\n"})
        with self.repo.blobs() as reader:
            process = reader._process
            self.assertIsNone(process.poll())
        self.assertIsNotNone(process.poll())
        with self.assertRaises(RuntimeError):
            with self.repo.blobs() as reader:
                process = reader._process
                raise RuntimeError("boom")
        self.assertIsNotNone(process.poll())

    def test_blobs_reader_handles_spaces_romanian_paths_large_and_non_utf8_blobs(self):
        folder = "jurisprudenta/a b"
        big = "ab" * 50_000
        self.commit({f"{folder}/ș.md": "ț ok", "big.md": big})
        (self.tmp / "src" / "latin.md").write_bytes("é".encode("latin-1"))
        self.commit({"next.md": "n"})
        with self.repo.blobs() as reader:
            self.assertEqual(reader.read(f"HEAD:{folder}/ș.md"), "ț ok")
            self.assertEqual(reader.read("HEAD:big.md"), big)
            with self.assertRaises(UnicodeDecodeError):
                reader.read("HEAD:latin.md")
            self.assertEqual(reader.read("HEAD:next.md"), "n")

    def test_blobs_reader_rejects_non_blob_objects_and_stays_usable(self):
        self.commit({PATH: "a"})
        with self.repo.blobs() as reader:
            with self.assertRaises(GitError):
                reader.read("HEAD")
            with self.assertRaises(GitError):
                reader.read("HEAD:legea-71-2011")
            self.assertEqual(reader.read(f"HEAD:{PATH}"), "a")

    def test_blobs_reader_truncated_output_raises(self):
        self.commit({PATH: "a" * 1000})
        with self.repo.blobs() as reader:
            process = reader._process
            process.stdin.write(f"HEAD:{PATH}".encode() + bytes([10]))
            process.stdin.flush()
            process.stdout.readline()
            process.kill()
            process.wait()
            process.stdout.read()
            with self.assertRaises(GitError):
                reader.read(f"HEAD:{PATH}")

    def test_is_ancestor(self):
        first = self.commit({PATH: "a\n"})
        second = self.commit({PATH: "b\n"})
        self.assertTrue(self.repo.is_ancestor(first, second))
        self.assertFalse(self.repo.is_ancestor(second, first))
        self.assertEqual(self.repo.head(), second)

    def test_show_file_returns_none_for_missing_path(self):
        sha = self.commit({PATH: "ţ\n"})
        self.assertEqual(self.repo.show_file(sha, PATH), "ț\n")
        self.assertIsNone(self.repo.show_file(sha, "missing.md"))

    def test_log_handles_colon_in_trailer_value_and_no_trailers(self):
        url = "https://legislatie.just.ro/Public/DetaliiDocument/1"
        self.commit({PATH: "a\n"}, "With", {"Source": url})
        self.fixture._git("commit", "-q", "--allow-empty", "-m", "Bare")
        commits = self.repo.log([])
        self.assertEqual(commits[0].trailers, {})
        self.assertEqual(commits[1].trailers, {"Source": [url]})

    def test_show_file_raises_on_bad_sha(self):
        self.commit({PATH: "a\n"})
        with self.assertRaises(GitError):
            self.repo.show_file("0" * 40, PATH)

    def test_git_error_carries_command_and_stderr(self):
        with self.assertRaises(GitError) as ctx:
            self.repo.show_file("0" * 40, PATH)
        self.assertIn("git rev-parse", str(ctx.exception))


def missing_blobs(repo, *paths):
    listing = gitrepo.run_git(
        ["rev-list", "--objects", "--missing=print", "HEAD", "--", *paths], repo.path
    ).stdout
    return [line[1:] for line in listing.splitlines() if line.startswith("?")]


def has_blob(repo, oid):
    result = gitrepo.run_git(
        ["cat-file", "-e", oid], repo.path, env={"GIT_NO_LAZY_FETCH": "1"}
    )
    return result.returncode == 0


class CloneTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.src = FixtureRepo(self.tmp / "src")
        self.sha = self.commit({PATH: "a\n", "other.md": "o\n"}, "First")
        self.bare = self.tmp / "bare.git"
        subprocess.run(
            ["git", "clone", "-q", "--bare", str(self.tmp / "src"), str(self.bare)], check=True
        )
        for key in ("uploadpack.allowFilter", "uploadpack.allowAnySHA1InWant"):
            subprocess.run(["git", "config", key, "true"], cwd=self.bare, check=True)

    def commit(self, files, message="msg"):
        return self.src.commit(
            files, author="Legea nr. 71/2011", trailers={"Kind": "base"}, message=message
        )

    def publish(self):
        subprocess.run(["git", "push", "-q", str(self.bare), "main"], cwd=self.tmp / "src", check=True)

    def clone(self):
        return GitRepo.clone(self.bare.as_uri(), self.tmp / "dest")

    def count_fetches(self):
        real = gitrepo.run_git
        calls = []

        def counting(args, cwd, input=None, env=None):
            if "fetch" in args and "--stdin" in args:
                calls.append(input)
            return real(args, cwd, input, env)

        return calls, mock.patch.object(gitrepo, "run_git", counting)

    def test_clone_is_blobless_without_checkout(self):
        repo = self.clone()
        promisor = gitrepo.run_git(["config", "--get", "remote.origin.promisor"], repo.path)
        self.assertEqual(promisor.stdout.strip(), "true")
        self.assertEqual(sorted(p.name for p in repo.path.iterdir()), [".git"])
        self.assertEqual(len(missing_blobs(repo)), 2)
        self.assertEqual(repo.show_file(repo.head(), PATH), "a\n")

    def test_clone_accepts_relative_destination(self):
        work = self.tmp / "work"
        work.mkdir()
        previous = os.getcwd()
        self.addCleanup(os.chdir, previous)
        os.chdir(work)
        repo = GitRepo.clone(self.bare.as_uri(), Path("x") / "repo")
        expected = work.resolve() / "x" / "repo"
        self.assertEqual(repo.path, expected)
        self.assertTrue((expected / ".git").exists())
        self.assertEqual(sorted(p.name for p in work.iterdir()), ["x"])
        self.assertEqual(sorted(p.name for p in (work / "x").iterdir()), ["repo"])

    def test_fetch_updates_clone(self):
        repo = self.clone()
        new = self.commit({PATH: "b\n"}, "Second")
        self.publish()
        repo.fetch()
        self.assertTrue(repo.is_ancestor(self.sha, "origin/main"))
        self.assertEqual(repo.show_file("origin/main", PATH), "b\n")
        self.assertEqual(gitrepo.run_git(["rev-parse", "origin/main"], repo.path).stdout.strip(), new)

    def test_fetch_advances_head(self):
        repo = self.clone()
        new = self.commit({PATH: "c\n"}, "Third")
        self.publish()
        repo.fetch()
        self.assertEqual(repo.head(), new)
        self.assertEqual(repo.show_file(repo.head(), PATH), "c\n")

    def test_prefetch_blobs_fetches_every_missing_blob_in_one_batch(self):
        for version in "bcd":
            self.commit({PATH: f"{version}\n"})
        self.publish()
        repo = self.clone()
        self.assertEqual(len(missing_blobs(repo, PATH)), 4)
        calls, patched = self.count_fetches()
        with patched:
            fetched = repo.prefetch_blobs(missing_blobs(repo, PATH))
        self.assertEqual(fetched, 4)
        self.assertEqual(len(calls), 1)
        self.assertEqual(missing_blobs(repo, PATH), [])
        self.assertEqual(len(missing_blobs(repo)), 1)

    def test_prefetch_blobs_does_nothing_when_nothing_is_missing(self):
        repo = self.clone()
        repo.prefetch_blobs(missing_blobs(repo, PATH))
        calls, patched = self.count_fetches()
        with patched:
            self.assertEqual(repo.prefetch_blobs(missing_blobs(repo, PATH)), 0)
        self.assertEqual(calls, [])

    def test_prefetch_blobs_ignores_empty_input_and_duplicates(self):
        self.commit({PATH: "b\n"})
        self.publish()
        repo = self.clone()
        self.assertEqual(repo.prefetch_blobs([]), 0)
        oids = missing_blobs(repo, PATH)
        self.assertEqual(repo.prefetch_blobs(oids + oids), 2)
        self.assertEqual(missing_blobs(repo, PATH), [])

    def test_prefetch_blobs_batches_over_10000(self):
        for version in "bcd":
            self.commit({PATH: f"{version}\n"})
        self.publish()
        repo = self.clone()
        calls, patched = self.count_fetches()
        with patched, mock.patch.object(gitrepo, "FETCH_BATCH", 2):
            fetched = repo.prefetch_blobs(missing_blobs(repo, PATH))
        self.assertEqual(fetched, 4)
        self.assertEqual(len(calls), 2)
        self.assertEqual(missing_blobs(repo, PATH), [])

    def test_prefetch_head_fetches_only_requested_files_and_folders(self):
        self.commit({
            "data/a.json": "a\n", "data/b.json": "b\n", "dec/1/meta.json": "m\n",
            "dec/1/text.md": "t\n", "dec/2/meta.json": "n\n", "tools/on.py": "p\n",
        })
        self.publish()
        repo = self.clone()
        fetched = repo.prefetch_head(["data/a.json", "dec/1/", "tools/on.py", "absent.txt"])
        self.assertEqual(fetched, 4)
        present = set()
        for segment in ("data", "dec", "tools"):
            for name, oid in repo.ls_tree(repo.head(), segment).items():
                if has_blob(repo, oid):
                    present.add(f"{segment}/{name}")
        self.assertEqual(
            present, {"data/a.json", "dec/1/meta.json", "dec/1/text.md", "tools/on.py"}
        )

    def test_prefetch_head_skips_present_objects(self):
        self.commit({"data/a.json": "a\n", "data/b.json": "b\n"})
        self.publish()
        repo = self.clone()
        self.assertEqual(repo.prefetch_head(["data/a.json"]), 1)
        calls, patched = self.count_fetches()
        with patched:
            self.assertEqual(repo.prefetch_head(["data/a.json"]), 0)
            self.assertEqual(calls, [])
            self.assertEqual(repo.prefetch_head(["data/"]), 1)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
