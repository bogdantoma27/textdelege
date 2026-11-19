import { env } from "cloudflare:test";
import { clearPageCache } from "./setup";

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function replaceObject(key: string, value: unknown): Promise<() => Promise<void>> {
  const original = await env.DATA.get(key);
  const bytes = original === null ? null : await original.arrayBuffer();
  await env.DATA.put(key, await gzip(JSON.stringify(value)));
  clearPageCache();
  return async () => {
    if (bytes === null) await env.DATA.delete(key);
    else await env.DATA.put(key, bytes);
    clearPageCache();
  };
}

export async function removeObject(key: string): Promise<() => Promise<void>> {
  const original = await env.DATA.get(key);
  const bytes = original === null ? null : await original.arrayBuffer();
  await env.DATA.delete(key);
  clearPageCache();
  return async () => {
    if (bytes !== null) await env.DATA.put(key, bytes);
    clearPageCache();
  };
}

interface ActRow {
  path: string;
  alias: string | null;
  slug: string | null;
  kind: string | null;
  title: string | null;
  short: string | null;
  status: string | null;
  freshness_status: string | null;
  year: number | null;
  number: string | null;
  from_date: string | null;
  latest: string | null;
  articles: number | null;
}

const INSERT_ACT =
  "INSERT OR REPLACE INTO acts (path, alias, slug, kind, title, short, status, freshness_status, year, number, from_date, latest, articles) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

async function insertRows(rows: ActRow[]): Promise<void> {
  for (let at = 0; at < rows.length; at += 100) {
    await env.DB.batch(
      rows
        .slice(at, at + 100)
        .map((r) =>
          env.DB.prepare(INSERT_ACT).bind(r.path, r.alias, r.slug, r.kind, r.title, r.short, r.status, r.freshness_status, r.year, r.number, r.from_date, r.latest, r.articles),
        ),
    );
  }
}

/** Adds acts to the D1 `acts` table (or, with `replace`, swaps the whole table); the returned function undoes it. */
export async function putActs(
  entries: { path: string; alias: string | null; title: string; short: string | null; kind: string; status: string; from: string | null; latest: string; articles: number }[],
  replace = false,
): Promise<() => Promise<void>> {
  const { results: saved } = await env.DB.prepare("SELECT * FROM acts").all<ActRow>();
  if (replace) await env.DB.prepare("DELETE FROM acts").run();
  await insertRows(
    entries.map((e) => {
      const parts = e.path.split("/");
      return {
        path: e.path,
        alias: e.alias,
        slug: e.alias ?? parts.join("-"),
        kind: e.kind,
        title: e.title,
        short: e.short,
        status: e.status,
        freshness_status: null,
        year: Number(parts[parts.length - 2]),
        number: parts[parts.length - 1] ?? null,
        from_date: e.from,
        latest: e.latest,
        articles: e.articles,
      };
    }),
  );
  clearPageCache();
  return async () => {
    await env.DB.prepare("DELETE FROM acts").run();
    await insertRows(saved);
    clearPageCache();
  };
}
