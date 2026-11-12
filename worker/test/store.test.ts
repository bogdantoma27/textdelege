import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { COUNT_CAP, createStore, toMatchQuery, toSafeHtml } from "../src/lib/store";

const CIVIL = "lege/2009/287";
const PROCEDURE = "lege/2010/134";

describe("store", () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM articles_fts WHERE file IN ('art-0009', 'art-0010')").run();
  });

  it("reads manifest and article", async () => {
    const store = createStore(env);
    const manifest = await store.manifest();
    expect(manifest.schema).toBe("textdelege/manifest/1");
    expect(manifest.acts.map((act) => act.path)).toEqual([CIVIL, PROCEDURE]);

    const article = await store.article(CIVIL, "art-0001");
    expect(article?.number).toBe("1");
    expect(article?.versions).toHaveLength(2);
    expect(article?.versions[1]?.lines[0]?.text).toBe("(1) Primul text modificat.");

    const act = await store.act(CIVIL);
    expect(act?.alias).toBe("codul-civil");
    expect((await store.changes("site"))?.scope).toBe("site");
    expect((await store.changes(CIVIL))?.scope).toBe(CIVIL);
    expect((await store.law("legea-200-2023"))?.label).toBe("Legea nr. 200/2023");
    expect((await store.ruling("dcc-1-2019"))?.court).toBe("ccr");
  });

  it("reads the manifest once per store", async () => {
    const store = createStore(env);
    expect(await store.manifest()).toBe(await store.manifest());
  });

  it("returns null for unknown article", async () => {
    const store = createStore(env);
    expect(await store.article(CIVIL, "art-9999")).toBeNull();
    expect(await store.article("lege/1999/1", "art-0001")).toBeNull();
    expect(await store.act("lege/1999/1")).toBeNull();
    expect(await store.changes("lege/1999/1")).toBeNull();
  });

  it("returns null for unknown law and ruling", async () => {
    const store = createStore(env);
    expect(await store.law("legea-1-1999")).toBeNull();
    expect(await store.ruling("ccr-9-1999")).toBeNull();
  });

  it("resolves alias to path", async () => {
    const store = createStore(env);
    expect(await store.resolveAlias("codul-civil")).toBe(CIVIL);
    expect(await store.resolveAlias("codul-procedura")).toBe(PROCEDURE);
    expect(await store.resolveAlias("nu-exista")).toBeNull();
  });

  it("reads objects at stable keys that do not name the build", async () => {
    const stored = await env.DATA.get(`acts/${CIVIL}/art/art-0002.json`);
    expect(stored).not.toBeNull();
    await stored?.arrayBuffer();
    expect((await createStore(env).article(CIVIL, "art-0002"))?.number).toBe("2");
    expect(await env.DATA.get("b/20261108T060000Z-cd6b8ad/acts/lege/2009/287/art/art-0002.json")).toBeNull();
  });

  it("search excludes repealed when inForceOnly", async () => {
    const store = createStore(env);
    await env.DB.prepare(
      "INSERT INTO articles_fts (act_path, file, state, number, title, text) VALUES (?, ?, 'repealed', '9', NULL, 'Procedura abrogata.')",
    )
      .bind(PROCEDURE, "art-0009")
      .run();

    const all = await store.search("procedura", false, 10);
    expect(all.map((hit) => hit.file).sort()).toEqual(["art-0001", "art-0009"]);
    const current = await store.search("procedura", true, 10);
    expect(current.map((hit) => hit.file)).toEqual(["art-0001"]);
    expect(current[0]).toMatchObject({
      actPath: PROCEDURE,
      number: "1",
      title: null,
      state: "in-force",
      snippet: "<mark>Procedura</mark>.",
    });
  });

  it("search matches the last word as a prefix, so results stay while a word is typed", async () => {
    const store = createStore(env);
    expect(await store.searchCount("doil", true)).toBe(await store.searchCount("doilea", true));
    expect(await store.searchCount("doilea", true)).toBe(2);
  });

  it("makes the last word a prefix only from four characters", () => {
    expect(toMatchQuery("art doi")).toBe('"art" "doi"');
    expect(toMatchQuery("art doil")).toBe('"art" "doil"*');
    expect(toMatchQuery("șțăî")).toBe('"șțăî"*');
    expect(toMatchQuery("abc")).toBe('"abc"');
    expect(toMatchQuery("")).toBe("");
  });

  it("search finds a title match and marks it in the snippet", async () => {
    const store = createStore(env);
    const hits = await store.search("titlu", true, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toContain("<mark>Titlu</mark>");
    expect(hits[0]).toMatchObject({ actPath: CIVIL, file: "art-0001", title: "Titlu" });
  });

  it("search ranks a title match in a code above repeated words in another act's text", async () => {
    const insert = "INSERT INTO articles_fts (act_path, file, state, number, title, text) VALUES (?, ?, 'in-force', ?, ?, ?)";
    await env.DB.prepare(insert)
      .bind("lege/2020/1", "art-0009", "9", null, "Contractul și contractul, contractul încheiat.")
      .run();
    await env.DB.prepare(insert).bind(CIVIL, "art-0010", "10", "Contractul", "Părțile se obligă.").run();
    const hits = await createStore(env).search("contractul", true, 10);
    expect(hits.map((hit) => [hit.actPath, hit.file])).toEqual([
      [CIVIL, "art-0010"],
      ["lege/2020/1", "art-0009"],
    ]);
  });

  it("search respects the limit and falls back for a non-numeric one", async () => {
    const store = createStore(env);
    expect(await store.search("doilea", true, 1)).toHaveLength(1);
    expect(await store.search("doilea", true, 0)).toHaveLength(1);
    expect(await store.search("doilea", true, Number.NaN)).toHaveLength(2);
  });

  it("search skips the rows before an offset and treats a bad offset as none", async () => {
    const store = createStore(env);
    const first = await store.search("doilea", true, 1, 0);
    const second = await store.search("doilea", true, 1, 1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.file).not.toBe(first[0]?.file);
    expect(await store.search("doilea", true, 1, 2)).toEqual([]);
    expect(await store.search("doilea", true, 1, -5)).toEqual(first);
    expect(await store.search("doilea", true, 1, Number.NaN)).toEqual(first);
  });

  it("searchCount counts every match whatever the limit, with the same state filter", async () => {
    const store = createStore(env);
    await env.DB.prepare(
      "INSERT INTO articles_fts (act_path, file, state, number, title, text) VALUES (?, ?, 'repealed', '9', NULL, 'Procedura abrogata.')",
    )
      .bind(PROCEDURE, "art-0009")
      .run();
    expect(await store.searchCount("doilea", true)).toBe(2);
    expect(await store.searchCount("procedura", false)).toBe(2);
    expect(await store.searchCount("procedura", true)).toBe(1);
    expect(await store.searchCount("   ", false)).toBe(0);
    expect(await store.searchCount("nimicnimic", false)).toBe(0);
  });

  it("searchCount stops counting just above the cap", async () => {
    const store = createStore(env);
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${COUNT_CAP + 50})
       INSERT INTO articles_fts (act_path, file, state, number, title, text)
       SELECT 'lege/2010/134', 'art-cap-' || i, 'in-force', CAST(i AS TEXT), NULL, 'zzplafonat ' || i FROM n`,
    ).run();
    try {
      expect(await store.searchCount("zzplafonat", true)).toBe(COUNT_CAP + 1);
      expect(await store.searchCount("zzplafonat", false)).toBe(COUNT_CAP + 1);
    } finally {
      await env.DB.prepare("DELETE FROM articles_fts WHERE file LIKE 'art-cap-%'").run();
    }
  });

  it("search escapes HTML in snippets and keeps only its own marks", async () => {
    const store = createStore(env);
    await env.DB.prepare(
      "INSERT INTO articles_fts (act_path, file, state, number, title, text) VALUES (?, 'art-0010', 'in-force', '10', NULL, ?)",
    )
      .bind(PROCEDURE, `<b>x</b> & "y" it's zeta`)
      .run();
    const hits = await store.search("zeta", true, 10);
    expect(hits[0]?.snippet).toBe("&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; it&#39;s <mark>zeta</mark>");
  });

  it("search ignores FTS operators in user input", async () => {
    const store = createStore(env);
    await expect(store.search('art* OR "x', true, 10)).resolves.toEqual([]);
    await expect(store.search("   ", true, 10)).resolves.toEqual([]);
    await expect(store.search('"*"', true, 10)).resolves.toEqual([]);
    const hits = await store.search("primul OR text*", true, 10);
    expect(hits).toEqual([]);
    expect((await store.search("(primul) text:", true, 10)).map((hit) => hit.file)).toEqual([
      "art-0001",
    ]);
  });

  it("toSafeHtml escapes markup and converts only the sentinels", () => {
    expect(toSafeHtml(`<i>&"'\uE000x\uE001`)).toBe("&lt;i&gt;&amp;&quot;&#39;<mark>x</mark>");
  });
});
