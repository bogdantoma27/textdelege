import os
import shutil
import stat
import subprocess
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path

LOG_FIELDS = "%H%x1f%aN%x1f%aE%x1f%(trailers:only,unfold)"
LOG_FORMAT = LOG_FIELDS + "%x1e"
PATHS_LOG_FORMAT = "%x1e" + LOG_FIELDS + "%x1d"
FETCH_BATCH = 10_000
MISSING_PATH_MARKERS = ("does not exist in", "exists on disk, but not in")
CEDILLA_TO_COMMA = str.maketrans(
    {"Ş": "Ș", "ş": "ș", "Ţ": "Ț", "ţ": "ț"}
)


class GitError(Exception):
    def __init__(self, cmd: list[str], stderr: str, returncode: int):
        super().__init__(f"{' '.join(cmd)} failed: {stderr.strip()}")
        self.cmd = cmd
        self.returncode = returncode
        self.stderr = stderr


@dataclass(frozen=True)
class Commit:
    sha: str
    author: str
    author_email: str
    trailers: dict[str, list[str]]


def run_git(
    args: list[str], cwd: Path, input: str | None = None, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        env={**os.environ, "LC_ALL": "C", **(env or {})},
        input=None if input is None else input.encode("utf-8"),
        check=False,
        capture_output=True,
    )
    # Bytes in, bytes out: text mode would turn the "\n" of the input into "\r\n" on Windows.
    return subprocess.CompletedProcess(
        result.args,
        result.returncode,
        _universal_newlines(result.stdout.decode("utf-8")),
        _universal_newlines(result.stderr.decode("utf-8", errors="replace")),
    )


def _universal_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _run_checked(
    args: list[str], cwd: Path, input: str | None = None, env: dict[str, str] | None = None
) -> str:
    result = run_git(args, cwd, input, env)
    if result.returncode != 0:
        raise GitError(["git", *args], result.stderr, result.returncode)
    return result.stdout


def _make_writable_and_retry(function, path, _error) -> None:
    os.chmod(path, stat.S_IWRITE)
    function(path)


def remove_tree(path: Path) -> None:
    shutil.rmtree(path, onexc=_make_writable_and_retry)


def normalise_text(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(CEDILLA_TO_COMMA)


def _parse_trailers(block: str) -> dict[str, list[str]]:
    trailers: dict[str, list[str]] = {}
    for line in block.splitlines():
        key, separator, value = line.partition(": ")
        if separator:
            trailers.setdefault(key, []).append(value.strip())
    return trailers


def _parse_commit(record: str) -> Commit:
    sha, author, email, trailers = record.split("\x1f")
    return Commit(
        sha=sha,
        author=author,
        author_email=email,
        trailers=_parse_trailers(trailers),
    )


class BlobReader:
    def __init__(self, path: Path):
        self._command = ["git", "cat-file", "--batch"]
        # stderr is discarded: nobody drains it, and a full pipe would block git.
        self._process = subprocess.Popen(
            self._command,
            cwd=path,
            env={**os.environ, "LC_ALL": "C"},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

    def read_or_none(self, name: str) -> str | None:
        process = self._process
        if process.poll() is not None:
            raise GitError(self._command, "cat-file --batch exited", process.returncode)
        try:
            process.stdin.write(name.encode("utf-8") + b"\n")
            process.stdin.flush()
        except OSError as error:
            raise GitError(self._command, f"cannot request {name}: {error}", 1) from error
        header = process.stdout.readline().decode("utf-8", errors="replace").rstrip("\n")
        if not header:
            raise GitError(self._command, f"no answer for {name}", process.poll() or 1)
        parts = header.rsplit(" ", 2)
        if len(parts) == 3 and parts[2].isdigit():
            size = int(parts[2])
            data = process.stdout.read(size + 1)
            if parts[1] != "blob":
                raise GitError(self._command, f"{name} is a {parts[1]}, not a blob", 1)
            if len(data) != size + 1 or not data.endswith(b"\n"):
                raise GitError(self._command, f"truncated read of {name}", process.poll() or 1)
            return normalise_text(_universal_newlines(data[:-1].decode("utf-8")))
        if header.endswith(" missing"):
            return None
        raise GitError(self._command, header, 1)

    def read(self, name: str) -> str:
        text = self.read_or_none(name)
        if text is None:
            raise GitError(self._command, f"{name} missing", 1)
        return text

    def close(self) -> None:
        process = self._process
        try:
            process.stdin.close()
        except OSError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        except BaseException:
            process.kill()
            process.wait()
            raise
        finally:
            process.stdout.close()

    def __enter__(self) -> "BlobReader":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


class GitRepo:
    def __init__(self, path: Path):
        self.path = Path(path).resolve()
        self._fetch_lock = threading.Lock()
        self.history = None

    def _git(self, *args: str) -> str:
        return _run_checked(list(args), self.path)

    def log(self, paths: list[str]) -> list[Commit]:
        if self.history is not None and self.history.covers(paths):
            return self.history.log(self, paths)
        output = self._git("log", "--no-merges", f"--format={LOG_FORMAT}", "--", *paths)
        return [
            _parse_commit(record.strip("\n"))
            for record in output.split("\x1e")
            if record.strip()
        ]

    def newest_commit(self, paths: list[str]) -> str | None:
        if self.history is not None and self.history.covers(paths):
            return self.history.newest_commit(self, paths)
        output = self._git("log", "--no-merges", "-n", "1", "--format=%H", "--", *paths)
        return output.strip() or None

    def log_with_paths(self, paths: list[str]) -> list[tuple[Commit, set[str]]]:
        if self.history is not None and self.history.covers(paths):
            return self.history.log_with_paths(self, paths)
        output = self._git(
            "-c",
            "core.quotepath=false",
            "log",
            "--no-merges",
            "--name-only",
            f"--format={PATHS_LOG_FORMAT}",
            "--",
            *paths,
        )
        entries = []
        for record in output.split("\x1e"):
            if not record.strip():
                continue
            fields, _separator, names = record.partition("\x1d")
            touched = {name for name in names.splitlines() if name}
            entries.append((_parse_commit(fields.strip("\n")), touched))
        return entries

    def ls_tree(self, sha: str, path: str) -> dict[str, str]:
        output = self._git("ls-tree", "-r", "-z", sha, "--", path)
        prefix = path.rstrip("/") + "/"
        files = {}
        for entry in output.split("\0"):
            if not entry:
                continue
            meta, name = entry.split("\t", 1)
            _mode, kind, blob_sha = meta.split()
            if kind == "blob":
                files[name.removeprefix(prefix)] = blob_sha
        return files

    def blobs(self) -> BlobReader:
        return BlobReader(self.path)

    def head(self) -> str:
        return self._git("rev-parse", "HEAD").strip()

    def is_ancestor(self, old: str, new: str) -> bool:
        result = run_git(["merge-base", "--is-ancestor", old, new], self.path)
        if result.returncode > 1:
            raise GitError(
                ["git", "merge-base", "--is-ancestor", old, new],
                result.stderr,
                result.returncode,
            )
        return result.returncode == 0

    def show_file(self, sha: str, path: str) -> str | None:
        result = run_git(["show", f"{sha}:{path}"], self.path)
        if result.returncode == 0:
            return normalise_text(result.stdout)
        if any(marker in result.stderr for marker in MISSING_PATH_MARKERS):
            self._git("rev-parse", "--verify", "--quiet", f"{sha}^{{tree}}")
            return None
        raise GitError(["git", "show", f"{sha}:{path}"], result.stderr, result.returncode)

    def show_bytes(self, sha: str, path: str) -> bytes | None:
        result = subprocess.run(
            ["git", "show", f"{sha}:{path}"],
            cwd=self.path,
            env={**os.environ, "LC_ALL": "C"},
            check=False,
            capture_output=True,
        )
        if result.returncode == 0:
            return result.stdout
        stderr = result.stderr.decode("utf-8", errors="replace")
        if any(marker in stderr for marker in MISSING_PATH_MARKERS):
            self._git("rev-parse", "--verify", "--quiet", f"{sha}^{{tree}}")
            return None
        raise GitError(["git", "show", f"{sha}:{path}"], stderr, result.returncode)

    @classmethod
    def clone(cls, url: str, dest: Path) -> "GitRepo":
        dest = Path(dest).resolve()
        parent = dest.parent
        parent.mkdir(parents=True, exist_ok=True)
        _run_checked(
            [
                "clone",
                "--filter=blob:none",
                "--no-checkout",
                "--single-branch",
                "--branch",
                "main",
                url,
                str(dest),
            ],
            parent,
        )
        return cls(dest)

    def remote_url(self) -> str:
        return self._git("remote", "get-url", "origin").strip()

    def fetch(self) -> None:
        self._git("fetch", "--filter=blob:none", "origin", "main")
        self._git("update-ref", "refs/heads/main", "refs/remotes/origin/main")

    def prefetch_blobs(self, oids: list[str]) -> int:
        unique = list(dict.fromkeys(oids))
        if not unique:
            return 0
        checked = _run_checked(
            ["cat-file", "--batch-check"],
            self.path,
            "\n".join(unique) + "\n",
            {"GIT_NO_LAZY_FETCH": "1"},
        )
        missing = [line.split()[0] for line in checked.splitlines() if line.endswith(" missing")]
        return self._fetch_blobs(missing)

    def prefetch_head(self, paths: list[str]) -> int:
        wanted = {path.rstrip("/") for path in paths}
        segments = sorted({path.split("/", 1)[0] for path in wanted})
        blobs = []
        for segment in segments:
            output = self._git("ls-tree", "-r", "-z", "HEAD", "--", segment)
            for entry in output.split("\0"):
                if not entry:
                    continue
                meta, name = entry.split("\t", 1)
                _mode, kind, oid = meta.split()
                if kind == "blob" and self._is_requested(name, wanted):
                    blobs.append(oid)
        if not blobs:
            return 0
        checked = _run_checked(
            ["cat-file", "--batch-check"],
            self.path,
            "\n".join(blobs) + "\n",
            {"GIT_NO_LAZY_FETCH": "1"},
        )
        missing = [line.split()[0] for line in checked.splitlines() if line.endswith(" missing")]
        return self._fetch_blobs(list(dict.fromkeys(missing)))

    @staticmethod
    def _is_requested(name: str, wanted: set[str]) -> bool:
        if name in wanted:
            return True
        parts = name.split("/")
        return any("/".join(parts[:end]) in wanted for end in range(1, len(parts)))

    def _fetch_blobs(self, oids: list[str]) -> int:
        with self._fetch_lock:
            self._fetch_batches(oids)
        return len(oids)

    def _fetch_batches(self, oids: list[str]) -> None:
        for start in range(0, len(oids), FETCH_BATCH):
            batch = oids[start : start + FETCH_BATCH]
            _run_checked(
                [
                    "-c",
                    "fetch.negotiationAlgorithm=noop",
                    "fetch",
                    "origin",
                    "--no-tags",
                    "--no-write-fetch-head",
                    "--recurse-submodules=no",
                    "--filter=blob:none",
                    "--stdin",
                ],
                self.path,
                "\n".join(batch) + "\n",
            )
        return len(oids)
