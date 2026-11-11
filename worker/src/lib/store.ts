import type { MiddlewareHandler } from "hono";
import type {
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
  sitemapTotal(): Promise<number>;
  sitemapEntries(limit: number, offset: number): Promise<SitemapEntry[]>;
  resolveAlias(alias: string): Promise<string | null>;
  actRulings(path: string): Promise<ArticleRuling[]>;
}

export const PREFIX_MIN = 4;
export const COUNT_CAP = 1000;

export interface SitemapEntry {
  actRef: string;
  number: string | null;
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

export function createStore(env: Env): Store {
  let manifestRead: Promise<Manifest> | undefined;

  const manifest = (): Promise<Manifest> => {
    manifestRead ??= readJson<Manifest>(env.DATA, MANIFEST_KEY).then((found) => {
      if (found === null) {
        throw new NoBuildError();
      }
      return found;
    });
    return manifestRead;
  };

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
          ORDER BY bm25(articles_fts)
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

    async sitemapTotal() {
      const row = await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM acts) + (SELECT COUNT(*) FROM articles) AS total",
      ).first<{ total: number }>();
      return row?.total ?? 0;
    },

    async sitemapEntries(limit, offset) {
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
  };
}

export const withStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("store", createStore(c.env));
  await next();
};
