import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const worker = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(worker, "..");
const target = join(worker, "test", "fixtures", "dataset");

const BUILD = String.raw`
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from build.tests.sourcerepo import SourceRepo
from build.tests.test_structure import art, unit
from build.textdelege import cli

tmp = Path(sys.argv[1])
source = SourceRepo(tmp / "source")
cache = tmp / "work" / ".cache"
config = tmp / "work" / "config.toml"
config.parent.mkdir()
config.write_text(
    f'source_url = "{source.uri}"\nselection = "codes"\ncache_dir = ".cache"\n'
    "headings = true\nheadings_min_articles = 2\n",
    encoding="utf-8",
)
PAGE = (
    "<html><body>"
    + unit(
        "CRT", "Cartea I", "Despre persoane",
        unit(
            "TTL", "Titlul I", "Dispoziții generale",
            unit("CAP", "Capitolul I", "Aplicarea legii", art("Articolul 1"))
            + unit("CAP", "Capitolul II", "Interpretarea legii", art("Articolul 2")),
        ),
    )
    + "</body></html>"
).encode("utf-8")
code = cli.main(
    ["build", "--config", str(config), "--dry-run", "--sample", "3"],
    today=date(2026, 11, 8),
    now=datetime(2026, 11, 8, 6, 0, 0, tzinfo=timezone.utc),
    fetch=lambda url: PAGE if url.endswith("/287") else None,
)
sys.exit(code)
`;

function findPython() {
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : ["python3", "python"];
  for (const candidate of candidates) {
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) {
      return candidate;
    }
  }
  throw new Error(`no working Python found (tried ${candidates.join(", ")}); set PYTHON`);
}

const python = findPython();
const tmp = await mkdtemp(join(tmpdir(), "textdelege-fixtures-"));
try {
  const run = spawnSync(python, ["-", tmp], {
    cwd: root,
    input: BUILD,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (run.error) {
    throw new Error(`could not run ${python}: ${run.error.message}`);
  }
  if (run.status !== 0) {
    throw new Error(`the dry run failed with exit status ${run.status}`);
  }
  await rm(target, { recursive: true, force: true });
  await cp(join(tmp, "work", ".cache", "out"), target, { recursive: true });
} finally {
  await rm(tmp, { recursive: true, force: true });
}
