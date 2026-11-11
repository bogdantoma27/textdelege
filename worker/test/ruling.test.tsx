import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/lib/store";
import type { RulingObject } from "../src/lib/types";
import { replaceObject } from "./support";

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`https://example.com${path}`, { redirect: "manual", ...init });
const page = async (path: string, init?: RequestInit) => (await get(path, init)).text();

const restores: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0)) await restore();
});

async function putRuling(key: string, patch: Partial<RulingObject>): Promise<void> {
  const store = createStore(env);
  const base = (await store.ruling("dcc-1-2019"))!;
  restores.push(await replaceObject(`rulings/${key}.json`, { ...base, key, ...patch }));
}

describe("ruling page", () => {
  it("sets noindex and lists affected articles", async () => {
    const res = await get("/jurisprudenta/ccr/2019/1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain("<h1");
    expect(html).toContain("CCR 1/2019");
    expect(html).toContain("Curtea Constituțională");
    expect(html).toContain("Articole vizate");
    expect(html).toContain("Monitorul Oficial");
    expect(html).toContain("Partea 1, nr. 250 din 01.03.2020");
    expect(html).toContain("123D/2019");
    expect(html).toContain("01.02.2019");
    expect(html).toContain("admis");
    expect(html).toContain("Neconstituționalitate constatată");
  });

  it("links each affected article on the binding date", async () => {
    const html = await page("/jurisprudenta/ccr/2019/1");
    expect(html).toContain('href="/codul-civil/art-1/2020-03-01"');
  });

  it("names the outcome in words and keeps an unknown one as it is", async () => {
    const fresh = { headers: { "Cache-Control": "no-cache" } };
    await putRuling("dcc-1-2019", { outcome: "rejected" });
    expect(await page("/jurisprudenta/ccr/2019/1", fresh)).toContain("Respinsă");
    await putRuling("dcc-1-2019", { outcome: "other" });
    expect(await page("/jurisprudenta/ccr/2019/1", fresh)).toContain("Altă soluție");
    await putRuling("dcc-1-2019", { outcome: "admitted" });
    expect(await page("/jurisprudenta/ccr/2019/1", fresh)).toContain("Admisă");
  });

  it("renders the operative part as paragraphs, as written, and the text in details", async () => {
    const html = await page("/jurisprudenta/ccr/2019/1");
    expect(html).not.toContain(`<ol class="law"`);
    expect(html).toContain('<div class="law" lang="ro"><p>Admite excepția de neconstituționalitate.</p><p>Constată că art. 1112 este neconstituțional.</p></div>');
    expect(html).toContain("Textul deciziei");
    expect(html).toContain('<details class="details ruling-text">');
    expect(html).toContain('lang="ro"');
    expect(html).toContain("DECIZIA nr. 1 din 2019");
  });

  it("keeps the numbers of the operative part as the decision wrote them and adds none", async () => {
    await putRuling("dcc-1-2019", {
      heading: "DECIZIE nr. 405 din 15 iunie 2016",
      operative: [
        "1. Admite excepția. 2. Respinge, ca neîntemeiată, restul.",
        "Definitivă și general obligatorie.",
        "Decizia se comunică Parlamentului.",
      ],
      text: "# DECIZIE nr. 405 din 15 iunie 2016\nreferitoare la art. 246\nAugustin Zegrean - președinte",
    });
    const html = await page("/jurisprudenta/ccr/2019/1", { headers: { "Cache-Control": "no-cache" } });
    const operative = /<section aria-labelledby="dispozitiv">([^]*?)<\/section>/.exec(html)![1]!;
    expect(operative).not.toMatch(/<(ol|ul|li)\b/);
    expect(operative).toContain("<p>1. Admite excepția. 2. Respinge, ca neîntemeiată, restul.</p><p>Definitivă și general obligatorie.</p><p>Decizia se comunică Parlamentului.</p>");
  });

  it("leaves out a markdown heading that repeats the page heading and sets another one as a heading", async () => {
    await putRuling("dcc-1-2019", {
      heading: "DECIZIA nr. 25 din 20 mai 2024",
      text: "# DECIZIA nr. 25 din 20 mai 2024\nreferitoare la interpretare\n## COMPLETUL PENTRU DEZLEGAREA UNOR CHESTIUNI DE DREPT\nDosar nr. 542/1/2024",
    });
    const html = await page("/jurisprudenta/ccr/2019/1", { headers: { "Cache-Control": "no-cache" } });
    const text = /<details class="details ruling-text">([^]*?)<\/details>/.exec(html)![1]!;
    expect(text).not.toContain("#");
    expect(text).not.toContain("<h3>DECIZIA nr. 25");
    expect(text).toContain("<p>referitoare la interpretare</p>");
    expect(text).toContain("<h3>COMPLETUL PENTRU DEZLEGAREA UNOR CHESTIUNI DE DREPT</h3>");
    expect(text).toContain("<p>Dosar nr. 542/1/2024</p>");
  });

  it("has the citation and the official source in the right rail", async () => {
    const html = await page("/jurisprudenta/ccr/2019/1");
    expect(html).toContain("Citare");
    expect(html).toContain("textdelege.ro/jurisprudenta/ccr/2019/1");
    expect(html).toContain("Sursa oficială");
    expect(html).toContain('href="https://example.invalid/1"');
  });

  it("leaves the source panel out when the record names no official page", async () => {
    await putRuling("dcc-1-2019", { source: null });
    const html = await page("/jurisprudenta/ccr/2019/1");
    expect(html).toContain("Citare");
    expect(html).not.toContain("Sursa oficială");
  });

  it("leads with breadcrumbs to the act and offers the permanent link as the secondary button", async () => {
    const html = await page("/jurisprudenta/ccr/2019/1");
    expect(html).toContain(
      '<nav class="crumbs" aria-label="Cale de navigare"><ol><li><a href="/">Acasă</a></li><li><a href="/codul-civil">Codul civil</a></li></ol></nav>',
    );
    expect(html).toContain(
      '<div class="cite">CCR 1/2019<span class="addr"><span class="vh">Adresa permanentă: </span>textdelege.ro/jurisprudenta/ccr/2019/1</span></div>',
    );
    expect(html).toContain(
      'data-copy="CCR 1/2019\nhttps://textdelege.ro/jurisprudenta/ccr/2019/1"',
    );
    expect(html).toContain(
      'Copiază citarea</button><span class="copied" role="status"></span><button class="btn secondary" type="button" data-copy="https://textdelege.ro/jurisprudenta/ccr/2019/1" data-copied="Copiat" data-failed="Nu s-a putut copia. Selectează adresa și copiaz-o.">Copiază linkul</button><span class="copied" role="status"></span></p>',
    );
    expect(html.match(/class="btn"/g)).toHaveLength(1);
    await putRuling("dcc-6-2019", { articles: [] });
    const bare = await page("/jurisprudenta/ccr/2019/6");
    expect(bare).toContain('<ol><li><a href="/">Acasă</a></li></ol>');
  });

  it("omits the text block when the decision has no text", async () => {
    await putRuling("dcc-2-2019", { text: null });
    const html = await page("/jurisprudenta/ccr/2019/2");
    expect(html).not.toContain('class="ruling-text"');
    expect(html).not.toContain("Textul deciziei");
  });

  it("escapes the text of the decision", async () => {
    await putRuling("dcc-3-2019", { text: "<script>alert(1)</script>\nal doilea" });
    const html = await page("/jurisprudenta/ccr/2019/3");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)");
  });

  it("serves ICCJ decisions of the HP and RIL panels", async () => {
    const iccj = { court: "iccj", court_name: "Înalta Curte de Casație și Justiție", finds_unconstitutional: false };
    await putRuling("iccj-hp-4-2019", { ...iccj, label: "ICCJ HP 4/2019", binding_from: null });
    await putRuling("iccj-ril-12-2020", { ...iccj, label: "ICCJ RIL 12/2020" });
    const hp = await get("/jurisprudenta/iccj/hp/2019/4");
    expect(hp.status).toBe(200);
    const hpHtml = await hp.text();
    expect(hpHtml).toContain("ICCJ HP 4/2019");
    expect(hpHtml).not.toContain("Neconstituționalitate constatată");
    expect(hpHtml).toContain('href="/codul-civil/art-1"');
    const ril = await get("/jurisprudenta/iccj/ril/2020/12");
    expect(ril.status).toBe(200);
    expect(await ril.text()).toContain("ICCJ RIL 12/2020");
  });

  it("skips affected articles that the act does not list", async () => {
    await putRuling("dcc-5-2019", {
      articles: [
        { act_path: "lege/2009/287", file: "art-9999" },
        { act_path: "lege/2009/287", file: "art-0002" },
      ],
    });
    const html = await page("/jurisprudenta/ccr/2019/5");
    expect(html).toContain('href="/codul-civil/art-2/2020-03-01"');
    expect(html).not.toContain("9999");
  });

  it("answers 404 for an unknown decision", async () => {
    expect((await get("/jurisprudenta/ccr/2019/999")).status).toBe(404);
    expect((await get("/jurisprudenta/iccj/hp/2019/999")).status).toBe(404);
  });

});
