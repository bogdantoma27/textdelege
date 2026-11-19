import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createStore } from "../src/lib/store";
import type { ActObject, ArticleObject } from "../src/lib/types";
import { renderAct } from "../src/views/act";
import { renderArticle } from "../src/views/article";

const NOW = "2026-11-08";
const articleCtx = { now: NOW, attribution: true, highlightLast: false, filter: "" };
const actCtx = { now: NOW, date: null, filter: "", page: null };

let act: ActObject;
let one: ArticleObject;

beforeAll(async () => {
  const store = createStore(env);
  act = (await store.act("lege/2009/287"))!;
  one = (await store.article("lege/2009/287", "art-0001"))!;
});

const meta = (html: string, attr: "name" | "property", key: string) =>
  new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html)?.[1];
const jsonLd = (html: string) => {
  const body = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1];
  expect(body).toBeDefined();
  return JSON.parse(body!);
};
const withText = (text: string): ArticleObject => {
  const copy = structuredClone(one);
  const last = copy.versions[copy.versions.length - 1]!;
  last.lines = [{ ...last.lines[0]!, text }];
  return copy;
};

describe("article page head", () => {
  let html = "";
  beforeAll(() => {
    html = String(renderArticle(articleCtx, act, one, null));
  });

  it("has the open graph and twitter tags", () => {
    expect(meta(html, "property", "og:site_name")).toBe("Textdelege");
    expect(meta(html, "property", "og:locale")).toBe("ro_RO");
    expect(meta(html, "property", "og:type")).toBe("article");
    expect(meta(html, "property", "og:title")).toBe("Art. 1 Codul civil");
    expect(meta(html, "property", "og:url")).toBe("https://textdelege.ro/codul-civil/art-1");
    expect(meta(html, "property", "og:image")).toBe("https://textdelege.ro/og.png");
    expect(meta(html, "property", "og:image:width")).toBe("1200");
    expect(meta(html, "property", "og:image:height")).toBe("630");
    expect(meta(html, "name", "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "property", "og:description")).toBe(meta(html, "name", "description"));
  });

  it("describes the article with its current text", () => {
    expect(meta(html, "name", "description")).toBe("Art. 1 Codul civil: (1) Primul text modificat. (2) Al doilea text.");
  });

  it("describes the version shown for a past date", () => {
    const old = String(renderArticle(articleCtx, act, one, "2020-01-01"));
    expect(meta(old, "name", "description")).toContain("(1) Primul text. (2)");
  });

  it("cuts a long text at a word boundary", () => {
    const long = Array.from({ length: 80 }, (_, i) => `cuvant${i}`).join("  \n ");
    const description = meta(String(renderArticle(articleCtx, act, withText(long), null)), "name", "description")!;
    expect(description.startsWith("Art. 1 Codul civil: cuvant0 cuvant1 ")).toBe(true);
    expect(description.endsWith("…")).toBe(true);
    expect(description.length).toBeLessThan(190);
    expect(description).toMatch(/cuvant\d+…$/);
  });

  it("has Legislation structured data", () => {
    const data = jsonLd(html);
    expect(data["@type"]).toBe("Legislation");
    expect(data["@id"]).toBe("https://textdelege.ro/codul-civil/art-1");
    expect(data.name).toBe("Art. 1 Codul civil");
    expect(data.isPartOf["@id"]).toBe("https://textdelege.ro/codul-civil");
    expect(data.legislationDateVersion).toBe("2023-07-09");
    expect(data.inLanguage).toBe("ro");
  });

  it("escapes a closing script tag in structured data", () => {
    const hostile = { ...act, short: "</script><b>x" };
    const out = String(renderArticle(articleCtx, hostile, one, null));
    expect(out.match(/<\/script>/g)?.length).toBe(
      String(renderArticle(articleCtx, act, one, null)).match(/<\/script>/g)?.length,
    );
    expect(jsonLd(out).name).toContain("</script><b>x");
  });
});

describe("act page head", () => {
  let html = "";
  beforeAll(() => {
    html = String(renderAct(actCtx, act, "text"));
  });

  it("has the open graph tags and a description", () => {
    expect(meta(html, "property", "og:type")).toBe("article");
    expect(meta(html, "property", "og:title")).toBe("Codul civil");
    expect(meta(html, "property", "og:url")).toBe("https://textdelege.ro/codul-civil");
    const description = meta(html, "name", "description")!;
    expect(description).toBe(
      "Codul civil (Lege nr. 287/2009) — textul consolidat la zi, cu istoricul modificărilor. În vigoare din 01.10.2011.",
    );
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("has Legislation structured data with the legal force", () => {
    const data = jsonLd(html);
    expect(data["@type"]).toBe("Legislation");
    expect(data.alternateName).toBe("Codul civil");
    expect(data.legislationIdentifier).toBe("Lege nr. 287/2009");
    expect(data.legislationType).toBe("Lege");
    expect(data.legislationJurisdiction).toBe("RO");
    expect(data.legislationLegalForce).toBe("https://schema.org/InForce");
    expect(data.legislationDateVersion).toBe("2023-07-09");
    expect(data.sameAs).toBe("https://example.invalid/287");
  });

  it("marks a repealed act as not in force and omits unknown status", () => {
    const repealed = jsonLd(String(renderAct(actCtx, { ...act, status: "repealed 2025-01-01" }, "text")));
    expect(repealed.legislationLegalForce).toBe("https://schema.org/NotInForce");
    const unknown = jsonLd(String(renderAct(actCtx, { ...act, status: "amending act" }, "text")));
    expect(unknown.legislationLegalForce).toBeUndefined();
  });

  it("adds the subject of an act known by its number and keeps the description short", () => {
    const hg: ActObject = {
      ...act,
      kind: "hg",
      number: "951",
      year: 2026,
      title: "Hotărârea Guvernului nr. 951/2026 pentru completarea Hotărârii Guvernului nr. 1/2000 privind o chestiune foarte lungă și complicată",
      short: "HG nr. 951/2026",
    };
    const description = meta(String(renderAct(actCtx, hg, "text")), "name", "description")!;
    expect(description.startsWith("HG nr. 951/2026 pentru completarea")).toBe(true);
    expect(description).toContain("…");
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("has no structured data on the other tabs", () => {
    expect(String(renderAct(actCtx, act, "istoric"))).not.toContain("application/ld+json");
  });
});
