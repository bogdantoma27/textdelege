import gzip
import json
import os
import subprocess
import sys
import threading
from collections.abc import Iterator
from pathlib import Path

from .gitrepo import Commit, GitError, GitRepo, _parse_commit

FORMAT = 1
LOCAL_NAME = "history-index.json.gz"
REMOTE_KEY = "build-cache/history-index.json.gz"
REMOTE_TYPE = "application/gzip"
RECORD = chr(0x1e)
GROUP = chr(0x1d)
NEWLINE = chr(10)
CRLF = chr(13) + chr(10)
WALK_FORMAT = "%x1e%H%x1f%aN%x1f%aE%x1f%(trailers:only,unfold)%x1d"


def folders_for(acts_json: dict, paths_json: dict) -> list[str]:
    folders = set()
    aliases = paths_json.get("paths", {})
    for row in acts_json["acts"]:
        folders.add(row["path"])
        if row["slug"] != row["path"] and aliases.get(row["slug"]) == row["path"]:
            folders.add(row["slug"])
    return sorted(folders)


def _walk(repo: GitRepo, revisions: list[str], pathspec: list[str] | None = None) -> Iterator[tuple[Commit, list[str]]]:
    command = [
        "git", "-c", "core.quotepath=false", "log", "--no-merges", "--no-renames", "--name-only",
        f"--format={WALK_FORMAT}", *revisions,
    ]
    if pathspec:
        command += ["--", *pathspec]
    process = subprocess.Popen(
        command,
        cwd=repo.path,
        env={**os.environ, "LC_ALL": "C"},
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    lines: list[str] | None = None
    names: list[str] = []
    commit: Commit | None = None

    try:
        for raw in process.stdout:
            line = raw.decode("utf-8").rstrip(CRLF)
            if line.startswith(RECORD):
                if commit is not None:
                    yield commit, names
                lines, names, commit = [line[1:]], [], None
            elif lines is not None and commit is None:
                lines.append(line)
            elif line:
                names.append(line)
            if lines is not None and commit is None and GROUP in lines[-1]:
                lines[-1] = lines[-1].split(GROUP)[0]
                commit = _parse_commit(NEWLINE.join(lines).strip(NEWLINE))
        if commit is not None:
            yield commit, names
    finally:
        process.stdout.close()
        code = process.wait()
    if code != 0:
        raise GitError(command, "log walk failed", code)


class HistoryIndex:
    def __init__(self, head: str, folders: list[str], commits: dict, touch: dict):
        self.head = head
        self.folders = set(folders)
        self.commits = commits
        self.touch = touch
        self._ordinals: dict[str, int] | None = None
        self._lock = threading.Lock()
        self._depth = max((len(f.split("/")) for f in self.folders), default=1)

    def covers(self, paths: list[str]) -> bool:
        return bool(paths) and all(path.rstrip("/") in self.folders for path in paths)

    def _commit(self, sha: str) -> Commit:
        author, email, trailers = self.commits[sha]
        return Commit(sha=sha, author=author, author_email=email, trailers=trailers)

    def _ordinal(self, repo: GitRepo) -> dict[str, int]:
        with self._lock:
            if self._ordinals is None:
                listing = repo._git("rev-list", "--no-merges", self.head).split()
                self._ordinals = {sha: position for position, sha in enumerate(listing)}
            return self._ordinals

    def entries(self, repo: GitRepo, paths: list[str]) -> list[tuple[str, list[str]]]:
        lists = [(path.rstrip("/"), self.touch.get(path.rstrip("/"), [])) for path in paths]
        lists = [item for item in lists if item[1]]
        if not lists:
            return []
        if len(lists) == 1:
            folder, items = lists[0]
            return [(sha, [f"{folder}/{name}" for name in names]) for sha, names in items]
        merged: dict[str, list[str]] = {}
        for folder, items in lists:
            for sha, names in items:
                merged.setdefault(sha, []).extend(f"{folder}/{name}" for name in names)
        ordinals = self._ordinal(repo)
        return sorted(merged.items(), key=lambda item: ordinals[item[0]])

    def log(self, repo: GitRepo, paths: list[str]) -> list[Commit]:
        return [self._commit(sha) for sha, _names in self.entries(repo, paths)]

    def log_with_paths(self, repo: GitRepo, paths: list[str]) -> list[tuple[Commit, set[str]]]:
        return [(self._commit(sha), set(names)) for sha, names in self.entries(repo, paths)]

    def newest_commit(self, repo: GitRepo, paths: list[str]) -> str | None:
        entries = self.entries(repo, paths)
        return entries[0][0] if entries else None

    def to_json(self) -> str:
        return json.dumps(
            {
                "format": FORMAT,
                "head": self.head,
                "folders": sorted(self.folders),
                "commits": self.commits,
                "touch": self.touch,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )

    @classmethod
    def from_json(cls, text: str) -> "HistoryIndex":
        data = json.loads(text)
        if data["format"] != FORMAT:
            raise ValueError("unknown history index format")
        return cls(data["head"], data["folders"], data["commits"], data["touch"])

    def _record(self, commit: Commit, names: list[str], folders: set[str], into: dict) -> None:
        grouped: dict[str, list[str]] = {}
        for path in names:
            parts = path.split("/")
            for size in range(1, min(len(parts), self._depth + 1)):
                folder = "/".join(parts[:size])
                if folder in folders:
                    grouped.setdefault(folder, []).append("/".join(parts[size:]))
        if not grouped:
            return
        self.commits[commit.sha] = [commit.author, commit.author_email, commit.trailers]
        for folder, relative in grouped.items():
            into.setdefault(folder, []).append([commit.sha, relative])

    def extend(self, repo: GitRepo, head: str, wanted: list[str]) -> None:
        known = set(self.folders)
        added = [folder for folder in wanted if folder not in known]
        fresh: dict[str, list] = {}
        if head != self.head:
            for commit, names in _walk(repo, [f"{self.head}..{head}"]):
                self._record(commit, names, known, fresh)
        for folder, items in fresh.items():
            self.touch[folder] = items + self.touch.get(folder, [])
        if added:
            wanted_new = set(added)
            gathered: dict[str, list] = {}
            for commit, names in _walk(repo, [head], added):
                self._record(commit, names, wanted_new, gathered)
            self.touch.update(gathered)
        self.folders |= set(wanted)
        self._depth = max((len(f.split("/")) for f in self.folders), default=1)
        self.head = head
        self._ordinals = None


def build(repo: GitRepo, head: str, folders: list[str]) -> HistoryIndex:
    index = HistoryIndex(head, folders, {}, {})
    touch: dict[str, list] = {}
    wanted = set(folders)
    for commit, names in _walk(repo, [head]):
        index._record(commit, names, wanted, touch)
    index.touch = touch
    return index


def local_path(cache_dir: Path) -> Path:
    return Path(cache_dir) / LOCAL_NAME


def _read_local(cache_dir: Path) -> HistoryIndex | None:
    try:
        with gzip.open(local_path(cache_dir), "rt", encoding="utf-8") as handle:
            return HistoryIndex.from_json(handle.read())
    except (OSError, ValueError, KeyError, TypeError, EOFError):
        return None


def _read_remote(r2) -> HistoryIndex | None:
    try:
        body = r2.get(REMOTE_KEY)
        if body is None:
            return None
        return HistoryIndex.from_json(gzip.decompress(body).decode("utf-8"))
    except Exception:
        return None


def _save(cache_dir: Path, index: HistoryIndex, r2) -> None:
    body = gzip.compress(index.to_json().encode("utf-8"), compresslevel=6, mtime=0)
    path = local_path(cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(body)
    temporary.replace(path)
    if r2 is not None:
        try:
            r2.put(REMOTE_KEY, body, REMOTE_TYPE, None)
        except Exception as error:
            print(f"warning: could not upload the history index: {error}", file=sys.stderr)


def ensure(repo: GitRepo, cache_dir: Path, folders: list[str], r2=None) -> HistoryIndex:
    head = repo.head()
    index = _read_local(cache_dir)
    if index is None and r2 is not None:
        index = _read_remote(r2)
    if index is not None and index.head != head:
        try:
            current = repo.is_ancestor(index.head, head)
        except GitError:
            current = False
        if not current:
            index = None
    if index is None:
        index = build(repo, head, folders)
    elif index.head == head and set(folders) <= index.folders:
        return index
    else:
        index.extend(repo, head, folders)
    _save(cache_dir, index, r2)
    return index


def wipe(cache_dir: Path, r2=None) -> None:
    local_path(cache_dir).unlink(missing_ok=True)
    if r2 is not None:
        try:
            r2.delete(REMOTE_KEY)
        except Exception as error:
            print(f"warning: could not delete the history index: {error}", file=sys.stderr)
