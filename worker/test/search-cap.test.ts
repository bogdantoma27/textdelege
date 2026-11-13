import { env } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RANK_CAP, createStore } from "../src/lib/store";

const COMMON = "zzcomun";
const ROWS = RANK_CAP * 3;

async function insertRows(): Promise<void> {
  for (let start = 0; start < ROWS; start += 500) {
    const statements = [];
    for (let i = start; i < Math.min(ROWS, start + 500); i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO articles_fts (act_path, file, state, number, title, text) VALUES (?, ?, 'in-force', ?, NULL, ?)",
        ).bind("lege/2010/134", `art-cap-${i}`, String(9000 + i), `${COMMON} text umplutura ${i}${i % 97 === 0 ? " zzrar" : ""}`),
      );
    }
    await env.DB.batch(statements);
  }
}

/** A store whose D1 reports how many rows each query read. */
function measured(reads: number[]) {
  const db = {
    prepare(sql: string) {
      const statement = env.DB.prepare(sql);
      return {
        bind: (...values: unknown[]) => {
          const bound = statement.bind(...values);
          return {
            all: async <T>() => {
              const result = await bound.all<T>();
              reads.push(result.meta.rows_read);
              return result;
            },
            first: async <T>() => bound.first<T>(),
          };
        },
      };
    },
  } as unknown as D1Database;
  return createStore({ ...env, DB: db });
}

describe("search ranking cap", () => {
  beforeAll(insertRows, 120_000);
  afterAll(async () => {
    await env.DB.prepare("DELETE FROM articles_fts WHERE file LIKE 'art-cap-%'").run();
  });

  it("reads a bounded number of rows for a term that matches nearly everything", async () => {
    const reads: number[] = [];
    const hits = await measured(reads).search(COMMON, false, 20);
    expect(hits).toHaveLength(20);
    expect(reads).toHaveLength(1);
    // Ranking sorts RANK_CAP candidates: a handful of reads per candidate, whatever the number of matches.
    expect(reads[0]).toBeLessThanOrEqual(RANK_CAP * 3 + 10);
    const old = await env.DB.prepare(
      `SELECT act_path FROM articles_fts WHERE articles_fts MATCH '"${COMMON}"' ORDER BY bm25(articles_fts, 0, 0, 0, 4.0, 8.0, 1.0) LIMIT 20`,
    ).all();
    expect(old.meta.rows_read).toBeGreaterThanOrEqual(ROWS);
    expect(reads[0]).toBeLessThan(old.meta.rows_read * 0.75);
  });

  it("gives a deep page of a common term from the capped set only", async () => {
    const hits = await createStore(env).search(COMMON, false, 20, 40);
    expect(hits).toHaveLength(20);
  });

  it("returns the same top results as ranking every match when the matches fit under the cap", async () => {
    const store = createStore(env);
    const capped = await store.search("zzrar", false, 20);
    const { results } = await env.DB.prepare(
      `SELECT act_path, file FROM articles_fts WHERE articles_fts MATCH '"zzrar"' ORDER BY bm25(articles_fts, 0, 0, 0, 4.0, 8.0, 1.0) * CASE WHEN act_path IN (SELECT path FROM acts WHERE alias IS NOT NULL) THEN 2.0 ELSE 1.0 END LIMIT 20`,
    ).all<{ act_path: string; file: string }>();
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.map((hit) => `${hit.actPath}/${hit.file}`)).toEqual(results.map((row) => `${row.act_path}/${row.file}`));
  });

  it("still counts at most the existing cap", async () => {
    expect(await createStore(env).searchCount(COMMON, false)).toBe(1001);
  });
});
