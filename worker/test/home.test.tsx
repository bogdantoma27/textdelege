import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { createStore } from "../src/lib/store";
import type { ChangeItem, Manifest } from "../src/lib/types";
import { removeObject, replaceObject } from "./support";

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string, init?: RequestInit) => (await get(path, init)).text();

const restores: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0)) await restore();
});

async function patchManifest(patch: (manifest: Manifest) => void): Promise<void> {
  const manifest = structuredClone(await createStore(env).manifest());
  patch(manifest);
  restores.push(await replaceObject("manifest.json", manifest));
}

async function patchSite(patch: (site: { items: ChangeItem[]; upcoming: ChangeItem[] }) => void) {
  const store = createStore(env);
  const site = structuredClone(await store.changes("site"));
  patch(site!);
  restores.push(await replaceObject("changes/site.json", site));
}

describe("home", () => {
  it("keeps the search in the masthead and shows the numbers beside the title", async () => {
    const html = await page("/");
    expect(html.match(/type="search"/g)).toHaveLength(2);
    expect(html).toContain('id="q"');
    expect(html).toContain('id="q-overlay"');
    expect(html).not.toContain("q-main");
    expect(html).toContain('<body class="home">');
    const hero = html.slice(html.indexOf('class="home-hero"'), html.indexOf('id="coduri"'));
    expect(hero).toContain('<dl class="home-strip"');
    expect(hero.indexOf('class="examples"')).toBeLessThan(hero.indexOf('class="home-strip"'));
  });

  it("offers three example searches under the introduction, drawn from the pool on every visit", async () => {
    const pool = [
      "art. 21 Constituția",
      "art. 1112 Codul civil",
      "art. 1357 Codul civil",
      "art. 188 Codul penal",
      "art. 228 Codul penal",
      "art. 52 alin. (1) Codul muncii",
      "art. 65 Codul muncii",
      "art. 7 Codul fiscal",
      "art. 194 Codul de procedură civilă",
      "art. 83 Codul de procedură penală",
      "art. 5 Codul administrativ",
      "art. 1 Codul vamal",
    ];
    const seen = new Set<string>();
    for (let visit = 0; visit < 12; visit++) {
      const html = await page("/");
      const examples = html.slice(html.indexOf('class="examples"'));
      const links = [...examples.slice(0, examples.indexOf("</p>")).matchAll(/<a href="\/cauta\?q=([^"]+)">/g)];
      const shown = links.map((m) => decodeURIComponent(m[1]!));
      expect(shown).toHaveLength(3);
      expect(new Set(shown).size).toBe(3);
      for (const example of shown) expect(pool).toContain(example);
      seen.add(shown.join("|"));
      expect(examples).toContain("Încearcă:");
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("says under the introduction where the data comes from", async () => {
    const html = await page("/");
    expect(html).toContain(
      '<p class="source-line">Toate datele vin din <a href="https://github.com/lexifina/romania-law">lexifina/romania-law</a>, un repo public pe GitHub. Textdelege este interfața care le face ușor de citit, de căutat și de citat.</p>',
    );
    expect(html.indexOf('class="source-line"')).toBeLessThan(html.indexOf('class="examples"'));
  });

  it("asks for a day in the hero and sends it to the point-in-time page", async () => {
    const html = await page("/");
    const start = html.indexOf('<form class="date-form"');
    const form = html.slice(start, html.indexOf("</form>", start));
    expect(form).toContain('method="get" action="/legislatie"');
    expect(form).not.toContain("data-shown");
    expect(form).toMatch(/name="data"[^>]*value="\d{2}\.\d{2}\.\d{4}"/);
    expect(form).toContain("Arată legislația");
    expect(html).toContain("Legislația la o dată");
  });

  it("gives the date field a visible label and hint and leaves the checking to the server", async () => {
    const html = await page("/");
    const start = html.indexOf('<form class="date-form"');
    const form = html.slice(start, html.indexOf("</form>", start));
    expect(form).toContain("novalidate");
    expect(form).toContain('<label class="label" for="data">Alege data</label>');
    expect(form).not.toContain('class="vh"');
    expect(form).toContain('<p class="hint" id="data-hint">De exemplu, 13.03.2021</p>');
    expect(form).toMatch(/<input[^>]*id="data"[^>]*aria-describedby="data-hint"/);
    expect(form).not.toContain("pattern=");
  });

  it("lists the codes once and has no contents rail", async () => {
    const html = await page("/");
    expect(html).not.toContain('class="toc');
    expect(html.match(/<a class="doc-link" href="\/codul-civil"/g)).toHaveLength(1);
  });

  it("answers 500 with the same friendly page for any other error", async () => {
    const broken = {
      get() {
        throw new TypeError("secret internal detail");
      },
    };
    const res = await app.fetch(new Request("https://example.com/"), { ...env, DATA: broken });
    expect(res.status).toBe(500);
    expect(res.headers.get("retry-after")).toBeNull();
    const html = await res.text();
    expect(html).toContain("Serviciul nu este disponibil momentan");
    expect(html).not.toContain("secret internal detail");
  });

  it("answers 503 with a friendly page when no build is published", async () => {
    restores.push(await removeObject("manifest.json"));
    const res = await get("/");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
    const html = await res.text();
    expect(html).toContain("Serviciul nu este disponibil momentan");
    expect(html).not.toContain("manifest.json");
  });

  it("home renders the code list, recent changes, upcoming and freshness line", async () => {
    await patchSite((site) => {
      site.upcoming = [
        {
          date: "2099-01-01",
          act_path: "lege/2009/287",
          file: "art-0002",
          number: "2",
          title: null,
          verb: "modified",
          units: ["alin-2"],
          law: { key: "legea-200-2023", label: "Legea nr. 200/2023" },
        },
      ];
    });
    const html = await page("/");
    expect(html).toContain('id="coduri"');
    expect(html).toContain("Codul civil");
    expect(html).toContain("Codul de procedura");
    expect(html).toContain('href="/codul-civil"');
    expect(html).toContain("Modificări recente");
    expect(html).toContain('href="/modificari"');
    expect(html).toContain('href="/codul-civil/art-1/2023-07-09"');
    expect(html).toContain('href="/lege/2023/200"');
    expect(html).toContain("alin. (1)");
    expect(html).toContain("Intră în vigoare în curând");
    expect(html).toContain("01.01.2099");
    expect(html).toContain('<link rel="canonical" href="https://textdelege.ro/"');
    expect(html).toContain('action="/cauta"');
  });

  it("lists each code once", async () => {
    const html = await page("/");
    const codes = html.slice(html.indexOf('id="coduri"'), html.indexOf('id="recente"'));
    expect(codes.match(/href="\/codul-civil"/g)?.length).toBe(1);
    expect(html).not.toContain('class="toc');
  });

  it("orders the bands: hero, numbers, codes, the date and the data, changes", async () => {
    const html = await page("/");
    const order = ['class="home-hero"', 'id="coduri"', 'id="la-data-titlu"', 'id="despre-date"', 'aria-labelledby="recente"'].map((s) => html.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("shows the manifest counts and the day of the last check beside the title", async () => {
    const html = await page("/");
    const strip = html.slice(html.indexOf('<dl class="home-strip"'), html.indexOf("</dl>"));
    expect(strip).toContain("<dt>acte</dt><dd>2</dd>");
    expect(strip).toContain("<dt>articole</dt><dd>3</dd>");
    expect(strip).toContain("<dt>versiuni</dt><dd>4</dd>");
    expect(strip).toContain("<dt>decizii</dt><dd>1</dd>");
    expect(strip).toContain("<dt>ultima verificare a surselor</dt><dd>01.11.2026</dd>");
    expect(strip).not.toContain("legi modificatoare");
    expect(html.indexOf('class="home-strip"')).toBeLessThan(html.indexOf('id="coduri"'));
  });

  it("describes each code by the day it entered into force and its size", async () => {
    const html = await page("/");
    expect(html).toContain('<span class="fact">din 01.10.2011</span>');
    expect(html).toContain("<span>2 articole · 3 versiuni</span>");
    expect(html).toContain("<span>1 articol · 1 versiune</span>");
  });

  it("groups the thousands of a large code the Romanian way", async () => {
    await patchManifest((manifest) => {
      manifest.acts[0]!.articles = 2674;
      manifest.acts[0]!.versions = 10231;
    });
    expect(await page("/")).toContain("2.674 de articole · 10.231 de versiuni");
  });

  it("leaves out what the manifest does not carry", async () => {
    await patchManifest((manifest) => {
      for (const act of manifest.acts) {
        delete act.from;
        delete act.articles;
        delete act.versions;
      }
    });
    const html = await page("/");
    expect(html).not.toContain('class="fact"');
    expect(html.slice(html.indexOf('id="coduri"'), html.indexOf('id="recente"'))).not.toContain("<span>");
  });

  it("shows the date of the newest version of each act", async () => {
    await patchManifest((manifest) => {
      manifest.acts[1]!.latest = "2020-02-03";
      manifest.acts[0]!.latest = "2099-01-01";
    });
    const html = await page("/");
    expect(html).toContain("Ultima modificare 03.02.2020");
    expect(html).not.toContain("Ultima modificare 01.01.2099");
  });

  it("omits the upcoming section when nothing is scheduled", async () => {
    const html = await page("/");
    expect(html).not.toContain("Intră în vigoare în curând</h2>");
    expect(html).not.toContain("home-changes split");
  });

  it("lists upcoming changes beside the recent ones, not as a table", async () => {
    await patchSite((site) => {
      site.upcoming = [
        {
          date: "2099-01-01",
          act_path: "lege/2009/287",
          file: "art-0002",
          number: "2",
          title: null,
          verb: "modified",
          units: ["alin-2"],
          law: { key: "legea-200-2023", label: "Legea nr. 200/2023" },
        },
      ];
    });
    const html = await page("/");
    const section = html.slice(html.indexOf('id="in-curand-titlu"'), html.indexOf("</footer>"));
    expect(html).toContain('class="home-changes split"');
    expect(section).toContain('<ul class="plain upcoming">');
    expect(section).not.toContain("<table");
    expect(section).toContain('<time class="upcoming-date" datetime="2099-01-01">01.01.2099</time>');
    expect(section).toContain('href="/codul-civil/art-2/2099-01-01"');
  });

  it("shows ten recent changes at most", async () => {
    await patchSite((site) => {
      site.items = Array.from({ length: 14 }, (_, i) => ({ ...site.items[0]!, number: String(i + 1) }));
    });
    const html = await page("/");
    const table = html.slice(html.indexOf('id="recente"'), html.indexOf("Toate modificările"));
    expect(table.match(/<tr>/g)).toHaveLength(11);
  });

  it("shows a change without a linkable law as plain text", async () => {
    await patchSite((site) => {
      site.items = [{ ...site.items[0]!, law: null }];
    });
    const html = await page("/");
    expect(html).not.toContain('href="/lege/2023/200"');
  });

  it("lists acts that are not in force apart from the current codes", async () => {
    await patchManifest((manifest) => {
      manifest.acts.push({
        path: "lege/1864/1",
        alias: "codul-vechi",
        title: "Legea veche",
        short: "Codul vechi",
        status: "repealed 1900-01-01",
        latest: "1900-01-01",
        freshness_status: null,
      });
    });
    const html = await page("/");
    const historical = html.indexOf('id="coduri-istorice"');
    expect(historical).toBeGreaterThan(-1);
    expect(html.indexOf('href="/codul-vechi"', historical)).toBeGreaterThan(historical);
    expect(html.slice(html.indexOf('id="coduri-vigoare"'), historical)).not.toContain("Codul vechi");
  });

  describe("tabs", () => {
    const old = () =>
      patchManifest((manifest) => {
        manifest.acts.push({
          path: "lege/1864/1",
          alias: "codul-vechi",
          title: "Legea veche",
          short: "Codul vechi",
          status: "repealed 1900-01-01",
          latest: "1900-01-01",
          freshness_status: null,
        });
      });

    it("shows the codes in force by default, with counts, and hides the historical ones", async () => {
      await old();
      const html = await page("/");
      const inForce = (await createStore(env).manifest()).acts.length - 1;
      expect(html).toContain(`În vigoare (${inForce})</a>`);
      expect(html).toContain("Istorice (1)</a>");
      expect(html).toMatch(/<a href="\/#coduri" aria-current="page"/);
      expect(html).toContain('<li class="tabs-item"><a href="/?coduri=istorice#coduri" data-panel="coduri-istorice" data-text="Istorice (1)">');
      expect(html).toMatch(/id="coduri-istorice" hidden/);
      expect(html).not.toMatch(/id="coduri-vigoare"[^>]* hidden/);
    });

    it("renders the historical panel when asked for, keeping both in the page", async () => {
      await old();
      const html = await page("/?coduri=istorice");
      expect(html).toMatch(/<a href="\/\?coduri=istorice#coduri" aria-current="page"/);
      expect(html).toMatch(/id="coduri-vigoare" hidden/);
      expect(html).not.toMatch(/id="coduri-istorice"[^>]* hidden/);
      expect(html).toContain('href="/codul-civil"');
    });

    it("badges codes in force in green and historical ones in grey", async () => {
      await old();
      const html = await page("/");
      const inForce = html.slice(html.indexOf('id="coduri-vigoare"'), html.indexOf('id="coduri-istorice"'));
      expect(inForce).toContain('href="/codul-civil"');
      expect(inForce).toContain('<span class="fact">din 01.10.2011</span>');
      expect(inForce).not.toContain("badge");
      expect(html.slice(html.indexOf('id="coduri-istorice"'))).toContain('<strong class="badge badge-grey">');
    });

    it("has no tabs when there are no historical codes", async () => {
      const html = await page("/?coduri=istorice");
      expect(html).not.toContain("data-panel");
      expect(html).not.toContain("tabs-panel");
      expect(html).not.toContain("coduri-istorice");
      expect(html).not.toMatch(/id="coduri-vigoare"[^>]* hidden/);
    });
  });

  it("labels an act whose amendments are not consolidated apart from a repealed one", async () => {
    await patchManifest((manifest) => {
      manifest.acts.push({
        path: "lege/1962/3",
        alias: null,
        title: "Legea nr. 3/1962",
        short: null,
        status: "amended, not consolidated",
        latest: "1963-01-29",
        freshness_status: null,
      });
    });
    const html = await page("/");
    const item = html.slice(html.indexOf('href="/lege/1962/3"'));
    expect(item.slice(0, item.indexOf("</li>"))).toContain('<strong class="badge badge-yellow">Text neconsolidat</strong>');
    expect(item.slice(0, item.indexOf("</li>"))).not.toContain("Nu mai este în vigoare");
  });

  it("says what the site is and credits the source repository beside the date form", async () => {
    const html = await page("/");
    const hero = html.slice(html.indexOf('class="home-hero"'), html.indexOf('id="coduri"'));
    expect(hero).toContain('<h1 id="home-titlu">Legile României, <em>cu toate modificările lor.</em></h1>');
    expect(hero).toContain("Vezi ce spune un articol azi, ce spunea înainte și cine l-a schimbat.");
    expect(html).toContain("<title>Legile României, cu toate modificările lor. | Textdelege</title>");
    const about = html.slice(html.indexOf('class="home-about"'), html.indexOf('class="home-changes'));
    expect(about).toContain('<a href="https://github.com/lexifina/romania-law">lexifina/romania-law</a>');
    expect(about).toContain('href="/despre"');
    expect(html.indexOf('id="la-data-titlu"')).toBeLessThan(html.indexOf('id="despre-date"'));
  });

  it("puts the Constitution first", async () => {
    await patchManifest((manifest) => {
      manifest.acts.push({
        path: "constitutie/1991",
        alias: "constitutia",
        title: "Constituția României",
        short: "Constituția",
        status: "in force",
        latest: "1991-12-08",
        freshness_status: null,
      });
    });
    const html = await page("/");
    const grid = html.slice(html.indexOf('id="coduri"'));
    expect(grid.indexOf("Constituția")).toBeGreaterThan(-1);
    expect(grid.indexOf("Constituția")).toBeLessThan(grid.indexOf("Codul civil"));
  });

  it("orders the codes by importance, then alphabetically, and historical ones alphabetically", async () => {
    const act = (alias: string, short: string, status = "in force") => ({
      path: `lege/2000/${alias}`,
      alias,
      title: short,
      short,
      status,
      latest: "2000-01-01",
      freshness_status: null,
    });
    await patchManifest((manifest) => {
      manifest.acts = [
        act("codul-vamal", "Codul vamal"),
        act("codul-comercial-1887", "Codul comercial din 1887", "repealed 1900-01-01"),
        act("codul-muncii", "Codul muncii"),
        act("codul-aerian", "Codul aerian"),
        act("codul-penal", "Codul penal"),
        act("codul-civil-1864", "Codul civil din 1864", "repealed 1900-01-01"),
        act("codul-silvic", "Codul silvic"),
        act("codul-administrativ", "Codul administrativ"),
        act("codul-fiscal", "Codul fiscal"),
        act("constitutia", "Constituția"),
        act("codul-civil", "Codul civil"),
        act("codul-procedura-fiscala", "Codul de procedură fiscală"),
        act("codul-procedura-penala", "Codul de procedură penală"),
        act("codul-procedura-civila", "Codul de procedură civilă"),
        act("codul-consumului", "Codul consumului"),
      ];
    });
    const html = await page("/?coduri=istorice");
    const grid = html.slice(html.indexOf('id="coduri"'));
    const names = [...grid.matchAll(/<a class="doc-link" href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Constituția",
      "Codul civil",
      "Codul de procedură civilă",
      "Codul penal",
      "Codul de procedură penală",
      "Codul fiscal",
      "Codul de procedură fiscală",
      "Codul muncii",
      "Codul administrativ",
      "Codul aerian",
      "Codul consumului",
      "Codul silvic",
      "Codul vamal",
      "Codul civil din 1864",
      "Codul comercial din 1887",
    ]);
  });

  it("prints no source notice, even when a source is unavailable", async () => {
    await patchManifest((manifest) => {
      manifest.status.official_sources = [
        {
          name: "Portal legislativ (legislatie.just.ro)",
          state: "unavailable",
          unavailable_since: "2026-11-08T08:52:13Z",
          last_successful_contact: "2026-11-08T08:52:10Z",
          as_of: "2026-11-08T08:56:56Z",
        },
      ];
    });
    const html = await page("/");
    expect(html).not.toContain("Sursa oficială");
    expect(html).not.toContain("nu răspunde");
  });

});
