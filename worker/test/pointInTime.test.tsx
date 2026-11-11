import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { today } from "../src/lib/dates";
import { createStore } from "../src/lib/store";
import type { Manifest } from "../src/lib/types";
import { replaceObject } from "./support";

const get = (path: string) => exports.default.fetch(`https://example.com${path}`, { redirect: "manual" });
const page = async (path: string) => (await get(path)).text();

const restores: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0)) await restore();
});

async function patchManifest(patch: (manifest: Manifest) => void): Promise<void> {
  const manifest = structuredClone(await createStore(env).manifest());
  patch(manifest);
  restores.push(await replaceObject("manifest.json", manifest));
}

const groupHeadings = (html: string) => [...html.matchAll(/<h2 id="acte-[^"]*">([^<]*)<\/h2>/g)].map((m) => m[1]);
const listedActs = (html: string) => [...html.matchAll(/class="doc-link" href="([^"]*)"/g)].map((m) => m[1]);

describe("point in time page", () => {
  it("sets the dated note and dated links", async () => {
    const html = await page("/legislatie/2019-01-01");
    expect(html).toContain('</nav><aside class="dated" aria-label="Important"><p>Citești legislația așa cum era la 01.01.2019. <a href="/">Înapoi la legislația de azi</a></p></aside></div><h1>Legislația la 01.01.2019</h1>');
    expect(html).toContain("01.01.2019");
    expect(html).toContain("Legislația la 01.01.2019");
    expect(html).toContain('href="/codul-civil/2019-01-01"');
    expect(html).toContain('href="/codul-procedura/2019-01-01"');
    expect(html).not.toContain("Înapoi la forma actuală");
  });

  it("lists the acts as a document list under breadcrumbs, with one primary button", async () => {
    const html = await page("/legislatie/2019-01-01");
    expect(html).toContain('<li><a href="/">Acasă</a></li><li aria-current="page">Legislația la 01.01.2019</li></ol>');
    expect(html).toContain('<ul class="doc-list grid">');
    expect(html).toContain(
      '<a class="doc-link" href="/codul-civil/2019-01-01">Codul civil</a><p class="doc-meta"><strong class="badge badge-green">În vigoare la 01.01.2019</strong></p>',
    );
    expect(html.match(/class="btn"/g)).toHaveLength(1);
  });

  it("explains the mode instead of repeating the note", async () => {
    const html = await page("/legislatie/2019-01-01");
    expect(html.match(/Citești legislația așa cum era la/g)).toHaveLength(1);
    expect(html).toContain("starea lui apare lângă nume");
  });

  it("offers a form to choose another date with a visible hint, and leaves the checking to the server", async () => {
    const html = await page("/legislatie/2019-01-01");
    expect(html).toContain('action="/legislatie"');
    expect(html).toMatch(/<form[^>]*action="\/legislatie"[^>]*novalidate/);
    expect(html).toMatch(/<input[^>]*type="text"[^>]*name="data"[^>]*value="01\.01\.2019"/);
    expect(html).toMatch(/<input class="date-picker" type="date" tabindex="-1" aria-hidden="true"\/?>/);
    expect(html).toContain('<label class="label" for="pit-date">Alege altă dată</label>');
    expect(html).toContain('<p class="hint" id="pit-date-hint">De exemplu, 13.03.2021</p>');
    expect(html).toMatch(/<input[^>]*id="pit-date"[^>]*aria-describedby="pit-date-hint"/);
    expect(html).not.toMatch(/<input[^>]*id="pit-date"[^>]*pattern=/);
  });

  it("redirects the form to the dated address", async () => {
    const res = await get("/legislatie?data=2020-02-29");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/legislatie/2020-02-29");
    const typed = await get("/legislatie?data=29.02.2020");
    expect(typed.headers.get("location")).toBe("/legislatie/2020-02-29");
  });

  it("shows today's page without the dated note and with the acts in their current form", async () => {
    const html = await page(`/legislatie/${today()}`);
    expect(html).not.toContain('class="dated"');
    expect(html).toContain('<a class="doc-link" href="/codul-civil">Codul civil</a>');
    expect(html).not.toContain(`href="/codul-civil/${today()}"`);
  });

  it("sends the earlier addresses to the new ones for good", async () => {
    const dated = await get("/la-data/2019-01-01");
    expect(dated.status).toBe(301);
    expect(dated.headers.get("location")).toBe("/legislatie/2019-01-01");
    const form = await get("/la-data?data=29.02.2020");
    expect(form.status).toBe(301);
    expect(form.headers.get("location")).toBe("/legislatie?data=29.02.2020");
  });

  it("sends a form without a date to today's page", async () => {
    for (const path of ["/legislatie", "/legislatie?data=", "/legislatie?data=%20"]) {
      const res = await get(path);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`/legislatie/${today()}`);
    }
  });

  it("refuses a typed date that is not a day with a 400, an error summary and the message beside the field", async () => {
    for (const typed of ["2020-02-30", "ieri", "31.02.2020"]) {
      const res = await get(`/legislatie?data=${encodeURIComponent(typed)}`);
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("<title>Eroare: Legislația la o dată | Textdelege</title>");
      expect(html).toContain("<h1>Legislația la o dată</h1>");
      expect(html).toContain(
        '<div class="error-summary" role="alert"><h2>Există o problemă</h2><ul><li><a href="#pit-date">Scrie o zi care există, de exemplu 13.03.2021</a></li></ul></div>',
      );
      expect(html.indexOf('class="error-summary"')).toBeLessThan(html.indexOf("<h1>"));
      expect(html).toContain(
        '<p class="error-message" id="pit-date-error"><span class="vh">Eroare: </span>Scrie o zi care există, de exemplu 13.03.2021</p>',
      );
      expect(html).toMatch(new RegExp(`<input[^>]*name="data"[^>]*value="${typed}"`));
      expect(html).toMatch(/<input[^>]*id="pit-date"[^>]*aria-invalid="true"/);
      expect(html).toContain('aria-describedby="pit-date-hint pit-date-error"');
      expect(html).not.toContain('class="dated"');
      expect(html).not.toContain("doc-list");
      expect(html).not.toContain("/codul-civil");
      expect(html).toContain('<meta name="robots" content="noindex"');
    }
  });

  it("shows no error on a dated page", async () => {
    const html = await page("/legislatie/2019-01-01");
    expect(html).not.toContain("pit-date-error");
    expect(html).not.toContain("error-summary");
  });

  it("shows acts that were not yet in force under their own heading and badge", async () => {
    const html = await page("/legislatie/2005-01-01");
    expect(groupHeadings(html)).toEqual(["Încă neintrate în vigoare"]);
    expect(html).toContain('<strong class="badge badge-yellow">Neintrat în vigoare la 01.01.2005</strong>');
    expect(html).not.toContain("badge-green");
  });

  it("groups the acts by their state on the day, each group in the order of the home page", async () => {
    await patchManifest((manifest) => {
      const model = manifest.acts[0]!;
      manifest.acts.push({ ...model, path: "lege/1999/1", alias: "zzz-veche", short: "Zzz veche", status: "repealed 2000-01-01", latest: "2000-01-01" });
      manifest.acts.push({ ...model, path: "lege/1998/1", alias: "aaa-veche", short: "Aaa veche", status: "repealed 1999-01-01", latest: "1999-01-01" });
      manifest.acts.reverse();
    });
    const html = await page("/legislatie/2019-01-01");
    expect(groupHeadings(html)).toEqual(["În vigoare la 01.01.2019", "Abrogate sau încetate la 01.01.2019"]);
    expect(listedActs(html)).toEqual([
      "/codul-civil/2019-01-01",
      "/codul-procedura/2019-01-01",
      "/aaa-veche/2019-01-01",
      "/zzz-veche/2019-01-01",
    ]);
    expect(html).toContain('<strong class="badge badge-grey">Abrogat până la 01.01.2019</strong>');
  });

  it("answers 404 for an invalid date", async () => {
    expect((await get("/legislatie/2019-02-30")).status).toBe(404);
    expect((await get("/legislatie/ieri")).status).toBe(404);
  });
});
