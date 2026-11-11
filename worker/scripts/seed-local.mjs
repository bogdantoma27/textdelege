import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { getPlatformProxy } from "wrangler";

const worker = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(worker, "node_modules", "wrangler", "bin", "wrangler.js");
const { values: options } = parseArgs({
  options: { dataset: { type: "string" }, "persist-to": { type: "string" } },
});
const dataset = resolve(options.dataset ?? join(worker, "test", "fixtures", "dataset"));
const persistTo = options["persist-to"] && resolve(options["persist-to"]);

const DATABASE = "textdelege";
const PARALLEL = 32;
const TABLES = [
  "articles_fts",
  "ruling_subjects",
  "rulings",
  "events",
  "laws",
  "versions",
  "articles",
  "acts",
  "meta",
];

async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else found.push(path);
  }
  return found;
}

const paths = (await files(dataset)).filter((path) => path.endsWith(".json"));
const proxy = await getPlatformProxy({
  configPath: join(worker, "wrangler.toml"),
  persist: persistTo ? { path: join(persistTo, "v3") } : true,
});
try {
  for (let start = 0; start < paths.length; start += PARALLEL) {
    await Promise.all(
      paths.slice(start, start + PARALLEL).map(async (path) => {
        const key = relative(dataset, path).split(sep).join("/");
        await proxy.env.DATA.put(key, gzipSync(await readFile(path)), {
          httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
        });
      }),
    );
  }
} finally {
  await proxy.dispose();
}

const tmp = await mkdtemp(join(tmpdir(), "textdelege-seed-"));
try {
  const index = await readFile(join(dataset, "index.sql"), "utf8");
  const drops = TABLES.map((table) => `DROP TABLE IF EXISTS ${table};\n`).join("");
  const sql = join(tmp, "index.sql");
  await writeFile(sql, drops + index);
  const args = ["d1", "execute", DATABASE, "--local", "--file", sql];
  if (persistTo) args.push("--persist-to", persistTo);
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: worker,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler d1 execute failed with exit status ${result.status}`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log(`Seeded ${paths.length} objects and the search index from ${dataset}.`);
