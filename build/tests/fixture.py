import json
import os
import re
import subprocess
from pathlib import Path

COMMITTER_NAME = "Lexifina"
COMMITTER_EMAIL = "lexifina@legislatie.invalid"
FIXED_DATE = "2026-01-01T12:00:00+00:00"


def author_email(author: str) -> str:
    slug = re.sub(r"[\s/]+", "-", author.lower().replace("nr.", ""))
    slug = re.sub(r"-+", "-", slug).strip("-")
    return f"{slug}@legislatie.invalid"


class FixtureRepo:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.mkdir(parents=True, exist_ok=True)
        self._git("init", "-q", "-b", "main")
        self._git("config", "user.name", COMMITTER_NAME)
        self._git("config", "user.email", COMMITTER_EMAIL)

    def _git(self, *args: str, env: dict[str, str] | None = None) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.path,
            env={
                **os.environ,
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CONFIG_NOSYSTEM": "1",
                **(env or {}),
            },
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        return result.stdout.strip()

    def commit(
        self,
        files: dict[str, str | None],
        *,
        author: str,
        trailers: dict[str, str],
        message: str,
    ) -> str:
        for name, content in files.items():
            target = self.path / name
            if content is None:
                target.unlink()
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8", newline="\n")
        self._git("add", "-A")
        body = message + "\n\n" + "\n".join(f"{key}: {value}" for key, value in trailers.items())
        env = {
            "GIT_AUTHOR_NAME": author,
            "GIT_AUTHOR_EMAIL": author_email(author),
            "GIT_AUTHOR_DATE": FIXED_DATE,
            "GIT_COMMITTER_NAME": COMMITTER_NAME,
            "GIT_COMMITTER_EMAIL": COMMITTER_EMAIL,
            "GIT_COMMITTER_DATE": FIXED_DATE,
        }
        self._git("commit", "-q", "--allow-empty", "-m", body, env=env)
        return self._git("rev-parse", "HEAD")

    def tag(self, name: str, sha: str) -> None:
        self._git("tag", name, sha)

    def write_json(self, path: str, data) -> None:
        self.commit(
            {path: json.dumps(data, ensure_ascii=False, indent=2) + "\n"},
            author="Lexifina",
            trailers={"Kind": "documentation"},
            message=f"Update {path}",
        )
