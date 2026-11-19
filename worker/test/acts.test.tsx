import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { actSubject } from "../src/lib/act-list";
import { normalise } from "../src/lib/citation";
import { type ActFilter, createStore } from "../src/lib/store";
import type { ActIndexEntry } from "../src/lib/types";
import { putActs, removeObject, replaceObject } from "./support";

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
  row("lege", 1995, "12", { title: "Legea ŞI ţara", short: "Ştiinţa" }),
  ...Array.from({ length: 120 }, (_, i) => row("oug", 2002, String(i + 1), { title: `Ordonanța de urgență nr. ${i + 1}/2002` })),
];

const restores: (() => Promise<void>)[] = [];

beforeEach(async () => {
  await env.DB.batch(
    extras.map((r) => env.DB.prepare(INSERT).bind(r.path, r.path.replaceAll("/", "-"), r.kind, r.title, r.short, r.status, r.year, r.number, r.articles)),
  );
});

afterEach(async () => {
  for (const restore of restores.splice(0).reverse()) await restore();
  await env.DB.prepare("DELETE FROM acts WHERE path NOT IN ('lege/2009/287', 'lege/2010/134')").run();
});

const FOLD: [string, string][] = [["ăĂ", "a"], ["âÂ", "a"], ["îÎ", "i"], ["șȘşŞ", "s"], ["țȚţŢ", "t"]];
function folded(column: string): string {
  let expression = `lower(${column})`;
  for (const [letters, plain] of FOLD) for (const letter of letters) expression = `replace(${expression}, '${letter}', '${plain}')`;
  return expression;
}

/** A plain reference query (no paging, another escape character): the oracle for the filters. */
async function oracle(filter: ActFilter): Promise<string[]> {
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.kind !== undefined) {
    where.push("kind = ?");
    values.push(filter.kind);
  }
  if (filter.year !== undefined) {
    where.push("year = ?");
    values.push(filter.year);
  }
  if (filter.status === "in-force") where.push("status = 'in force'");
  if (filter.status === "repealed") where.push("status LIKE 'repealed%'");
  const q = normalise(filter.q ?? "");
  if (q !== "") {
    const like = `%${q.replace(/[!%_]/g, "!$&")}%`;
    const name = `(${folded("coalesce(title, '')")} || ' ' || ${folded("coalesce(short, '')")})`;
    if (/^[0-9]+$/.test(q)) {
      where.push(`(number = ? OR ${name} LIKE ? ESCAPE '!')`);
      values.push(q, like);
    } else {
      where.push(`${name} LIKE ? ESCAPE '!'`);
      values.push(like);
    }
  }
  const clause = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
  const { results } = await env.DB.prepare(
    `SELECT path FROM acts ${clause} ORDER BY year DESC, CAST(number AS INTEGER) DESC, path LIMIT 5000`,
  )
    .bind(...values)
    .all<{ path: string }>();
  return results.map((r) => r.path);
}

const all = async (filter: Omit<ActFilter, "page">): Promise<string[]> => {
  const store = createStore(env);
  const found: string[] = [];
  for (let page = 1; ; page++) {
    const list = await store.listActs({ ...filter, page });
    found.push(...list.items.map((item) => item.path));
    if (page >= list.pages) return found;
  }
};

const paths = async (filter: ActFilter) => (await createStore(env).listActs(filter)).items.map((item) => item.path);

describe("the act list from D1", () => {
  it("orders by year, then number as a number, then path", async () => {
    const list = await createStore(env).listActs({ page: 1 });
    expect(list.total).toBe(126);
    expect(list.items).toHaveLength(50);
    expect(list.items[0]?.path).toBe("lege/2010/134");
    expect(list.items[1]?.path).toBe("lege/2009/287");
    expect(list.items[2]?.path).toBe("oug/2002/120");
    expect(list.items[3]?.path).toBe("oug/2002/119");
    const third = await createStore(env).listActs({ page: 3 });
    expect(third.items.map((item) => item.path).slice(-3)).toEqual(["lege/1990/31", "lege/1990/9", "decret-lege/1938/115"]);
    expect(third.pages).toBe(3);
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
    // the cedilla forms fold like the comma forms, in the query and in the titles
    expect(await paths({ page: 1, q: "stiinta" })).toEqual(["lege/1995/12"]);
    expect(await paths({ page: 1, q: "ȘI țara" })).toEqual(["lege/1995/12"]);
  });

  it("gives the same acts in the same order as a plain reference query, for every filter", async () => {
    const filters: Omit<ActFilter, "page">[] = [
      {},
      { kind: "oug" },
      { kind: "lege" },
      { year: 1990 },
      { year: 2002, status: "in-force" },
      { status: "repealed" },
      { status: "in-force" },
      { kind: "lege", status: "in-force" },
      { q: "societăților" },
      { q: "SOCIETATILOR" },
      { q: "ştiinţa" },
      { q: "ȘI ţara" },
      { q: "ordonanta de urgenta" },
      { q: "9" },
      { q: "287" },
      { q: "nr. 7/" },
      { q: "100%" },
      { q: "a_b" },
      { kind: "oug", q: "12" },
      { year: 1990, q: "legea" },
    ];
    for (const filter of filters) {
      expect(await all(filter), JSON.stringify(filter)).toEqual(await oracle({ ...filter, page: 1 }));
    }
  });

  it("clamps the page and counts exactly, with no cap", async () => {
    const list = await createStore(env).listActs({ page: 99 });
    expect(list.page).toBe(3);
    expect(list.total).toBe(126);
    expect(await createStore(env).listActs({ page: 0 })).toMatchObject({ page: 1 });
    expect(await createStore(env).listActs({ page: Number.NaN })).toMatchObject({ page: 1 });
    const many = Array.from({ length: 1200 }, (_, i) => ({
      path: `hg/2000/${i + 1}`, alias: null, title: "Legea", short: null, kind: "hg", status: "in force", from: null, latest: "1990-01-01", articles: 1,
    }));
    restores.push(await putActs(many, true));
    const html = await page("/acte");
    expect(html).toContain("1.200 de acte");
    expect(html).toContain("Actele 1–50 din 1.200");
    expect(html).not.toContain("Peste");
    const last = await createStore(env).listActs({ page: 99 });
    expect(last).toMatchObject({ total: 1200, pages: 24, page: 24 });
    expect(last.items).toHaveLength(50);
  });

  it("finds a text without diacritics in a title with them, and a numeric q by number or text", async () => {
    expect(await paths({ page: 1, q: "societatilor" })).toEqual(["lege/1990/31"]);
    expect(await paths({ page: 1, q: "31" })).toEqual(["oug/2002/31", "lege/1990/31"]);
    expect((await createStore(env).listActs({ page: 1, kind: "oug", q: "2002" })).total).toBe(120);
    expect(await paths({ page: 1, kind: "lege", status: "repealed" })).toEqual(["lege/1990/9"]);
  });

  it("binds the text as a parameter: quotes, percent signs and backslashes do not break the query", async () => {
    for (const q of ["'; DROP TABLE acts; --", "100%", "a_b", "\\", '"quoted"', "%", "_", "x' OR '1'='1"]) {
      expect(await paths({ page: 1, q }), q).toEqual([]);
    }
    expect((await createStore(env).listActs({ page: 1 })).total).toBe(126);
  });

  it("makes bounded queries (a COUNT only for year, status and text filters) and reads no act index", async () => {
    const statements: string[] = [];
    const db = new Proxy(env.DB, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property === "prepare") {
          return (sql: string) => {
            statements.push(sql);
            return (member as (sql: string) => unknown).call(target, sql);
          };
        }
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const reads: string[] = [];
    const data = new Proxy(env.DATA, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property !== "get") return typeof member === "function" ? member.bind(target) : member;
        return (key: string, ...rest: unknown[]) => {
          reads.push(key);
          return (member as (...args: unknown[]) => unknown).call(target, key, ...rest);
        };
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    for (const path of ["/acte", "/acte?tip=oug&pagina=2", "/acte?q=societatilor", "/acte?an=1990&stare=abrogate"]) {
      statements.length = 0;
      const response = await app.fetch(new Request(`https://example.com${path}`), { ...env, DB: db, DATA: data }, context);
      expect(response.status).toBe(200);
      await response.text();
      expect(statements.filter((sql) => sql.includes("LIMIT 50")), path).toHaveLength(1);
      expect(statements.filter((sql) => sql.includes("COUNT(*) AS total")), path).toHaveLength(path.includes("q=") || path.includes("an=") ? 1 : 0);
    }
    expect(reads).not.toContain("acts/index.json");
  });

  it("takes the total from the kind counts, with no COUNT query, for no filter or a kind", async () => {
    const statements: string[] = [];
    const db = new Proxy(env.DB, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property === "prepare") {
          return (sql: string) => {
            statements.push(sql);
            return (member as (sql: string) => unknown).call(target, sql);
          };
        }
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    for (const [path, shown] of [["/acte", "126 de acte"], ["/acte?tip=lege", "5 acte"]] as const) {
      statements.length = 0;
      const response = await app.fetch(new Request(`https://example.com${path}`), { ...env, DB: db }, context);
      const html = await response.text();
      expect(html, path).toContain(shown);
      expect(statements.filter((sql) => sql.includes("COUNT(*) AS total FROM acts")), path).toHaveLength(0);
    }
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
    expect(html).toContain("126 de acte");
  });

  it("filters by the form fields and keeps them in the form", async () => {
    const html = await page("/acte?tip=lege&an=1990&stare=abrogate");
    expect(html).toContain('href="/lege/1990/9"');
    expect(html).not.toContain('href="/lege/1990/31"');
    expect(html).toContain('<option value="lege" selected="">Legi</option>');
    expect(html).toContain('<option value="abrogate" selected="">Abrogate</option>');
    expect(html).toContain('<option value="norma">Norme</option>');
    expect(html).toContain('<option value="hotarare">Hotărâri ale autorităților</option>');
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

describe("act subjects", () => {
  it("strips the designation, or unwraps the parenthesis, or says nothing", () => {
    expect(
      actSubject("Hotărârea Guvernului nr. 951/2026 pentru completarea Hotărârii Guvernului nr. 1.074/2021 privind x", "HG nr. 951/2026"),
    ).toBe("pentru completarea Hotărârii Guvernului nr. 1.074/2021 privind x");
    expect(actSubject("Decizia nr. 965/2026 privind autorizarea de funcționare a societății FLEX", "Decizia ASF nr. 965/2026")).toBe(
      "privind autorizarea de funcționare a societății FLEX",
    );
    expect(actSubject("Codul muncii (Legea nr. 53/2003)", "Codul muncii")).toBe("Legea nr. 53/2003");
    expect(actSubject("Legea nr. 31/1990", null)).toBeNull();
    expect(actSubject("Codul civil", "Codul civil")).toBeNull();
    expect(actSubject("Constituția României", null)).toBeNull();
    expect(actSubject("Constituția României", "Constituția")).toBe("Constituția României");
  });
});

describe("act rows and kind chips", () => {
  const entry = (path: string, kind: string, title: string, short: string | null): ActIndexEntry => ({
    path, alias: null, title, short, kind, status: "in force", from: null, latest: "", articles: 1,
  });
  const undo: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const restore of undo.splice(0)) await restore();
  });

  it("shows the subject under the link and does not repeat the number", async () => {
    const acts = [
      entry("hg/2026/951", "hg", "Hotărârea Guvernului nr. 951/2026 pentru completarea Hotărârii Guvernului nr. 1.074/2021", "HG nr. 951/2026"),
      entry("lege/2003/53", "lege", "Codul muncii (Legea nr. 53/2003)", "Codul muncii"),
      entry("oug/2002/7", "oug", "Ordonanța de urgență nr. 7/2002", null),
      entry("lege/2001/5", "lege", "Legea privind altceva", "Altceva"),
    ];
    undo.push(await putActs(acts, true));
    {
      const html = await page("/acte");
      expect(html).toContain('<p class="doc-subject">pentru completarea Hotărârii Guvernului nr. 1.074/2021</p>');
      expect(html).toContain('<p class="doc-subject">Legea nr. 53/2003</p>');
      expect(html).not.toContain("nr. 951/2026</span>");
      expect(html).not.toContain("nr. 53/2003</span>");
      expect(html).not.toContain("nr. 7/2002</span>");
      expect(html).toContain("<span>nr. 5/2001</span>");
      expect(html.match(/class="doc-subject"/g)).toHaveLength(3);
    }
  });

  it("links the kind chips with the other filters and marks the current kind", async () => {
    const html = await page("/acte?tip=lege&an=1990&q=muncii");
    expect(html).toContain('<nav class="kind-nav" aria-label="Tipuri de acte">');
    expect(html).toContain('<a class="kind-link" href="/acte?an=1990&amp;q=muncii">Toate</a>');
    expect(html).toContain('<a class="kind-link" href="/acte?tip=oug&amp;an=1990&amp;q=muncii">');
    expect(html).toMatch(/<a class="kind-link" href="\/acte\?tip=lege&amp;an=1990&amp;q=muncii" aria-current="true">Legi<\/a>/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/<details class="more-filters" open/);
    expect(await page("/acte")).toMatch(/<details class="more-filters">/);
    expect(await page("/acte")).toContain('<a class="kind-link" href="/acte" aria-current="true">Toate</a>');
  });
});

describe("links to the acts page", () => {
  it("is in the header, the footer and in the act type line on the home page", async () => {
    const html = await page("/despre");
    expect(html).toContain('<a href="/acte" data-text="Acte">Acte</a>');
    expect(html).toContain('<li><a href="/acte">Acte</a></li>');
    const home = await page("/");
    expect(home).toMatch(/<a href="\/acte">Toate actele \([0-9.]+\)<\/a>/);
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
