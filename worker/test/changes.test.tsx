import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { atom, escapeXml } from "../src/lib/feed";
import { createStore } from "../src/lib/store";
import type { ChangeItem } from "../src/lib/types";
import { changeCells } from "../src/views/changes";
import { unitText } from "../src/lib/text";
import { replaceObject } from "./support";

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });

const restores: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0)) await restore();
});

async function patchSite(patch: (site: { items: ChangeItem[]; upcoming: ChangeItem[] }) => void) {
  const store = createStore(env);
  const site = structuredClone(await store.changes("site"));
  patch(site!);
  restores.push(await replaceObject("changes/site.json", site));
}

const UPCOMING: ChangeItem = {
  date: "2099-01-01",
  act_path: "lege/2009/287",
  file: "art-0002",
  number: "2",
  title: null,
  verb: "modified",
  units: ["alin-2"],
  law: { key: "legea-200-2023", label: "Legea nr. 200/2023" },
};

function assertWellFormed(xml: string): void {
  const body = xml.replace(/^<\?xml[^>]*\?>/, "");
  const stack: string[] = [];
  const token = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
  let consumed = 0;
  for (const match of body.matchAll(token)) {
    expect(match.index, "unparsed markup").toBe(consumed);
    consumed += match[0].length;
    if (match[5] !== undefined) {
      expect(match[5], "bare ampersand").not.toMatch(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/);
      continue;
    }
    if (match[3]) expect(match[3], "bare ampersand in attribute").not.toMatch(/&(?!(?:amp|lt|gt|quot|apos|#\d+);)/);
    if (match[4] === "/") continue;
    if (match[1] === "/") expect(stack.pop()).toBe(match[2]);
    else stack.push(match[2]!);
  }
  expect(consumed).toBe(body.length);
  expect(stack).toEqual([]);
}

const tagText = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

describe("escapeXml", () => {
  it("drops characters XML 1.0 cannot carry", () => {
    const dirty = "a\u0000b\u0008c\u000Bd\u000Ce\u000Ef\u001Fg\t\n\r";
    expect(escapeXml(dirty)).toBe("abcdefg\t\n\r");
  });

  it("keeps a feed well-formed when a value holds control characters", () => {
    const xml = atom(
      [
        {
          id: "i\u0001",
          title: "t\u0002",
          updated: "2023-07-09T00:00:00Z",
          link: "https://x/\u0003",
          summary: "s\u000B",
        },
      ],
      "https://example.com/f.atom",
      "T\u0000",
      "2026-11-08T06:00:00Z",
    );
    assertWellFormed(xml);
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("escapes the five predefined entities", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe("a &amp; b &lt; c &gt; d &quot; e &apos; f");
  });
});

describe("atom", () => {
  it("builds a feed from entries without trusting any value", () => {
    const xml = atom(
      [
        {
          id: "tag:textdelege.ro,2026:x",
          title: "<b>&",
          updated: "2023-07-09T00:00:00Z",
          link: "https://example.com/a?x=1&y=2",
          summary: "\"q\" 'q'",
        },
      ],
      "https://example.com/modificari.atom",
      "Titlu & <altul>",
      "2026-11-08T06:00:00Z",
    );
    assertWellFormed(xml);
    expect(xml).toContain("<title>Titlu &amp; &lt;altul&gt;</title>");
    expect(xml).toContain('href="https://example.com/a?x=1&amp;y=2"');
  });

  it("falls back to the given time when there are no entries", () => {
    const xml = atom([], "https://example.com/modificari.atom", "T", "2026-11-08T06:00:00Z");
    expect(tagText(xml, "updated")).toBe("2026-11-08T06:00:00Z");
  });
});

describe("changes feeds", () => {
  it("changes atom validates required elements", async () => {
    const res = await get("/modificari.atom");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
    const xml = await res.text();
    assertWellFormed(xml);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="utf-8"\?>/);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain("<id>tag:textdelege.ro,2026:modificari.atom</id>");
    expect(xml).toContain("<title>Textdelege: modificări recente</title>");
    expect(xml).toContain("<updated>2023-07-09T00:00:00Z</updated>");
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://textdelege.ro/modificari.atom"/>');
    expect(xml).toContain('<link rel="alternate" type="text/html" href="https://textdelege.ro/modificari"/>');

    const entries = xml.split("<entry>").slice(1);
    expect(entries).toHaveLength(4);
    const ids = entries.map((entry) => tagText(entry, "id"));
    expect(ids).toContain("tag:textdelege.ro,2026:lege/2009/287/art-0001/2023-07-09/modified/legea-200-2023/alin-1");
    expect(ids).toContain("tag:textdelege.ro,2026:lege/2010/134/art-0001/2011-10-01/entered/legea-71-2011/all");
    expect(new Set(ids).size).toBe(4);
    const first = entries[0]!;
    expect(tagText(first, "title")).toBe("Codul civil, art. 1: Modificat");
    expect(tagText(first, "updated")).toBe("2023-07-09T00:00:00Z");
    expect(first).toContain('<link rel="alternate" type="text/html" href="https://textdelege.ro/codul-civil/art-1/2023-07-09"/>');
    expect(first).toContain('<summary type="text">');
    expect(first).toContain("alin. (1)");
    expect(first).toContain("Legea nr. 200/2023");
  });

  it("keeps entry ids stable between requests", async () => {
    const ids = async () => [...(await (await get("/modificari.atom")).text()).matchAll(/<id>([^<]*)<\/id>/g)].map((m) => m[1]);
    expect(await ids()).toEqual(await ids());
  });

  it("escapes a law label with an ampersand", async () => {
    await patchSite((site) => {
      site.items[0]!.law = { key: "legea-200-2023", label: 'Legea A & B <1> "x"' };
    });
    const xml = await (await get("/modificari.atom")).text();
    assertWellFormed(xml);
    expect(xml).toContain("Legea A &amp; B &lt;1&gt; &quot;x&quot;");
  });

  it("pins absolute links to the site origin whatever the request host", async () => {
    const res = await exports.default.fetch("https://other.example/modificari.atom");
    const xml = await res.text();
    expect(xml).toContain('href="https://textdelege.ro/codul-civil/art-1/2023-07-09"');
    expect(xml).not.toContain("other.example");
  });

  it("gives two same-day events of one article different ids", async () => {
    await patchSite((site) => {
      site.items = [
        { ...site.items[0]!, units: ["alin-1"], law: { key: "legea-1-2023", label: "L1" } },
        { ...site.items[0]!, units: ["alin-2"], law: { key: "legea-2-2023", label: "L2" } },
        { ...site.items[0]!, units: ["alin-3", "alin-2"], law: { key: "legea-2-2023", label: "L2" } },
      ];
    });
    const xml = await (await get("/modificari.atom")).text();
    const ids = [...xml.matchAll(/<entry><id>([^<]*)<\/id>/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain("tag:textdelege.ro,2026:lege/2009/287/art-0001/2023-07-09/modified/legea-2-2023/alin-2+alin-3");
  });

  it("lists the events of an article in its feed", async () => {
    const xml = await (await get("/modificari/codul-civil/art-1.atom")).text();
    expect(xml).toContain('<link rel="self" type="application/atom+xml" href="https://textdelege.ro/modificari/codul-civil/art-1.atom"/>');
    expect(tagText(xml, "title")).toBe("Textdelege: modificări la Codul civil, art. 1");
    const ids = [...xml.matchAll(/<entry><id>([^<]*)<\/id>/g)].map((m) => m[1]);
    expect(ids).toEqual([
      "tag:textdelege.ro,2026:lege/2009/287/art-0001/2023-07-09/modified/legea-200-2023/alin-1",
      "tag:textdelege.ro,2026:lege/2009/287/art-0001/2011-10-01/entered/legea-71-2011/all",
    ]);
  });

  it("serves the article atom feed from the events of the article", async () => {
    const xml = await (await get("/modificari/codul-civil/art-1.atom")).text();
    assertWellFormed(xml);
    expect(xml.split("<entry>")).toHaveLength(3);
    expect(xml).toContain("<id>tag:textdelege.ro,2026:modificari/codul-civil/art-1.atom</id>");
  });

  it("serves the act feed from the act scope, addressed by alias or path", async () => {
    for (const path of ["/modificari/codul-civil.atom", "/modificari/lege/2009/287.atom"]) {
      const xml = await (await get(path)).text();
      expect(xml.split("<entry>")).toHaveLength(4);
    }
    const other = await (await get("/modificari/codul-procedura.atom")).text();
    expect(other.split("<entry>")).toHaveLength(2);
  });

  it("includes scheduled changes in the feeds", async () => {
    await patchSite((site) => {
      site.upcoming = [UPCOMING];
    });
    const xml = await (await get("/modificari.atom")).text();
    expect(xml).toContain("2099-01-01/modified/legea-200-2023/alin-2</id>");
    expect(tagText(xml, "updated")).toBe("2023-07-09T00:00:00Z");
  });

  it("answers 404 for an unknown act or article", async () => {
    for (const path of [
      "/modificari/necunoscut",
      "/modificari/necunoscut.atom",
      "/modificari/codul-civil/art-99",
      "/modificari/codul-civil/art-99.atom",
      "/modificari.json",
      "/modificari/codul-civil.json",
      "/modificari/lege/1999/1.atom",
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });
});

describe("change filters", () => {
  const count = (xml: string) => xml.split("<entry>").length - 1;

  it("filters the site feed by act, verb and dates", async () => {
    expect(count(await (await get("/modificari.atom?act=codul-procedura")).text())).toBe(1);
    expect(count(await (await get("/modificari.atom?verb=modified")).text())).toBe(1);
    expect(count(await (await get("/modificari.atom?de=2023-01-01")).text())).toBe(1);
    expect(count(await (await get("/modificari.atom?pana=2012-01-01")).text())).toBe(3);
    expect(count(await (await get("/modificari.atom?verb=entered&de=2011-10-01&pana=2011-10-01&act=codul-civil")).text())).toBe(2);
  });

  it("reads the dates as DD.MM.YYYY as well as ISO", async () => {
    expect(count(await (await get("/modificari.atom?de=01.01.2023")).text())).toBe(1);
    expect(count(await (await get("/modificari.atom?pana=1.1.2012")).text())).toBe(3);
    expect(await (await get("/modificari.atom?de=01.01.2023")).text()).toContain(
      'href="https://textdelege.ro/modificari.atom?de=2023-01-01"',
    );
  });

  it("shows the dates of the form as DD.MM.YYYY text fields", async () => {
    const html = await (await get("/modificari?de=2011-10-01&pana=2012-01-01")).text();
    expect(html).toMatch(/<input[^>]*type="text"[^>]*name="de"[^>]*value="01\.10\.2011"/);
    expect(html).toMatch(/<input[^>]*type="text"[^>]*name="pana"[^>]*value="01\.01\.2012"/);
    expect(html).not.toMatch(/<input[^>]*type="date"[^>]*name=/);
    expect(html).toContain('<label class="label" for="filter-from">De la</label>');
  });

  it("ignores invalid values", async () => {
    for (const query of ["verb=nothing", "de=2023-13-45", "de=31.02.2023", "pana=ieri", "act=necunoscut", "de=&pana=&verb="]) {
      expect(count(await (await get(`/modificari.atom?${query}`)).text()), query).toBe(4);
    }
  });

  it("filters article feeds by verb and dates", async () => {
    const entries = async (query: string) => count(await (await get(`/modificari/codul-civil/art-1.atom?${query}`)).text());
    expect(await entries("verb=entered")).toBe(1);
    expect(await entries("de=2020-01-01")).toBe(1);
    expect(await entries("pana=2020-01-01")).toBe(1);
    expect(await entries("act=codul-procedura")).toBe(2);
  });

  it("filters the HTML table and keeps the filters in the form and the feed links", async () => {
    const html = await (await get("/modificari?verb=modified")).text();
    expect(html).toContain("09.07.2023");
    expect(html).not.toContain("01.10.2011");
    expect(html).toContain('<option value="modified" selected');
    expect(html).toContain('href="/modificari.atom?verb=modified"');
  });

  it("answers the choice of an act with the changes of that act, keeping the other filters", async () => {
    const chosen = await get("/modificari?act=codul-civil");
    expect(chosen.status).toBe(302);
    expect(chosen.headers.get("location")).toBe("/modificari/codul-civil");
    const more = await get("/modificari?q=titlu&act=codul-civil&verb=modified&de=01.01.2020&pana=2023-12-31");
    expect(more.status).toBe(302);
    expect(more.headers.get("location")).toBe("/modificari/codul-civil?q=titlu&verb=modified&de=2020-01-01&pana=2023-12-31");
    const empty = await get("/modificari?act=&verb=");
    expect(empty.status).toBe(301);
    expect(empty.headers.get("location")).toBe("/modificari");
    expect((await get("/modificari?act=necunoscut")).status).toBe(200);
  });

  it("filters within the act's own changes on the act page", async () => {
    const html = await (await get("/modificari/codul-civil?verb=modified")).text();
    expect(html).toContain("09.07.2023");
    expect(html).not.toContain("01.10.2011");
    expect(html).toContain('<option value="modified" selected');
    expect(html).toContain('href="/modificari/codul-civil.atom?verb=modified"');
  });

  it("states the window of the rows under the results bar", async () => {
    const site = await (await get("/modificari")).text();
    expect(site).toContain('<p class="window">Ultimele 100 de modificări din toate actele</p>');
    expect(site.indexOf('class="results-bar"')).toBeLessThan(site.indexOf('class="window"'));
    const act = await (await get("/modificari/codul-civil")).text();
    expect(act).toContain('<p class="window">Ultimele 100 de modificări ale actului</p>');
    const article = await (await get("/modificari/codul-civil/art-1")).text();
    expect(article).not.toContain('class="window"');
  });

  it("offers a way back when the filters leave nothing", async () => {
    const html = await (await get("/modificari?q=nimic+de+gasit")).text();
    expect(html).toContain('<p>Nu există modificări de arătat.</p><p><a href="/modificari">Șterge filtrele</a></p>');
    const act = await (await get("/modificari/codul-civil?q=nimic+de+gasit")).text();
    expect(act).toContain('<p><a href="/modificari/codul-civil">Șterge filtrele</a></p>');
    const plain = await (await get("/modificari")).text();
    expect(plain).not.toContain("Nu există modificări de arătat");
  });

  it("lists the acts of the filter in the order of the home page, in groups", async () => {
    const html = await (await get("/modificari")).text();
    const select = html.slice(html.indexOf('<select class="field" id="filter-act"'), html.indexOf("</select>", html.indexOf('id="filter-act"')));
    expect(select).toMatch(/<option value="">Toate<\/option><optgroup label="În vigoare"><option value="codul-civil">Codul civil<\/option>/);
    expect(select.indexOf('value="codul-civil"')).toBeLessThan(select.indexOf('value="codul-procedura"'));
    expect(select).not.toContain("Istorice");
  });

  it("groups the historical acts apart in the filter", async () => {
    const store = createStore(env);
    const manifest = structuredClone(await store.manifest());
    manifest.acts.push({ ...manifest.acts[0]!, path: "lege/1999/1", alias: "veche", short: "Veche", status: "repealed 2000-01-01" });
    restores.push(await replaceObject("manifest.json", manifest));
    const html = await (await get("/modificari")).text();
    expect(html).toMatch(/<optgroup label="Istorice"><option value="veche">Veche<\/option><\/optgroup>/);
    expect(html.indexOf('<optgroup label="În vigoare">')).toBeLessThan(html.indexOf('<optgroup label="Istorice">'));
  });

  it("gives every date filter a visible hint, leaves the checking to the server and keeps a typed value", async () => {
    const html = await (await get("/modificari")).text();
    expect(html).toMatch(/<form class="filters"[^>]*novalidate/);
    expect(html).toContain('<p class="hint" id="filter-from-hint">De exemplu, 13.03.2021</p>');
    expect(html).toContain('<p class="hint" id="filter-to-hint">De exemplu, 13.03.2021</p>');
    expect(html).toMatch(/<input[^>]*id="filter-from"[^>]*aria-describedby="filter-from-hint"/);
  });

  it("refuses a date that is not a day with a 400, an error summary and the message beside the field", async () => {
    const res = await get("/modificari?de=31.02.2020&pana=ieri&verb=modified");
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("<title>Eroare: Modificările legislației | Textdelege</title>");
    expect(html).toContain(
      '<div class="error-summary" role="alert"><h2>Există o problemă</h2><ul><li><a href="#filter-from">Scrie o zi care există, de exemplu 13.03.2021</a></li><li><a href="#filter-to">Scrie o zi care există, de exemplu 13.03.2021</a></li></ul></div>',
    );
    expect(html).toContain('<p class="error-message" id="filter-from-error"><span class="vh">Eroare: </span>Scrie o zi care există, de exemplu 13.03.2021</p>');
    expect(html).toMatch(/<input[^>]*id="filter-from"[^>]*value="31\.02\.2020"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<input[^>]*id="filter-to"[^>]*value="ieri"/);
    expect(html).not.toContain('class="results-bar"');
    expect(html).not.toContain("<table");
    expect((await get("/modificari?de=01.01.2020")).status).toBe(200);
    const blank = await get("/modificari?q=titlu&de=&pana=");
    expect(blank.status).toBe(301);
    expect(blank.headers.get("location")).toBe("/modificari?q=titlu");
  });

  it("names no act when the source names none, in the table and the feed", async () => {
    await patchSite((site) => {
      site.items[0]!.law = { key: "", label: "Portalul legislativ (Ministerul Justiției)" };
    });
    const html = await (await get("/modificari")).text();
    expect(html).not.toContain("Portalul legislativ");
    expect(html).not.toContain("unexplained");
    expect(html).toContain('<a href="/despre#sursa">act nemenționat de sursă</a>');
    const feed = await (await get("/modificari.atom")).text();
    expect(feed).not.toContain("Portalul legislativ");
    expect(feed).toContain("Act modificator: act nemenționat de sursă.");
  });

  it("searches the act name, the article, the title, the law and the units without case or diacritics", async () => {
    const entries = async (q: string) => count(await (await get(`/modificari.atom?q=${encodeURIComponent(q)}`)).text());
    expect(await entries("CODUL civil")).toBe(3);
    expect(await entries("procedura")).toBe(1);
    expect(await entries("art. 2")).toBe(1);
    expect(await entries("titlu")).toBe(2);
    expect(await entries("Legea nr. 200/2023")).toBe(1);
    expect(await entries("71/2011")).toBe(3);
    expect(await entries("alin. (1)")).toBe(1);
    expect(await entries("nimic de gasit")).toBe(0);
    await patchSite((site) => {
      site.items[0]!.title = "Țara înaltă";
    });
    expect(await entries("tara inalta")).toBe(1);
    expect(await entries("ȚARA ÎNALTĂ")).toBe(1);
    expect(await entries("ţară înaltă")).toBe(1);
  });

  it("trims the text and keeps at most 100 characters of it", async () => {
    const feed = await (await get(`/modificari.atom?q=${encodeURIComponent(`  civil ${"x".repeat(200)}  `)}`)).text();
    expect(feed).toContain(`?q=civil+${"x".repeat(100 - 6)}`);
    expect(feed).not.toContain("x".repeat(100));
    expect(await (await get("/modificari.atom?q=%20%20")).text()).not.toContain("?q=");
  });

  it("shows the search field first in the form, the zero count for no match and keeps the text in the links", async () => {
    const html = await (await get("/modificari?q=nimic+de+gasit")).text();
    expect(html).toContain('<label class="label" for="filter-q">Caută în modificări</label>');
    expect(html).toMatch(/<input[^>]*type="search"[^>]*name="q"[^>]*value="nimic de gasit"/);
    expect(html.indexOf('id="filter-q"')).toBeLessThan(html.indexOf('id="filter-act"'));
    expect(html).toContain('<span class="count">0 modificări</span>');
    expect(html).toContain('href="/modificari.atom?q=nimic+de+gasit"');
    const found = await (await get("/modificari?q=procedura")).text();
    expect(found).toContain('<span class="count">1 modificare</span>');
  });

  it("applies the text filter to the scheduled changes", async () => {
    await patchSite((site) => {
      site.upcoming = [UPCOMING];
    });
    const html = await (await get("/modificari?q=200/2023")).text();
    expect(html).toContain('id="in-curand"');
    const none = await (await get("/modificari?q=71/2011")).text();
    expect(none).not.toContain('id="in-curand"');
  });

  it("offers the act choice on the site page only", async () => {
    expect(await (await get("/modificari")).text()).toContain('name="act"');
    expect(await (await get("/modificari/codul-civil")).text()).not.toContain('name="act"');
  });
});

describe("changes pages", () => {
  it("lists the changes in a table with links", async () => {
    const res = await get("/modificari");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<table");
    expect(html).toContain("09.07.2023");
    expect(html).toContain('href="/codul-civil"');
    expect(html).toContain('href="/codul-civil/art-1/2023-07-09"');
    expect(html).toContain('href="/lege/2023/200"');
    expect(html).toContain('<link rel="canonical" href="https://textdelege.ro/modificari"');
    expect(html).toContain('rel="alternate" type="application/atom+xml"');
    expect(html).not.toContain("feed+json");
    expect(html).toContain('href="/modificari.atom"');
    expect(html).not.toContain(".json");
  });

  it("has breadcrumbs, one primary button and a results bar with the count", async () => {
    const html = await (await get("/modificari")).text();
    expect(html).toContain('<ol><li><a href="/">Acasă</a></li><li aria-current="page">Modificările legislației</li></ol>');
    expect(html.match(/class="btn"/g)).toHaveLength(1);
    expect(html).not.toContain("page-links");
    const bar = html.match(/<div class="results-bar"><span class="count">([^<]*)<\/span><nav aria-label="Abonare">([\s\S]*?)<\/nav>/)!;
    expect(bar[1]).toMatch(/^\d+ (modificare|modificări|de modificări)$/);
    expect(bar[2]).toContain('<a href="/abonare">Abonare la aceste modificări</a>');
  });

  it("names the act in the breadcrumbs of its own pages", async () => {
    const html = await (await get("/modificari/codul-civil")).text();
    expect(html).toContain('<ol><li><a href="/">Acasă</a></li><li><a href="/codul-civil">Codul civil</a></li></ol>');
    expect(html).toContain('<a href="/modificari">Toate modificările</a>');
  });

  it("shows scheduled changes in their own section with the Programat tag", async () => {
    await patchSite((site) => {
      site.upcoming = [UPCOMING];
    });
    const html = await (await get("/modificari")).text();
    const at = html.indexOf('id="in-curand"');
    expect(at).toBeGreaterThan(-1);
    const section = html.slice(at, html.indexOf("</section>", at));
    expect(section).toContain("În curând");
    expect(section).toContain("Programat");
    expect(section).toContain("01.01.2099");
    expect(html.slice(0, at)).not.toContain("01.01.2099");
  });

  it("splits the changes on today, whatever the build put in each list", async () => {
    await patchSite((site) => {
      site.items = [UPCOMING];
      site.upcoming = [{ ...UPCOMING, date: "2000-01-01" }];
    });
    const html = await (await get("/modificari")).text();
    const at = html.indexOf('id="in-curand"');
    expect(at).toBeGreaterThan(-1);
    const section = html.slice(at, html.indexOf("</section>", at));
    expect(section).toContain("01.01.2099");
    expect(section).not.toContain("01.01.2000");
    expect(html.slice(0, at)).not.toContain("01.01.2099");
    expect(html).toContain("01.01.2000");
  });

  it("has no scheduled section when nothing is scheduled", async () => {
    expect(await (await get("/modificari")).text()).not.toContain('id="in-curand"');
  });

  it("renders the act and article pages", async () => {
    const act = await (await get("/modificari/codul-civil")).text();
    expect(act).toContain("Modificări: Codul civil");
    expect(act).toContain('href="/modificari/codul-civil.atom"');
    const article = await (await get("/modificari/codul-civil/art-1")).text();
    expect(article).toContain("Modificări: Codul civil, art. 1");
    expect(article).toContain('href="/modificari/codul-civil/art-1.atom"');
    expect(article).not.toContain("/codul-civil/art-2/");
  });

  it("answers 404 with the not-found page", async () => {
    const res = await get("/modificari/necunoscut");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Pagină negăsită");
  });

});

describe("subscribe pages", () => {
  it("explains the feed of the site, of an act and of an article, with its full address", async () => {
    const site = await (await get("/abonare")).text();
    expect(site).toContain("<h1>Abonare la modificări</h1>");
    expect(site).toContain("Fluxul acesta urmărește modificările tuturor actelor de pe site.");
    expect(site).toContain('<p class="feed-addr">https://textdelege.ro/modificari.atom</p>');
    expect(site).toContain('data-copy="https://textdelege.ro/modificari.atom"');
    expect(site).toContain('<meta name="robots" content="noindex"');
    const act = await (await get("/abonare/codul-civil")).text();
    expect(act).toContain("Fluxul acesta urmărește modificările Codului civil.");
    expect(act).toContain('<a href="/modificari/codul-civil">Modificări: Codul civil</a>');
    const article = await (await get("/abonare/codul-civil/art-1")).text();
    expect(article).toContain("Fluxul acesta urmărește modificările art. 1 din Codul civil.");
    expect(article).toContain("https://textdelege.ro/modificari/codul-civil/art-1.atom");
  });

  it("keeps the filters of the changes page in the feed address", async () => {
    const html = await (await get("/abonare?verb=modified")).text();
    expect(html).toContain('<p class="feed-addr">https://textdelege.ro/modificari.atom?verb=modified</p>');
    expect(html).toContain('<a href="/modificari?verb=modified">');
  });

  it("has no page for an unknown act or a feed address", async () => {
    expect((await get("/abonare/nu-exista")).status).toBe(404);
    expect((await get("/abonare/codul-civil.atom")).status).toBe(404);
  });

  it("drops empty filter fields from the address of the changes, search and subscribe pages", async () => {
    for (const [from, to] of [
      ["/abonare?q=&verb=modified", "/abonare?verb=modified"],
      ["/cauta?q=impozit&in_force=", "/cauta?q=impozit"],
      ["/modificari/codul-civil?q=&de=", "/modificari/codul-civil"],
    ]) {
      const res = await get(from!);
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(to);
    }
    expect((await get("/legislatie?data=")).status).not.toBe(301);
  });
});

describe("indices in the changes table", () => {
  const item: ChangeItem = {
    date: "2023-07-09",
    act_path: "lege/2009/287",
    file: "art-0047_3",
    number: "47^3",
    title: null,
    verb: "modified",
    units: ["alin-1_1"],
    law: null,
  };

  it("sets the article number and the unit as superscripts and keeps the caret in plain text", () => {
    const html = changeCells(item, new Map()).map(String).join("");
    expect(html).toContain('Art. 47<span class="vh">^</span><sup>3</sup>');
    expect(html).toContain('alin. (1<span class="vh">^</span><sup>1</sup>)');
    expect(unitText("alin-1_1")).toBe("alin. (1^1)");
  });
});
