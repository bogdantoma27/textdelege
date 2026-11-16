import re
from datetime import date

from .extract import (
    Article,
    ArticleCore,
    Line,
    Version,
    _apply_blame,
    _spans_per_file,
    finalize_act,
    law_key_from_email,
    line_id,
)
from .gitrepo import GitRepo
from .selection import act_commits, commit_for_day, in_force_days, kind_of

TEXT_FILE = "text.md"
ARTICLE_FILE = "art-text.md"
ARTICLE_NUMBER = "text"
PARAGRAPH_BREAK = re.compile(r"\n|\s{2,}")
DASHES = re.compile(r"-+")


def paragraphs(text: str) -> list[str]:
    parts = (part.strip() for part in PARAGRAPH_BREAK.split(text))
    return [part for part in parts if part and part != "+" and not DASHES.fullmatch(part)]


def whole_text_core(
    repo: GitRepo, folder: str, old_folder: str | None
) -> list[ArticleCore]:
    commits = act_commits(repo, folder, old_folder)
    days = in_force_days(commits)
    listings: dict[str, tuple[str | None, str]] = {}

    def listing(sha: str) -> tuple[str | None, str]:
        if sha not in listings:
            used = folder
            tree = repo.ls_tree(sha, folder)
            if not tree and old_folder:
                tree = repo.ls_tree(sha, old_folder)
                used = old_folder
            listings[sha] = (tree.get(TEXT_FILE), used)
        return listings[sha]

    trees: dict[date, dict[str, str]] = {}
    used_folders: dict[date, str] = {}
    for day in days:
        commit = commit_for_day(commits, day)
        if commit is None:
            trees[day] = {}
            continue
        blob, used = listing(commit.sha)
        trees[day] = {ARTICLE_FILE: blob} if blob else {}
        used_folders[day] = used
    spans, absent_since = _spans_per_file(days, trees)
    history = spans.get(ARTICLE_FILE)
    if not history:
        return []
    repo.prefetch_blobs([span.blob for span in history])

    versions = []
    with repo.blobs() as reader:
        for span in history:
            selected = commit_for_day(commits, span.from_)
            ids: list[str] = []
            lines = []
            law_key = law_key_from_email(selected.author_email)
            for text in paragraphs(reader.read(span.blob)):
                ids.append(line_id(text, ids))
                lines.append(Line(text, ids[-1], span.from_, law_key))
            versions.append(
                Version(
                    from_=span.from_,
                    until=span.until,
                    commit=selected.sha,
                    law_commit=selected.sha,
                    law_key=law_key,
                    law_label=selected.author,
                    kind=kind_of(selected),
                    source_path=f"{used_folders[span.from_].rstrip('/')}/{TEXT_FILE}",
                    lines=lines,
                )
            )
    _apply_blame(versions)
    absent = absent_since.get(ARTICLE_FILE)
    removed_by_key = removed_by_label = None
    if absent is not None:
        remover = commit_for_day(commits, absent)
        removed_by_key, removed_by_label = law_key_from_email(remover.author_email), remover.author
    return [ArticleCore(ARTICLE_FILE, ARTICLE_NUMBER, None, versions, absent, removed_by_key, removed_by_label)]


def whole_text_articles(
    repo: GitRepo, folder: str, old_folder: str | None, today: date
) -> list[Article]:
    """One synthetic article from the history of text.md; empty when the act never had one."""
    return finalize_act(whole_text_core(repo, folder, old_folder), today)
