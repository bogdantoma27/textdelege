import hashlib
import os
import random
import subprocess
import sys
import tempfile
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, timedelta
from functools import partial
from pathlib import Path

from .extract import Article, split_body, version_on
from .gitrepo import GitRepo, normalise_text

BOUNDARY_ACTS = 5
BOUNDARY_CAP = 400
CACHED_FLOOR = 50
ORACLE_TIMEOUT_SECONDS = 120
LOOKBACK_DAYS = 30
READER_PATH = "tools/on.py"
READER_SHA256 = "51f7d052c344929e5017cf1a7610f202743376cffd9d97a32f3372f0109c7d9f"


@dataclass(frozen=True)
class Sample:
    act_path: str
    file: str
    day: date


ABSENCE_MESSAGES = ("is not in the record on", "was not in the text on")


class OracleError(Exception):
    def __init__(self, sample: "Sample", returncode: int | None, stderr: str):
        super().__init__(f"reader failed for {sample} (exit {returncode}): {stderr.strip()}")
        self.sample = sample
        self.returncode = returncode
        self.stderr = stderr


@dataclass
class Mismatch:
    sample: Sample
    reason: str
    ours: str | None
    oracle: str | None


def _random_picks(
    articles_by_act: dict[str, list[Article]], acts: list[str], n: int, rng: random.Random, today: date
) -> list[Sample]:
    picked: list[Sample] = []
    for _ in range(n if acts else 0):
        act = rng.choice(acts)
        article = rng.choice([a for a in articles_by_act[act] if a.versions])
        first = min(v.from_ for v in article.versions) - timedelta(days=LOOKBACK_DAYS)
        offset = rng.randint(0, max((today - first).days, 0))
        picked.append(Sample(act, article.file, first + timedelta(days=offset)))
    return picked


def sample(
    articles_by_act: dict[str, list[Article]],
    n: int,
    seed: int,
    today: date,
    fresh: set[str] | None = None,
) -> list[Sample]:
    rng = random.Random(seed)
    acts = sorted(
        act for act, articles in articles_by_act.items() if any(a.versions for a in articles)
    )
    if fresh is None:
        picked = _random_picks(articles_by_act, acts, n, rng, today)
        boundary_acts = acts
    else:
        fresh_acts = [act for act in acts if act in fresh]
        cached_acts = [act for act in acts if act not in fresh]
        picked = _random_picks(articles_by_act, fresh_acts, n, rng, today)
        picked += _random_picks(articles_by_act, cached_acts, min(n, CACHED_FLOOR), rng, today)
        boundary_acts = fresh_acts

    start_days = {
        act: {v.from_ for a in articles_by_act[act] for v in a.versions} for act in boundary_acts
    }
    busiest = sorted(boundary_acts, key=lambda act: (-len(start_days[act]), act))[:BOUNDARY_ACTS]
    boundaries: list[Sample] = []
    for act in busiest:
        for day in sorted(start_days[act]):
            for article in articles_by_act[act]:
                if any(v.from_ == day for v in article.versions):
                    boundaries.append(Sample(act, article.file, day))
                    boundaries.append(Sample(act, article.file, day - timedelta(days=1)))
    result = list(dict.fromkeys(picked))
    seen = set(result)
    extras = [s for s in dict.fromkeys(boundaries) if s not in seen]
    return result + extras[:BOUNDARY_CAP]


class ReaderNotReviewed(Exception):
    pass


def prepare_script(repo: GitRepo, dest_dir: Path) -> Path:
    data = repo.show_bytes(repo.head(), READER_PATH)
    if data is None:
        raise ReaderNotReviewed(
            f"warning: {READER_PATH} is missing upstream; verification skipped until a reader is reviewed"
        )
    digest = hashlib.sha256(data).hexdigest()
    if digest != READER_SHA256:
        raise ReaderNotReviewed(
            f"warning: {READER_PATH} changed upstream (sha256 {digest}); "
            "verification skipped until the new reader is reviewed"
        )
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    script = dest_dir / "on.py"
    script.write_bytes(data)
    return script


# The reader is outside code: pass it only these variables, never publisher credentials.
ORACLE_ENVIRONMENT = ("PATH", "HOME", "LANG", "LC_ALL", "TMP", "TEMP", "SYSTEMROOT", "PYTHONIOENCODING")


def oracle_environment(environment: dict[str, str] | None = None) -> dict[str, str]:
    source = os.environ if environment is None else environment
    return {name: source[name] for name in ORACLE_ENVIRONMENT if name in source}


def oracle_text(repo_path: Path, s: Sample, script: Path) -> str | None:
    try:
        result = subprocess.run(
            [sys.executable, "-I", str(script), s.day.isoformat(), s.act_path, Path(s.file).stem],
            cwd=repo_path,
            env=oracle_environment(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=ORACLE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise OracleError(s, None, f"timed out after {ORACLE_TIMEOUT_SECONDS} s") from error
    if result.returncode == 0:
        return result.stdout
    if any(message in result.stderr for message in ABSENCE_MESSAGES):
        return None
    raise OracleError(s, result.returncode, result.stderr)


def normalise(text: str) -> str:
    lines = normalise_text(text).replace("\r\n", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines if line.strip())


def _check(
    repo: GitRepo,
    articles: dict[str, Article],
    old_folders: dict[str, str | None],
    oracle: Callable[[Sample], str | None],
    s: Sample,
) -> Mismatch | None:
    theirs = oracle(s)
    version = version_on(articles[(s.act_path, s.file)], s.day)
    if theirs is None and version is None:
        return None
    if theirs is None or version is None:
        ours = None if version is None else _ours(repo, s, version.commit, old_folders)
        return Mismatch(s, "presence", ours, theirs)
    ours = _ours(repo, s, version.commit, old_folders)
    if ours is None or normalise(theirs) != normalise(ours):
        return Mismatch(s, "selection", ours, theirs)
    if split_body(normalise(theirs))[1] != [line.text for line in version.lines]:
        return Mismatch(s, "parsing", ours, theirs)
    return None


def _ours(repo: GitRepo, s: Sample, commit: str, old_folders: dict[str, str | None]) -> str | None:
    text = repo.show_file(commit, f"{s.act_path}/{s.file}")
    old = old_folders.get(s.act_path)
    if text is None and old:
        text = repo.show_file(commit, f"{old}/{s.file}")
    return text


def verify(
    repo: GitRepo,
    articles_by_act: dict[str, list[Article]],
    samples: list[Sample],
    *,
    old_folders: dict[str, str | None],
    oracle: Callable[[Sample], str | None] | None = None,
    workers: int = 8,
) -> list[Mismatch]:
    articles = {(act, a.file): a for act, items in articles_by_act.items() for a in items}
    with tempfile.TemporaryDirectory() as scratch:
        if oracle is None:
            oracle = partial(oracle_text, repo.path, script=prepare_script(repo, Path(scratch)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = pool.map(partial(_check, repo, articles, old_folders, oracle), samples)
            return [m for m in results if m is not None]
