import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { monitorRef, paginate, tocEntries } from "../src/lib/act";
import { formatRo, today } from "../src/lib/dates";
import { createStore } from "../src/lib/store";
import type { ActObject, ArticleObject } from "../src/lib/types";
import { type ActContext, type ActTab, renderAct } from "../src/views/act";

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string) => (await get(path)).text();
const rail = (html: string) => html.slice(html.indexOf('<nav class="toc"'), html.indexOf("</nav>", html.indexOf('<nav class="toc"')));
const entry = (html: string, href: string) => {
  const at = rail(html).indexOf(`href="${href}"`);
  return at === -1 ? "" : rail(html).slice(at, rail(html).indexOf("</a>", at));
};

const NOW = "2026-11-08";
const BIG = "lege/2099/1";
const HEADED = "lege/2098/1";
const COUNT = 260;

let codul: ActObject;

const ctx = (over: Partial<ActContext> = {}): ActContext => ({
  now: NOW,
  date: null,
  filter: "",
  page: null,
  ...over,
});
const view = (
  tab: ActTab,
  over: Partial<ActContext> = {},
  act: ActObject = codul,
) => String(renderAct(ctx(over), act, tab));

function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function put(key: string, value: unknown): Promise<void> {
  await env.DATA.put(key, await gzip(JSON.stringify(value)));
}

function bigAct(): ActObject {
  const articles = Array.from({ length: COUNT }, (_, index) => {
    const n = index + 1;
    return {
      file: `art-${String(n).padStart(4, "0")}`,
      number: String(n),
      title: `Titlu ${n}`,
      state: n === 5 ? ("repealed" as const) : n === 6 ? ("future" as const) : ("in-force" as const),
      versions: 1,
      changes: n === 7 ? 3 : 0,
      first: n === 6 ? "2099-01-01" : "2015-01-01",
      last_change: n === 5 ? "2020-01-01" : n === 6 ? "2099-01-01" : "2015-01-01",
    };
  });
  return {
    schema: "textdelege/act/1",
    path: BIG,
    slug: "mare",
    alias: null,
    kind: "lege",
    year: 2099,
    number: "1",
    title:
      "Legea nr. 1/2099, publicată în Monitorul Oficial al României, Partea I, nr. 511 din 24 iulie 2009",
    short: null,
    code: null,
    status: "in force",
    portal: "https://example.invalid/mare",
    from: "2015-01-01",
    latest: "2099-01-01",
    freshness: null,
    articles,
    timeline: [
      { date: "2015-01-01", laws: [{ key: "legea-71-2011", label: "Legea nr. 71/2011" }], articles: 255 },
      { date: "2099-01-01", laws: [{ key: "legea-200-2023", label: "Legea nr. 200/2023" }], articles: 1 },
      { date: "2020-01-01", laws: [{ key: "legea-200-2023", label: "Legea nr. 200/2023" }], articles: 4 },
    ],
    stats: {
      changes_per_year: { "2020": 4, "2015": 8, "2099": 1 },
      most_amended: [{ file: "art-0007", number: "7", title: "Titlu 7", changes: 3 }],
    },
    rulings: [],
    laws: [],
  };
}

function bigArticle(entry: ActObject["articles"][number]): ArticleObject {
  const n = Number(entry.number);
  const from = entry.first ?? "2015-01-01";
  return {
    schema: "textdelege/article/1",
    act: { path: BIG, alias: null, title: "Legea nr. 1/2099", short: null, kind: "lege" },
    file: entry.file,
    number: entry.number,
    title: entry.title,
    state: entry.state,
    repealed: n === 5 ? { on: "2020-01-01", law: null } : null,
    versions: [
      {
        from,
        until: n === 5 ? "2019-12-31" : null,
        commit: "a".repeat(40),
        law_commit: "a".repeat(40),
        law: null,
        kind: "amendment",
        lines: [{ id: "alin-1", text: `(1) Text ${n}.`, since: from, law: "" }],
      },
    ],
    events: [],
    rulings: [],
    prev: null,
    next: null,
  };
}

beforeAll(async () => {
  const store = createStore(env);
  codul = (await store.act("lege/2009/287"))!;
  const big = bigAct();
  await put(`acts/${BIG}/act.json`, big);
  for (const entry of big.articles) {
    await put(`acts/${BIG}/art/${entry.file}.json`, bigArticle(entry));
  }
  const headed = headedAct(big);
  await put(`acts/${HEADED}/act.json`, headed);
  for (const entry of headed.articles) {
    await put(`acts/${HEADED}/art/${entry.file}.json`, { ...bigArticle(entry), act: { ...bigArticle(entry).act, path: HEADED } });
  }
});

function headedAct(big: ActObject): ActObject {
  const heading = (n: number) => (n < 40 ? 2 : n < 70 ? 3 : 5);
  return {
    ...big,
    path: HEADED,
    slug: "cu-titluri",
    portal: "https://example.invalid/cu-titluri",
    headings: [
      { kind: "crt", label: "Cartea I", name: "Despre persoane", depth: 0 },
      { kind: "ttl", label: "Titlul I", name: "Dispoziții generale", depth: 1 },
      { kind: "cap", label: "Capitolul I", name: "Început", depth: 2 },
      { kind: "cap", label: "Capitolul II", name: "Mijloc", depth: 2 },
      { kind: "ttl", label: "Titlul II", name: "Sfârșit", depth: 1 },
      { kind: "cap", label: "Capitolul I", name: "", depth: 2 },
    ],
    articles: big.articles.map((entry) => ({ ...entry, heading: heading(Number(entry.number)) })),
  };
}

const TABS: [string, ActTab, string][] = [
  ["/codul-civil", "text", "Text"],
  ["/codul-civil/istoric", "istoric", "Istoric"],
  ["/codul-civil/jurisprudenta", "jurisprudenta", "Jurisprudență"],
  ["/codul-civil/statistici", "statistici", "Statistici"],
  ["/codul-civil/date", "date", "Date"],
];

describe("act header", () => {
  it("renders the facts of the act on the status line beside the title", async () => {
    const html = await page("/codul-civil");
    expect(html).toContain("<h1>Codul civil</h1>");
    expect(html).toContain("Legea nr. 287/2009");
    expect(html).not.toContain('<dl class="summary">');
    expect(html).not.toContain("Emitent");
    expect(html).toContain('<strong class="badge badge-green">În vigoare din 01.10.2011</strong>');
    expect(html).not.toContain('<span class="fact">În vigoare din');
    expect(html).toContain('<span class="fact">Ultima modificare <b><a href="/modificari/codul-civil">09.07.2023</a></b></span>');
    expect(html).toMatch(/<h1>Codul civil<\/h1><div class="status">[\s\S]*?<\/div><section class="time compact"/);
    expect(html).not.toContain('<p class="sub">');
    expect(html).toContain('<span class="fact">Verificat față de legislatie.just.ro la 01.11.2026</span>');
    expect(html).not.toContain('<div class="warning">');
    expect(html).toContain('<span class="fact">Sursa oficială: <b><a href="https://example.invalid/287">example.invalid</a></b></span>');
    expect(html).not.toContain('class="src"');
    expect(html).not.toContain(">Monitorul Oficial</dt>");
    expect(html).not.toContain('content="noindex"');
  });

  it("keeps the contents, the filter and every rail panel reachable without a wide screen", async () => {
    for (const path of ["/codul-civil", "/codul-civil/art-1"]) {
      const html = await page(path);
      expect(html, path).toMatch(/<div class="toc-sheet" id="cuprins"><nav class="toc"/);
      expect(html, path).toContain('<a class="open-toc" href="#cuprins">');
      expect(html, path).not.toContain('<details class="toc-sheet"');
      expect(html.match(/name="cuprins"/g), path).toHaveLength(1);
      expect(html.replace(/<button[^>]*data-(?:copy|calendar)[^>]*>/g, ""), path).not.toMatch(/\shidden[\s=>]/);
      const rail = html.slice(html.indexOf('<aside class="rail">'));
      const footer = html.slice(html.indexOf('<footer class="site-footer compact"'));
      expect(footer, path).toContain('<nav class="footer-line" aria-label="Linkuri utile">');
      expect(footer, path).not.toContain("footer-nav");
      expect(footer, path).toContain('href="/despre"');
      expect(footer, path).toContain('href="https://ko-fi.com/bogdantoma27"');
      expect(footer, path).toContain('class="footer-meta"');
      for (const title of ["Citare", "Actualitate", "Unelte", "Susține"]) {
        expect(rail).toContain('<a class="btn kofi" href="https://ko-fi.com/bogdantoma27">');
        expect(rail, `${path} ${title}`).toContain(`<h2>${title}</h2>`);
      }
    }
  });

  it("reads the Monitorul Oficial issue from the title", () => {
    expect(
      monitorRef(
        "Legea nr. 1, publicată în Monitorul Oficial al României, Partea I, nr. 511 din 24 iulie 2009",
      ),
    ).toEqual({ number: "511", date: "24 iulie 2009" });
    expect(monitorRef("Legea nr. 287/2009")).toBeNull();
    const html = String(renderAct(ctx(), bigAct(), "text"));
    expect(html).toContain('<span class="fact">Monitorul Oficial <b>nr. 511 din 24 iulie 2009</b></span>');
  });

  it("ignores a Monitorul Oficial issue that belongs to another act", () => {
    const title =
      "Legea nr. 9/2020 pentru aprobarea OUG nr. 1/2020, publicată în Monitorul Oficial nr. 5 din 3 mai 2020, și pentru modificarea unor acte";
    expect(monitorRef(title)).toBeNull();
    const act = bigAct();
    act.title = title;
    expect(String(renderAct(ctx(), act, "text"))).not.toContain(">Monitorul Oficial</dt>");
  });

  it("serves the alias and the canonical path with the matching canonical link", async () => {
    expect(await page("/codul-civil")).toContain(
      '<link rel="canonical" href="https://textdelege.ro/codul-civil"',
    );
    const canonical = await page("/lege/2009/287");
    expect(canonical).toContain("<h1>Codul civil</h1>");
    expect(canonical).toContain('<link rel="canonical" href="https://textdelege.ro/codul-civil"');
    expect(await page(`/${BIG}`)).toContain(`href="https://textdelege.ro/${BIG}"`);
  });

  it.each(TABS)("%s renders the tab bar with the current tab marked", async (path, _tab, label) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    const html = await response.text();
    const marked = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)];
    expect(marked.map((m) => m[1])).toEqual([label]);
    for (const [href] of TABS) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("shows the rails on every tab", async () => {
    for (const [path] of TABS) {
      const html = await page(path);
      expect(html).toContain("<h2>Actualitate</h2>");
      expect(html).toContain("<h2>Citare</h2>");
      expect(html).toContain("<h2>Unelte</h2>");
      expect(html).toContain(
        'Copiază citarea</button><span class="copied" role="status"></span><button class="btn secondary" type="button" data-copy="https://textdelege.ro/codul-civil/2023-07-09" data-copied="Copiat" data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o.">Copiază linkul</button><span class="copied" role="status"></span></p>',
      );
      expect(html.match(/class="btn"/g)).toHaveLength(2);
      expect(html).toContain(
        '<span class="addr"><span class="vh">Adresa permanentă: </span>textdelege.ro/codul-civil/2023-07-09</span>',
      );
    }
  });

  it("gives the not-found page breadcrumbs and the ways on", async () => {
    const html = await page("/nu-exista");
    expect(html).toContain('<ol><li><a href="/">Acasă</a></li><li aria-current="page">Pagină negăsită</li></ol>');
    expect(html).toContain("Adresa cerută: <code>/nu-exista</code>");
    expect(html).toMatch(/<form class="omni page-search" role="search" action="\/cauta"/);
    expect(html).toContain('<a href="https://github.com/bogdantoma27/textdelege/issues/new">Dacă ai ajuns aici dintr-un link de pe acest site, spune-ne.</a>');
    for (const href of ["/#coduri", "/modificari", "/legislatie", "/despre"]) {
      expect(html).toContain(`<li><a href="${href}">`);
    }
  });

  it("answers unknown acts and unknown amending acts with 404", async () => {
    expect((await get("/nu-exista")).status).toBe(404);
    expect((await get("/nu-exista/istoric")).status).toBe(404);
    expect((await get("/lege/2021/23")).status).toBe(404);
    expect((await get("/codul-civil/2023-02-30")).status).toBe(404);
  });

  it("redirects the date form to the dated address", async () => {
    const dated = await get("/codul-civil?data=2020-05-05");
    expect(dated.status).toBe(302);
    expect(dated.headers.get("location")).toBe("/codul-civil/2020-05-05");
    const typed = await get("/codul-civil?data=05.05.2020");
    expect(typed.headers.get("location")).toBe("/codul-civil/2020-05-05");
    const cleared = await get("/codul-civil?data=");
    expect(cleared.headers.get("location")).toBe("/codul-civil");
  });

  it("refuses a day that does not exist with 400, the message by the field and the text kept", async () => {
    const response = await get("/codul-civil?data=31.02.2020");
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("<title>Eroare: Codul civil | Textdelege</title>");
    expect(html).toContain('content="noindex"');
    expect(html).toContain('<div class="error-summary" role="alert">');
    expect(html).toContain('<a href="#data">Scrie o zi care există, de exemplu 13.03.2021</a>');
    expect(html).toContain('<p class="error-message" id="data-error"><span class="vh">Eroare: </span>Scrie o zi care există, de exemplu 13.03.2021</p>');
    expect(html).toContain('<form class="date-form error"');
    expect(html).toContain('<select class="field" id="data" name="data" aria-invalid="true">');
    expect(html).toContain("Art. 1");
    expect((await get("/codul-civil?data=2020-13-45")).status).toBe(400);
  });

  it("sends a past day after the last change to the undated address", async () => {
    const same = await get("/codul-civil/2026-01-01?cuprins=art");
    expect(same.status).toBe(302);
    expect(same.headers.get("location")).toBe("/codul-civil?cuprins=art");
    expect((await get("/codul-civil/2020-05-05")).status).toBe(200);
  });

  it("sends the day already shown to the undated address", async () => {
    const same = await get(`/codul-civil/2020-05-05?data=${today()}`);
    expect(same.status).toBe(302);
    expect(same.headers.get("location")).toBe("/codul-civil");
    const typed = await get(`/codul-civil?data=${formatRo(today())}&cuprins=art`);
    expect(typed.headers.get("location")).toBe("/codul-civil?cuprins=art");
  });

  it("puts the date form in the main column and links the current text only from a dated page", () => {
    const undated = view("text");
    const form = undated.match(/<section class="time compact"[^>]*>[\s\S]*?<\/section>/)![0];
    expect(form).toContain('<form class="date-form" method="get" action="/codul-civil" novalidate="" data-filter="">');
    expect(form).toContain(
      '<label class="label" for="data">Textul la data de</label><div class="date-row"><select class="field" id="data" name="data"><option value="" selected="">Azi, textul în vigoare</option><option value="2011-10-01">01.10.2011 · Legea nr. 71/2011</option></select>',
    );
    expect(undated).not.toContain("data-shown");
    expect(undated.slice(undated.indexOf('<aside class="rail">'))).not.toContain("date-form");
    const main = undated.slice(0, undated.indexOf('<aside class="rail">'));
    expect(main.match(/class="btn"/g)).toHaveLength(1);
    expect(undated).not.toContain("Textul în vigoare");
    const dated = view("text", { date: "2020-05-05" });
    expect(dated).toContain('<option value="">Azi, textul în vigoare</option><option value="2011-10-01" selected="">01.10.2011 · Legea nr. 71/2011</option>');
    expect(dated).toContain('<a class="btn secondary" href="/codul-civil">Textul în vigoare</a></p>');
  });
});

describe("contents", () => {
  it("renders table of contents with repealed article in place", async () => {
    const html = await page(`/${BIG}`);
    const toc = rail(html);
    const at = (n: number) => toc.indexOf(`href="/${BIG}/art-${n}"`);
    expect(at(4)).toBeGreaterThan(-1);
    expect(at(4)).toBeLessThan(at(5));
    expect(at(5)).toBeLessThan(at(6));
    const repealed = entry(html, `/${BIG}/art-5`);
    expect(repealed).toContain("abrogat");
    expect(repealed).toContain("Titlu 5");
    expect(repealed).toContain('class="rep"');
    const future = entry(html, `/${BIG}/art-6`);
    expect(future).toContain('class="fut"');
    expect(future).not.toContain('class="rep"');
    const changed = entry(html, `/${BIG}/art-7`);
    expect(changed).not.toContain("abrogat");
    expect(rail(html)).not.toMatch(/mod\./);
    expect(html).not.toContain("Afișează textul actului");
  });

  it("offers today and every day the act changed, newest first, never a free date", () => {
    const changing = structuredClone(codul);
    changing.latest = "2023-07-09";
    changing.timeline = [
      { date: "2023-07-09", laws: [{ key: "legea-200-2023", label: "Legea nr. 200/2023" }], articles: 2 },
      { date: "2011-10-01", laws: [{ key: "legea-71-2011", label: "Legea nr. 71/2011" }], articles: 9 },
      { date: "2018-03-01", laws: [{ key: "", label: "Portalul legislativ" }, { key: "oug-1-2018", label: "OUG nr. 1/2018" }], articles: 3 },
      { date: "2099-01-01", laws: [{ key: "", label: "Portalul legislativ" }], articles: 1 },
    ];
    const options = (html: string) => [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((m) => [m[1], m[2] !== undefined, m[3]]);
    expect(options(view("text", {}, changing))).toEqual([
      ["", true, "Azi, textul în vigoare"],
      ["2099-01-01", false, "01.01.2099 · act nemenționat de sursă (viitor)"],
      ["2018-03-01", false, "01.03.2018 · OUG nr. 1/2018 și încă 1"],
      ["2011-10-01", false, "01.10.2011 · Legea nr. 71/2011"],
    ]);
    expect(view("text", {}, changing)).not.toContain('type="date"');
    const selected = (date: string) => options(view("text", { date }, changing)).find(([, on]) => on)?.[0];
    expect(selected("2019-06-30")).toBe("2018-03-01");
    expect(selected("2011-10-01")).toBe("2011-10-01");
    expect(selected("2005-01-01")).toBe("2011-10-01");
    expect(selected("2099-05-05")).toBe("2099-01-01");
    const repealed = structuredClone(changing);
    repealed.latest = "2024-01-01";
    expect(options(view("text", {}, repealed)).map(([value]) => value)).toContain("2023-07-09");
  });

  it("shows a muted line under the status row when the act may be out of date, and a box only for a missing amendment", () => {
    const stale = structuredClone(codul);
    stale.freshness = { ...stale.freshness!, status: "stale" };
    const html = view("text", {}, stale);
    expect(html).toMatch(
      /<h1>Codul civil<\/h1><div class="status">[^]*?<\/div><p class="fresh-line">[^]*?mai veche decât ar trebui[^]*?<\/p><section class="time compact"/,
    );
    expect(html).not.toContain("fresh-note");
    expect(view("text", { date: "2012-01-01" }, stale)).toContain('<p class="fresh-line">');
    const missing = structuredClone(codul);
    missing.freshness = { ...missing.freshness!, status: "pending-change", newest_change: missing.laws[0]!.key, change_in_repo: false };
    const boxed = view("text", {}, missing);
    expect(boxed).toMatch(/<\/div><div class="warning fresh-note"><strong class="warning-text">[^]*?<\/strong><\/div><section class="time compact"/);
    expect(boxed).not.toContain("fresh-line");
  });

  it("computes states as of a date", () => {
    const states = (date: string | null) =>
      tocEntries(bigAct(), date, NOW)
        .slice(3, 6)
        .map((e) => e.state);
    expect(states(null)).toEqual(["in-force", "repealed", "future"]);
    expect(states("2019-06-01")).toEqual(["in-force", "in-force", "future"]);
    expect(states("2100-01-01")).toEqual(["in-force", "repealed", "in-force"]);
  });

  it("windows the list around the open article and names the address of the complete contents", async () => {
    const html = String(renderAct(ctx(), bigAct(), "text"));
    expect(html).toContain(`<nav class="toc" aria-label="Cuprins" style="--nw:3ch" data-all="/${BIG}/cuprins" data-count="{n} articole" data-none="Niciun articol nu corespunde.">`);
    expect(html).toContain('<div class="toc-list">');
    expect(html).toContain("articole după</a>");
    expect(await page("/codul-civil")).not.toContain('data-all="/');
  });

  it("serves the complete contents of an act, on a day too, with the display flags kept", async () => {
    const all = await page(`/${BIG}/cuprins`);
    expect(all).toContain('<nav class="toc" aria-label="Cuprins"');
    expect(all).not.toContain('data-all="/');
    expect(all).not.toContain('class="more"');
    expect(all).toContain(`href="/${BIG}/art-1"`);
    expect(all).toContain(`href="/${BIG}/art-${COUNT}"`);
    expect(all).not.toContain('class="cur"');
    const dated = await page(`/${BIG}/2019-01-01/cuprins?atribuire=0`);
    expect(dated).toContain(`href="/${BIG}/art-1/2019-01-01?atribuire=0"`);
    expect((await get("/nu-exista/cuprins")).status).toBe(404);
  });

  it("filters on the server and caps the result at 200", async () => {
    const all = rail(await page(`/${BIG}?cuprins=titlu`));
    expect(all).toContain("Primele 200 rezultate");
    expect(all).toContain(`href="/${BIG}/art-200"`);
    expect(all).not.toContain(`href="/${BIG}/art-201"`);

    const one = rail(await page(`/${BIG}?cuprins=art.%2017`));
    expect(one).toContain(`href="/${BIG}/art-17"`);
    expect(one).toContain(`href="/${BIG}/art-170"`);
    expect(one).not.toContain(`href="/${BIG}/art-18"`);
    expect(one).not.toContain("Primele 200");
    expect(one).toContain("Șterge filtrul");

    expect(rail(await page(`/${BIG}?cuprins=zzzz`))).toContain("Niciun articol nu corespunde.");
  });

  it("keeps the filter in the form and posts it to the same path", async () => {
    const html = await page(`/${BIG}/2021-06-01?cuprins=titlu%201`);
    expect(html).toContain(`action="/${BIG}/2021-06-01"`);
    expect(html).toContain('name="cuprins"');
    expect(html).toContain('value="titlu 1"');
  });
});

describe("full text", () => {
  it("shows the last change of an article with its law", async () => {
    const html = await page("/codul-civil");
    expect(html).toContain(
      '<p class="prov">Ultima modificare: <a href="/lege/2023/200">Legea nr. 200/2023</a> · din 09.07.2023</p>',
    );
  });

  it("calls the text of an article that was never amended the original text", async () => {
    const html = await page("/codul-civil");
    const prov = [...html.matchAll(/<p class="prov">(.*?)<\/p>/g)].map((m) => m[1]!);
    expect(prov.some((p) => p.startsWith("Ultima modificare: "))).toBe(true);
    const original = prov.filter((p) => p.startsWith("Text inițial"));
    expect(original.length).toBeGreaterThan(0);
    expect(original.every((p) => /^Text inițial · din \d\d\.\d\d\.\d{4}$/.test(p))).toBe(true);
  });

  it("renders 50 articles with prefixed ids and page links, fetching only that page", async () => {
    const spy = vi.spyOn(env.DATA, "get");
    try {
      const html = await page(`/${BIG}?pagina=2`);
      const fetched = spy.mock.calls
        .map(([key]) => String(key))
        .filter((key) => key.includes("/art/"));
      expect(fetched).toHaveLength(50);
      expect(fetched.every((key) => /art-(00(5[1-9]|[6-9]\d)|0100)\.json$/.test(key))).toBe(true);

      expect(html.match(/<div class="law flow" lang="ro">/g)).toHaveLength(50);
      expect(html).toContain('id="art-51-alin-1"');
      expect(html).toContain('id="art-100-alin-1"');
      expect(html).not.toContain('id="art-50-alin-1"');
      expect(html).not.toContain('id="art-101-alin-1"');
      expect(html).toContain('<span class="n">(1)</span>');
      expect(html).toContain("Text 51.");
      expect(html).not.toContain('class="who"');
      expect(html).toContain("Titlu 51");
      expect(html).toContain(`href="/${BIG}/art-51"`);
      expect(html).toContain("Articolele 51–100 din 260 (pagina 2 din 6)");
      expect(html).toContain(`href="/${BIG}?pagina=1"`);
      expect(html).toContain(`href="/${BIG}?pagina=3"`);
      expect(html).toContain(
        '<link rel="canonical" href="https://textdelege.ro/lege/2099/1?pagina=2"',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("shows page 1 of the text by default", async () => {
    const spy = vi.spyOn(env.DATA, "get");
    try {
      const html = await page(`/${BIG}`);
      const fetched = spy.mock.calls.map(([key]) => String(key)).filter((key) => key.includes("/art/"));
      expect(fetched).toHaveLength(50);
      expect(html.match(/<div class="law flow" lang="ro">/g)?.length).toBeGreaterThanOrEqual(48);
      expect(html).toContain('id="art-50-alin-1"');
      expect(html).toContain("Articolele 1–50 din 260 (pagina 1 din 6)");
      expect(html).toContain(`href="/${BIG}?pagina=2"`);
      expect(html).toContain('<link rel="canonical" href="https://textdelege.ro/lege/2099/1"');
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the filter in the page links", async () => {
    const html = await page(`/${BIG}?cuprins=titlu`);
    expect(html).toContain(`href="/${BIG}?pagina=2&amp;cuprins=titlu"`);
  });

  it("says so when an article object is missing", () => {
    const act = bigAct();
    const paged = paginate(act.articles, 1, 2);
    const html = String(renderAct(ctx({ page: 1 }), act, "text", { paged, articles: [null, bigArticle(act.articles[1]!)] }));
    expect(html.match(/Textul articolului nu este disponibil\./g)).toHaveLength(1);
    expect(html).toContain("Text 2.");
  });

  it("has no previous link on the first page and no next link on the last", async () => {
    const first = await page(`/${BIG}?pagina=1`);
    expect(first).toContain('<span class="off" aria-disabled="true">');
    expect(first).toMatch(/<span class="off" aria-disabled="true"><span class="pagination-title"><svg [^>]*>[^]*?<\/svg>Pagina anterioară<\/span><\/span>/);
    expect(first).toContain('rel="next"');
    const last = await page(`/${BIG}?pagina=6`);
    expect(last).toContain("Articolele 251–260 din 260");
    expect(last).toMatch(/<span class="off" aria-disabled="true"><span class="pagination-title">Pagina următoare<svg/);
    expect(last).not.toContain('rel="next"');
    expect(await page(`/${BIG}?pagina=99`)).toContain("pagina 6 din 6");
    expect(await page(`/${BIG}?pagina=x`)).toContain("pagina 1 din 6");
  });
});

describe("dated act page", () => {
  it("dated act page carries the date on every article link", async () => {
    const html = await page(`/${BIG}/2021-06-01`);
    expect(html).toMatch(/<div class="crumb-row"><nav class="crumbs"[^]*?<\/nav><aside class="dated" aria-label="Important"><p>Citești legislația așa cum era la 01\.06\.2021\. <a href="\/[^"]*">Înapoi la forma actuală<\/a><\/p><\/aside><\/div>/);
    expect(await page(`/${BIG}`)).not.toContain('class="dated"');
    expect(html).toContain("01.06.2021");
    const links = [...html.matchAll(/href="(\/lege\/2099\/1\/art-[^"]*)"/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(50);
    expect(links.every((href) => href.endsWith("/2021-06-01"))).toBe(true);
    expect(html).toContain(`href="/${BIG}/2021-06-01?pagina=2"`);

    const text = await page(`/${BIG}/2021-06-01?pagina=1`);
    const textLinks = [...text.matchAll(/href="(\/lege\/2099\/1\/art-[^"]*)"/g)].map((m) => m[1]!);
    expect(textLinks.length).toBeGreaterThan(0);
    expect(textLinks.every((href) => href.endsWith("/2021-06-01"))).toBe(true);
  });

  it("shows states and text as of the date", async () => {
    const item = (html: string, n: number) => entry(html, `/${BIG}/art-${n}/${html.includes("2019-06-01") ? "2019-06-01" : "2021-06-01"}`);
    const before = await page(`/${BIG}/2019-06-01`);
    expect(item(before, 5)).not.toContain("abrogat");
    expect(item(before, 6)).toContain("viitor");
    const after = await page(`/${BIG}/2021-06-01`);
    expect(item(after, 5)).toContain("abrogat");

    const textBefore = await page(`/${BIG}/2019-06-01?pagina=1`);
    expect(textBefore).toContain("Text 5.");
    const textAfter = await page(`/${BIG}/2021-06-01?pagina=1`);
    expect(textAfter).not.toContain("Text 5.");
    expect(textAfter).toContain("Abrogat");
    expect(textAfter).toContain("Text 4.");
  });

  it("marks an act that was not yet in force", async () => {
    const html = await page("/codul-civil/2001-01-01");
    expect(html).toContain('<strong class="badge badge-yellow">Viitor</strong>');

  });
});

describe("istoric tab", () => {
  it("istoric tab lists events with applied or pending state", async () => {
    const html = await page(`/${BIG}/istoric`);
    const rows = html.match(/<tr>.*?<\/tr>/gs)!.slice(1);
    expect(rows).toHaveLength(3);
    expect(html).toContain('<link rel="canonical" href="https://textdelege.ro/lege/2099/1/istoric"');
    expect(rows[0]).toContain("01.01.2099");
    expect(rows[0]).toContain('<strong class="badge badge-yellow">Programat</strong>');
    expect(rows[0]).toContain("Programat");
    expect(rows[0]).toContain('<a href="/lege/2023/200">Legea nr. 200/2023</a>');
    expect(rows[0]).toContain(`href="/${BIG}/compara/2098-12-31..2099-01-01"`);
    expect(rows[1]).toContain("01.01.2020");
    expect(rows[1]).toContain("Aplicat");
    expect(rows[1]).not.toContain("Programat");
    expect(rows[1]).toContain(`href="/${BIG}/compara/2019-12-31..2020-01-01"`);
    expect(rows[1]).toContain(">4<");
    expect(rows[2]).toContain("01.01.2015");
    expect(rows[2]).toContain('<a href="/lege/2011/71">Legea nr. 71/2011</a>');
    expect(rows[2]).toContain(`href="/${BIG}/2015-01-01"`);
  });

  it("paginates at 100 rows", () => {
    const act = bigAct();
    act.timeline = Array.from({ length: 130 }, (_, i) => ({
      date: `20${String(Math.floor(i / 12) + 10)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      laws: [],
      articles: 1,
    }));
    const first = view("istoric", { page: null }, act);
    expect(first.match(/<tr>/g)).toHaveLength(101);
    expect(first).toContain(`href="/${BIG}/istoric?pagina=2"`);
    expect(first).toMatch(/<span class="off" aria-disabled="true"><span class="pagination-title"><svg [^>]*>[^]*?<\/svg>Pagina anterioară<\/span><\/span>/);
    expect(first).not.toContain('rel="prev"');
    const second = view("istoric", { page: 2 }, act);
    expect(second.match(/<tr>/g)).toHaveLength(31);
    expect(second).toContain(
      '<link rel="canonical" href="https://textdelege.ro/lege/2099/1/istoric?pagina=2"',
    );
    expect(second).toContain(`href="/${BIG}/istoric?pagina=1"`);
    expect(second).not.toContain('rel="next"');
  });

  it("paginate clamps pages", () => {
    expect(paginate([1, 2, 3], 9, 2)).toEqual({ items: [3], page: 2, pages: 2, total: 3 });
    expect(paginate([], 1, 2).pages).toBe(1);
  });
});

describe("jurisprudenta tab", () => {
  it("lists act-level rulings and sends article decisions to the article pages", () => {
    const act = structuredClone(codul);
    act.rulings = [
      {
        key: "dcc-1-2019",
        label: "Decizia CCR nr. 1/2019",
        court: "ccr",
        date: "2019-01-10",
        outcome: "admis",
        finds_unconstitutional: true,
      },
    ];
    const html = view("jurisprudenta", {}, act);
    expect(html).toContain('<a href="/jurisprudenta/ccr/2019/1">Decizia CCR nr. 1/2019</a>');
    expect(html).toContain("10.01.2019");
    expect(html).toContain("Neconstituțional");
    expect(html).toContain("Decizii pe articole");
    expect(view("jurisprudenta")).toContain("Nicio decizie privind actul în ansamblu.");
    expect(view("jurisprudenta")).toContain("Nicio decizie privind articole din acest act.");
  });

  it("groups the decisions on articles by article", async () => {
    const html = await page("/codul-civil/jurisprudenta");
    const at = html.indexOf("Decizii pe articole");
    expect(html.slice(at)).toContain('<h3><a href="/codul-civil/art-1">Art. 1</a>');
    expect(html.slice(at)).toContain('<a href="/jurisprudenta/ccr/2019/1">CCR 1/2019</a>');
    expect(html.slice(at)).toContain("01.02.2019 · admis");
    expect(html).not.toContain("Nicio decizie privind articole din acest act.");
  });
});

describe("statistici tab", () => {
  it("statistici tab renders changes per year and most amended articles", async () => {
    const html = await page(`/${BIG}/statistici`);
    expect(html).toContain("Modificări pe ani");
    const rows = html.match(/<tr>.*?<\/tr>/gs)!.slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("2015");
    expect(rows[0]).toContain("<b>8</b>");
    expect(rows[0]).toContain('class="bar" style="width:100%" aria-hidden="true"');
    expect(rows[1]).toContain("2020");
    expect(rows[1]).toContain("<b>4</b>");
    expect(rows[1]).toContain("width:50%");
    expect(rows[2]).toContain("2099");
    expect(html).toContain("Cele mai modificate articole");
    expect(html).toContain(`<a href="/${BIG}/art-7">`);
    expect(html).toContain("3 mod.");
  });

  it("says so when there are no changes", () => {
    const act = bigAct();
    act.stats = { changes_per_year: {}, most_amended: [] };
    expect(view("statistici", {}, act)).toContain("Nu există modificări de arătat.");
  });
});

describe("date tab", () => {
  it("links the feed, the source folder and the official portal", async () => {
    const html = await page("/codul-civil/date");
    expect(html).toContain('href="/modificari/codul-civil.atom"');
    expect(html).toContain(
      'href="https://github.com/lexifina/romania-law/tree/main/lege/2009/287"',
    );
    expect(html).toContain('href="https://example.invalid/287"');
    expect(html).toContain("Legea nr. 8/1996");
    expect(html).toContain("CC0");
  });
});

describe("headings of an act", () => {
  const where = (html: string) => /<p class="where">([^<]*)<\/p>/.exec(html)?.[1];
  const headingRows = (html: string) => [...html.matchAll(/<h3 class="hd d(\d)"><span class="hd-label">([^<]*)<\/span>([^<]*)<\/h3>/g)].map((m) => `${m[1]}|${m[2]}|${m[3]!.trim()}`);

  it("prints the headings between the articles on the text page, once each", async () => {
    const html = await page(`/${HEADED}`);
    expect(headingRows(html)).toEqual([
      "0|Cartea I|Despre persoane",
      "1|Titlul I|Dispoziții generale",
      "2|Capitolul I|Început",
      "2|Capitolul II|Mijloc",
    ]);
    const at = (needle: string) => html.indexOf(needle);
    expect(at('<h3 class="hd d0">')).toBeLessThan(at('id="art-1"'));
    expect(at("Capitolul II")).toBeGreaterThan(at('id="art-39"'));
    expect(at("Capitolul II")).toBeLessThan(at('id="art-40"'));
    expect(where(html)).toBeUndefined();
  });

  it("opens a later page with the full path of its first article and carries on from there", async () => {
    const html = await page(`/${HEADED}?pagina=2`);
    expect(where(html)).toBe("Cartea I Despre persoane › Titlul I Dispoziții generale › Capitolul II Mijloc");
    expect(headingRows(html)).toEqual(["1|Titlul II|Sfârșit", "2|Capitolul I|"]);
    expect(html.indexOf('<p class="where">')).toBeLessThan(html.indexOf('id="art-51"'));
    expect(html.indexOf('<h3 class="hd d1">')).toBeGreaterThan(html.indexOf('id="art-69"'));
    expect(html.indexOf('<h3 class="hd d1">')).toBeLessThan(html.indexOf('id="art-70"'));
  });

  it("leaves an act without headings as it was", async () => {
    const html = await page(`/${BIG}`);
    expect(html).not.toContain('class="hd');
    expect(html).not.toContain('class="where"');
    expect(html).not.toContain("toc-sec");
  });

  it("puts a heading row in the contents before the first article under it, not while filtering", async () => {
    const html = await page(`/${HEADED}/art-45`);
    const toc = html.slice(html.indexOf('<div class="toc-list">'), html.indexOf("</nav>", html.indexOf('<div class="toc-list">')));
    const rows = [...toc.matchAll(/<div class="toc-sec d(\d)"><span class="l">([^<]*)<\/span>(?:<span class="d">([^<]*)<\/span>)?<\/div>/g)];
    // The contents show a window of 61 articles around the open one: 15 to 75.
    expect(rows.map((m) => `${m[1]}|${m[2]}|${m[3] ?? ""}`)).toEqual(["2|Capitolul II|Mijloc", "1|Titlul II|Sfârșit", "2|Capitolul I|"]);
    expect(toc.indexOf("Capitolul II")).toBeGreaterThan(toc.indexOf('href="/lege/2098/1/art-39"'));
    expect(toc.indexOf("Capitolul II")).toBeLessThan(toc.indexOf('href="/lege/2098/1/art-40"'));
    expect(toc.indexOf("Titlul II")).toBeLessThan(toc.indexOf('href="/lege/2098/1/art-70"'));
    expect(toc).toContain('class="cur"');
    const filtered = await page(`/${HEADED}/art-45?cuprins=45`);
    expect(filtered).not.toContain("toc-sec");
  });

  it("shows the path above the title of an article", async () => {
    const html = await page(`/${HEADED}/art-45`);
    expect(where(html)).toBe("Cartea I Despre persoane › Titlul I Dispoziții generale › Capitolul II Mijloc");
    expect(html.indexOf('<p class="where">')).toBeLessThan(html.indexOf("<h1>"));
    expect(await page(`/${BIG}/art-45`)).not.toContain('class="where"');
  });
});
