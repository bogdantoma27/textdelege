import type { MiddlewareHandler } from "hono";
import type {
  ActIndex,
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
  actIndex(): Promise<ActIndexEntry[]>;
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
const INDEX_KEY = "acts/index.json";

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

/** How long an isolate keeps the manifest and the act index before it reads them from R2 again. */
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

const manifestMemo = new Memo<Manifest>();
const indexMemo = new Memo<ActIndexEntry[]>();

/** For tests: forget what this isolate has memoised. */
export function resetStoreCache(): void {
  manifestMemo.reset();
  indexMemo.reset();
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

  const actIndex = (): Promise<ActIndexEntry[]> =>
    indexMemo.get(() =>
      manifest().then(async (current) => {
        const found = await readJson<ActIndex>(env.DATA, INDEX_KEY);
        return found !== null
          ? found.acts
          : current.acts.map((act) => ({
              path: act.path,
              alias: act.alias,
              title: act.title,
              short: act.short,
              kind: act.path.split("/")[0] ?? "",
              status: act.status,
              from: act.from ?? null,
              latest: act.latest,
              articles: act.articles ?? 0,
            }));
      }),
    );

  const readObject = <T>(key: string): Promise<T | null> => readJson<T>(env.DATA, key);

  return {
    manifest,
    actIndex,
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
        snippet: toSafeHtml(row.snippet),
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
      const acts = await actIndex();
      return acts.find((act) => act.alias === alias)?.path ?? null;
    },
  };
}

export const withStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("store", createStore(c.env));
  await next();
};
