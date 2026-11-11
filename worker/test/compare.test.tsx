import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ACT_CAP, CHUNK, candidates, eventsIn, inChunks, linkRange } from "../src/lib/compare";
import { createStore } from "../src/lib/store";
import type { ActArticleEntry, ActObject, ArticleObject, LawObject } from "../src/lib/types";
import { parsePath } from "../src/lib/urls";
import {
  type CompareContext,
  changedRows,
  changesPhrase,
  renderActCompare,
  renderCompare,
} from "../src/views/compare";

const NOW = "2026-11-08";
const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string, init?: RequestInit) => (await get(path, init)).text();

const ONE = "/codul-civil/art-1/compara/2011-10-01..2023-07-09";

let act: ActObject;
let one: ArticleObject;
let two: ArticleObject;
let law200: LawObject;

beforeAll(async () => {
  const store = createStore(env);
  act = (await store.act("lege/2009/287"))!;
  one = (await store.article("lege/2009/287", "art-0001"))!;
  two = (await store.article("lege/2009/287", "art-0002"))!;
  law200 = (await store.law("legea-200-2023"))!;
});

const ctx = (over: Partial<CompareContext> = {}): CompareContext => ({
  now: NOW,
  parallel: false,
  onlyChanges: false,
  colourBlind: false,
  granularity: "word",
  ...over,
});
const view = (
  article: ArticleObject,
  from: string,
  to: string,
  over: Partial<CompareContext> = {},
  law: LawObject | null = law200,
  theAct: ActObject = act,
) => String(renderCompare(ctx(over), theAct, article, from, to, law));

function markup(): ArticleObject {
  const article = structuredClone(one);
  article.versions[0]!.lines[0]!.text = "(1) Dacă a < b & c.";
  article.versions[1]!.lines[0]!.text = "(1) Dacă a < b & d.";
  article.versions[1]!.lines.push({
    id: "alin-3",
    text: "(3) Nou <b>.",
    since: "2023-07-09",
    law: "legea-200-2023",
  });
  return article;
}

describe("article comparison page", () => {
  it("renders both versions as a summary list, the stats bar, the legend and links to both versions in the repo", async () => {
    const response = await get(ONE);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      '<dt class="summary-key">Versiunea veche</dt><dd class="summary-value">01.10.2011 → 08.07.2023<span class="by">Forma dată de <a href="/lege/2011/71">',
    );
    expect(html).toContain(
      '<dt class="summary-key">Versiunea nouă</dt><dd class="summary-value">09.07.2023 → prezent<span class="by">Modificată prin <a href="/lege/2023/200">',
    );
    expect(html).toContain('<a href="/lege/2011/71">Legea nr. 71/2011</a>');
    expect(html).toContain('<a href="/lege/2023/200">Legea nr. 200/2023</a>');
    expect(html).toContain('<span class="cnt">1 schimbare</span> în alin. (1) · alin. (2) neschimbat');
    expect(html).toContain("<ins>");
    expect(html).toContain("modificat");
    expect(html).toContain("<del>text eliminat</del>");
    expect(html).toContain("<ins>text adăugat</ins>");
    expect(html).toMatch(/<ins><span class="vh">text adăugat: <\/span> ?modificat/);
    expect(html).not.toContain("dd8ba34cb925<");
    expect(html).not.toContain("<code>");
    expect(html).toContain("Fișierul sursă");
    expect(html).toContain("blob/dd8ba34cb925b4cea72b8d468e26f6adbac9bdf4/lege/2009/287/art-0001.md");
    expect(html).toContain("blob/4633e3daa158e5c50641a2d42999b164f36615b5/lege/2009/287/art-0001.md");
    expect(html).toContain('id="schimbare-1"');
  });

  it("links each side to the folder its version was stored in", () => {
    const moved = structuredClone(one);
    moved.versions[0]!.path = "codul-civil/art-0001.md";
    moved.versions[1]!.path = "lege/2009/287/art-0001.md";
    const html = view(moved, "2011-10-01", "2023-07-09");
    expect(html).toContain(`blob/${moved.versions[0]!.commit}/codul-civil/art-0001.md`);
    expect(html).toContain(`blob/${moved.versions[1]!.commit}/lege/2009/287/art-0001.md`);
  });

  it("closes every deletion and insertion with a hidden word for screen readers", () => {
    const html = view(markup(), "2011-10-01", "2023-07-09");
    const text = html.slice(html.indexOf('<div class="law'), html.indexOf('<div class="legend"'));
    const marks = text.match(/<(del|ins)>[^]*?<\/(del|ins)>/g) ?? [];
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      if (mark.startsWith("<del>")) {
        expect(mark).toMatch(/^<del><span class="vh">text eliminat: <\/span>[^]*<span class="vh"> \(sfârșit\)<\/span><\/del>$/);
      } else {
        expect(mark).toMatch(/^<ins><span class="vh">text adăugat: <\/span>[^]*<span class="vh"> \(sfârșit\)<\/span><\/ins>$/);
      }
    }
  });

  it("steps between changes only where there is another change to go to", () => {
    const single = view(one, "2011-10-01", "2023-07-09");
    expect(single).not.toContain('class="step"');
    expect(single).not.toContain('href="#schimbare-');
    const many = view(markup(), "2011-10-01", "2023-07-09");
    const first = many.split('id="schimbare-1"')[1]!.split('id="schimbare-2"')[0]!;
    expect(first).toContain('href="#schimbare-2" aria-label="Următoarea"');
    expect(first).not.toContain('aria-label="Anterioară"');
    expect(first).toMatch(/<span class="off" aria-disabled="true"><svg [^>]*>[^]*?<\/svg><span class="vh">Anterioară<\/span><\/span>/);
    const last = many.split('id="schimbare-2"')[1]!;
    expect(last).toContain('href="#schimbare-1" aria-label="Anterioară"');
    expect(last).not.toMatch(/<div class="chg">[^]*?href="#schimbare-3"/);
    expect(last).toMatch(/<span class="off" aria-disabled="true"><svg [^>]*>[^]*?<\/svg><span class="vh">Următoarea<\/span><\/span>/);
    expect(many).toContain('<span class="step" role="group" aria-label="Schimbările din text">');
  });

  it("draws the stepping arrows as icons, not as characters missing from the fonts", async () => {
    const html = await page(ONE);
    expect(html).not.toMatch(/[\u2191\u2193]/);
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("is noindex with a canonical link that names itself without flags", async () => {
    const html = await page(`${ONE}?vedere=paralel&paleta=daltonism`);
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain(`<link rel="canonical" href="https://textdelege.ro${ONE}"`);
  });

  it("collapses unchanged paragraphs with doar=diferente", async () => {
    expect(await page(ONE)).toContain("Al doilea text.");
    const html = await page(`${ONE}?doar=diferente`);
    expect(html).not.toContain("Al doilea text.");
    expect(html).toContain("… 1 alineat neschimbat");
  });

  it("offers the display options as checkboxes of one form that keeps the granularity", async () => {
    const html = await page(`${ONE}?doar=diferente&paleta=daltonism&granularitate=caractere`);
    const start = html.indexOf('<form class="options inline"');
    const form = html.slice(start, html.indexOf("</form>", start));
    expect(form).toContain(`method="get" action="${ONE}"`);
    expect(form).toContain('<input type="hidden" name="granularitate" value="caractere"');
    expect(form).toContain('<legend>Opțiuni de comparație</legend>');
    expect(form).toMatch(/<input id="optiune-doar" type="checkbox" name="doar" value="diferente" checked=""/);
    expect(form).toMatch(/<input id="optiune-paleta" type="checkbox" name="paleta" value="daltonism" checked=""/);
    expect(form).toMatch(/<div class="checkbox wide-only"><input id="optiune-vedere" type="checkbox" name="vedere" value="paralel" data-param/);
    expect(form).not.toContain('type="hidden" name="doar"');
    expect(form).toContain('<button class="btn secondary apply" type="submit">Aplică</button>');
    expect(await page(ONE)).not.toContain('name="granularitate"');
  });

  it("renders two aligned columns with equal row counts in the parallel view", () => {
    const html = view(markup(), "2011-10-01", "2023-07-09", { parallel: true });
    const olds = html.match(/class="cell old/g) ?? [];
    const news = html.match(/class="cell new/g) ?? [];
    expect(olds).toHaveLength(3);
    expect(news).toHaveLength(olds.length);
    expect(html.match(/class="pair"/g)).toHaveLength(3);
    const oldCell = /<div class="cell old changed">[\s\S]*?<\/p>/.exec(html)![0];
    expect(oldCell).toContain("<del>");
    expect(oldCell).not.toContain("<ins>");
    const newCell = /<div class="cell new changed">[\s\S]*?<\/p>/.exec(html)![0];
    expect(newCell).toContain("<ins>");
    expect(newCell).not.toContain("<del>");
    expect(html).toContain('class="cell old empty"');
  });

  it("puts the cause of a removed paragraph in the old column", () => {
    const article = structuredClone(one);
    article.versions[1]!.lines.pop();
    const html = view(article, "2011-10-01", "2023-07-09", { parallel: true });
    const row = html.split('<div class="pair"').find((part) => part.includes('id="schimbare-2"'))!;
    expect(row).toContain('<div class="cell new empty" aria-hidden="true"></div>');
    expect(row).toContain("<b>Eliminat</b> prin");
    expect(row).toContain("Al doilea text.");
    expect(row).toMatch(/<del><span class="vh">text eliminat: <\/span>Al doilea text\.<span class="vh"> \(sfârșit\)<\/span><\/del>/);
  });

  it("switches the palette with a class and keeps the shapes", () => {
    expect(view(one, "2011-10-01", "2023-07-09")).toContain('<article class="cmp">');
    const blind = view(one, "2011-10-01", "2023-07-09", { colourBlind: true });
    expect(blind).toContain('<article class="cmp cb">');
    expect(blind).toContain("<ins>");
  });

  it("lets the page flip the palette locally and fetch the views that differ in content", () => {
    const html = view(one, "2011-10-01", "2023-07-09");
    expect(html).toMatch(/data-param="paleta"[^>]*data-flips="cb"/);
    expect(html).not.toMatch(/data-param="vedere"[^>]*data-flips/);
    expect(html).not.toMatch(/data-param="doar"[^>]*data-flips/);
  });

  it("sets the indices of paragraph markers in the diff as superscripts", () => {
    const article = structuredClone(one);
    article.versions[0]!.lines[0]!.text = "(1^1) Text vechi.";
    article.versions[1]!.lines[0]!.text = "(1^1) Text nou.";
    const html = view(article, "2011-10-01", "2023-07-09");
    expect(html).toContain('<span class="n">(1<span class="vh">^</span><sup>1</sup>)</span>');
  });

  it("escapes markup characters inside diff parts", () => {
    const html = view(markup(), "2011-10-01", "2023-07-09");
    expect(html).toContain("a &lt; b &amp; ");
    expect(html).toContain("Nou &lt;b&gt;.");
    expect(html).not.toMatch(/Nou <b>/);
  });

  it("names the act that made each change and numbers the changes", () => {
    const html = view(markup(), "2011-10-01", "2023-07-09");
    expect(html).toContain('<b>Modificat</b> prin <a href="/lege/2023/200">Legea nr. 200/2023</a>');
    expect(html).toContain("<b>Adăugat</b>");
    expect(html).toContain('id="schimbare-1"');
    expect(html).toContain('id="schimbare-2"');
    expect(html).toContain('id="alin-2"');
  });

  it("names the law recorded on the line when it did not change in the new version", () => {
    const article = structuredClone(one);
    article.versions[1]!.lines[1]!.text = "(2) Al doilea text, dar altfel.";
    const html = view(article, "2011-10-01", "2023-07-09");
    expect(html).toContain('<a href="/lege/2011/71">Legea nr. 71/2011</a>');
    expect(html).toContain("în vigoare din 01.10.2011");
  });

  it("offers the character granularity in the legend and back", () => {
    const words = view(one, "2011-10-01", "2023-07-09");
    expect(words).toContain("Diferențe la nivel de cuvânt.");
    expect(words).toContain(`href="${ONE}?granularitate=caractere"`);
    const chars = view(one, "2011-10-01", "2023-07-09", { granularity: "char" });
    expect(chars).toContain("Diferențe la nivel de caracter.");
    expect(chars).toContain(`<a href="${ONE}">La nivel de cuvânt</a>`);
  });

  it("marks both versions on the timeline", () => {
    const html = view(one, "2011-10-01", "2023-07-09");
    expect(html.match(/class="pt rng"/g)).toHaveLength(2);
  });

  it("renders the version picker, the citation and the amending act", () => {
    const html = view(one, "2011-10-01", "2023-07-09");
    expect(html).toContain('<form class="pick" data-filter="" method="get" action="/codul-civil/art-1/compara"><fieldset><legend>Alege versiunile</legend>');
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main.indexOf('class="pick"')).toBeGreaterThan(-1);
    expect(main.indexOf('class="pick"')).toBeLessThan(main.indexOf('class="time"'));
    expect(html.slice(html.indexOf('<aside class="rail">'))).not.toContain('class="pick"');
    expect(html).toContain('action="/codul-civil/art-1/compara"');
    expect(html).toContain('<select class="field" id="de" name="de">');
    expect(html).not.toContain("Caractere");
    expect(html).toContain('<option value="2011-10-01" selected="">01.10.2011 · Legea nr. 71/2011</option>');
    expect(html).toContain('<option value="2023-07-09" selected="">09.07.2023 · Legea nr. 200/2023</option>');
    expect(html).toContain(
      'Copiază citarea</button><span class="copied" role="status"></span><button class="btn secondary" type="button" data-copy="https://textdelege.ro/codul-civil/art-1/compara/2011-10-01..2023-07-09" data-copied="Copiat" data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o.">Copiază linkul</button><span class="copied" role="status"></span></p>',
    );
    expect(html).toContain(
      'data-copy="Art. 1 Codul civil, comparație 01.10.2011 → 09.07.2023\nhttps://textdelege.ro/codul-civil/art-1/compara/2011-10-01..2023-07-09"',
    );
    expect(html.match(/class="btn"/g)).toHaveLength(2);
    expect(html).toContain("Art. 1 Codul civil, comparație 01.10.2011 → 09.07.2023");
    expect(html).toContain(
      '<span class="addr"><span class="vh">Adresa permanentă: </span>textdelege.ro/codul-civil/art-1/compara/2011-10-01..2023-07-09</span>',
    );
    expect(html).not.toContain('class="addr" aria-label');
    expect(html).toContain("<h2>Actul modificator</h2>");
    expect(html).toContain("în vigoare din 09.07.2023");
  });

  it("shows the Monitorul Oficial reference and omits the amending act when it is unknown", () => {
    const bare = structuredClone(one);
    bare.versions[1]!.law = null;
    expect(view(bare, "2011-10-01", "2023-07-09", {}, null)).not.toContain("Actul modificator");
    const law = { ...structuredClone(law200), mo: "M.Of. nr. 616 din 6 iulie 2023" };
    expect(view(one, "2011-10-01", "2023-07-09", {}, law)).toContain(
      "M.Of. nr. 616 din 6 iulie 2023 · în vigoare din 09.07.2023",
    );
  });

  it("lists the other articles the same law changed, each with a compare link", () => {
    const law = structuredClone(law200);
    law.changes.push(
      { act_path: "lege/2009/287", file: "art-0002", number: "2", verb: "modified", units: ["p-1"], date: "2023-07-09" },
      { act_path: "lege/2010/134", file: "art-0001", number: "1", verb: "modified", units: [], date: "2023-07-09" },
      { act_path: "lege/2009/287", file: "art-0002", number: "2", verb: "modified", units: [], date: "2024-01-01" },
    );
    const html = view(one, "2011-10-01", "2023-07-09", {}, law);
    expect(html).toContain("Aceeași lege a mai schimbat în Codul civil");
    const table = /<h2>Aceeași lege[\s\S]*?<\/table>/.exec(html)![0];
    expect(table.match(/<tr>/g)).toHaveLength(2);
    expect(table).toContain('href="/codul-civil/art-2/compara/2023-07-08..2023-07-09">Compară</a>');
    expect(table).toContain('<span class="verb">Modificat</span> rândul 1');
    expect(view(one, "2011-10-01", "2023-07-09")).not.toContain("Aceeași lege a mai schimbat");
  });

  it("links the previous comparison and the article", () => {
    const three = structuredClone(one);
    three.versions.push({ ...structuredClone(one.versions[1]!), from: "2025-01-01", until: null });
    three.versions[1]!.until = "2024-12-31";
    const html = view(three, "2023-07-09", "2025-01-01");
    expect(html).toContain("Versiunea anterioară</span>");
    expect(html).toContain('<a href="/codul-civil/art-1/compara/2011-10-01..2023-07-09" rel="prev">');
    expect(html).toMatch(/<p class="back"><a href="\/codul-civil\/art-1"><svg[^>]*>[^]*?<\/svg>Înapoi la art\. 1<\/a><\/p>/);
    expect(html).toContain('<div class="pagination-next"><span class="off" aria-disabled="true">');
    expect(html).not.toContain('rel="next"');
    const first = view(one, "2011-10-01", "2023-07-09");
    expect(first).not.toContain("Versiunea anterioară");
    expect(first).not.toContain('class="pagination"');
    expect(first).toContain('<p class="back">');
  });

  it("says when the two versions are the same text", () => {
    const html = view(one, "2012-01-01", "2013-01-01");
    expect(html).toContain("Textul este identic în cele două versiuni.");
    expect(html).not.toContain('id="schimbare-1"');
  });
});

describe("paragraph alignment and attribution", () => {
  const withLines = (older: [string, string][], newer: [string, string][]) => {
    const article = structuredClone(one);
    const line = (id: string, text: string, since: string, law: string) => ({ id, text, since, law });
    article.versions[0]!.lines = older.map(([id, text]) => line(id, text, "2011-10-01", "legea-71-2011"));
    article.versions[1]!.lines = newer.map(([id, text]) => line(id, text, "2023-07-09", "legea-200-2023"));
    return article;
  };

  it("shows one added block for an inserted paragraph with a caret index", () => {
    const article = withLines(
      [["alin-1", "(1) A."], ["alin-2", "(2) B."], ["alin-3", "(3) C."]],
      [["alin-1", "(1) A."], ["alin-2", "(2) B."], ["alin-2_1", "(2^1) Nou."], ["alin-3", "(3) C."]],
    );
    const html = view(article, "2011-10-01", "2023-07-09");
    expect(html.match(/class="p added"/g)).toHaveLength(1);
    expect(html.match(/class="p changed"/g)).toBeNull();
    expect(html.match(/class="p same"/g)).toHaveLength(3);
    expect(html).toContain("1 schimbare");
    expect(html).toContain("Alineatele sunt comparate după numărul lor.");
  });

  it("compares by number when a republication renumbers", () => {
    const article = withLines(
      [["alin-1", "(1) A."], ["alin-2", "(2) B."]],
      [["alin-1", "(1) A."], ["alin-2", "(2) Nou."], ["alin-3", "(3) B."]],
    );
    const html = view(article, "2011-10-01", "2023-07-09");
    expect(html.match(/class="p changed"/g)).toHaveLength(1);
    expect(html.match(/class="p added"/g)).toHaveLength(1);
    expect(html).toBe(view(article, "2011-10-01", "2023-07-09"));
  });

  it("aligns ids that differ by a build suffix independently", () => {
    const article = withLines(
      [["alin-1", "(1) A."], ["alin-1-2", "(1) B."]],
      [["alin-1", "(1) A."], ["alin-1-2", "(1) C."]],
    );
    const html = view(article, "2011-10-01", "2023-07-09");
    expect(html.match(/class="p same"/g)).toHaveLength(1);
    expect(html.match(/class="p changed"/g)).toHaveLength(1);
  });

  function threeSteps(): ArticleObject {
    const article = structuredClone(one);
    const first = article.versions[0]!;
    first.until = "2019-12-31";
    first.lines = [
      { id: "alin-1", text: "(1) A.", since: "2011-10-01", law: "legea-71-2011" },
      { id: "alin-2", text: "(2) B.", since: "2011-10-01", law: "legea-71-2011" },
    ];
    const middle = structuredClone(first);
    middle.from = "2020-01-01";
    middle.until = "2023-07-08";
    middle.law = { key: "legea-100-2020", label: "Legea nr. 100/2020" };
    middle.lines = [{ id: "alin-1", text: "(1) A mutat.", since: "2020-01-01", law: "legea-100-2020" }];
    const last = article.versions[1]!;
    last.lines = [{ id: "alin-1", text: "(1) A mutat.", since: "2020-01-01", law: "legea-100-2020" }];
    article.versions = [first, middle, last];
    return article;
  }

  it("names the middle law that changed a line when the versions are several steps apart", () => {
    const html = view(threeSteps(), "2011-10-01", "2023-07-09");
    expect(html).toContain('<b>Modificat</b> prin <a href="/lege/2020/100">Legea nr. 100/2020</a>');
    expect(html).toContain("în vigoare din 01.01.2020");
    expect(html).not.toContain("Legea nr. 200/2023</a><span>");
  });

  it("names the middle law that removed a line", () => {
    const html = view(threeSteps(), "2011-10-01", "2023-07-09");
    expect(html).toContain('<b>Eliminat</b> prin <a href="/lege/2020/100">Legea nr. 100/2020</a>');
  });
});

describe("compare routes", () => {
  it("answers 404 for an unknown article or act", async () => {
    expect((await get("/codul-civil/art-99/compara/2011-10-01..2023-07-09")).status).toBe(404);
    expect((await get("/nu-exista/art-1/compara/2011-10-01..2023-07-09")).status).toBe(404);
  });

  it("answers 404 with an explanation when a date has no version", async () => {
    const response = await get("/codul-civil/art-1/compara/2010-01-01..2023-07-09");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("Articolul nu avea o versiune în vigoare la 01.01.2010");
    expect(html).toContain('<meta name="robots" content="noindex"');
  });

  it("answers 404 for an equal range and turns a reversed one round", async () => {
    expect((await get("/codul-civil/art-1/compara/2023-07-09..2023-07-09")).status).toBe(404);
    const reversed = await get("/codul-civil/art-1/compara/2023-07-09..2011-10-01?paralel=da");
    expect(reversed.status).toBe(301);
    expect(reversed.headers.get("location")).toBe("/codul-civil/art-1/compara/2011-10-01..2023-07-09?paralel=da");
    const act = await get("/codul-civil/compara/2023-07-09..2011-10-01");
    expect(act.status).toBe(301);
    expect(act.headers.get("location")).toBe("/codul-civil/compara/2011-10-01..2023-07-09");
  });

  it("redirects the version picker to the canonical comparison address", async () => {
    const response = await get("/codul-civil/art-1/compara?de=2011-10-01&pana=2023-07-09");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(ONE);
  });

  it("swaps a reversed pair and keeps the display flags", async () => {
    const response = await get("/codul-civil/art-1/compara?de=2023-07-09&pana=2011-10-01&paleta=daltonism&x=1");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ONE}?paleta=daltonism`);
  });

  it("carries only known flag pairs through the picker", async () => {
    const response = await get(
      "/codul-civil/art-1/compara?de=2011-10-01&pana=2023-07-09&vedere=paralel&doar=nu&paleta=x&granularitate=caractere",
    );
    expect(response.headers.get("location")).toBe(`${ONE}?vedere=paralel&granularitate=caractere`);
  });

  it("opens the article when both selectors name the same version", async () => {
    const response = await get("/codul-civil/art-1/compara?de=2023-07-09&pana=2023-07-09");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/codul-civil/art-1/2023-07-09");
  });

  it.each([
    "/codul-civil/art-1/compara",
    "/codul-civil/art-1/compara?de=2011-10-01",
    "/codul-civil/art-1/compara?de=oops&pana=2023-07-09",
    "/codul-civil/art-1/compara?de=2011-02-30&pana=2023-07-09",
    "/codul-civil/art-77/compara?de=2011-10-01&pana=2023-07-09",
  ])("answers 404 for the invalid picker request %s", async (path) => {
    expect((await get(path)).status).toBe(404);
  });

  it("serves the canonical address too", async () => {
    const html = await page("/lege/2009/287/art-1/compara/2011-10-01..2023-07-09");
    expect(html).toContain("Primul text");
  });
});

describe("compare links of the article page", () => {
  it("resolve to valid comparison addresses that exist", async () => {
    const html = await page("/codul-civil/art-1");
    const hrefs = [...html.matchAll(/href="([^"]*\/compara\/[^"]*)"/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(parsePath(href.split("?")[0]!)?.kind, href).toBe("compareArticle");
      expect((await get(href)).status, href).toBe(200);
    }
  });

  it("send the first version to the article page and the rest to a comparison", async () => {
    const html = await page("/codul-civil/art-1");
    expect(html).toContain('<a href="/codul-civil/art-1/2011-10-01">Forma inițială</a>');
    expect(html.match(/Vezi modificarea/g)).toHaveLength(1);
  });
});

describe("plural forms", () => {
  it.each([
    [1, "1 schimbare"],
    [2, "2 schimbări"],
    [19, "19 schimbări"],
    [20, "20 de schimbări"],
    [101, "101 schimbări"],
    [120, "120 de schimbări"],
  ])("writes %i", (n, text) => {
    expect(changesPhrase(n)).toBe(text);
  });
});

function entry(n: number, over: Partial<ActArticleEntry> = {}): ActArticleEntry {
  return {
    file: `art-${String(n).padStart(4, "0")}`,
    number: String(n),
    title: `Titlu ${n}`,
    state: "in-force",
    versions: 2,
    changes: 1,
    first: "2011-10-01",
    last_change: "2020-01-01",
    ...over,
  };
}

describe("act comparison", () => {
  it("lists articles changed between the dates with the verb, the law and a compare link", async () => {
    const response = await get("/codul-civil/compara/2023-01-01..2023-12-31");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Comparație Codul civil");
    expect(html).toContain("Între 01.01.2023 și 31.12.2023");
    expect(html).toContain("1 articol modificat");
    expect(html).toContain('<span class="verb">Modificat</span> alin. (1) · 09.07.2023');
    expect(html).toContain('<a href="/lege/2023/200">Legea nr. 200/2023</a>');
    expect(html).toContain('<a href="/codul-civil/art-1/compara/2023-01-01..2023-12-31">Compară</a>');
    expect(html).not.toContain("Art. 2");
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain(
      '<link rel="canonical" href="https://textdelege.ro/codul-civil/compara/2023-01-01..2023-12-31"',
    );
  });

  it("counts an event on the last day and not on the first", async () => {
    expect(await page("/codul-civil/compara/2023-07-09..2023-12-31")).toContain("Nicio modificare");
    expect(await page("/codul-civil/compara/2023-01-01..2023-07-09")).toContain("1 articol modificat");
  });

  it("links an article that began inside the range to its first version", async () => {
    const html = await page("/codul-civil/compara/2011-01-01..2023-12-31");
    expect(html).toContain("2 articole modificate");
    expect(html).toContain('<a href="/codul-civil/art-1/compara/2011-10-01..2023-12-31">Compară</a>');
    expect(html).toContain('<a href="/codul-civil/art-2">Deschide</a>');
  });

  it("answers 404 for an unknown act", async () => {
    expect((await get("/nu-exista/compara/2023-01-01..2023-12-31")).status).toBe(404);
  });

  it("opens only candidate articles, caps them at 300 and says so", () => {
    const synthetic = structuredClone(act);
    synthetic.articles = [
      ...Array.from({ length: 350 }, (_, i) => entry(i + 1)),
      entry(900, { last_change: "2010-01-01", first: "2010-01-01" }),
      entry(901, { first: "2030-01-01", last_change: "2030-01-01" }),
    ];
    const { entries, capped } = candidates(synthetic, "2019-01-01", "2021-01-01");
    expect(ACT_CAP).toBe(300);
    expect(entries).toHaveLength(300);
    expect(capped).toBe(true);
    expect(entries.some((e) => e.number === "900" || e.number === "901")).toBe(false);
    const few = { ...synthetic, articles: synthetic.articles.slice(0, 5) };
    expect(candidates(few, "2019-01-01", "2021-01-01")).toEqual({
      entries: few.articles,
      capped: false,
    });
    const html = String(renderActCompare(synthetic, [], "2019-01-01", "2021-01-01", true));
    expect(html).toContain("primele articole care pot fi modificate (cel mult 300)");
  });

  it("keeps only the articles with an event in the range", () => {
    const entries = [entry(1), entry(2)];
    const rows = changedRows(entries, [one, two], "2011-10-01", "2023-07-09");
    expect(rows.map((row) => row.article.number)).toEqual(["1"]);
    expect(rows[0]!.events.map((event) => event.date)).toEqual(["2023-07-09"]);
    const early = changedRows(entries, [null, two], "2011-09-01", "2011-10-01");
    expect(early.map((row) => row.article.number)).toEqual(["2"]);
    expect(eventsIn(one, "2011-10-01", "2023-07-08")).toEqual([]);
  });

  it("clamps the compare link of an article to the versions it has", () => {
    expect(linkRange(one, "2011-01-01", "2023-12-31")).toEqual({ from: "2011-10-01", to: "2023-12-31" });
    expect(linkRange(two, "2011-01-01", "2023-12-31")).toBeNull();
    expect(linkRange(one, "2011-10-01", "2023-07-09")).toEqual({ from: "2011-10-01", to: "2023-07-09" });
  });

  it("runs the work in chunks of at most 20 and keeps the order", async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 45 }, (_, i) => i);
    const result = await inChunks(items, CHUNK, async (i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return i * 2;
    });
    expect(peak).toBe(20);
    expect(result).toEqual(items.map((i) => i * 2));
  });
});
