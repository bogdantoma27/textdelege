import type { MiddlewareHandler } from "hono";
import { normalise } from "./citation";
import { unmarkStopWords } from "./text";
import type {
  ActIndexEntry,
  ActObject,
  ArticleObject,
  ArticleRuling,
  ChangesObject,
  Env,
  LawObject,
  Manifest,
  RulingObject,
  SearchHit,
} from "./types";

export class NoBuildError extends Error {
  constructor() {
    super("manifest.json is missing");
    this.name = "NoBuildError";
  }
}

export type AppEnv = { Bindings: Env; Variables: { store: Store } };

export interface Store {
  manifest(): Promise<Manifest>;
  act(path: string): Promise<ActObject | null>;
  article(path: string, file: string): Promise<ArticleObject | null>;
  law(key: string): Promise<LawObject | null>;
  ruling(key: string): Promise<RulingObject | null>;
  changes(scope: string): Promise<ChangesObject | null>;
  search(q: string, inForceOnly: boolean, limit: number, offset?: number): Promise<SearchHit[]>;
  searchCount(q: string, inForceOnly: boolean): Promise<number>;
  /** From the build's sitemaps/index.json; null for data published before the build wrote it. */
  sitemapIndex(): Promise<SitemapIndex | null>;
  sitemapPage(number: number): Promise<SitemapPage | null>;
  /** Fallback until the next build has published sitemaps/*.json: counts and sorts the whole index in D1. */
  legacySitemapTotal(): Promise<number>;
  legacySitemapEntries(limit: number, offset: number): Promise<SitemapEntry[]>;
  resolveAlias(alias: string): Promise<string | null>;
  /** The named acts from D1 (at most 50 per query); paths that are not acts are absent from the map. */
  actsByPath(paths: readonly string[]): Promise<Map<string, ActIndexEntry>>;
  /** Number of acts per kind, from D1; memoised for the life of the build. */
  kindCounts(): Promise<Map<string, number>>;
  /** One page of /acte with the exact total: two bounded D1 queries. */
  listActs(filter: ActFilter): Promise<ActList>;
  /** A page of the acts of one kind, newest first, leaving out the given paths (at most 90). */
  actsOfKind(kind: string, exclude: readonly string[], limit: number, offset: number): Promise<ActIndexEntry[]>;
  actRulings(path: string): Promise<ArticleRuling[]>;
}

export interface ActFilter {
  kind?: string;
  year?: number;
  status?: "in-force" | "repealed";
  q?: string;
  page: number;
}

export interface ActListItem {
  path: string;
  alias: string | null;
  kind: string;
  title: string;
  short: string | null;
  status: string;
  year: number | null;
  number: string | null;
  articles: number | null;
}

export interface ActList {
  items: ActListItem[];
  total: number;
  page: number;
  pages: number;
}

export const ACTS_PAGE = 50;

export const PREFIX_MIN = 4;
export const COUNT_CAP = 1000;
/**
 * Measured on the 76,000-article index: with 10,000 the top 20 of real queries ("contract", 2,524 matches;
 * "lege", 8,172) are unchanged, while 2,000 dropped 6 of the top 20 for "contract".
 * Ranking looks at this many matches at most (the first ones, in rowid order); a very common term would
 * otherwise rank every row. The subquery finds the rowid of the last candidate and the outer query, which
 * must carry the MATCH for bm25 and snippet, then stops at that rowid.
 */
export const RANK_CAP = 10_000;

export interface SitemapIndex {
  schema: string;
  pages: number;
  total: number;
}

export interface SitemapPage {
  schema: string;
  entries: [string, string | null][];
}

/** Row of the legacy D1 sitemap query. */
export interface SitemapEntry {
  actRef: string;
  number: string | null;
  file: string | null;
  lastmod: string | null;
}

const MANIFEST_KEY = "manifest.json";

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (object === null) {
    return null;
  }
  const text = await new Response(
    object.body.pipeThrough(new DecompressionStream("gzip")),
  ).text();
  return JSON.parse(text) as T;
}

export function toMatchQuery(q: string): string {
  return q
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "")
    .map((token, index, tokens) =>
      index === tokens.length - 1 && [...token].length >= PREFIX_MIN ? `"${token}"*` : `"${token}"`,
    )
    .join(" ");
}

const RANK = `bm25(articles_fts, 0, 0, 0, 4.0, 8.0, 1.0)
  * CASE WHEN act_path IN (SELECT path FROM acts WHERE alias IS NOT NULL) THEN 2.0 ELSE 1.0 END`;

const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function clampOffset(offset: number): number {
  return Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
}

export function toSafeHtml(snippet: string): string {
  return snippet
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll(MARK_OPEN, "<mark>")
    .replaceAll(MARK_CLOSE, "</mark>");
}

interface SearchRow {
  act_path: string;
  file: string;
  number: string;
  title: string | null;
  state: SearchHit["state"];
  snippet: string;
}

/** How long an isolate keeps the manifest before it reads it from R2 again. */
export const MEMO_MS = 60_000;

class Memo<T> {
  private entry: { at: number; value: Promise<T> } | undefined;

  get(read: () => Promise<T>): Promise<T> {
    const held = this.entry;
    if (held !== undefined && Date.now() - held.at < MEMO_MS) return held.value;
    const entry = { at: Date.now(), value: read() };
    this.entry = entry;
    // A failed read is not kept.
    entry.value.catch(() => {
      if (this.entry === entry) this.entry = undefined;
    });
    return entry.value;
  }

  reset(): void {
    this.entry = undefined;
  }
}

/** Keeps a value for as long as the manifest's build id is unchanged; a failed read is not kept. */
class BuildMemo<T> {
  private entry: { build: string; value: Promise<T> } | undefined;

  get(build: string, read: () => Promise<T>): Promise<T> {
    const held = this.entry;
    if (held !== undefined && held.build === build) return held.value;
    const entry = { build, value: read() };
    this.entry = entry;
    entry.value.catch(() => {
      if (this.entry === entry) this.entry = undefined;
    });
    return entry.value;
  }

  reset(): void {
    this.entry = undefined;
  }
}

const manifestMemo = new Memo<Manifest>();
const kindsMemo = new BuildMemo<Map<string, number>>();

/** D1 allows 100 bound parameters per query; stay well below. */
export const IN_CHUNK = 50;

interface ActRow {
  path: string;
  alias: string | null;
  title: string | null;
  short: string | null;
  kind: string | null;
  status: string | null;
  from_date: string | null;
  latest: string | null;
  articles: number | null;
}

const FOLD: [string, string][] = [["ăĂ", "a"], ["âÂ", "a"], ["îÎ", "i"], ["șȘşŞ", "s"], ["țȚţŢ", "t"]];

/** SQL expression: the column lowercased without Romanian diacritics (SQLite's lower() is ASCII-only). */
function folded(column: string): string {
  let expression = `lower(${column})`;
  for (const [letters, plain] of FOLD) for (const letter of letters) expression = `replace(${expression}, '${letter}', '${plain}')`;
  return expression;
}

const FOLDED_NAME = `(${folded("COALESCE(title, '')")} || ' ' || ${folded("COALESCE(short, '')")})`;

interface ListRow extends ActRow {
  year: number | null;
  number: string | null;
}

/** For tests: forget what this isolate has memoised. */
export function resetStoreCache(): void {
  manifestMemo.reset();
  kindsMemo.reset();
}

export function createStore(env: Env): Store {
  const manifest = (): Promise<Manifest> =>
    manifestMemo.get(() =>
      readJson<Manifest>(env.DATA, MANIFEST_KEY).then((found) => {
        if (found === null) {
          throw new NoBuildError();
        }
        return found;
      }),
    );

  const readObject = <T>(key: string): Promise<T | null> => readJson<T>(env.DATA, key);

  return {
    manifest,
    act: (path) => readObject<ActObject>(`acts/${path}/act.json`),
    article: (path, file) => readObject<ArticleObject>(`acts/${path}/art/${file}.json`),
    law: (key) => readObject<LawObject>(`laws/${key}.json`),
    ruling: (key) => readObject<RulingObject>(`rulings/${key}.json`),
    changes: (scope) =>
      readObject<ChangesObject>(scope === "site" ? "changes/site.json" : `changes/acts/${scope}.json`),

    async search(q, inForceOnly, limit, offset = 0) {
      const match = toMatchQuery(q);
      if (match === "") {
        return [];
      }
      const stateFilter = inForceOnly ? "AND state = 'in-force'" : "";
      const { results } = await env.DB.prepare(
        `SELECT act_path, file, number, title, state,
                snippet(articles_fts, -1, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 12) AS snippet
           FROM articles_fts
          WHERE articles_fts MATCH ?1 ${stateFilter}
            AND rowid <= (SELECT max(rowid) FROM (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?1 ${stateFilter} LIMIT ${RANK_CAP}))
          ORDER BY ${RANK}
          LIMIT ?2 OFFSET ?3`,
      )
        .bind(match, clampLimit(limit), clampOffset(offset))
        .all<SearchRow>();
      return results.map((row) => ({
        actPath: row.act_path,
        file: row.file,
        number: row.number,
        title: row.title,
        state: row.state,
        snippet: unmarkStopWords(toSafeHtml(row.snippet), q),
      }));
    },

    async searchCount(q, inForceOnly) {
      const match = toMatchQuery(q);
      if (match === "") {
        return 0;
      }
      const stateFilter = inForceOnly ? "AND state = 'in-force'" : "";
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM (SELECT 1 FROM articles_fts WHERE articles_fts MATCH ?1 ${stateFilter} LIMIT ${COUNT_CAP + 1})`,
      )
        .bind(match)
        .first<{ total: number }>();
      return row?.total ?? 0;
    },

    sitemapIndex: () => readObject<SitemapIndex>("sitemaps/index.json"),
    sitemapPage: (number) => readObject<SitemapPage>(`sitemaps/${number}.json`),

    // LEGACY FALLBACK (remove once every published build carries sitemaps/*.json).
    async legacySitemapTotal() {
      const row = await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM acts) + (SELECT COUNT(*) FROM articles) AS total",
      ).first<{ total: number }>();
      return row?.total ?? 0;
    },

    async legacySitemapEntries(limit, offset) {
      const { results } = await env.DB.prepare(
        `SELECT u.act_path, COALESCE(ac.alias, u.act_path) AS act_ref, u.file, u.number, u.lastmod FROM (
           SELECT a.path AS act_path, '' AS file, NULL AS number,
                  (SELECT MAX(last_change) FROM articles WHERE act_path = a.path) AS lastmod
             FROM acts a
           UNION ALL
           SELECT act_path, file, number, last_change AS lastmod FROM articles
         ) u
         LEFT JOIN acts ac ON ac.path = u.act_path
         ORDER BY u.act_path, u.file
         LIMIT ?1 OFFSET ?2`,
      )
        .bind(Math.max(0, Math.floor(limit)), clampOffset(offset))
        .all<{ act_ref: string; file: string; number: string | null; lastmod: string | null }>();
      return results.map((row) => ({
        actRef: row.act_ref,
        number: row.file === "" ? null : row.number,
        file: row.file === "" ? null : row.file,
        lastmod: row.lastmod,
      }));
    },

    async actRulings(path) {
      const { results } = await env.DB.prepare(
        `SELECT a.file, a.number, a.title AS article_title, r.key, r.label, r.date, r.outcome
           FROM ruling_subjects s
           JOIN rulings r ON r.key = s.ruling_key
           JOIN articles a ON a.act_path = s.act_path AND a.file = s.file
          WHERE s.act_path = ?1
          ORDER BY a.file, r.date DESC, r.key`,
      )
        .bind(path)
        .all<{
          file: string;
          number: string;
          article_title: string | null;
          key: string;
          label: string;
          date: string;
          outcome: string;
        }>();
      return results.map((row) => ({
        file: row.file,
        number: row.number,
        title: row.article_title,
        key: row.key,
        label: row.label,
        date: row.date,
        outcome: row.outcome,
      }));
    },

    async resolveAlias(alias) {
      const { acts } = await manifest();
      return acts.find((act) => act.alias === alias)?.path ?? null;
    },

    async actsByPath(paths) {
      const unique = [...new Set(paths)];
      const found = new Map<string, ActIndexEntry>();
      if (unique.length === 0) return found;
      const statements = [];
      for (let at = 0; at < unique.length; at += IN_CHUNK) {
        const chunk = unique.slice(at, at + IN_CHUNK);
        statements.push(
          env.DB.prepare(
            `SELECT path, alias, title, short, kind, status, from_date, latest, articles
               FROM acts WHERE path IN (${chunk.map(() => "?").join(",")})`,
          ).bind(...chunk),
        );
      }
      const batches = statements.length === 1 ? [await statements[0]!.all<ActRow>()] : await env.DB.batch<ActRow>(statements);
      for (const { results } of batches) {
        for (const row of results) {
          found.set(row.path, {
            path: row.path,
            alias: row.alias,
            title: row.title ?? "",
            short: row.short,
            kind: row.kind ?? "",
            status: row.status ?? "",
            from: row.from_date,
            latest: row.latest ?? "",
            articles: row.articles ?? 0,
          });
        }
      }
      return found;
    },

    async listActs(filter) {
      const where: string[] = [];
      const values: (string | number)[] = [];
      if (filter.kind !== undefined) {
        where.push(`kind = ?${values.push(filter.kind)}`);
      }
      if (filter.year !== undefined) {
        where.push(`year = ?${values.push(filter.year)}`);
      }
      if (filter.status === "in-force") where.push("status = 'in force'");
      if (filter.status === "repealed") where.push("status LIKE 'repealed%'");
      const q = normalise(filter.q ?? "");
      if (q !== "") {
        const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
        const text = `${FOLDED_NAME} LIKE ?${values.push(like)} ESCAPE '\\'`;
        if (/^[0-9]+$/.test(q)) where.push(`(number = ?${values.push(q)} OR ${text})`);
        else where.push(text);
      }
      const clause = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
      const pageQuery = (page: number) =>
        env.DB.prepare(
          `SELECT path, alias, title, short, kind, status, year, number, articles FROM acts ${clause}
            ORDER BY year DESC, CAST(number AS INTEGER) DESC, path
            LIMIT ${ACTS_PAGE} OFFSET ${(page - 1) * ACTS_PAGE}`,
        ).bind(...values);
      const requested = Math.max(1, Math.floor(filter.page) || 1);
      // With no filter or only a kind the total is the memoised per-build count; otherwise one COUNT(*).
      let total: number;
      let first: { results: ListRow[] };
      if (where.length === 0 || (filter.kind !== undefined && where.length === 1)) {
        const kinds = await this.kindCounts();
        total = filter.kind === undefined ? [...kinds.values()].reduce((sum, n) => sum + n, 0) : (kinds.get(filter.kind) ?? 0);
        first = await pageQuery(requested).all<ListRow>();
      } else {
        const count = env.DB.prepare(`SELECT COUNT(*) AS total FROM acts ${clause}`).bind(...values);
        const [counted, firstPage] = await env.DB.batch<{ total: number } & ListRow>([count, pageQuery(requested)]);
        total = (counted!.results[0] as { total: number } | undefined)?.total ?? 0;
        first = firstPage as { results: ListRow[] };
      }
      const pages = Math.max(1, Math.ceil(total / ACTS_PAGE));
      const page = Math.min(requested, pages);
      const rows = page === requested ? first!.results : (await pageQuery(page).all<ListRow>()).results;
      return {
        items: rows.map((row) => ({
          path: row.path,
          alias: row.alias,
          kind: row.kind ?? "",
          title: row.title ?? "",
          short: row.short,
          status: row.status ?? "",
          year: row.year,
          number: row.number === null || row.number === "" ? null : row.number,
          articles: row.articles,
        })),
        total,
        page,
        pages,
      };
    },

    async actsOfKind(kind, exclude, limit, offset) {
      const { results } = await env.DB.prepare(
        `SELECT path, alias, title, short, kind, status, from_date, latest, articles
           FROM acts WHERE kind = ?1 ${exclude.length === 0 ? "" : `AND path NOT IN (${exclude.map((_, i) => `?${i + 4}`).join(",")})`}
          ORDER BY year DESC, CAST(number AS INTEGER) DESC, path
          LIMIT ?2 OFFSET ?3`,
      )
        .bind(kind, limit, offset, ...exclude)
        .all<ActRow>();
      return results.map((row) => ({
        path: row.path,
        alias: row.alias,
        title: row.title ?? "",
        short: row.short,
        kind: row.kind ?? "",
        status: row.status ?? "",
        from: row.from_date,
        latest: row.latest ?? "",
        articles: row.articles ?? 0,
      }));
    },

    async kindCounts() {
      const current = await manifest();
      return kindsMemo.get(current.build, async () => {
        const { results } = await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM acts GROUP BY kind").all<{
          kind: string | null;
          n: number;
        }>();
        return new Map(results.map((row) => [row.kind ?? "", row.n]));
      });
    },
  };
}

export const withStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("store", createStore(c.env));
  await next();
};
