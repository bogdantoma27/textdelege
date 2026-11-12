import re
from datetime import date

from .gitrepo import Commit, GitRepo

EXCLUDED_KINDS = {"ruling", "documentation"}
ARTICLE_FILE = re.compile(r"art-\d+(-\d+)?\.md")


def in_force_of(commit: Commit) -> date | None:
    values = commit.trailers.get("In-force") or []
    if not values or not values[0].strip():
        return None
    return date.fromisoformat(values[0].strip())


def kind_of(commit: Commit) -> str:
    values = commit.trailers.get("Kind") or []
    return values[0] if values else ""


def act_commits(repo: GitRepo, folder: str, old_folder: str | None) -> list[Commit]:
    paths = [folder] + ([old_folder] if old_folder else [])
    return [
        commit
        for commit in repo.log(paths)
        if in_force_of(commit) is not None and kind_of(commit) not in EXCLUDED_KINDS
    ]


def in_force_days(commits: list[Commit]) -> list[date]:
    return sorted({day for commit in commits if (day := in_force_of(commit)) is not None})


def commit_for_day(commits: list[Commit], day: date) -> Commit | None:
    for commit in commits:
        in_force = in_force_of(commit)
        if in_force is not None and in_force <= day:
            return commit
    return None


def tree_and_folder_for_day(
    repo: GitRepo,
    commits: list[Commit],
    day: date,
    folder: str,
    old_folder: str | None,
) -> tuple[dict[str, str], str]:
    commit = commit_for_day(commits, day)
    if commit is None:
        return {}, folder
    used = folder
    tree = repo.ls_tree(commit.sha, folder)
    if not tree and old_folder:
        tree = repo.ls_tree(commit.sha, old_folder)
        used = old_folder
    return {name: blob for name, blob in tree.items() if ARTICLE_FILE.fullmatch(name)}, used


def tree_for_day(
    repo: GitRepo,
    commits: list[Commit],
    day: date,
    folder: str,
    old_folder: str | None,
) -> dict[str, str]:
    return tree_and_folder_for_day(repo, commits, day, folder, old_folder)[0]


def act_blob_ids(repo: GitRepo, folder: str, old_folder: str | None) -> list[str]:
    commits = act_commits(repo, folder, old_folder)
    blobs: dict[str, None] = {}
    for day in in_force_days(commits):
        tree, _used = tree_and_folder_for_day(repo, commits, day, folder, old_folder)
        for blob in tree.values():
            blobs[blob] = None
    return list(blobs)
