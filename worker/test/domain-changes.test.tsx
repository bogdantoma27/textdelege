import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/lib/store";
import type { ActIndexEntry, ChangeItem } from "../src/lib/types";
import { env } from "cloudflare:test";
import { putActs, replaceObject } from "./support";

const get = (path: string) => exports.default.fetch(`https://example.com${path}`, { redirect: "manual" });

const restores: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0)) await restore();
});

const item = (extra: Partial<ChangeItem>): ChangeItem => ({
  date: "2026-03-05",
  act_path: "lege/2015/227",
  file: "art-0001",
  number: "1",
  title: "Definiții",
  verb: "modified",
  units: ["alin-2"],
  law: { key: "legea-10-2026", label: "Legea nr. 10/2026" },
  ...extra,
});

async function seed(items: ChangeItem[], path = "lege/2015/227") {
  const store = createStore(env);
  if (!(await store.actsByPath([path])).has(path)) {
    const act: ActIndexEntry = {
      path,
      alias: path === "lege/2015/227" ? "codul-fiscal" : null,
      title: "Legea nr. 227/2015",
      short: path === "lege/2015/227" ? "Codul fiscal" : null,
      kind: "lege",
      status: "in force",
      from: "2016-01-01",
      latest: "2026-03-05",
      articles: 1,
    };
    restores.push(await putActs([act]));
  }
  restores.push(
    await replaceObject(`changes/acts/${path}.json`, {
      schema: "textdelege/changes/1",
      scope: path,
      items,
      upcoming: [],
    }),
  );
}

describe("domain change pages", () => {
  it("renders the changes of a month, with the amending act and links", async () => {
    await seed([
      item({}),
      item({ file: "art-0002", number: "2", title: null, law: { key: "unnamed-xyz", label: "Lexifina 7" }, verb: "repealed", units: [] }),
      item({ date: "2026-02-01", file: "art-0003", number: "3" }),
    ]);
    const response = await get("/ce-s-a-schimbat/fiscal/2026/03");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<h1>Ce s-a schimbat în legislația fiscală în martie 2026</h1>");
    expect(html).toContain('content="Modificările din legislația fiscală intrate în vigoare în martie 2026: 2 modificări, în 1 act."');
    expect(html).toContain('rel="canonical" href="https://textdelege.ro/ce-s-a-schimbat/fiscal/2026/03"');
    expect(html).toContain('href="/codul-fiscal/art-1/2026-03-05"');
    expect(html).toContain('href="/codul-fiscal/art-2/2026-03-05"');
    expect(html).not.toContain("/art-3/");
    expect(html).toContain("Legea nr. 10/2026");
    expect(html).toContain("act nemenționat de sursă");
    expect(html).not.toContain("Lexifina");
    expect(html).toContain('href="/ce-s-a-schimbat/fiscal/2026/02"');
  });

  it("answers 404 for a month without changes and for unknown domains or dates", async () => {
    await seed([item({})]);
    for (const path of [
      "/ce-s-a-schimbat/fiscal/2026/04",
      "/ce-s-a-schimbat/fiscal/2026/13",
      "/ce-s-a-schimbat/fiscal/2026",
      "/ce-s-a-schimbat/necunoscut",
      "/ce-s-a-schimbat/munca",
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("links only to neighbouring months that have changes", async () => {
    await seed([item({ date: "2026-05-01" }), item({ date: "2026-03-05", file: "art-0002", number: "2" })]);
    const html = await (await get("/ce-s-a-schimbat/fiscal/2026/05")).text();
    expect(html).toContain('rel="prev" href="/ce-s-a-schimbat/fiscal/2026/03"');
    expect(html).not.toContain("2026/04");
    expect(html).not.toContain('rel="next"');
  });

  it("leaves out the oldest month of a full window", async () => {
    const many = Array.from({ length: 100 }, (_, n) =>
      item({ date: n < 50 ? "2026-04-01" : "2026-03-01", file: `art-${n}`, number: String(n + 1) }),
    );
    await seed(many);
    expect((await get("/ce-s-a-schimbat/fiscal/2026/04")).status).toBe(200);
    expect((await get("/ce-s-a-schimbat/fiscal/2026/03")).status).toBe(404);
  });

  it("lists the months of a domain and the latest on the index", async () => {
    await seed([item({}), item({ date: "2026-02-01", file: "art-0003", number: "3" })]);
    const domain = await (await get("/ce-s-a-schimbat/fiscal")).text();
    expect(domain).toContain("<h1>Ce s-a schimbat în legislația fiscală</h1>");
    expect(domain.indexOf("martie 2026")).toBeLessThan(domain.indexOf("februarie 2026"));
    expect(domain).toContain("1 modificare");
    const index = await (await get("/ce-s-a-schimbat")).text();
    expect(index).toContain('href="/ce-s-a-schimbat/fiscal/2026/03"');
    expect(index).toContain("Muncă");
  });

  it("puts the index, domain and month pages in the sitemap", async () => {
    await seed([item({})]);
    const xml = await (await get("/sitemap-1.xml")).text();
    for (const path of ["/ce-s-a-schimbat", "/ce-s-a-schimbat/fiscal", "/ce-s-a-schimbat/fiscal/2026/03"]) {
      expect(xml).toContain(`<loc>https://textdelege.ro${path}</loc>`);
    }
    expect(xml).not.toContain("/ce-s-a-schimbat/munca");
  });
});
