import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { listFromIndex } from "../src/lib/act-list";
import { createStore } from "../src/lib/store";
import type { ActIndexEntry } from "../src/lib/types";
import { removeObject, replaceObject } from "./support";

const get = (path: string) => exports.default.fetch(`https://example.com${path}`, { redirect: "manual" });
const page = async (path: string) => (await get(path)).text();

const INSERT =
  "INSERT INTO acts (path, alias, slug, kind, title, short, status, freshness_status, year, number, from_date, latest, articles) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, '1990-01-01', '1990-01-01', ?9)";

interface Row {
  path: string;
  kind: string;
  title: string;
  short: string | null;
  status: string;
  year: number;
  number: string;
  articles: number;
}

const row = (kind: string, year: number, number: string, extra: Partial<Row> = {}): Row => ({
  path: `${kind}/${year}/${number}`,
  kind,
  title: `${kind} nr. ${number}/${year}`,
  short: null,
  status: "in force",
  year,
  number,
  articles: 3,
  ...extra,
});

const extras: Row[] = [
  row("lege", 1990, "31", { title: "Legea nr. 31/1990", short: "Legea societăților" }),
  row("lege", 1990, "9", { status: "repealed 2005-01-01" }),
  row("decret-lege", 1938, "115"),
  ...Array.from({ length: 120 }, (_, i) => row("oug", 2002, String(i + 1), { title: `Ordonanța de urgență nr. ${i + 1}/2002` })),
];

beforeEach(async () => {
  await env.DB.batch(
    extras.map((r) => env.DB.prepare(INSERT).bind(r.path, r.path.replaceAll("/", "-"), r.kind, r.title, r.short, r.status, r.year, r.number, r.articles)),
  );
});

afterEach(async () => {
  await env.DB.prepare("DELETE FROM acts WHERE path NOT IN ('lege/2009/287', 'lege/2010/134')").run();
});

const paths = async (filter: Parameters<ReturnType<typeof createStore>["listActs"]>[0]) =>
  (await createStore(env).listActs(filter)).items.map((item) => item.path);

describe("store.listActs", () => {
  it("orders by year, then number as a number, then path", async () => {
    const list = await createStore(env).listActs({ page: 1 });
    expect(list.total).toBe(125);
    expect(list.items).toHaveLength(50);
    expect(list.items[0]?.path).toBe("lege/2010/134");
    expect(list.items[1]?.path).toBe("lege/2009/287");
    expect(list.items[2]?.path).toBe("oug/2002/120");
    expect(list.items[3]?.path).toBe("oug/2002/119");
    const second = await createStore(env).listActs({ page: 3 });
    expect(second.items.map((item) => item.path).slice(-3)).toEqual(["lege/1990/31", "lege/1990/9", "decret-lege/1938/115"].slice(0, 3));
    expect(second.pages).toBe(3);
  });

  it("filters by kind, year and status", async () => {
    expect(await paths({ page: 1, kind: "decret-lege" })).toEqual(["decret-lege/1938/115"]);
    expect(await paths({ page: 1, year: 1990 })).toEqual(["lege/1990/31", "lege/1990/9"]);
    expect(await paths({ page: 1, year: 1990, status: "repealed" })).toEqual(["lege/1990/9"]);
    expect(await paths({ page: 1, year: 1990, status: "in-force" })).toEqual(["lege/1990/31"]);
  });

  it("matches the text without case or diacritics, and a number exactly", async () => {
    expect(await paths({ page: 1, q: "SOCIETATILOR" })).toEqual(["lege/1990/31"]);
    expect(await paths({ page: 1, q: "societăților" })).toEqual(["lege/1990/31"]);
    expect(await paths({ page: 1, q: "Ordonanta de urgenta nr. 7/" })).toEqual(["oug/2002/7"]);
    expect(await paths({ page: 1, kind: "lege", q: "287" })).toEqual(["lege/2009/287"]);
    expect(await paths({ page: 1, q: "100%" })).toEqual([]);
  });

  it("clamps the page and reports the total", async () => {
    const list = await createStore(env).listActs({ page: 99 });
    expect(list.page).toBe(3);
    expect(list.over).toBe(false);
  });

  it("caps the count and says there are more", async () => {
    await env.DB.batch(
      Array.from({ length: 1000 }, (_, i) => {
        const r = row("hg", 1900 + (i % 10), String(i + 1));
        return env.DB.prepare(INSERT).bind(r.path, r.path.replaceAll("/", "-"), r.kind, r.title, r.short, r.status, r.year, r.number, r.articles);
      }),
    );
    const list = await createStore(env).listActs({ page: 1 });
    expect(list.total).toBe(1000);
    expect(list.over).toBe(true);
    expect(list.pages).toBe(20);
  });
});

describe("the acts page", () => {
  it("lists acts with title, number, status and article count, and marks the menu", async () => {
    const html = await page("/acte");
    expect(html).toContain("<h1>Toate actele</h1>");
    expect(html).toContain('<a class="doc-link" href="/oug/2002/120">Ordonanța de urgență nr. 120/2002</a>');
    expect(html).toContain('<a class="doc-link" href="/codul-civil">Codul civil</a>');
    expect(html).toContain("nr. 287/2009");
    expect(html).toContain("2 articole");
    expect(html).toContain('<a href="/acte" aria-current="page" data-text="Acte">Acte</a>');
    expect(html).toContain("125 de acte");
  });

  it("filters by the form fields and keeps them in the form", async () => {
    const html = await page("/acte?tip=lege&an=1990&stare=abrogate");
    expect(html).toContain('href="/lege/1990/9"');
    expect(html).not.toContain('href="/lege/1990/31"');
    expect(html).toContain('<option value="lege" selected="">Legi</option>');
    expect(html).toContain('<option value="abrogate" selected="">Abrogate</option>');
    expect(html).toMatch(/name="an"[^>]*value="1990"|value="1990"[^>]*name="an"/);
    expect(html).toContain("1 act");
  });

  it("paginates in pages of fifty and links to the other pages", async () => {
    const html = await page("/acte?tip=oug");
    expect(html.match(/class="doc-link"/g)).toHaveLength(50);
    expect(html).toContain('href="/acte?tip=oug&amp;pagina=2"');
    const last = await page("/acte?tip=oug&pagina=3");
    expect(last.match(/class="doc-link"/g)).toHaveLength(20);
    expect(last).toContain("Actele 101–120 din 120");
  });

  it("answers 400 for a year that is not four digits, with the error beside the field", async () => {
    const response = await get("/acte?an=19x");
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('id="acte-an-error"');
    expect(html).toContain("Scrie un an din patru cifre");
    expect(html).toContain('<div class="error-summary"');
    expect(html).toContain("noindex");
  });

  it("ignores an unknown kind and status", async () => {
    const response = await get("/acte?tip=nimic&stare=nimic");
    expect(response.status).toBe(200);
  });

  it("shows a message when nothing matches", async () => {
    const html = await page("/acte?q=zzzzzz");
    expect(html).toContain("Niciun act nu corespunde filtrelor.");
    expect(html).not.toContain("page-numbers");
  });
});

describe("links to the acts page", () => {
  it("is in the header, the footer and under the code list on the home page", async () => {
    const html = await page("/despre");
    expect(html).toContain('<a href="/acte" data-text="Acte">Acte</a>');
    expect(html).toContain('<li><a href="/acte">Acte</a></li>');
    const home = await page("/");
    expect(home).toContain('<p><a href="/acte">Toate actele</a></p>');
  });
});

describe("Modificări aduse on the act page", () => {
  const restores: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const restore of restores.splice(0)) await restore();
  });

  async function addAct(path: string): Promise<void> {
    const act = await createStore(env).act("lege/2009/287");
    restores.push(await replaceObject(`acts/${path}/act.json`, { ...act, path, alias: null, title: "Legea nr. 200/2023", short: null, articles: [] }));
    const index = await createStore(env).actIndex();
    restores.push(await replaceObject("acts/index.json", { schema: "textdelege/act-index/1", acts: index }));
  }

  it("lists what a numbered act changed in other acts", async () => {
    await addAct("lege/2023/200");
    const html = await page("/lege/2023/200");
    expect(html).toContain('<section aria-labelledby="modificari-aduse"><h2 id="modificari-aduse">Modificări aduse</h2>');
    expect(html).toContain('<a href="/codul-civil">Codul civil</a>');
  });

  it("reads the law object only for numbered paths and shows nothing without one", async () => {
    await addAct("lege/2023/201");
    expect(await page("/lege/2023/201")).not.toContain("modificari-aduse");
    expect(await page("/codul-civil")).not.toContain("modificari-aduse");
  });

  it("does not repeat the section on the other tabs", async () => {
    await addAct("lege/2023/200");
    expect(await page("/lege/2023/200/istoric")).not.toContain("modificari-aduse");
  });

  it("is absent when the law object is gone", async () => {
    await addAct("lege/2023/200");
    restores.push(await removeObject("laws/legea-200-2023.json"));
    expect(await page("/lege/2023/200")).not.toContain("modificari-aduse");
  });
});

describe("the acts page against a database without the new columns", () => {
  const restores: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const restore of restores.splice(0)) await restore();
  });

  const entry = (path: string, kind: string, extra: Partial<ActIndexEntry> = {}): ActIndexEntry => ({
    path,
    alias: null,
    title: `Act ${path}`,
    short: null,
    kind,
    status: "in force",
    from: null,
    latest: "1990-01-01",
    articles: 2,
    ...extra,
  });

  const acts = [
    entry("lege/1990/31", "lege", { title: "Legea nr. 31/1990", short: "Legea societăților" }),
    entry("lege/1990/9", "lege", { status: "repealed 2005-01-01" }),
    entry("decret-lege/1938/115", "decret-lege"),
    ...Array.from({ length: 60 }, (_, i) => entry(`oug/2002/${i + 1}`, "oug")),
  ];

  async function fetchBroken(path: string): Promise<Response> {
    restores.push(await replaceObject("acts/index.json", { schema: "textdelege/act-index/1", acts }));
    const db = new Proxy(env.DB, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property !== "prepare") return typeof member === "function" ? member.bind(target) : member;
        return (sql: string) => {
          if (sql.includes("FROM acts") && sql.includes("year")) throw new Error("D1_ERROR: no such column: year");
          return target.prepare(sql);
        };
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    return app.fetch(new Request(`https://example.com${path}`), { ...env, DB: db }, context);
  }

  it("lists the acts from the index, newest first, with the filters and pages", async () => {
    const response = await fetchBroken("/acte?tip=oug");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html.match(/class="doc-link"/g)).toHaveLength(50);
    expect(html).toContain('href="/oug/2002/60"');
    const second = await (await fetchBroken("/acte?tip=oug&pagina=2")).text();
    expect(second.match(/class="doc-link"/g)).toHaveLength(10);
    const repealed = await (await fetchBroken("/acte?an=1990&stare=abrogate")).text();
    expect(repealed).toContain('href="/lege/1990/9"');
    expect(repealed).not.toContain('href="/lege/1990/31"');
    expect(await (await fetchBroken("/acte?q=SOCIETATILOR")).text()).toContain('href="/lege/1990/31"');
  });

  it("keeps failures of other pages unchanged", async () => {
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property !== "prepare") return Reflect.get(target, property, target);
        return () => {
          throw new Error("D1_ERROR: broken");
        };
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const response = await app.fetch(new Request("https://example.com/sitemap.xml"), { ...env, DB: db }, context);
    expect(response.status).toBe(503);
  });
});

describe("listFromIndex", () => {
  const index: ActIndexEntry[] = [
    { path: "lege/1990/9", alias: null, title: "Legea 9", short: null, kind: "lege", status: "in force", from: null, latest: "", articles: 1 },
    { path: "lege/1990/31", alias: null, title: "Legea 31", short: null, kind: "lege", status: "repealed", from: null, latest: "", articles: 1 },
    { path: "constitutie/1991", alias: "constitutia", title: "Constituția", short: null, kind: "constitutie", status: "in force", from: null, latest: "", articles: 1 },
  ];

  it("orders by year then numeric number, and matches numbers and status", () => {
    expect(listFromIndex(index, { page: 1 }).items.map((i) => i.path)).toEqual([
      "constitutie/1991",
      "lege/1990/31",
      "lege/1990/9",
    ]);
    expect(listFromIndex(index, { page: 1, q: "9" }).items.map((i) => i.path)).toEqual(["lege/1990/9"]);
    expect(listFromIndex(index, { page: 1, status: "repealed" }).items.map((i) => i.path)).toEqual(["lege/1990/31"]);
    expect(listFromIndex(index, { page: 1, q: "constitutia" }).items[0]?.alias).toBe("constitutia");
  });

  it("caps the count like the database does", () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ ...index[0]!, path: `hg/2000/${i + 1}`, kind: "hg" }));
    const list = listFromIndex(many, { page: 99 });
    expect(list).toMatchObject({ total: 1000, over: true, pages: 20, page: 20 });
  });
});
