import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { SITEMAP_SIZE } from "../src/routes/site";
import { removeObject, replaceObject } from "./support";

const get = (path: string) => exports.default.fetch(`https://example.com${path}`, { redirect: "manual" });
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);

describe("robots.txt", () => {
  it("allows the site, keeps search and comparisons out and names the sitemap", async () => {
    const response = await get("/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(
      "User-agent: *\nAllow: /\nDisallow: /cauta\nDisallow: /*/compara/\n\nSitemap: https://textdelege.ro/sitemap.xml\n",
    );
  });
});

describe("sitemaps", () => {
  it("lists one child for the fixture", async () => {
    const response = await get("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const xml = await response.text();
    expect(xml).toContain("<sitemapindex");
    expect(locs(xml)).toEqual(["https://textdelege.ro/sitemap-1.xml"]);
  });

  it("lists the fixed pages, then each act with its articles, with last modification dates", async () => {
    const response = await get("/sitemap-1.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const xml = await response.text();
    expect(xml).toContain("<urlset");
    expect(locs(xml)).toEqual([
      "https://textdelege.ro/",
      "https://textdelege.ro/modificari",
      "https://textdelege.ro/acte",
      "https://textdelege.ro/despre",
      "https://textdelege.ro/legenda",
      "https://textdelege.ro/legislatie",
      "https://textdelege.ro/codul-civil",
      "https://textdelege.ro/codul-civil/art-1",
      "https://textdelege.ro/codul-civil/art-2",
      "https://textdelege.ro/codul-procedura",
      "https://textdelege.ro/codul-procedura/art-1",
    ]);
    expect(xml).toContain("<url><loc>https://textdelege.ro/</loc></url>");
    expect(xml).toContain("<url><loc>https://textdelege.ro/codul-civil</loc><lastmod>2023-07-09</lastmod></url>");
    expect(xml).toContain("<url><loc>https://textdelege.ro/codul-civil/art-1</loc><lastmod>2023-07-09</lastmod></url>");
    expect(xml).toContain("<url><loc>https://textdelege.ro/codul-civil/art-2</loc><lastmod>2011-10-01</lastmod></url>");
    expect(xml).not.toContain("/compara/");
    expect(xml).not.toContain("/jurisprudenta/");
    expect(xml).not.toMatch(/\d{4}-\d{2}-\d{2}<\/loc>/);
    expect(xml).not.toContain("/cauta");
  });

  it("holds at most 50,000 entries per child", () => {
    expect(SITEMAP_SIZE).toBe(50000);
  });

  it("answers 404 for a child that does not exist", async () => {
    for (const path of ["/sitemap-2.xml", "/sitemap-0.xml", "/sitemap-x.xml"]) {
      expect((await get(path)).status).toBe(404);
    }
  });

  it("stores the sitemap in the page cache", async () => {
    const first = await get("/sitemap.xml");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=604800");
    await first.text();
  });
});

describe("sitemaps from the build", () => {
  const withoutDatabase = async (path: string) => {
    const broken = new Proxy(env.DB, {
      get(target, property) {
        if (property !== "prepare") return Reflect.get(target, property, target);
        return () => {
          throw new Error("D1_ERROR: the sitemap must not touch D1");
        };
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    return app.fetch(new Request(`https://example.com${path}`), { ...env, DB: broken }, context);
  };

  it("serves the index and the children from the R2 objects, without D1", async () => {
    const index = await withoutDatabase("/sitemap.xml");
    expect(index.status).toBe(200);
    expect(locs(await index.text())).toEqual(["https://textdelege.ro/sitemap-1.xml"]);
    const child = await withoutDatabase("/sitemap-1.xml");
    expect(child.status).toBe(200);
    const xml = await child.text();
    expect(locs(xml)).toHaveLength(11);
    expect(xml).toContain("<url><loc>https://textdelege.ro/codul-civil/art-1</loc><lastmod>2023-07-09</lastmod></url>");
  });

  it("checks the number of a child against the index without running a query", async () => {
    const restore = await replaceObject("sitemaps/index.json", { schema: "textdelege/sitemap-index/1", pages: 2, total: 60000 });
    try {
      expect(locs(await (await withoutDatabase("/sitemap.xml")).text())).toEqual([
        "https://textdelege.ro/sitemap-1.xml",
        "https://textdelege.ro/sitemap-2.xml",
      ]);
      expect((await withoutDatabase("/sitemap-3.xml")).status).toBe(404);
      expect((await withoutDatabase("/sitemap-999.xml")).status).toBe(404);
      // page 2 is listed but missing from R2
      expect((await withoutDatabase("/sitemap-2.xml")).status).toBe(404);
    } finally {
      await restore();
    }
  });

  it("falls back to the D1 query while the published data has no sitemap objects", async () => {
    const before = await (await get("/sitemap-1.xml")).text();
    const restore = await removeObject("sitemaps/index.json");
    try {
      expect(locs(await (await get("/sitemap.xml")).text())).toEqual(["https://textdelege.ro/sitemap-1.xml"]);
      const legacy = await (await get("/sitemap-1.xml")).text();
      expect(legacy).toBe(before);
      expect((await get("/sitemap-2.xml")).status).toBe(404);
    } finally {
      await restore();
    }
  });
});

