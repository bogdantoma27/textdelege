import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { removeObject } from "./support";

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string) => (await get(path)).text();

async function insert(file: string, state: string, number: string, title: string | null, text: string) {
  await env.DB.prepare(
    "INSERT INTO articles_fts (act_path, file, state, number, title, text) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind("lege/2010/134", file, state, number, title, text)
    .run();
}

describe("search", () => {
  it("shows one visible field labelled Caută, filled with the query, and none in the header", async () => {
    const html = await page("/cauta?q=text");
    expect(html.match(/type="search"/g)?.length).toBe(1);
    expect(html).not.toContain('class="find"');
    expect(html).not.toContain('id="q-overlay"');
    expect(html).toContain('<label class="label" for="q-results">Caută</label>');
    expect(html).toMatch(/<input class="field" id="q-results" type="search" name="q" value="text"/);
    expect(html).toMatch(/<button class="btn secondary" type="submit">Caută<\/button>/);
    expect(html).toContain("Doar în vigoare");
  });

  it("shows an empty field on the page without a query", async () => {
    const html = await page("/cauta");
    expect(html).toMatch(/<input class="field" id="q-results" type="search" name="q" maxlength="200" autocomplete="off"/);
  });

  afterEach(async () => {
    await env.DB.prepare("DELETE FROM articles_fts WHERE file IN ('art-0009', 'art-0010') OR file LIKE 'art-pg-%'").run();
  });

  async function insertMany(count: number) {
    for (let i = 1; i <= count; i++) {
      await insert(`art-pg-${String(i).padStart(3, "0")}`, "in-force", String(1000 + i), null, `Textul zzpaginat numarul ${i}`);
    }
  }

  it("answers 503 with a friendly page when the search database fails", async () => {
    const broken = {
      prepare() {
        throw new Error("D1_ERROR: no such table: articles_fts");
      },
    };
    const res = await app.fetch(new Request("https://example.com/cauta?q=text"), { ...env, DB: broken });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
    const html = await res.text();
    expect(html).toContain("Serviciul nu este disponibil momentan");
    expect(html).not.toContain("articles_fts");
    expect(html).toContain('<ol><li><a href="/">Acasă</a></li></ol>');
    for (const href of ["/#coduri", "/modificari", "/legislatie", "/despre"]) {
      expect(html).toContain(`<li><a href="${href}">`);
    }
  });

  it("answers 503 on the search page when no build is published", async () => {
    const restore = await removeObject("manifest.json");
    try {
      expect((await get("/cauta?q=text")).status).toBe(503);
    } finally {
      await restore();
    }
  });

  it("search redirects a citation to the article URL", async () => {
    const res = await get("/cauta?q=" + encodeURIComponent("art. 1 Codul civil"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/codul-civil/art-1");
  });

  it("redirects a numbered act citation of a selected act", async () => {
    const res = await get("/cauta?q=" + encodeURIComponent("Legea 134/2010 art. 1"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/lege/2010/134/art-1");
  });

  it("redirects a numbered act citation to the page of an amending act that is not selected", async () => {
    for (const query of ["Legea 71/2011", "legea nr. 71 din 2011 art. 3"]) {
      const res = await get("/cauta?q=" + encodeURIComponent(query));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/lege/2011/71");
    }
  });

  it("falls through to full-text search when the cited act is not selected", async () => {
    const res = await get("/cauta?q=" + encodeURIComponent("Legea 31/1990 art. 5"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Niciun rezultat");
  });

  it("falls through for a code that is not in the manifest", async () => {
    const res = await get("/cauta?q=" + encodeURIComponent("art. 3 Codul muncii"));
    expect(res.status).toBe(200);
  });

  it("renders hits with state tags and excludes repealed under in_force", async () => {
    await insert("art-0009", "repealed", "9", "Abrogat", "Procedura abrogata veche.");
    const all = await page("/cauta?q=procedura");
    expect(all).toContain('href="/codul-procedura/art-9"');
    expect(all).toContain('<strong class="badge badge-grey">Abrogat</strong>');
    expect(all).toContain("<mark>");
    const some = await page("/cauta?q=procedura&in_force=1");
    expect(some).not.toContain("/codul-procedura/art-9");
  });

  it("renders a hit with act name and article link, naming the state only when it is not in force", async () => {
    const html = await page("/cauta?q=text");
    expect(html).toContain("Codul civil");
    expect(html).toContain('href="/codul-civil/art-1"');
    expect(html).not.toContain('<strong class="badge badge-green">În vigoare</strong>');
    expect(html).toContain('name="in_force"');
  });

  it("shows the count in a results bar and applies the filter with a secondary button", async () => {
    const html = await page("/cauta?q=text");
    expect(html).toMatch(/<div class="results-bar"><span class="count">\d+ rezultat(e|)<\/span><\/div>/);
    expect(html).not.toContain('class="actions"');
    expect(html).not.toContain("page-numbers");
    expect(html).toContain('<ol><li><a href="/">Acasă</a></li><li aria-current="page">Căutare</li></ol>');
  });

  it("makes each result title a second level heading", async () => {
    const html = await page("/cauta?q=text");
    expect(html).toMatch(/<h2 class="hit-head"><a href="\/codul-civil\/art-1">/);
    expect(html).not.toContain('<div class="hit-head">');
  });

  it("states the real total and pages the results by twenty with numbered addresses", async () => {
    await insertMany(45);
    const first = await page("/cauta?q=zzpaginat");
    expect(first).toContain('<span class="count">Rezultatele 1–20 din 45</span>');
    expect(first.match(/<li class="hit">/g)).toHaveLength(20);
    expect(first).not.toContain("primele");
    expect(first).toContain('<nav class="page-numbers" aria-label="Paginile listei">');
    expect(first).toContain('<span class="page-current" aria-label="Pagina 1" aria-current="page">1</span>');
    expect(first).toContain('<a href="/cauta?q=zzpaginat&amp;pagina=2" aria-label="Pagina 2">2</a>');
    expect(first).toContain('<a href="/cauta?q=zzpaginat&amp;pagina=3" aria-label="Pagina 3">3</a>');
    expect(first).toContain('<a href="/cauta?q=zzpaginat&amp;pagina=2" rel="next">');
    expect(first).not.toContain('rel="prev"');

    const second = await page("/cauta?q=zzpaginat&pagina=2");
    expect(second).toContain('<span class="count">Rezultatele 21–40 din 45</span>');
    expect(second.match(/<li class="hit">/g)).toHaveLength(20);
    expect(second).toContain('aria-label="Pagina 2" aria-current="page"');
    expect(second).toContain('<a href="/cauta?q=zzpaginat" rel="prev">');

    const third = await page("/cauta?q=zzpaginat&pagina=3");
    expect(third).toContain('<span class="count">Rezultatele 41–45 din 45</span>');
    expect(third.match(/<li class="hit">/g)).toHaveLength(5);
    expect(third).not.toContain('rel="next"');
  });

  it("gives different results on different pages", async () => {
    await insertMany(25);
    const ids = (html: string) => [...html.matchAll(/class="hit-head"><a href="\/codul-procedura\/art-(\d+)"/g)].map((m) => m[1]);
    const one = ids(await page("/cauta?q=zzpaginat"));
    const two = ids(await page("/cauta?q=zzpaginat&pagina=2"));
    expect(one).toHaveLength(20);
    expect(two).toHaveLength(5);
    expect(new Set([...one, ...two]).size).toBe(25);
  });

  it("shows the last page for a page past the end and the first for a page that is not a number", async () => {
    await insertMany(45);
    const past = await page("/cauta?q=zzpaginat&pagina=99");
    expect(past).toContain("Rezultatele 41–45 din 45");
    expect(past).toContain('aria-label="Pagina 3" aria-current="page"');
    for (const raw of ["0", "abc", "-2"]) {
      expect(await page(`/cauta?q=zzpaginat&pagina=${raw}`)).toContain("Rezultatele 1–20 din 45");
    }
    expect((await get("/cauta?q=zzpaginat&pagina=")).headers.get("location")).toBe("/cauta?q=zzpaginat");
  });

  it("counts only what is in force under the filter and keeps it in the page addresses", async () => {
    await insertMany(25);
    await insert("art-pg-900", "repealed", "900", null, "Textul zzpaginat abrogat");
    expect(await page("/cauta?q=zzpaginat")).toContain("Rezultatele 1–20 din 26");
    const some = await page("/cauta?q=zzpaginat&in_force=1");
    expect(some).toContain("Rezultatele 1–20 din 25");
    expect(some).toContain('href="/cauta?q=zzpaginat&amp;in_force=1&amp;pagina=2"');
  });

  it("states the exact count without pages when the results fit on one page", async () => {
    await insertMany(20);
    const html = await page("/cauta?q=zzpaginat");
    expect(html).toContain('<span class="count">20 de rezultate</span>');
    expect(html).not.toContain("page-numbers");
  });

  it("shows only the cap and no pages beyond it when the matches pass a thousand", async () => {
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1030)
       INSERT INTO articles_fts (act_path, file, state, number, title, text)
       SELECT 'lege/2010/134', 'art-pg-' || printf('%04d', i), 'in-force', CAST(i AS TEXT), NULL, 'zzplafonat ' || i FROM n`,
    ).run();
    const first = await page("/cauta?q=zzplafonat");
    expect(first).toContain('<span class="count">Peste 1.000 de rezultate</span>');
    expect(first).toContain('aria-label="Pagina 50"');
    expect(first).not.toContain('aria-label="Pagina 51"');
    const past = await page("/cauta?q=zzplafonat&pagina=99");
    expect(past).toContain('aria-label="Pagina 50" aria-current="page"');
    expect(past.match(/<li class="hit">/g)).toHaveLength(20);
  });

  it("answers a live request with at most eight hits and no count", async () => {
    await insertMany(30);
    const live = await page("/cauta?q=zzpaginat&live=1");
    expect(live.match(/<li class="hit">/g)).toHaveLength(8);
    expect(live).not.toContain('class="count"');
    expect(live).not.toContain("results-bar");
    expect(live).not.toContain("page-numbers");
    expect(live).toContain("noindex");
  });

  it("matches a three-letter last word whole and a four-letter one as a prefix", async () => {
    await insertMany(3);
    expect(await page("/cauta?q=zzpag")).toContain('<span class="count">3 rezultate</span>');
    expect(await page("/cauta?q=zzp")).toContain("Niciun rezultat");
  });

  it("keeps the in-force checkbox checked", async () => {
    const html = await page("/cauta?q=text&in_force=1");
    expect(html).toMatch(/name="in_force"[^>]*checked/);
  });

  it("renders the snippet as the escaped snippet", async () => {
    await insert("art-0010", "in-force", "10", null, "Un text cu <b>bold</b> si procedura.");
    const html = await page("/cauta?q=bold");
    expect(html).toContain("&lt;b&gt;<mark>bold</mark>&lt;/b&gt;");
    expect(html).not.toContain("<b>bold</b>");
  });

  it("escapes the query where it is echoed", async () => {
    const html = await page("/cauta?q=" + encodeURIComponent("<script>alert(1)</script>"));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Niciun rezultat");
  });

  it("renders the search page with examples for an empty query", async () => {
    expect((await get("/cauta?q=")).headers.get("location")).toBe("/cauta");
    for (const path of ["/cauta", "/cauta?q=%20%20"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Legea 31/1990");
      expect(html).toContain('<meta name="robots" content="noindex"');
      expect(html).not.toContain("Niciun rezultat");
    }
  });

  it("marks result pages noindex", async () => {
    expect(await page("/cauta?q=text")).toContain('<meta name="robots" content="noindex"');
  });

  it("caps the query at 200 characters", async () => {
    const long = "a".repeat(190) + " procedura " + "b".repeat(500);
    const html = await page("/cauta?q=" + long);
    expect(html).not.toContain("b".repeat(11));
    const echoed = /name="q"[^>]*value="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(echoed.length).toBe(200);
  });

  it("suggests what to try when nothing matches", async () => {
    const html = await page("/cauta?q=zzzzqqqq");
    expect(html).toContain("Niciun rezultat");
    expect(html).toContain("<li>");
  });
});
