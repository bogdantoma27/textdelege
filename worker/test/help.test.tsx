import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/lib/store";
import { t } from "../src/text";
import { BADGES } from "../src/views/shared";
import type { Manifest, OfficialSource } from "../src/lib/types";
import { replaceObject } from "./support";

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string, init?: RequestInit) => (await get(path, init)).text();

const restores: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0)) await restore();
});

describe("help pages", () => {
  it("render", async () => {
    for (const path of ["/despre", "/legenda"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html).toContain("<h1");
      expect(html, path).toMatch(/<ol><li><a href="\/">Acasă<\/a><\/li><li aria-current="page">[^<]+<\/li><\/ol>/);
    }
  });

  it("/despre has every section anchor and the licence statements", async () => {
    const html = await page("/despre");
    expect(html).toContain('<a href="https://github.com/lexifina/romania-law">lexifina/romania-law</a>');
    expect(html).toContain("repo-ul public");
    for (const id of ["actualitate", "limitari", "licenta", "date-personale", "contact"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain("data intrării în vigoare");
    expect(html).toContain("legislatie.just.ro");
    expect(html).toContain("Legea nr. 8/1996");
    expect(html).toContain("CC0");
    expect(html).toContain("MIT");
    expect(html).not.toContain("lexifina.com");
    expect(html).toContain('<a href="https://github.com/lexifina/romania-law/issues">repo sursă pe GitHub</a>');
    expect(html).toContain('<a href="https://github.com/bogdantoma27/textdelege/issues">repo site-ului pe GitHub</a>');
    expect(html).not.toContain("amended, not consolidated");
    for (const status of ["La zi", "Modificare în așteptare", "Verificare întârziată", "Neverificat", "Sursă indisponibilă"]) {
      expect(html, status).toContain(`<dt>${status}</dt>`);
    }
    const statuses = /<section id="actualitate"[^]*?<\/section>/.exec(html)![0];
    expect(statuses).not.toContain("<code>");
    for (const code of ["pending-change", "source-unavailable"]) expect(statuses, code).not.toContain(code);
  });

  it("/despre lists every unavailable source with its name and date, and no other", async () => {
    const source = (name: string, state: OfficialSource["state"], since: string | null): OfficialSource => ({
      name,
      state,
      unavailable_since: since,
      last_successful_contact: "2026-11-01T08:00:00Z",
      as_of: "2026-11-08T08:56:56Z",
    });
    const manifest: Manifest = structuredClone(await createStore(env).manifest());
    manifest.status.official_sources = [
      source("Portal legislativ: web service (legislatie.just.ro)", "unavailable", "2026-11-08T08:52:13Z"),
      source("Portal legislativ: website (legislatie.just.ro)", "unavailable", "2026-11-05T10:00:00Z"),
      source("EU Publications Office (CELLAR)", "available", null),
    ];
    restores.push(await replaceObject("manifest.json", manifest));
    const html = await page("/despre");
    expect(html).toContain("Portal legislativ: web service (legislatie.just.ro): din 08.11.2026");
    expect(html).toContain("Portal legislativ: website (legislatie.just.ro): din 05.11.2026");
    expect(html).not.toContain("CELLAR");
  });

  it("pages render when a silent source has no date at all, the error page included", async () => {
    const manifest: Manifest = structuredClone(await createStore(env).manifest());
    manifest.status.official_sources = [
      {
        name: "Portal legislativ: website (legislatie.just.ro)",
        state: "unavailable",
        unavailable_since: null,
        last_successful_contact: null,
        as_of: "2026-11-08T08:56:56Z",
      },
    ];
    restores.push(await replaceObject("manifest.json", manifest));
    const about = await get("/despre");
    expect(about.status).toBe(200);
    const html = await about.text();
    expect(html).toContain("<li>Portal legislativ: website (legislatie.just.ro)</li>");
    const missing = await get("/nu-exista");
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain("nu răspunde");
    expect((await get("/codul-civil")).status).toBe(200);
  });

  it("/despre has no source list while every source answers", async () => {
    expect(await page("/despre")).not.toContain("nu răspund acum");
  });

  it("/legenda renders a tag for every state", async () => {
    const html = await page("/legenda");
    expect(html).toContain('<strong class="badge badge-green">');
    expect(html).toContain('<strong class="badge badge-grey">');
    expect(html).toContain('<strong class="badge badge-yellow">');
    for (const label of ["În vigoare", "Abrogat", "Viitor", "Text încheiat", "Aplicat", "Programat"]) {
      expect(html, label).toContain(label);
    }
  });

  it("/legenda explains every verb, diff mark and bar colour", async () => {
    const html = await page("/legenda");
    for (const verb of ["Intrat în vigoare", "Modificat", "Completat cu", "Abrogat", "Declarat neconstituțional", "Text reconfirmat"]) {
      expect(html, verb).toContain(verb);
    }
    expect(html).toContain("<ins>");
    expect(html).toContain("<del>");
    for (let n = 1; n <= 8; n++) expect(html, `bar ${n}`).toContain(`class="p b${n}"`);
    expect(html).not.toContain("Republicat");
  });

  it("/legenda draws the colour bars of the examples", async () => {
    const html = await page("/legenda");
    expect(html).toContain('<div class="law attr hl">');
    expect(html).toContain('<section id="bare"');
  });

  it("/legenda lists every badge of the list the pages use, with its colour", async () => {
    const html = await page("/legenda");
    for (const { colour, label } of Object.values(BADGES)) {
      expect(html, label).toContain(`<strong class="badge badge-${colour}">${t(label, { date: t("dateFormat") })}</strong>`);
    }
    expect(html).toContain("Formă anterioară");
    expect(html).toContain("Text neconsolidat");
  });

  it("/legenda explains every badge that the pages render", async () => {
    const legend = await page("/legenda");
    const explained = new Set([...legend.matchAll(/<strong class="badge [^"]*">([^<]+)<\/strong>/g)].map((m) => m[1]!.replace(/ (la|din) (\d\d\.\d\d\.\d{4}|ZZ\.LL\.AAAA)$/, "")));
    const seen = new Set<string>();
    for (const path of [
      "/",
      "/codul-civil",
      "/codul-civil/art-1",
      "/codul-civil/art-1/2012-01-01",
      "/codul-civil/art-1/1800-01-01",
      "/codul-civil/istoric",
      "/codul-civil/jurisprudenta",
      "/codul-civil/2012-01-01",
      "/codul-civil/art-1/compara/2011-10-01..2023-07-09",
      "/legislatie/2020-01-01",
      "/legislatie/2000-01-01",
      "/modificari",
      "/cauta?q=codul",
    ]) {
      const html = await page(path);
      for (const match of html.matchAll(/<strong class="badge [^"]*">([^<]+)<\/strong>/g)) {
        seen.add(match[1]!.replace(/ (la|din) (\d\d\.\d\d\.\d{4}|ZZ\.LL\.AAAA)$/, ""));
      }
    }
    expect(seen.size).toBeGreaterThan(2);
    for (const label of seen) expect(explained, label).toContain(label);
  });

  it("has no API page", async () => {
    expect((await get("/api")).status).toBe(404);
  });

  it("every footer link returns 200", async () => {
    const html = await page("/");
    const footer = html.slice(html.indexOf('<footer class="site-footer"'));
    const hrefs = [...footer.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => h.startsWith("/"));
    expect(hrefs).toEqual(expect.arrayContaining(["/#coduri", "/modificari", "/legislatie", "/cauta", "/abonare", "/despre", "/legenda"]));
    for (const href of new Set(hrefs)) {
      const res = await get(href.split("#")[0] || "/", { redirect: "follow" });
      expect(res.status, href).toBe(200);
    }
  });
});
