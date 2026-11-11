import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/lib/store";
import type { LawObject } from "../src/lib/types";
import { replaceObject } from "./support";

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string) => (await get(path)).text();

describe("amending act page", () => {
  it("lists changes with compare links", async () => {
    const res = await get("/lege/2023/200");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Legea nr. 200/2023");
    expect(html).toContain("Modificări aduse");
    expect(html).toContain("Codul civil");
    expect(html).toContain('href="/codul-civil/art-1/2023-07-09"');
    expect(html).toContain('href="/codul-civil/art-1/compara/2023-07-08..2023-07-09"');
    expect(html).toContain("Modificat");
    expect(html).toContain("alin. (1)");
  });

  it("links the official portal when the data names no page for the act", async () => {
    const html = await page("/lege/2011/71");
    expect(html).toContain('<a href="https://legislatie.just.ro/">legislatie.just.ro</a>');
  });

  it("has breadcrumbs, a citation panel and the official source in a rail", async () => {
    const html = await page("/lege/2011/71");
    expect(html).toContain(
      '<ol><li><a href="/">Acasă</a></li><li><a href="/modificari">Modificări</a></li></ol>',
    );
    const rail = html.slice(html.indexOf('<aside class="rail">'));
    expect(rail).toContain("<h2>Citare</h2>");
    expect(rail).toContain("textdelege.ro/lege/2011/71");
    expect(rail).toContain(
      '<span class="addr"><span class="vh">Adresa permanentă: </span>textdelege.ro/lege/2011/71</span>',
    );
    expect(rail).toContain(
      'Copiază citarea</button><span class="copied" role="status"></span><button class="btn secondary" type="button" data-copy="https://textdelege.ro/lege/2011/71" data-copied="Copiat" data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o.">Copiază linkul</button><span class="copied" role="status"></span></p>',
    );
    expect(rail).toContain("<h2>Sursa oficială</h2>");
    expect(rail).toContain('<a href="https://legislatie.just.ro/">legislatie.just.ro</a>');
    expect(rail).toContain("Textul acestui act nu este reprodus aici.");
    expect(html).not.toContain('class="src"');
    expect(html.match(/class="btn"/g)).toHaveLength(1);
  });

  it("shows the dates of the law", async () => {
    const html = await page("/lege/2023/200");
    expect(html).toContain("06.07.2023");
    expect(html).toContain("05.07.2023");
    expect(html).toContain("09.07.2023");
  });

  it("links the dated article instead of a comparison for entered articles", async () => {
    const html = await page("/lege/2011/71");
    expect(html).toContain('href="/codul-civil/art-2/2011-10-01"');
    expect(html).not.toContain("/art-2/compara/");
    expect(html).toContain("Codul de procedura");
  });

  it("heads the action column Text and offers the text when there is no comparison", async () => {
    const html = await page("/lege/2011/71");
    expect(html).toContain('<th scope="col">Text</th>');
    expect(html).not.toContain("Comparație");
    expect(html).toContain('<a href="/codul-civil/art-2/2011-10-01">Vezi textul</a>');
    expect(html).not.toContain(">Deschide<");
    const compared = await page("/lege/2023/200");
    expect(compared).toContain('>Compară</a>');
  });

  it("summarises what the law changed, by act and by kind of change", async () => {
    const html = await page("/lege/2011/71");
    expect(html).toContain("A modificat 3 articole în 2 acte.");
    expect(html).toContain('<th scope="col">Total</th>');
    expect(html).toContain('<td data-label="Actul">Codul civil</td>');
    expect(html).toContain('<td data-label="Total">2</td>');
    expect(html).toContain('<td data-label="Total">1</td>');
    expect(html).toContain("(2 articole)");
    expect(html).not.toContain("page-numbers");
    expect(html).not.toContain("Modificările 1–");
  });

  describe("with many changes", () => {
    const restores: (() => Promise<void>)[] = [];
    const fresh = { headers: { "Cache-Control": "no-cache" } };
    const page = async (path: string) => (await get(path, fresh)).text();
    afterEach(async () => {
      for (const restore of restores.splice(0).reverse()) await restore();
      await get("/lege/2011/71", fresh);
    });

    const pad = (n: number) => String(n).padStart(4, "0");

    async function patchLaw(patch: (law: LawObject) => void) {
      const law = structuredClone((await createStore(env).law("legea-71-2011"))!);
      patch(law);
      restores.push(await replaceObject("laws/legea-71-2011.json", law));
    }

    const many = (law: LawObject) => {
      law.changes = [];
      for (let i = 1; i <= 150; i++) {
        law.changes.push({ act_path: "lege/2009/287", file: `art-${pad(i)}`, number: String(i), verb: "modified", units: [], date: "2011-10-01" });
      }
      for (let i = 1; i <= 20; i++) {
        law.changes.push({ act_path: "lege/2009/287", file: `art-${pad(i)}`, number: String(i), verb: "repealed", units: [], date: "2013-10-01" });
      }
      for (let i = 1; i <= 80; i++) {
        law.changes.push({ act_path: "lege/2010/134", file: `art-${pad(i)}`, number: String(i), verb: "entered", units: [], date: "2011-10-01" });
      }
    };

    it("counts articles, not rows, in the summary and the table", async () => {
      await patchLaw(many);
      const html = await page("/lege/2011/71");
      expect(html).toContain("A modificat 230 de articole în 2 acte.");
      expect(html).toContain('<td data-label="Actul">Codul civil</td>');
      expect(html).toContain('<td data-label="Total">150</td>');
      expect(html).toContain('<td data-label="Total">80</td>');
      expect(html).toContain("(150 de articole)");
    });

    it("pages the rows by a hundred, grouped by act within each page, with numbered addresses", async () => {
      await patchLaw(many);
      const first = await page("/lege/2011/71");
      expect(first).toContain('<span class="count">Modificările 1–100 din 250</span>');
      expect(first.match(/<tbody>/g)).toHaveLength(2);
      expect(first.match(/Vezi textul|Compară/g)).toHaveLength(100);
      expect(first).toContain('<nav class="page-numbers" aria-label="Paginile listei">');
      expect(first).toContain('<span class="page-current" aria-label="Pagina 1" aria-current="page">1</span>');
      expect(first).toContain('<a href="/lege/2011/71?pagina=3" aria-label="Pagina 3">3</a>');
      expect(first).not.toContain("/codul-procedura/art-");

      const second = await page("/lege/2011/71?pagina=2");
      expect(second).toContain('<span class="count">Modificările 101–200 din 250</span>');
      expect(second.match(/<h3>/g)).toHaveLength(2);
      expect(second).toContain("(150 de articole)");
      expect(second).toContain("(80 de articole)");
      expect(second).toContain('href="https://textdelege.ro/lege/2011/71?pagina=2"');
      expect(second).toContain('<a href="/lege/2011/71" rel="prev">');
      expect(second).toContain('<a href="/lege/2011/71?pagina=3" rel="next">');

      const third = await page("/lege/2011/71?pagina=3");
      expect(third).toContain('<span class="count">Modificările 201–250 din 250</span>');
      expect(third.match(/<h3>/g)).toHaveLength(1);
      expect(third).not.toContain('rel="next"');
    });

    it("shows the last page for a page past the end and the first for a page that is not a number", async () => {
      await patchLaw(many);
      expect(await page("/lege/2011/71?pagina=99")).toContain("Modificările 201–250 din 250");
      expect(await page("/lege/2011/71?pagina=abc")).toContain("Modificările 1–100 din 250");
    });

    it("shows one effective date plainly and several as a range with the full list", async () => {
      await patchLaw((law) => {
        law.in_force = ["2011-10-01"];
      });
      const one = await page("/lege/2011/71");
      expect(one).toContain('<dd class="summary-value">01.10.2011</dd>');
      expect(one).not.toContain("<details>");

      await patchLaw((law) => {
        law.in_force = ["2013-10-01", "2011-10-01", "2012-12-08"];
      });
      const several = await page("/lege/2011/71");
      expect(several).toContain("01.10.2011 – 01.10.2013 (3 date)");
      expect(several).toContain(
        "<details><summary>Toate datele</summary><ul class=\"plain\"><li>01.10.2011</li><li>08.12.2012</li><li>01.10.2013</li></ul></details>",
      );
    });

    it("shows the Monitorul Oficial reference when the data has one and none when it has not", async () => {
      const without = await page("/lege/2011/71");
      expect(without).not.toContain("<dt class=\"summary-key\">Monitorul Oficial</dt>");
      await patchLaw((law) => {
        law.mo = "nr. 505 din 15.07.2011";
      });
      const html = await page("/lege/2011/71");
      expect(html).toContain('<dt class="summary-key">Monitorul Oficial</dt><dd class="summary-value"><span lang="ro">nr. 505 din 15.07.2011</span></dd>');
    });
  });

  it("serves a selected act with its act page", async () => {
    const html = await page("/lege/2009/287");
    expect(html).toContain("Codul civil");
    expect(html).not.toContain("Modificări aduse");
    expect(html).toContain('aria-label="Secțiunile actului"');
  });

  it("answers 404 for an unknown law", async () => {
    expect((await get("/lege/2099/1")).status).toBe(404);
    expect((await get("/oug/2020/5")).status).toBe(404);
    expect((await get("/lege/2023/200/istoric")).status).toBe(404);
  });

});
