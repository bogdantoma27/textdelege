import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { listFromIndex } from "../src/lib/act-list";
import { articleLabel } from "../src/lib/article-label";
import { parseCitation } from "../src/lib/citation";
import { citedAct, findCitedAct } from "../src/lib/resolve";
import { createStore } from "../src/lib/store";
import { linkCrossReferences, linkableNumbers } from "../src/lib/text";
import type { ActArticleEntry, ActIndexEntry, ActObject, ArticleObject } from "../src/lib/types";
import { replaceObject } from "./support";

const get = (path: string) => exports.default.fetch(`https://example.com${path}`, { redirect: "manual" });

const entry = (path: string, title = "Titlu"): ActIndexEntry => ({
  path,
  alias: null,
  title,
  short: null,
  kind: path.split("/")[0]!,
  status: "in force",
  from: null,
  latest: "2020-01-01",
  articles: 1,
});

describe("Parliament decision citations", () => {
  const index = [
    entry("hotarare-parlament/camera/1990/14"),
    entry("hotarare-parlament/senat/2005/3"),
    entry("hotarare-parlament/camera/2005/3"),
    entry("lege/1990/14"),
  ];

  it("finds the Chamber of Deputies decision", () => {
    expect(findCitedAct(index, "Hotărârea Camerei Deputaților nr. 14/1990")?.path).toBe(
      "hotarare-parlament/camera/1990/14",
    );
  });

  it("finds the Senate decision", () => {
    expect(findCitedAct(index, "Hotărârea Senatului nr. 3/2005")?.path).toBe("hotarare-parlament/senat/2005/3");
  });

  it("does not take the Chamber decision for the Senate one", () => {
    expect(findCitedAct(index, "Hotărârea Senatului nr. 14/1990")).toBeNull();
  });

  it("resolves HP only when one chamber has the number", () => {
    expect(findCitedAct(index, "HP 14/1990")?.path).toBe("hotarare-parlament/camera/1990/14");
    expect(findCitedAct(index, "HP 3/2005")).toBeNull();
    const citation = parseCitation("Hotărârea Parlamentului nr. 14/1990")!;
    expect(citedAct(index, citation)?.path).toBe("hotarare-parlament/camera/1990/14");
  });

  it("keeps plain numbered kinds working", () => {
    expect(findCitedAct(index, "Legea nr. 14/1990")?.path).toBe("lege/1990/14");
  });
});

describe("acts list with Parliament decisions", () => {
  it("reads year and number from four-segment paths", () => {
    const list = listFromIndex(
      [entry("hotarare-parlament/camera/1990/14"), entry("hotarare-parlament/senat/2005/3"), entry("lege/2009/287")],
      { page: 1 },
    );
    expect(list.items.map((item) => [item.path, item.year, item.number])).toEqual([
      ["lege/2009/287", 2009, "287"],
      ["hotarare-parlament/senat/2005/3", 2005, "3"],
      ["hotarare-parlament/camera/1990/14", 1990, "14"],
    ]);
    expect(listFromIndex([entry("hotarare-parlament/senat/2005/3")], { page: 1, q: "3" }).total).toBe(1);
  });
});

describe("article labels", () => {
  const articles = [
    { number: "I", file: "art-t2-i" },
    { number: "I", file: "art-t3-i" },
    { number: "UNIC", file: "art-t1-unic" },
    { number: "5", file: "art-005" },
  ];

  it("adds the title to an ambiguous number", () => {
    expect(articleLabel(articles[0]!, articles)).toBe("Art. I (titlul 2)");
    expect(articleLabel(articles[1]!, articles)).toBe("Art. I (titlul 3)");
  });

  it("leaves unambiguous and unlisted numbers alone", () => {
    expect(articleLabel(articles[3]!, articles)).toBe("Art. 5");
    expect(articleLabel(articles[0]!)).toBe("Art. I");
  });

  it("names the sole article", () => {
    expect(articleLabel(articles[2]!, articles)).toBe("Articol unic");
  });
});

describe("cross-reference links", () => {
  const articles = [
    { number: "I", file: "art-t2-i" },
    { number: "I", file: "art-t3-i" },
    { number: "5", file: "art-005" },
    { number: "6", file: "art-006-a" },
    { number: "6", file: "art-006-b" },
    { number: "UNIC", file: "art-t1-unic" },
  ];

  it("only offers unique numeric numbers", () => {
    expect([...linkableNumbers(articles)]).toEqual(["5"]);
  });

  it("links a unique numeric reference and never an ambiguous one", () => {
    const ctx = { actRef: "lege/2007/363", date: null, articles: linkableNumbers(articles) };
    const html = (text: string) => JSON.stringify(linkCrossReferences(text, ctx));
    expect(html("vezi art. 5 aici")).toContain("/lege/2007/363/art-5");
    expect(html("vezi art. I aici")).not.toContain("href");
    expect(html("vezi art. 6 aici")).not.toContain("href");
  });
});

describe("routes", () => {
  const restores: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (restores.length > 0) await restores.pop()!();
  });

  let baseAct: ActObject;
  let baseArticle: ArticleObject;
  beforeAll(async () => {
    const store = createStore(env);
    baseAct = (await store.act("lege/2009/287"))!;
    baseArticle = (await store.article("lege/2009/287", "art-0001"))!;
  });

  async function install(path: string, files: { file: string; number: string }[]) {
    const first = baseAct.articles[0]!;
    const articles: ActArticleEntry[] = files.map(({ file, number }) => ({ ...first, file, number, title: null }));
    const act: ActObject = {
      ...structuredClone(baseAct),
      path,
      alias: null,
      kind: path.split("/")[0]!,
      articles,
    };
    restores.push(await replaceObject(`acts/${path}/act.json`, act));
    for (const { file, number } of files) {
      const article: ArticleObject = {
        ...structuredClone(baseArticle),
        file,
        number,
        prev: null,
        next: null,
        act: { ...baseArticle.act, path, alias: null },
      };
      restores.push(await replaceObject(`acts/${path}/art/${file}.json`, article));
    }
  }

  it("serves a Chamber of Deputies decision and its articles", async () => {
    const path = "hotarare-parlament/camera/1990/14";
    await install(path, [{ file: "art-001", number: "1" }]);
    expect((await get(`/${path}`)).status).toBe(200);
    const article = await get(`/${path}/art-1`);
    expect(article.status).toBe(200);
    expect(await article.text()).toContain(`/${path}/art-1`);
    expect((await get(`/${path}/art-1/compara`)).status).toBe(404);
    expect((await get(`/modificari/${path}`)).status).toBe(200);
    expect((await get("/hotarare-parlament/1990/14")).status).toBe(404);
  });

  it("serves a Senate decision", async () => {
    const path = "hotarare-parlament/senat/2005/3";
    await install(path, [{ file: "art-001", number: "1" }]);
    expect((await get(`/${path}`)).status).toBe(200);
    expect((await get(`/${path}/art-1`)).status).toBe(200);
  });

  it("serves non-numeric articles by file stem and labels the ambiguous ones", async () => {
    const path = "lege/2007/363";
    await install(path, [
      { file: "art-001", number: "1" },
      { file: "art-t1-unic", number: "UNIC" },
      { file: "art-t2-i", number: "I" },
      { file: "art-t3-i", number: "I" },
      { file: "art-270-2-a", number: "270^2 a)" },
    ]);
    const second = await get(`/${path}/art-t2-i`);
    expect(second.status).toBe(200);
    const html = await second.text();
    expect(html).toContain("Art. I (titlul 2)");
    expect(html).not.toContain("Art. I (titlul 3)");
    expect(await (await get(`/${path}/art-t3-i`)).text()).toContain("Art. I (titlul 3)");
    expect(await (await get(`/${path}/art-t1-unic`)).text()).toContain("Articol unic");
    expect((await get(`/${path}/art-270-2-a`)).status).toBe(200);
    expect((await get(`/${path}/art-1`)).status).toBe(200);
    expect((await get(`/${path}/art-001`)).status).toBe(404);
    expect((await get(`/${path}/art-i`)).status).toBe(404);
    expect((await get(`/modificari/${path}/art-t2-i`)).status).toBe(200);
    const listing = await (await get(`/${path}`)).text();
    expect(listing).toContain(`/${path}/art-t2-i`);
    expect(listing).toContain(`/${path}/art-t3-i`);
    expect(listing).toContain(`/${path}/art-270-2-a`);
  });

  it("compares a non-numeric article", async () => {
    const path = "lege/2007/363";
    await install(path, [{ file: "art-t2-i", number: "I" }]);
    const article = (await createStore(env).article(path, "art-t2-i"))!;
    const versions = article.versions;
    expect(versions.length).toBeGreaterThan(1);
    const res = await get(`/${path}/art-t2-i/compara/${versions[0]!.from}..${versions[1]!.from}`);
    expect(res.status).toBe(200);
  });
});
