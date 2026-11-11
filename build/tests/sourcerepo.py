import csv
import io
import json
import subprocess
from pathlib import Path

from build.tests.fixture import FixtureRepo
from build.tests.test_rulings import CSV_FIELDS, meta as ruling_meta

CIVIL = "lege/2009/287"
PROCEDURE = "lege/2010/134"
OTHER = "lege/2012/1"
RULING_KEY = "dcc-1-2019"
RULING_FOLDER = "jurisprudenta/ccr/2019/1"
ARTICLE_1 = "art-0001"
LAW_71 = "legea-71-2011"
LAW_200 = "legea-200-2023"
TEXT_V1 = "Titlu\n(1) Primul text.\n(2) Al doilea text.\n"
TEXT_V2 = "Titlu\n(1) Primul text modificat.\n(2) Al doilea text.\n"
ON_PY = """\
import subprocess
import sys

day, act, stem = sys.argv[1:4]
path = f"{act}/{stem}.md"
FORMAT = "--format=%H%x1f%(trailers:key=In-force,valueonly,unfold)%x1e"
log = subprocess.run(
    ["git", "log", "--no-merges", FORMAT, "--", path],
    capture_output=True, text=True, encoding="utf-8", check=True,
).stdout
for record in log.split("\\x1e"):
    sha, _, in_force = record.strip().partition("\\x1f")
    if sha and in_force.strip() and in_force.strip() <= day:
        sys.stdout.write(subprocess.run(
            ["git", "show", f"{sha}:{path}"],
            capture_output=True, text=True, encoding="utf-8", check=True,
        ).stdout)
        sys.exit(0)
sys.stderr.write(f"{path} was not in the text on {day}\\n")
sys.exit(1)
"""


def act_row(path, slug, code, short, status="in force"):
    year, number = path.split("/")[1:]
    return {
        "path": path, "slug": slug, "kind": "lege", "year": int(year), "number": number,
        "title": f"Legea nr. {number}/{year}", "code": code, "short": short,
        "status": status, "portal": "https://example.invalid/" + number,
        "versions": 2, "from": "2011-10-01", "latest": "2023-07-09", "withdrawn_by": None,
    }


def decisions_csv():
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    row = dict.fromkeys(CSV_FIELDS, "")
    row.update(key=RULING_KEY, label="CCR 1/2019", folder=RULING_FOLDER, court="ccr")
    writer.writerow(row)
    return out.getvalue()


def dump(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


class SourceRepo:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.fixture = FixtureRepo(self.root / "src")
        self.bare = self.root / "bare.git"
        self._populate()
        subprocess.run(
            ["git", "clone", "-q", "--bare", str(self.fixture.path), str(self.bare)], check=True
        )
        subprocess.run(
            ["git", "config", "uploadpack.allowFilter", "true"], cwd=self.bare, check=True
        )
        subprocess.run(
            ["git", "config", "uploadpack.allowAnySHA1InWant", "true"], cwd=self.bare, check=True
        )

    @property
    def uri(self) -> str:
        return self.bare.as_uri()

    def head(self) -> str:
        return self.fixture._git("rev-parse", "HEAD")

    def _populate(self):
        civil = act_row(CIVIL, "codul-civil", "Codul civil", "Codul civil")
        procedure = act_row(PROCEDURE, PROCEDURE.replace("/", "-"), "Codul de procedura", "Codul de procedura")
        other = act_row(OTHER, "legea-1-2012", None, None, "repealed 2013-02-15")
        data = {
            "data/acts.json": dump({"acts": [civil, procedure, other]}),
            "data/paths.json": dump({"paths": {"codul-civil": CIVIL}}),
            "data/laws.csv": (
                "key,label,kind,title,enacted,published,in_force_days,commits,url\n"
                f"{LAW_200},Legea nr. 200/2023,law,Legea nr. 200/2023,2023-07-05,2023-07-06,"
                "2023-07-09,1,\n"
            ),
            "data/credits.csv": "act,in_force,provision,law,was_law,was_commit\n",
            "data/rulings-by-provision.json": dump({"note": "n", "acts": {CIVIL: {
                "slug": "codul-civil", "path": CIVIL, "kind": "lege", "in_repo": True,
                "label": "Codul civil", "act": [],
                "articles": {"1": {"file": f"{ARTICLE_1}.md", "decisions": [RULING_KEY]}},
            }}}),
            "data/decisions.csv": decisions_csv(),
            "data/freshness.json": dump({"as_of": "2026-11-01", "checked_against_official_source": "2026-11-01"}),
            "data/freshness/index.json": dump({"shards": [{"shard": "lege/2009", "file": "lege-2009.csv"}]}),
            "data/freshness/lege-2009.csv": (
                "act,status,last_verified,check_due,method,newest_change,newest_change_date,"
                "change_in_repo,official_url\ncodul-civil,current,2026-11-01,2026-11-08,"
                "consolidated-form,,,no,\n"
            ),
            "data/status.json": dump({"schema": "romania-law-status/1", "generated": "2026-11-01T00:00:00Z"}),
            "tools/on.py": ON_PY,
        }
        self.fixture.commit(
            data, author="Lexifina", trailers={"Kind": "documentation"}, message="Add data"
        )
        self.fixture.commit(
            {
                f"{CIVIL}/{ARTICLE_1}.md": "# Articolul 1\n\n" + TEXT_V1,
                f"{CIVIL}/art-0002.md": "# Articolul 2\n\nAl doilea articol.\n",
                f"{PROCEDURE}/{ARTICLE_1}.md": "# Articolul 1\n\nProcedura.\n",
                f"{OTHER}/{ARTICLE_1}.md": "# Articolul 1\n\nAlta lege.\n",
            },
            author="Legea nr. 71/2011",
            trailers={"Kind": "amendment", "In-force": "2011-10-01"},
            message="Enter acts",
        )
        self.fixture.commit(
            {f"{CIVIL}/{ARTICLE_1}.md": "# Articolul 1\n\n" + TEXT_V2},
            author="Legea nr. 200/2023",
            trailers={"Kind": "amendment", "In-force": "2023-07-09"},
            message="Amend article 1",
        )
        ruling = ruling_meta(RULING_KEY, "CCR 1/2019", "ccr", CIVIL, ["1"], date="2019-02-01")
        self.fixture.commit(
            {
                f"{RULING_FOLDER}/meta.json": json.dumps(ruling, ensure_ascii=False),
                f"{RULING_FOLDER}/decizie.md": "DECIZIA nr. 1 din 2019\n",
            },
            author="Lexifina",
            trailers={"Kind": "ruling"},
            message="Add decision",
        )

    def push(self, *, force: bool = False) -> None:
        args = ["push", "-q", str(self.bare), "main"] + (["--force"] if force else [])
        subprocess.run(["git", *args], cwd=self.fixture.path, check=True)

    def amend_article(self, text: str, in_force: str) -> str:
        sha = self.fixture.commit(
            {f"{CIVIL}/{ARTICLE_1}.md": "# Articolul 1\n\n" + text},
            author="Legea nr. 300/2026",
            trailers={"Kind": "amendment", "In-force": in_force},
            message="Amend again",
        )
        self.push()
        return sha

    def rewrite_history(self) -> str:
        git = self.fixture._git
        git("checkout", "-q", "--orphan", "rewritten")
        sha = self.fixture.commit(
            {},
            author="Legea nr. 71/2011",
            trailers={"Kind": "amendment", "In-force": "2011-10-01"},
            message="Rewritten history",
        )
        git("branch", "-M", "rewritten", "main")
        self.push(force=True)
        return sha
