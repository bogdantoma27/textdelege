import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { formatRo, today } from "../src/lib/dates";
import { withSources } from "../src/lib/outages";
import { createStore } from "../src/lib/store";
import type { ActObject, ArticleObject, ArticleVersion } from "../src/lib/types";
import { type ArticleContext, renderArticle, singleLaw } from "../src/views/article";

const NOW = "2026-11-08";
const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string, init?: RequestInit) => (await get(path, init)).text();

let act: ActObject;
let one: ArticleObject;
let two: ArticleObject;

beforeAll(async () => {
  const store = createStore(env);
  act = (await store.act("lege/2009/287"))!;
  one = (await store.article("lege/2009/287", "art-0001"))!;
  two = (await store.article("lege/2009/287", "art-0002"))!;
});

const ctx = (over: Partial<ArticleContext> = {}): ArticleContext => ({
  now: NOW,
  attribution: true,
  highlightLast: false,
  filter: "",
  ...over,
});
const view = (
  article: ArticleObject,
  date: string | null = null,
  over: Partial<ArticleContext> = {},
  theAct: ActObject = act,
) => String(renderArticle(ctx(over), theAct, article, date));

const primaries = (html: string) => html.match(/class="btn"/g)?.length ?? 0;

function repealedArticle(): ArticleObject {
  const article = structuredClone(one);
  article.state = "repealed";
  article.repealed = { on: "2024-01-01", law: null };
  article.versions[1]!.until = "2023-12-31";
  article.events.unshift({
    date: "2024-01-01",
    verb: "repealed",
    units: [],
    law: null,
    kind: "",
    from_version: 1,
    to_version: -1,
  });
  return article;
}

describe("article route", () => {
  it("renders the current version with a short status row and no second version picker", async () => {
    const response = await get("/codul-civil/art-1");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Art. 1");
    expect(html).toContain("Titlu");
    expect(html).toContain('<div class="status"><strong class="badge badge-green">');
    expect(html).toMatch(
      /În vigoare<\/strong><span>din 09\.07\.2023<\/span><span class="fact">Verificat față de legislatie\.just\.ro la \d\d\.\d\d\.\d{4}<\/span><\/div>/,
    );
    expect(html).not.toContain("Această formă");
    expect(html).not.toContain('class="seg"');
    expect(html).not.toContain("La o dată");
    expect(html).not.toContain("Vezi forma actuală");
    expect(html).toContain("Primul text modificat.");
    expect(html).not.toContain('class="dated"');
  });

  it("prints the day the data was built, read from the manifest, under the citation", async () => {
    const manifest = await createStore(env).manifest();
    const html = await page("/codul-civil/art-1");
    expect(html).toContain(`<p>Pagină generată la ${formatRo(manifest.generated.slice(0, 10))}</p></div></main>`);
  });

  it("serves the alias and the canonical address with the same canonical link", async () => {
    const alias = await page("/codul-civil/art-1");
    const canonical = await page("/lege/2009/287/art-1");
    const link = '<link rel="canonical" href="https://textdelege.ro/codul-civil/art-1"';
    expect(alias).toContain(link);
    expect(canonical).toContain(link);
    expect(canonical).toContain("Primul text modificat.");
  });

  it("renders an earlier version with its validity range, a link to the current form and dated links", async () => {
    const html = await page("/codul-civil/art-1/2014-10-18");
    expect(html).toContain('<aside class="dated" aria-label="Important"><p>Citești legislația așa cum era la 18.10.2014. <a href="/codul-civil/art-1">Înapoi la forma actuală</a></p></aside>');
    expect(html).toContain('</nav><aside class="dated"');
    expect(html.indexOf('class="dated"')).toBeLessThan(html.indexOf('class="head"'));
    expect(html).toContain("Primul text.");
    expect(html).not.toContain("Primul text modificat.");
    expect(html).toContain("Formă anterioară</strong><span>01.10.2011–08.07.2023</span>");
    expect(html).not.toContain("Vezi forma actuală");
    expect(html).not.toContain("Versiune înlocuită");
    const colour = /<strong class="badge badge-(\w+)">/.exec(html)?.[1];
    expect(colour).toBe("grey");
    expect(html).not.toContain("badge-green");
    expect(html).toContain('href="/codul-civil/art-2/2014-10-18"');
    expect(html).toContain(
      '<link rel="canonical" href="https://textdelege.ro/codul-civil/art-1/2014-10-18"',
    );
    const undated = new Set(
      [...html.matchAll(/href="(\/codul-civil\/art-\d+(?:\?[^"]*)?)"/g)].map((m) => m[1]),
    );
    expect([...undated]).toEqual(["/codul-civil/art-1"]);
  });

  it("says the article was not in force before its first version", async () => {
    const response = await get("/codul-civil/art-1/2005-01-01");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Articolul nu era în vigoare la 01.01.2005");
    expect(html).toContain('href="/codul-civil/art-1/2011-10-01"');
    expect(html).not.toContain("Primul text");
  });

  it("answers 404 for an unknown article, act or canonical address", async () => {
    for (const path of ["/codul-civil/art-99", "/nu-exista/art-1", "/lege/1999/1/art-1"]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toContain("Pagină negăsită");
    }
  });

  it("redirects the date form to the dated path and keeps the other flags", async () => {
    const typed = await get("/codul-civil/art-1?data=18.10.2014");
    expect(typed.status).toBe(302);
    expect(typed.headers.get("location")).toBe("/codul-civil/art-1/2014-10-18");
    const plain = await get("/codul-civil/art-1?data=2014-10-18");
    expect(plain.status).toBe(302);
    expect(plain.headers.get("location")).toBe("/codul-civil/art-1/2014-10-18");
    const flags = await get("/lege/2009/287/art-1/2020-01-01?data=2014-10-18&atribuire=0");
    expect(flags.headers.get("location")).toBe("/lege/2009/287/art-1/2014-10-18?atribuire=0");
  });

  it("sends a past day on which the text was already the current one to the undated path", async () => {
    const same = await get("/codul-civil/art-1/2026-01-01?atribuire=0");
    expect(same.status).toBe(302);
    expect(same.headers.get("location")).toBe("/codul-civil/art-1?atribuire=0");
    expect((await get("/codul-civil/art-1/2014-10-18")).status).toBe(200);
    expect((await get("/codul-civil/art-1/2099-01-01")).status).toBe(200);
  });

  it("sends the day already shown to the undated path", async () => {
    const same = await get(`/codul-civil/art-1/2014-10-18?data=${today()}&atribuire=0`);
    expect(same.status).toBe(302);
    expect(same.headers.get("location")).toBe("/codul-civil/art-1?atribuire=0");
  });

  it("checks the article before redirecting the date form", async () => {
    expect((await get("/codul-civil/art-99?data=2014-10-18")).status).toBe(404);
    expect((await get("/nu-exista/art-1?data=2014-10-18")).status).toBe(404);
  });

  it("answers 404 for an invalid date in the form", async () => {
    expect((await get("/codul-civil/art-1?data=2014-13-40")).status).toBe(404);
    expect((await get("/codul-civil/art-1?data=40.13.2014")).status).toBe(404);
    expect((await get("/codul-civil/art-1?data=ieri")).status).toBe(404);
  });

  it("reads the display flags from the query string", async () => {
    const off = await page("/codul-civil/art-1?atribuire=0&ultima=1");
    expect(off).toContain('<article class="hl">');
    expect(off).toContain("modificat în această versiune");
    expect(await page("/codul-civil/art-1")).toContain('<article class="attr">');
    expect(off).toContain('href="/codul-civil/art-2?atribuire=0&amp;ultima=1"');
  });

  it("has no font switch: the law text is set in one face", async () => {
    const html = await page("/codul-civil/art-1?serif=1");
    expect(html).toContain('<article class="attr">');
    expect(html).not.toContain('name="serif"');
  });

  it("links the paragraph numbers to their anchors", () => {
    const html = view(one);
    expect(html).toContain('<span class="n"><a href="#alin-1">(1)</a></span>');
  });

  it("offers the comparison with the current form on superseded versions only", () => {
    const old = view(one, "2012-01-01");
    expect(old).toContain('href="/codul-civil/art-1/compara/2011-10-01..2023-07-09"');
    expect(old).toContain("Compară cu forma actuală");
    expect(old).not.toContain("Compară două versiuni");
    expect(view(one)).not.toContain("Compară cu forma actuală");
    const three = structuredClone(one);
    three.versions.push({ ...structuredClone(one.versions[1]!), from: "2025-01-01", until: null });
    three.versions[1]!.until = "2024-12-31";
    const middle = view(three, "2024-01-01");
    expect(middle).toContain('<a href="/codul-civil/art-1/compara/2023-07-09..2025-01-01">Compară cu forma actuală</a>');
    expect(middle).toContain("compara/2011-10-01..2023-07-09");
  });

  it("names the amending act in the title of each timeline point", () => {
    expect(view(one)).toMatch(/<a class="pt[^"]*" href="[^"]*" aria-label="[^"]*" title="Legea nr\. 71\/2011"/);
  });

  it("is indexable", async () => {
    expect(await page("/codul-civil/art-1")).not.toContain("noindex");
    expect(await page("/codul-civil/art-1/2014-10-18")).not.toContain("noindex");
  });

  it("declares Romanian for the page and the law text", async () => {
    const html = await page("/codul-civil/art-1");
    expect(html).toContain('<html lang="ro"');
    expect(html).toContain('<div class="law" lang="ro">');
  });

  it("filters the contents on the server by title and by number", async () => {
    const byTitle = await page("/codul-civil/art-2?cuprins=titl");
    expect(byTitle).toContain('<span class="n">1</span>');
    expect(byTitle).not.toContain('<span class="n">2</span>');
    const byNumber = await page("/codul-civil/art-1?cuprins=2");
    expect(byNumber).toContain('<span class="n">2</span>');
    expect(byNumber).not.toContain('<span class="n">1</span>');
    const none = await page("/codul-civil/art-1?cuprins=zzz");
    expect(none).toContain("Niciun articol nu corespunde.");
  });

  it("shows the start of the text as an excerpt for an article without a title", async () => {
    const html = await page("/codul-civil/art-1");
    expect(html).toContain('<span class="t lead">Al doilea articol.</span>');
    expect(html).toContain('title="Al doilea articol."');
    expect(html).not.toContain('<span class="t lead">Titlu');
  });

  it("filters the contents by the excerpt", async () => {
    const byLead = await page("/codul-civil/art-1?cuprins=doilea");
    expect(byLead).toContain('<span class="n">2</span>');
    expect(byLead).not.toContain('<span class="n">1</span>');
  });
});

describe("renderArticle", () => {
  it("renders one block per line with ids, a hanging marker and the law text language", () => {
    const html = view(one);
    expect(html).toContain('<div class="law" lang="ro">');
    expect(html).toContain('id="alin-1"');
    expect(html).toContain('id="alin-2"');
    expect(html).toContain('<span class="n"><a href="#alin-1">(1)</a></span>Primul text modificat.');
  });

  it("renders the attribution line under each paragraph and hides it by the article class", () => {
    const html = view(one);
    expect(html.match(/class="who"/g)).toHaveLength(2);
    expect(html).toContain(
      '<a href="/lege/2023/200">Legea nr. 200/2023</a><span>· din 09.07.2023</span>',
    );
    expect(html).toContain("· din 01.10.2011");
    expect(html).toContain('<article class="attr">');
    const off = view(one, null, { attribution: false });
    expect(off).toContain("<article>");
    expect(off.match(/class="who"/g)).toHaveLength(2);
  });

  it("leaves out the attribution when one law wrote the whole version, and the whole form when no option applies", () => {
    const html = view(two);
    expect(html).not.toContain('class="who"');
    expect(html).not.toContain("optiune-atribuire");
    expect(html).not.toContain("optiune-ultima");
    expect(html).not.toContain('class="options');
    expect(view(one)).toContain("optiune-atribuire");
  });

  it("offers the mark of the last change only on a version that changed an earlier one", () => {
    expect(view(one)).toContain("optiune-ultima");
    const first = view(one, "2012-01-01");
    expect(first).toMatch(/<input id="optiune-ultima" type="checkbox"[^>]*disabled=""/);
    expect(first).toContain('<span class="vh"> (nu se aplică acestei versiuni)</span>');
    expect(view(one)).not.toMatch(/<input id="optiune-ultima"[^>]*disabled/);
    const silent = structuredClone(one);
    for (const line of silent.versions[1]!.lines) line.since = "2012-01-01";
    expect(view(silent)).toMatch(/<input id="optiune-ultima" type="checkbox"[^>]*disabled=""/);
  });

  it("keeps the bar colour of a law stable across lines and versions", () => {
    const current = view(one);
    expect(current).toMatch(/class="p b2 last" id="alin-1"/);
    expect(current).toMatch(/class="p b1" id="alin-2"/);
    const first = view(one, "2012-01-01");
    expect(first).toMatch(/class="p b1" id="alin-1"/);
    expect(first).toMatch(/class="p b1" id="alin-2"/);
  });

  it("marks the lines written by the shown version always and shows the mark by the article class", () => {
    const tag =
      '<a class="here" href="/codul-civil/art-1/compara/2011-10-01..2023-07-09">modificat în această versiune</a></div>';
    for (const highlightLast of [false, true]) {
      const html = view(one, null, { highlightLast });
      expect(html).toMatch(/class="p b2 last" id="alin-1"/);
      expect(html).toMatch(/class="p b1" id="alin-2"/);
      expect(html).toContain(tag);
    }
    expect(view(one, null, { highlightLast: true })).toContain('<article class="attr hl">');
    expect(view(one, null)).toContain('<article class="attr">');
    expect(view(one, "2012-01-01")).not.toContain(" last");
  });

  it("offers the display options as checkboxes of one form that works without JavaScript", () => {
    const html = view(one, null, { highlightLast: true, filter: "titl" });
    const form = html.slice(html.indexOf('<form class="options inline"'), html.indexOf("</form>", html.indexOf('<form class="options inline"')));
    expect(form).toContain('method="get" action="/codul-civil/art-1"');
    expect(form).toContain('<input type="hidden" name="cuprins" value="titl"');
    expect(form).toMatch(/<input id="optiune-atribuire" type="checkbox" name="atribuire" value="1" checked=""/);
    expect(form).toMatch(/<input id="optiune-ultima" type="checkbox" name="ultima" value="1" checked=""/);
    expect(form).toContain('<label for="optiune-atribuire">Legea fiecărui alineat</label>');
    expect(form).toContain('<legend>Opțiuni de afișare</legend>');
    expect(form).toContain('<button class="btn secondary apply" type="submit">Aplică</button>');
    expect(html).toContain('<div class="law" lang="ro">');
    const off = view(one, null, { attribution: false });
    expect(off).toMatch(/<input id="optiune-atribuire" type="checkbox" name="atribuire" value="1" data-param/);
    expect(off).toMatch(/name="atribuire" value="1"[^>]*>(?:(?!<input)[\s\S])*<\/div><input type="hidden" name="atribuire" value="0"/);
    expect(off).not.toMatch(/<input id="optiune-ultima"[^>]*checked/);
  });

  it("renders the compare link and the timeline, with no date form", () => {
    const html = view(one);
    expect(html).not.toContain("date-form");
    expect(html).not.toContain('name="data"');
    expect(html).not.toContain("data-shown");
    expect(primaries(html)).toBe(1);
    expect(primaries(html.slice(0, html.indexOf('<aside class="rail">')))).toBe(0);
    expect(html).toContain('href="/codul-civil/art-1/compara/2011-10-01..2023-07-09"');
    expect(html).toContain("Compară două versiuni");
    expect(html).toContain('aria-label="Versiunile textului"');
    expect(html).toContain("01.10.2011");
    const single = view(two);
    expect(single).toContain('<p class="compare-links"><span class="off" aria-disabled="true">Compară două versiuni</span></p>');
    expect(single).not.toContain("/compara/");
  });

  it("compares the previous version with the shown one, or the first with the last", () => {
    const three = structuredClone(one);
    three.versions.push({ ...structuredClone(one.versions[1]!), from: "2025-01-01", until: null });
    three.versions[1]!.until = "2024-12-31";
    expect(view(three)).toContain("compara/2023-07-09..2025-01-01");
    expect(view(three, "2012-01-01")).toContain("compara/2011-10-01..2025-01-01");
  });

  it("renders the history table with one row per event and compare links", () => {
    const html = view(one);
    const body = /<tbody>[\s\S]*<\/tbody>/.exec(html)![0];
    expect(body.match(/<tr>/g)).toHaveLength(one.events.length);
    expect(html).toContain('<span class="verb">Modificat</span> alin. (1)');
    expect(html).toContain(
      '<a href="/codul-civil/art-1/compara/2011-10-01..2023-07-09">Vezi modificarea</a>',
    );
    expect(html).toContain('<span class="verb">Intrat în vigoare</span>');
    expect(html).toContain('<a href="/codul-civil/art-1/2011-10-01">Forma inițială</a>');
    const initial = view(one, "2011-10-01");
    expect(initial).toContain('<span class="off" aria-disabled="true">Forma inițială</span>');
    expect(initial).not.toContain('>Forma inițială</a>');
  });

  it("writes every verb in Romanian", () => {
    const article = structuredClone(one);
    article.events = (
      [
        ["completed", ["alin-2-lit-c"]],
        ["unconstitutional", []],
        ["restated", []],
        ["repealed", []],
      ] as const
    ).map(([verb, units]) => ({
      date: "2024-01-01",
      verb,
      units: [...units],
      law: null,
      kind: "",
      from_version: 0,
      to_version: 1,
    }));
    const ro = view(article);
    for (const text of [
      "Completat cu</span> alin. (2) lit. c)",
      "Declarat neconstituțional",
      "Text reconfirmat",
      "Abrogat",
    ]) {
      expect(ro).toContain(text);
    }
  });

  it("shows a repeal row with the verb only when no law is named", () => {
    const html = view(repealedArticle());
    const row = html
      .split("<tr>")
      .find((chunk) => chunk.includes('<span class="verb">Abrogat</span>'))!;
    expect(row).not.toContain("<a ");
  });

  it("shows a neutral notice, not a repeal, for a gap in a non-repealed article", () => {
    const gap = structuredClone(one);
    gap.versions[0]!.until = "2012-12-31";
    gap.versions[1]!.from = "2030-01-01";
    const html = view(gap, "2020-01-01");
    expect(html).toContain("Textul de mai jos a fost în vigoare până la 31.12.2012.");
    expect(html).not.toContain("Abrogat la");
    expect(html).not.toContain("abrogat la");
    expect(html).toContain("Text încheiat");
    expect(html).not.toContain("Vezi forma actuală");
  });

  it("keeps the contents filter in the date form", () => {
    expect(view(one, null, { filter: "titl" })).toContain('<input type="hidden" name="cuprins" value="titl"');
  });

  it("renders a repealed article with the state badge and the last text", () => {
    const html = view(repealedArticle());
    expect(html).toContain('<strong class="badge badge-grey">Abrogat la 01.01.2024</strong>');
    expect(html).toContain("Abrogat la 01.01.2024");
    expect(html).toContain("Primul text modificat.");
    expect(html).toContain("Articolul a fost abrogat la 01.01.2024");
    expect(html).toContain("09.07.2023–31.12.2023");
  });

  it("names the repeal on a last version whose text only says it was repealed", () => {
    const article = structuredClone(one);
    const last = article.versions[1]!;
    article.versions.push({ ...structuredClone(last), from: "2024-01-01", until: null, lines: [{ ...last.lines[0]!, id: "p-1", text: "Abrogat." }] });
    last.until = "2023-12-31";
    article.state = "repealed";
    article.repealed = { on: "2024-01-01", law: null };
    const html = view(article);
    expect(html).toContain('<strong class="badge badge-grey">Abrogat la 01.01.2024</strong>');
    expect(html).not.toContain("badge-green");
  });

  it("explains a version that is not in force yet", () => {
    const future = structuredClone(two);
    future.versions[0]!.from = "2030-01-01";
    const html = view(future);
    expect(html).toContain('<strong class="badge badge-yellow">Viitor</strong>');
    expect(html).toContain("Viitor");
    expect(html).toContain("Articolul nu este încă în vigoare. Intră în vigoare la 01.01.2030.");
    expect(html).toContain("Al doilea articol.");
  });

  it("renders the source line with the official page, the check and a link to the repo", () => {
    const html = view(one);
    expect(html).toContain('<a href="https://example.invalid/287">example.invalid</a>');
    expect(html).not.toContain("Verificat față de sursă");
    const commit = one.versions[1]!.commit;
    expect(html).toContain(
      `<a href="https://github.com/lexifina/romania-law/blob/${commit}/lege/2009/287/art-0001.md">Fișierul sursă</a>`,
    );
    expect(html).not.toContain("<code>");
  });

  it("links the source file in the folder recorded for the version", () => {
    const moved: ArticleObject = {
      ...one,
      versions: one.versions.map((v, i) => ({
        ...v,
        path: i === 0 ? "codul-civil/art-0001.md" : "lege/2009/287/art-0001.md",
      })),
    };
    const html = view(moved, "2011-10-01");
    expect(html).toContain(`blob/${moved.versions[0]!.commit}/codul-civil/art-0001.md">Fișierul sursă`);
    expect(html).not.toContain("/lege/2009/287/art-0001.md");
  });

  it("falls back to the act folder when a version has no recorded path", () => {
    const legacy: ArticleObject = {
      ...one,
      versions: one.versions.map(({ path: _path, ...rest }) => rest),
    };
    expect(view(legacy)).toContain("/lege/2009/287/art-0001.md");
  });

  it("renders the copy buttons from the first paint, shown only where the clipboard exists", () => {
    const html = view(one);
    const citation = html.match(/<button class="btn" type="button"[^>]*>/)![0];
    expect(citation).not.toContain(" hidden");
    expect(citation).toContain('data-copy="Art. 1 Codul civil, în vigoare la');
    expect(citation).toContain("\nhttps://textdelege.ro/codul-civil/art-1/2023-07-09\"");
    expect(html).toContain(
      'Copiază citarea</button><span class="copied" role="status"></span><button class="btn secondary" type="button" data-copy="https://textdelege.ro/codul-civil/art-1/2023-07-09" data-copied="Copiat" data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o.">Copiază linkul</button><span class="copied" role="status"></span>',
    );
    expect(html).toContain(
      '<p class="cite-links"><button class="btn" type="button" data-copy=',
    );
    const paragraph = html.match(/<button class="copy"[^>]*>/)![0];
    expect(paragraph).not.toContain(" hidden");
    expect(paragraph).toMatch(
      /data-copy="Art\. 1 alin\. \(1\) Codul civil, forma în vigoare la \d\d\.\d\d\.\d{4}, https:\/\/textdelege\.ro\/codul-civil\/art-1\/2023-07-09#alin-1"/,
    );
  });

  it("names the outcome of a ruling in words and keeps an unknown one as it is", () => {
    const ruled = structuredClone(one);
    ruled.rulings[0]!.outcome = "rejected";
    expect(view(ruled)).toContain("Respinsă");
    expect(view(one)).toContain("· admis<");
  });

  it("renders the citation sentence and the permanent link of the shown version", () => {
    const html = view(one);
    expect(html).toContain(`Art. 1 Codul civil, în vigoare la ${formatRo(NOW)}`);
    expect(html).not.toContain("Art. 1 alin. (1) Codul civil, în vigoare la");
    expect(html).toContain(
      'data-copy="https://textdelege.ro/codul-civil/art-1/2023-07-09" data-copied="Copiat" data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o.">Copiază linkul</button>',
    );
    expect(html).not.toContain("Textul în vigoare");
    expect(html).not.toContain("Link actual");
    expect(view(one, null, { attribution: false, highlightLast: true })).not.toContain("Textul în vigoare");
    const button =
      '<button class="btn secondary" type="button" data-copy="https://textdelege.ro/codul-civil/art-1/2023-07-09" data-copied="Copiat" data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o.">Copiază linkul</button><span class="copied" role="status"></span><a class="btn secondary" href="/codul-civil/art-1">Textul în vigoare</a></p>';
    expect(view(one, "2023-07-09")).toContain(button);
    expect(view(one, null, { now: "2000-01-01" })).toContain('<a class="btn secondary" href="/codul-civil/art-1">Textul în vigoare</a>');
    expect(view(one, "2023-07-09")).not.toContain("Link actual");
    expect(view(two)).toContain("Art. 2 Codul civil, în vigoare la");
  });

  it("renders the rulings panel and omits it when there are none", () => {
    expect(view(one)).toContain("CCR 1/2019");
    expect(view(one)).toContain('href="/jurisprudenta/ccr/2019/1"');
    const unknown = structuredClone(one);
    unknown.rulings[0]!.key = "cedo-3594-19-2020-05-05";
    const html = view(unknown);
    expect(html).toContain("CCR 1/2019");
    expect(html).not.toContain("/jurisprudenta/");
    expect(view(two)).not.toContain("Jurisprudență");
  });

  it("says what the freshness status means", () => {
    const portal = `<a href="${act.portal}">legislatie.just.ro</a>`;
    expect(view(one)).toContain(`Codul civil este la zi. Verificat față de ${portal} la 01.11.2026.`);
    const withStatus = (freshness: Partial<NonNullable<ActObject["freshness"]>>) => {
      const changed = structuredClone(act);
      changed.freshness = { ...changed.freshness!, ...freshness };
      return view(one, null, {}, changed);
    };
    expect(withStatus({ status: "stale" })).toContain("a fost la 01.11.2026, mai veche decât ar trebui");
    const warning = /<div class="warning">[\s\S]*?<\/div>/.exec(withStatus({ status: "stale" }))?.[0] ?? "";
    expect(warning).toContain(portal);
    expect(warning.replaceAll(portal, "")).not.toContain("legislatie.just.ro");
    expect(withStatus({ status: "unverified" })).toContain("nu a fost încă verificat");
    expect(withStatus({ status: "source-unavailable" })).toContain(
      "Sursa oficială nu a putut fi consultată",
    );
    expect(
      withStatus({
        status: "pending-change",
        newest_change: "OUG nr. 12/2026",
        newest_change_date: "2027-01-01",
        change_in_repo: true,
      }),
    ).toContain("O modificare programată: OUG nr. 12/2026, de la 01.01.2027.");
    expect(
      withStatus({ status: "pending-change", newest_change: "OUG nr. 12/2026", change_in_repo: false }),
    ).toContain("nu este încă preluată în Codul civil: OUG nr. 12/2026.");
  });

  it("announces the next future version of the article", () => {
    const upcoming = structuredClone(one);
    upcoming.versions[1]!.until = "2026-12-31";
    upcoming.versions.push({ ...structuredClone(one.versions[1]!), from: "2027-01-01", until: null });
    const html = view(upcoming);
    expect(html).toContain("Următoarea versiune a articolului intră în vigoare la 01.01.2027.");
    expect(html).toContain('href="/codul-civil/art-1/2027-01-01"');
    expect(view(one)).not.toContain("Următoarea versiune");
  });

  it("lists the tools", () => {
    const html = view(one);
    expect(html).toContain('href="/codul-civil">Codul civil, textul întreg</a>');
    expect(html).toContain('href="/abonare/codul-civil/art-1"');
    expect(html).not.toContain('href="/modificari/codul-civil/art-1.atom"');
    expect(view(one, "2014-10-18")).toContain(
      'href="/codul-civil/2014-10-18">Codul civil, textul întreg la 18.10.2014</a>',
    );
  });

  it("lists the articles of the act with titles, marking the current one and showing no change counts", () => {
    const html = view(one);
    expect(html).toContain('<a href="/codul-civil/art-1" class="cur" aria-current="page"');
    expect(html).not.toContain("1 mod.");
    expect(html).toContain('<span class="cnt">2 articole</span>');
    expect(html).toContain('<a href="/codul-civil/art-2" title="Al doilea articol." data-n="2" data-lead="Al doilea articol."');
  });

  describe("repealed articles in the contents", () => {
    const repealed = (laws: { key: string; label: string }[], lastChange: string | null = "2020-05-01", lead: string | null = null) => {
      const changed = structuredClone(act);
      changed.articles[1]!.lead = lead;
      changed.articles[1]!.state = "repealed";
      changed.articles[1]!.last_change = lastChange;
      changed.timeline = [{ date: "2020-05-01", laws, articles: 1 }];
      return view(one, null, {}, changed);
    };

    it("names the date and the act that repealed the article", () => {
      const html = repealed([{ key: "lege/2019/1", label: "Legea nr. 1/2019" }]);
      expect(html).toContain("abrogat la 01.05.2020 prin Legea nr. 1/2019");
    });

    it("names only the date when several acts changed the code that day", () => {
      const html = repealed([
        { key: "lege/2019/1", label: "Legea nr. 1/2019" },
        { key: "lege/2019/2", label: "Legea nr. 2/2019" },
      ]);
      expect(html).toContain("abrogat la 01.05.2020");
      expect(html).not.toContain("prin Legea");
    });

    it("says only that the article is repealed when the date is unknown", () => {
      expect(repealed([], null)).toContain('<span class="t">abrogat</span>');
    });

    it("shows the excerpt of a repealed article that has no title", () => {
      const html = repealed([], null, "Text abrogat.");
      expect(html).toContain('<span class="t lead">Text abrogat.</span>');
      expect(html).toContain('title="Text abrogat. · abrogat"');
    });
  });

  it("offers the contents as a sheet that is open on load only when a filter is applied", () => {
    const html = view(one);
    expect(html).toContain('<div class="toc-sheet" id="cuprins"><nav class="toc"');
    expect(html).toContain('<a class="close" href="#main">Închide</a>');
    expect(html).not.toContain('<details class="toc-sheet"');
    expect(view(one, null, { filter: "art 2" })).toContain('<div class="toc-sheet open" id="cuprins">');
    expect(html.match(/name="cuprins"/g)).toHaveLength(1);
    expect(html.match(/<nav class="toc"/g)).toHaveLength(1);
    expect(html.match(/type="search"/g)).toHaveLength(3);
  });

  it("puts the text in main before the contents and the rail, and the footer after them", () => {
    const html = view(one);
    const at = (part: string) => html.indexOf(part);
    expect(at('<main id="main" tabindex="-1">')).toBeGreaterThan(0);
    expect(at("<article")).toBeGreaterThan(at('<main id="main"'));
    expect(at("</article>")).toBeLessThan(at("</main>"));
    expect(at("</main>")).toBeLessThan(at('<div class="toc-sheet"'));
    expect(at('<div class="toc-sheet"')).toBeLessThan(at('<aside class="rail">'));
    expect(at('<aside class="rail">')).toBeLessThan(at("<footer"));
    expect(html.match(/<aside class="rail">/g)).toHaveLength(1);
  });

  it("labels the contents filter with visible text and keeps the placeholder as an example", () => {
    const html = view(one);
    expect(html).toContain('<label class="flt-label" for="toc-filter">Filtrează articolele</label>');
    expect(html).toMatch(/<input class="field" id="toc-filter" type="search" name="cuprins"[^>]*placeholder="Caută un articol sau un titlu"/);
    expect(html).not.toMatch(/<input[^>]*name="cuprins"[^>]*aria-label/);
  });

  it("keeps the citation, the permanent address and the build day at the end of the printed text", () => {
    const html = withSources([], () => view(one), "2026-11-10");
    const block = /<div class="print-cite">([\s\S]*?)<\/div><\/main>/.exec(html)?.[1] ?? "";
    expect(block).toMatch(
      /^<p>Art\. 1 .*în vigoare la \d\d\.\d\d\.\d{4}<\/p><p>https:\/\/textdelege\.ro\/[a-z0-9-]+\/art-1\/\d{4}-\d\d-\d\d<\/p><p>Pagină generată la 10\.11\.2026<\/p>$/,
    );
  });

  it("filters the contents live: rows carry their number, the list its messages and a status region", () => {
    const html = view(one);
    expect(html).toContain('data-count="{n} articole" data-none="Niciun articol nu corespunde."');
    expect(html).toContain('<span class="vh" id="toc-status" role="status"></span>');
    expect(html).toMatch(/<a href="\/codul-civil\/art-1" class="cur" aria-current="page"[^>]*data-n="1"/);
    expect(view(one, null, { filter: "titl" })).toMatch(/<nav class="toc"[^>]*data-all="\/codul-civil\/cuprins"/);
  });

  it("gives every copy button the message for a failed copy", () => {
    const html = view(one);
    const buttons = html.match(/<button[^>]*data-copy=[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toContain('data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o."');
  });

  it("has a bottom bar with the neighbours, the contents button and the position", () => {
    const first = view(one);
    expect(first).toContain('<nav class="toc-bar" aria-label="Navigare în articole și cuprins">');
    expect(first).toContain('<a class="open-toc" href="#cuprins"><span>Cuprins</span><small>art. 1 din 2</small></a>');
    expect(first).toMatch(/<a class="side r" href="\/codul-civil\/art-2"><span>Art\. 2<\/span><svg [^>]*aria-hidden="true"[^>]*><path d="m9 6 6 6-6 6"><\/path><\/svg><\/a>/);
    expect(first).not.toContain('class="side"');
    const last = view(two);
    expect(last).toMatch(/<a class="side" href="\/codul-civil\/art-1"><svg [^>]*aria-hidden="true"[^>]*><path d="m15 6-6 6 6 6"><\/path><\/svg><span>Art\. 1<\/span><\/a>/);
    expect(last).toContain("art. 2 din 2");
    expect(last).not.toContain('class="side r"');
  });

  it("links previous and next with number and title as a pagination block", () => {
    const first = view(one);
    expect(first).toContain('<nav class="pagination" aria-label="Articolul anterior și următorul">');
    expect(first).toMatch(
      /<div class="pagination-next"><a href="\/codul-civil\/art-2" rel="next"><span class="pagination-title">Următor<svg [^>]*><path d="m9 6 6 6-6 6"><\/path><\/svg><\/span><span class="vh">: <\/span><span class="pagination-label">Art\. 2<\/span><\/a><\/div>/,
    );
    expect(first).toMatch(
      /<div class="pagination-prev"><span class="off" aria-disabled="true"><span class="pagination-title"><svg [^>]*>[^]*?<\/svg>Anterior<\/span><\/span><\/div>/,
    );
    expect(first).not.toContain('rel="prev"');
    const last = view(two);
    expect(last).toContain('<div class="pagination-prev"><a href="/codul-civil/art-1" rel="prev">');
    expect(last).toContain('<span class="pagination-label">Art. 1 Titlu</span>');
    expect(last).toMatch(/<div class="pagination-next"><span class="off" aria-disabled="true"><span class="pagination-title">Următor<svg/);
    expect(last).not.toContain('rel="next"');
  });

  it("loads the page script on the pages with contents only", async () => {
    const tag = '<script type="module" src="/article.js"></script>';
    expect(await page("/codul-civil/art-1")).toContain(tag);
    expect(await page("/codul-civil/art-1/compara/2011-10-01..2023-07-09")).toContain(tag);
    expect(await page("/codul-civil")).toContain(tag);
    expect(await page("/")).not.toContain("/article.js");
    const script = await env.ASSETS.fetch("https://assets.test/article.js");
    expect(script.status).toBe(200);
  });

  it("sets the options that the page can flip locally apart from those that need the server", () => {
    const html = view(one);
    for (const flag of ["atribuire", "ultima"]) {
      expect(html).toMatch(new RegExp(`data-param="${flag}"[^>]*data-flips=`));
    }
    expect(html).toContain('data-flips="attr"');
    expect(html).toContain('data-flips="hl"');
  });

  it("marks the places where the version is picked without leaving the page", () => {
    const html = view(one, "2014-10-18");
    expect(html.match(/data-pick/g)?.length).toBe(one.versions.length - 1);
  });

  it("sets an index as a superscript and keeps the caret for copying", () => {
    const article = structuredClone(one);
    article.number = "47^3";
    article.versions[0]!.lines[0]!.text = "(1^1) Vezi art. 47^3.";
    article.versions[1]!.lines[0]!.text = "(1^1) Vezi art. 47^3.";
    article.prev = { file: "art-0047_2", number: "47^2", title: null, state: "in-force" };
    const html = view(article);
    expect(html).toContain('<h1>Art. 47<span class="vh">^</span><sup>3</sup>');
    expect(html).toContain('<span class="n"><a href="#alin-1">(1<span class="vh">^</span><sup>1</sup>)</a></span>');
    expect(html).toContain("<title>Art. 47^3 ");
    expect(html).toContain("Art. 47<span class=\"vh\">^</span><sup>2</sup>");
  });

  it("turns cross references into links that carry the page date", () => {
    const article = structuredClone(one);
    article.versions[0]!.lines[0]!.text = "(1) Conform art. 2 și art. 9999, vezi art. 2 alin. (1).";
    const html = view(article, "2012-01-01");
    expect(html).toContain('<a class="x" href="/codul-civil/art-2/2012-01-01"');
    expect(html).toContain('href="/codul-civil/art-2/2012-01-01#alin-1"');
    expect(html).not.toContain("art-9999");
  });
});

describe("singleLaw", () => {
  const version = (...lines: { law: string; since: string }[]) =>
    ({ lines: lines.map((line, i) => ({ id: `alin-${i + 1}`, text: "", ...line })) }) as unknown as ArticleVersion;

  it("is true when every line has the same law and date", () => {
    expect(singleLaw(version({ law: "lege/2011/71", since: "2011-10-01" }, { law: "lege/2011/71", since: "2011-10-01" }))).toBe(true);
  });

  it("is false for a different law or a different date", () => {
    expect(singleLaw(version({ law: "lege/2011/71", since: "2011-10-01" }, { law: "lege/2023/200", since: "2011-10-01" }))).toBe(false);
    expect(singleLaw(version({ law: "lege/2011/71", since: "2011-10-01" }, { law: "lege/2011/71", since: "2023-07-09" }))).toBe(false);
  });

  it("is true when no line names a law", () => {
    expect(singleLaw(version({ law: "", since: "" }, { law: "", since: "" }))).toBe(true);
  });
});

describe("article page: citation, freshness, paragraph copy, issue link", () => {
  function singleAuthor(): ArticleObject {
    const article = structuredClone(one);
    for (const version of article.versions) {
      for (const line of version.lines) {
        line.law = "legea-71-2011";
        line.since = version.from;
      }
    }
    return article;
  }

  const withStatus = (status: NonNullable<ActObject["freshness"]>["status"], date: string | null = null) => {
    const changed = structuredClone(act);
    changed.freshness = { ...changed.freshness!, status };
    return view(one, date, {}, changed);
  };

  it("cites the article by its name only, and a paragraph by its own number", () => {
    const html = view(one);
    expect(html).toContain("Art. 1 Codul civil, în vigoare la");
    expect(html).not.toMatch(/data-copy="Art\. 1 alin\. \(1\) Codul civil, în vigoare/);
    expect(html).toMatch(/data-copy="Art\. 1 alin\. \(2\) Codul civil, forma în vigoare la /);
  });

  it("puts the warning box under the status row when the text may be out of date, the same for every version", () => {
    const current = withStatus("stale");
    const box = /<div class="warning fresh-note"><strong class="warning-text">[^]*?<\/strong><\/div>/.exec(current)?.[0] ?? "";
    expect(box).toContain("mai veche decât ar trebui");
    const head = /<div class="status">[^]*?<\/div>(<div class="warning fresh-note">[^]*?<\/div>)/.exec(current);
    expect(head?.[1]).toBe(box);
    expect(withStatus("stale", "2012-01-01")).toContain(box);
    expect(withStatus("current")).not.toMatch(/<div class="status">[^]*?<\/div><div class="warning/);
  });

  it("states the verification date of the act in the status row, or that there is none", () => {
    expect(view(one)).toContain('<span class="fact">Verificat față de legislatie.just.ro la 01.11.2026</span>');
    const unverified = structuredClone(act);
    unverified.freshness = { ...unverified.freshness!, last_verified: null };
    expect(view(one, null, {}, unverified)).toContain('<span class="fact">Neverificat față de legislatie.just.ro</span>');
  });

  it("keeps the verification of the act out of the footer", () => {
    const html = view(one);
    expect(html).not.toContain("<span>Codul civil: verificat față de");
    expect(html.slice(html.indexOf("<footer"))).not.toContain("01.11.2026");
  });

  it("offers the copy button on every numbered paragraph, also when one law wrote the text", () => {
    const html = view(singleAuthor());
    expect(html).not.toContain("optiune-atribuire");
    expect(html).not.toContain('class="attr');
    const buttons = html.match(/<button class="copy"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).not.toContain(" hidden");
    expect(html).toContain('<span class="vh">Copiază</span></button><span class="copied" role="status"></span>');
  });

  it("gives an unnumbered paragraph no copy button", () => {
    expect(view(two)).not.toContain('class="copy"');
  });

  it("keeps the copy button when the attribution is switched off", () => {
    expect((view(one, null, { attribution: false }).match(/<button class="copy"/g) ?? []).length).toBe(2);
  });

  it("links the report of a problem to the source repository with the facts of the page", () => {
    const html = view(one);
    const href = /<span class="report"><a href="([^"]+)">Raportează o problemă cu acest text<\/a><\/span>/.exec(html)?.[1];
    expect(html).not.toContain('<p class="report">');
    expect(html).toMatch(
      /<div class="src"><p><span>Sursa oficială: <a [^>]*>[^<]*<\/a><\/span><span><a href="[^"]*">Fișierul sursă<\/a><\/span><span class="report">/,
    );
    expect(href).toBeDefined();
    const url = new URL(href!.replaceAll("&amp;", "&"));
    expect(url.origin + url.pathname).toBe("https://github.com/lexifina/romania-law/issues/new");
    expect(url.searchParams.get("title")).toBe("Codul civil, Art. 1: problemă cu textul");
    const body = url.searchParams.get("body")!;
    expect(body).toContain("Versiunea din: 09.07.2023");
    expect(body).toContain(`Revizia sursei: ${one.versions[1]!.commit}`);
    expect(body).toContain("Pagina: https://textdelege.ro/codul-civil/art-1/2023-07-09");
  });

  it("heads the date of a version in the history table with the day it took effect", () => {
    expect(view(one)).toContain('<th scope="col">În vigoare din</th>');
  });

  it("marks the shown version of the timeline for screen readers", () => {
    expect(view(one)).toContain('aria-current="true"><span class="vh">versiunea afișată</span></span>');
  });
});
