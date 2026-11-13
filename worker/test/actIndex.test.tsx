import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { createStore } from "../src/lib/store";
import type { ActIndexEntry } from "../src/lib/types";
import { removeObject, replaceObject } from "./support";

const get = (path: string) => exports.default.fetch(`https://example.com${path}`, { redirect: "manual" });
const page = async (path: string) => (await get(path)).text();

const restores: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0)) await restore();
});

const entry = (path: string, kind: string, extra: Partial<ActIndexEntry> = {}): ActIndexEntry => ({
  path,
  alias: null,
  title: `Act ${path}`,
  short: null,
  kind,
  status: "in force",
  from: "1990-01-01",
  latest: "1990-01-01",
  articles: 1,
  ...extra,
});

const OUG_COUNT = 120;

async function withIndex(extra: ActIndexEntry[]): Promise<void> {
  const acts = await createStore(env).actIndex();
  restores.push(await replaceObject("acts/index.json", { schema: "textdelege/act-index/1", acts: [...acts, ...extra] }));
}

const others = [
  entry("lege/1990/31", "lege", { title: "Legea nr. 31/1990", from: "1991-01-01" }),
  entry("decret-lege/1938/115", "decret-lege", { title: "Decretul-lege nr. 115/1938", from: "1938-01-01" }),
  ...Array.from({ length: OUG_COUNT }, (_, i) =>
    entry(`oug/2002/${i + 1}`, "oug", { title: `Ordonanța de urgență nr. ${i + 1}/2002`, from: "2002-06-01" }),
  ),
];

function countingEnv() {
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
  return { reads, env: { ...env, DATA: data } as typeof env };
}

const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

describe("store.actIndex", () => {
  it("reads the index object once per store", async () => {
    const { reads, env: counted } = countingEnv();
    const store = createStore(counted);
    const [first, second] = await Promise.all([store.actIndex(), store.actIndex()]);
    expect(first).toBe(second);
    expect(reads.filter((key) => key === "acts/index.json")).toHaveLength(1);
    expect(first.map((act) => act.path)).toContain("lege/2009/287");
  });

  it("falls back to the acts of the manifest when the index object is missing", async () => {
    restores.push(await removeObject("acts/index.json"));
    const store = createStore(env);
    const manifest = await store.manifest();
    const index = await store.actIndex();
    expect(index.map((act) => act.path)).toEqual(manifest.acts.map((act) => act.path));
    expect(index[0]).toMatchObject({ kind: "lege", alias: manifest.acts[0]!.alias, title: manifest.acts[0]!.title });
    expect(await store.resolveAlias("codul-civil")).toBe("lege/2009/287");
  });

  it("is read once for a whole page request", async () => {
    const { reads, env: counted } = countingEnv();
    const response = await app.fetch(new Request("https://example.com/legislatie/2019-01-01?once=1"), counted, context);
    expect(response.status).toBe(200);
    expect(reads.filter((key) => key === "acts/index.json")).toHaveLength(1);
    expect(reads.filter((key) => key === "manifest.json")).toHaveLength(1);
  });
});

describe("point in time page with other acts", () => {
  it("reads no act.json for the listed acts", async () => {
    await withIndex(others);
    const { reads, env: counted } = countingEnv();
    const response = await app.fetch(new Request("https://example.com/legislatie/2019-01-01?once=2"), counted, context);
    expect(response.status).toBe(200);
    expect(reads.filter((key) => key.endsWith("/act.json"))).toEqual([]);
  });

  it("lists the other acts of the first kind after the featured acts", async () => {
    await withIndex(others);
    const html = await page("/legislatie/2019-01-01");
    expect(html).toContain('<h2 id="acte-alte">Alte acte</h2>');
    expect(html.indexOf('id="acte-in-force"')).toBeLessThan(html.indexOf('id="acte-alte"'));
    expect(html).toContain('<span aria-current="page">Legi (1)</span>');
    expect(html).toContain('<a href="/legislatie/2019-01-01?tip=oug">Ordonanțe de urgență (120)</a>');
    expect(html).toContain('href="/lege/1990/31/2019-01-01"');
  });

  it("paginates the chosen kind in pages of fifty", async () => {
    await withIndex(others);
    const first = await page("/legislatie/2019-01-01?tip=oug");
    expect(first.match(/class="doc-link" href="\/oug\//g)).toHaveLength(50);
    expect(first).toContain('href="/oug/2002/120/2019-01-01"');
    expect(first).toContain('href="/legislatie/2019-01-01?tip=oug&amp;pagina=2"');
    const last = await page("/legislatie/2019-01-01?tip=oug&pagina=3");
    expect(last.match(/class="doc-link" href="\/oug\//g)).toHaveLength(20);
    expect(last).toContain('<span class="page-current"');
    const clamped = await page("/legislatie/2019-01-01?tip=oug&pagina=99");
    expect(clamped.match(/class="doc-link" href="\/oug\//g)).toHaveLength(20);
  });

  it("falls back to the first kind for an unknown kind and shows the state at the date", async () => {
    await withIndex(others);
    const html = await page("/legislatie/1950-01-01?tip=nimic");
    expect(html).toContain('<span aria-current="page">Legi (1)</span>');
    expect(html).toContain("Neintrat în vigoare la 01.01.1950");
  });

  it("shows no section for other acts when the index holds only featured acts", async () => {
    const html = await page("/legislatie/2019-01-01");
    expect(html).not.toContain("acte-alte");
    expect(html).not.toContain("page-numbers");
  });
});

describe("Alt act field on the changes page", () => {
  it("offers the field next to the select of featured acts", async () => {
    await withIndex(others);
    const html = await page("/modificari");
    expect(html).toContain('<label class="label" for="filter-alt">Alt act</label>');
    expect(html).toMatch(/<input[^>]*type="text"[^>]*name="alt"/);
    expect(html.indexOf('name="alt"')).toBeLessThan(html.indexOf('id="filter-alt-hint"'));
    expect(html).toMatch(/<input[^>]*id="filter-alt"[^>]*aria-describedby="filter-alt-hint"/);
    expect(html).not.toContain("Legea nr. 31/1990</option>");
  });

  it("sends a known citation to the changes of that act, keeping the other filters", async () => {
    await withIndex(others);
    const response = await get("/modificari?alt=Legea%2031%2F1990&verb=modified");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/modificari/lege/1990/31?verb=modified");
    const decree = await get("/modificari?alt=Decretul-lege%20115%2F1938");
    expect(decree.headers.get("location")).toBe("/modificari/decret-lege/1938/115");
  });

  it("finds a featured act by its citation too", async () => {
    const response = await get("/modificari?alt=Codul%20civil");
    expect(response.headers.get("location")).toBe("/modificari/codul-civil");
  });

  it("shows an error near the field and applies no filter for an unknown act", async () => {
    await withIndex(others);
    const response = await get("/modificari?alt=Legea%20999%2F1999");
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("Nu am găsit în date actul „Legea 999/1999”.");
    expect(html).toContain('id="filter-alt-error"');
    expect(html).toContain('value="Legea 999/1999"');
    expect(await page("/modificari?alt=ceva%20oarecare")).toContain('id="filter-alt-error"');
  });

  it("ignores an empty field", async () => {
    expect((await get("/modificari?alt=%20")).status).toBe(200);
  });

  it("accepts an act that is not featured in the act parameter", async () => {
    await withIndex(others);
    const response = await get("/modificari?act=lege/1990/31");
    expect(response.headers.get("location")).toBe("/modificari/lege/1990/31");
  });
});

describe("search with acts outside the manifest", () => {
  it("sends a citation of an indexed act to its page", async () => {
    await withIndex(others);
    const response = await get("/cauta?q=D.-L.%20115%2F1938");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/decret-lege/1938/115");
  });
});
