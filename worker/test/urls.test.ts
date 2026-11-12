import { describe, expect, it } from "vitest";
import {
  actUrl,
  actPathParts,
  articleSlug,
  articleSlugFor,
  findArticle,
  isArticleSlug,
  articleUrl,
  changesUrl,
  compareUrl,
  lawUrlFromKey,
  parsePath,
  rulingKeyFromRoute,
  rulingUrlFromKey,
  subscribeUrl,
} from "../src/lib/urls";

describe("article slugs", () => {
  it.each([
    ["1", "art-1"],
    ["1112", "art-1112"],
    ["112^1", "art-112-1"],
    ["2029^10", "art-2029-10"],
  ])("round trips %s", (number, slug) => {
    expect(articleSlug(number)).toBe(slug);
    expect(articleSlugFor({ number, file: "art-zzz" })).toBe(slug);
    expect(isArticleSlug(slug)).toBe(true);
  });

  it.each([
    ["270^2 a)", "art-270-2-a"],
    ["I", "art-i"],
    ["III^1", "art-iii-1"],
    ["I", "art-t2-i"],
    ["I", "art-t3-i"],
    ["UNIC", "art-t1-unic"],
    ["0", "art-000"],
  ])("uses the file stem for number %s", (number, file) => {
    expect(articleSlugFor({ number, file })).toBe(file);
    expect(isArticleSlug(file)).toBe(true);
  });

  it.each(["art-", "art", "1112", "art-X", "arts-1x", "art--1", "art-1-", "art-a_b", "art-1/2"])("rejects %s", (slug) => {
    expect(isArticleSlug(slug)).toBe(false);
  });

  it("finds an article by slug even when numbers repeat", () => {
    const articles = [
      { number: "5", file: "art-005" },
      { number: "I", file: "art-t2-i" },
      { number: "I", file: "art-t3-i" },
    ];
    expect(findArticle(articles, "art-5")).toBe(articles[0]);
    expect(findArticle(articles, "art-t3-i")).toBe(articles[2]);
    expect(findArticle(articles, "art-t2-i")).toBe(articles[1]);
    expect(findArticle(articles, "art-005")).toBeUndefined();
    expect(findArticle(articles, "art-i")).toBeUndefined();
  });
});

describe("act path parts", () => {
  it.each([
    ["lege/2009/287", { kind: "lege", chamber: null, year: "2009", number: "287" }],
    ["hotarare-parlament/camera/1990/14", { kind: "hotarare-parlament", chamber: "camera", year: "1990", number: "14" }],
    ["hotarare-parlament/senat/2005/3", { kind: "hotarare-parlament", chamber: "senat", year: "2005", number: "3" }],
    ["constitutie/1991", { kind: "constitutie", chamber: null, year: "1991", number: "" }],
  ])("splits %s", (path, expected) => {
    expect(actPathParts(path)).toEqual(expected);
  });
});

const art = (number: string, file = `art-${number.padStart(3, "0")}`) => ({ number, file });

describe("url builders", () => {
  it("builds urls for non-numeric articles from the file stem", () => {
    const unic = art("UNIC", "art-t1-unic");
    const second = art("I", "art-t2-i");
    expect(articleUrl("lege/2007/363", unic)).toBe("/lege/2007/363/art-t1-unic");
    expect(articleUrl("lege/2007/363", second, "2008-01-01")).toBe("/lege/2007/363/art-t2-i/2008-01-01");
    expect(compareUrl("lege/2007/363", art("270^2 a)", "art-270-2-a"), "2020-01-01", "2021-01-01")).toBe(
      "/lege/2007/363/art-270-2-a/compara/2020-01-01..2021-01-01",
    );
    expect(changesUrl("lege/2007/363", art("III^1", "art-iii-1"))).toBe("/modificari/lege/2007/363/art-iii-1");
    expect(subscribeUrl("lege/2007/363", second)).toBe("/abonare/lege/2007/363/art-t2-i");
  });

  it("keeps numeric slugs for numeric articles whatever the file", () => {
    expect(articleUrl("codul-civil", art("6^1", "art-006-1"))).toBe("/codul-civil/art-6-1");
  });

  it("builds Parliament decision urls", () => {
    expect(actUrl("hotarare-parlament/camera/1990/14")).toBe("/hotarare-parlament/camera/1990/14");
    expect(articleUrl("hotarare-parlament/senat/2005/3", art("I", "art-i"))).toBe(
      "/hotarare-parlament/senat/2005/3/art-i",
    );
  });

  it("builds article, act, compare, ruling, law and changes urls", () => {
    expect(articleUrl("codul-civil", art("1"))).toBe("/codul-civil/art-1");
    expect(articleUrl("codul-penal", art("112^1"))).toBe("/codul-penal/art-112-1");
    expect(articleUrl("lege/2009/287", art("1112"), "2014-10-18")).toBe(
      "/lege/2009/287/art-1112/2014-10-18",
    );
    expect(actUrl("codul-civil")).toBe("/codul-civil");
    expect(actUrl("codul-civil", "2014-10-18")).toBe("/codul-civil/2014-10-18");
    expect(compareUrl("codul-civil", art("1112"), "2014-10-19", "2021-03-13")).toBe(
      "/codul-civil/art-1112/compara/2014-10-19..2021-03-13",
    );
    expect(compareUrl("codul-civil", null, "2014-10-19", "2021-03-13")).toBe(
      "/codul-civil/compara/2014-10-19..2021-03-13",
    );
    expect(changesUrl()).toBe("/modificari");
    expect(changesUrl("codul-civil")).toBe("/modificari/codul-civil");
    expect(changesUrl("codul-civil", art("1112"))).toBe("/modificari/codul-civil/art-1112");
    expect(subscribeUrl()).toBe("/abonare");
    expect(subscribeUrl("lege/2009/287", art("1112"))).toBe("/abonare/lege/2009/287/art-1112");
  });
});

describe("parsePath", () => {
  const act = (actRef: string, date: string | null = null, tab: string | null = null) => ({
    kind: "act",
    actRef,
    date,
    tab,
  });
  const article = (actRef: string, slug: string, date: string | null = null) => ({
    kind: "article",
    actRef,
    slug,
    date,
  });
  const changes = (actRef: string | null, slug: string | null, format: string) => ({
    kind: "changes",
    actRef,
    slug,
    format,
  });

  const cases: [string, unknown][] = [
    ["/", { kind: "home" }],
    ["/cauta", { kind: "search" }],
    ["/cauta/", { kind: "search" }],
    ["/codul-civil", act("codul-civil")],
    ["/codul-civil/", act("codul-civil")],
    ["/lege/2009/287", act("lege/2009/287")],
    ["/lege/2021/23", act("lege/2021/23")],
    ["/oug/2019/57", act("oug/2019/57")],
    ["/decret-lege/1989/2", act("decret-lege/1989/2")],
    ["/decret-lege/1938/115", act("decret-lege/1938/115")],
    ["/decret/1990/1", act("decret/1990/1")],
    ["/hotarare-parlament/camera/1990/14", act("hotarare-parlament/camera/1990/14")],
    ["/hotarare-parlament/senat/2005/3", act("hotarare-parlament/senat/2005/3")],
    ["/hotarare-parlament/senat/2005/3/2006-01-01", act("hotarare-parlament/senat/2005/3", "2006-01-01")],
    ["/hotarare-parlament/senat/2005/3/art-2", article("hotarare-parlament/senat/2005/3", "art-2")],
    ["/hotarare-parlament/senat/2005/3/art-i", article("hotarare-parlament/senat/2005/3", "art-i")],
    ["/hotarare-parlament/camera/1990/14/istoric", act("hotarare-parlament/camera/1990/14", null, "istoric")],
    ["/modificari/hotarare-parlament/camera/1990/14", changes("hotarare-parlament/camera/1990/14", null, "html")],
    ["/hotarare-parlament/2000/1", null],
    ["/hotarare-parlament/camera/1990", null],
    ["/hotarare-parlament/consiliu/1990/14", null],
    ["/lege/2007/363/art-t2-i", article("lege/2007/363", "art-t2-i")],
    ["/lege/2007/363/art-t1-unic", article("lege/2007/363", "art-t1-unic")],
    [
      "/lege/2007/363/art-270-2-a/compara/2020-01-01..2021-01-01",
      { kind: "compareArticle", actRef: "lege/2007/363", slug: "art-270-2-a", from: "2020-01-01", to: "2021-01-01" },
    ],
    ["/modificari/lege/2007/363/art-t3-i.atom", changes("lege/2007/363", "art-t3-i", "atom")],
    ["/abonare/lege/2007/363/art-iii-1", changes("lege/2007/363", "art-iii-1", "subscribe")],
    ["/constitutie/1991", act("constitutie/1991")],
    ["/cod/1864/civil", act("cod/1864/civil")],
    ["/codul-civil/2014-10-19", act("codul-civil", "2014-10-19")],
    ["/lege/2009/287/2014-10-19", act("lege/2009/287", "2014-10-19")],
    ["/codul-civil/cuprins", { kind: "contents", actRef: "codul-civil", date: null }],
    ["/codul-civil/2014-10-19/cuprins", { kind: "contents", actRef: "codul-civil", date: "2014-10-19" }],
    ["/codul-civil/istoric", act("codul-civil", null, "istoric")],
    ["/codul-civil/jurisprudenta", act("codul-civil", null, "jurisprudenta")],
    ["/codul-civil/statistici", act("codul-civil", null, "statistici")],
    ["/lege/2009/287/date", act("lege/2009/287", null, "date")],
    ["/codul-civil/art-1", article("codul-civil", "art-1")],
    ["/codul-penal/art-112-1", article("codul-penal", "art-112-1")],
    ["/lege/2009/287/art-1112", article("lege/2009/287", "art-1112")],
    ["/lege/2009/287/art-1112/2014-10-18", article("lege/2009/287", "art-1112", "2014-10-18")],
    ["/codul-civil/art-1112/2014-10-18/", article("codul-civil", "art-1112", "2014-10-18")],
    ["/codul-civil/art-%31", article("codul-civil", "art-1")],
    [
      "/codul-civil/art-1112/compara/2014-10-19..2021-03-13",
      {
        kind: "compareArticle",
        actRef: "codul-civil",
        slug: "art-1112",
        from: "2014-10-19",
        to: "2021-03-13",
      },
    ],
    [
      "/codul-civil/compara/2014-10-19..2021-03-13",
      { kind: "compareAct", actRef: "codul-civil", from: "2014-10-19", to: "2021-03-13" },
    ],
    ["/jurisprudenta/ccr/2019/1", { kind: "ruling", key: "ccr/2019/1" }],
    ["/jurisprudenta/iccj/hp/2019/4", { kind: "ruling", key: "iccj/hp/2019/4" }],
    ["/jurisprudenta/iccj/hp-penal/2020/12", { kind: "ruling", key: "iccj/hp-penal/2020/12" }],
    ["/modificari", changes(null, null, "html")],
    ["/modificari.atom", changes(null, null, "atom")],
    ["/modificari/codul-civil", changes("codul-civil", null, "html")],
    ["/modificari/codul-civil.atom", changes("codul-civil", null, "atom")],
    ["/modificari/codul-civil/art-1112", changes("codul-civil", "art-1112", "html")],
    ["/modificari/codul-civil/art-1112.atom", changes("codul-civil", "art-1112", "atom")],
    ["/abonare", changes(null, null, "subscribe")],
    ["/abonare/codul-civil", changes("codul-civil", null, "subscribe")],
    ["/abonare/codul-civil/art-112-1", changes("codul-civil", "art-112-1", "subscribe")],
    ["/legislatie/2019-01-01", { kind: "pointInTime", date: "2019-01-01" }],
    ["/despre", { kind: "help", page: "despre" }],
    ["/legenda", { kind: "help", page: "legenda" }],
  ];

  it.each(cases)("parses %s", (path, expected) => {
    expect(parsePath(path)).toEqual(expected);
  });

  it.each([
    "/healthz",
    "/assets/app.css",
    "/legislatie/2019-02-30",
    "/legislatie",
    "/legislatie/2019-01-01/extra",
    "/la-data/2019-01-01",
    "/codul-civil/2021-02-30",
    "/codul-civil/art-1/2021-02-30",
    "/codul-civil/art-1/compara/2014-10-19..2014-10-19",
    "/codul-civil/compara/2014-10-19",
    "/codul-civil/compara/2014-10-19..2021-02-30",
    "/codul-civil/unknown",
    "/codul-civil/istoric/2014-10-19",
    "/codul-civil/art-1/istoric",
    "/lege/2009",
    "/lege",
    "/lege/abc/287",
    "/jurisprudenta",
    "/jurisprudenta/ccr/2019",
    "/jurisprudenta/iccj/xyz/2019/4",
    "/jurisprudenta/xyz/2019/4",
    "/despre/more",
    "/api/v1/acts",
    "/modificari.json",
    "/modificari/codul-civil.json",
    "/codul-civil//art-1",
    "/codul-civil/art-%E0%A4%A",
    "/modificari/codul-civil/art-1/extra",
    "/modificari/codul-civil/istoric",
    "/abonare.atom",
    "/abonare/codul-civil.atom",
    "/abonare/codul-civil/art-1/extra",
  ])("rejects %s", (path) => {
    expect(parsePath(path)).toBeNull();
  });

  it("parses a reversed range as it is written, for the route to turn round", () => {
    expect(parsePath("/codul-civil/compara/2021-03-13..2014-10-19")).toEqual({
      kind: "compareAct",
      actRef: "codul-civil",
      from: "2021-03-13",
      to: "2014-10-19",
    });
  });

  it("round trips the builders", () => {
    expect(parsePath(articleUrl("codul-penal", art("112^1"), "2020-01-01"))).toEqual(
      article("codul-penal", "art-112-1", "2020-01-01"),
    );
    expect(parsePath(changesUrl("lege/2009/287", art("2029^10")))).toEqual(
      changes("lege/2009/287", "art-2029-10", "html"),
    );
  });
});

describe("decision and law keys", () => {
  it.each([
    ["dcc-1-2019", "/jurisprudenta/ccr/2019/1"],
    ["iccj-hp-4-2019", "/jurisprudenta/iccj/hp/2019/4"],
    ["iccj-hp-penal-7-2020", "/jurisprudenta/iccj/hp-penal/2020/7"],
    ["iccj-ril-12-2021", "/jurisprudenta/iccj/ril/2021/12"],
  ])("maps %s to its page and back", (key, url) => {
    expect(rulingUrlFromKey(key)).toBe(url);
    expect(lawUrlFromKey(key)).toBe(url);
    const route = parsePath(url);
    expect(route?.kind).toBe("ruling");
    expect(rulingKeyFromRoute(route as { key: string })).toBe(key);
  });

  it.each(["cedo-3594-19-2020-05-05", "iccj-xx-1-2019", "dcc-1", "ccr-1-2019", ""])(
    "gives %j no page",
    (key) => {
      expect(rulingUrlFromKey(key)).toBeNull();
    },
  );

  it.each([
    ["legea-200-2023", "/lege/2023/200"],
    ["oug-57-2019", "/oug/2019/57"],
    ["og-27-2002", "/og/2002/27"],
    ["hg-1-2020", "/hg/2020/1"],
    ["decret-5-1990", "/decret/1990/5"],
  ])("maps the law key %s to %s", (key, url) => {
    expect(lawUrlFromKey(key)).toBe(url);
    expect(parsePath(url)?.kind).toBe("act");
  });

  it("gives other law keys no page", () => {
    expect(lawUrlFromKey("ordin-1-2020")).toBeNull();
    expect(lawUrlFromKey("legea-200")).toBeNull();
  });

  it("rejects routes that are not decisions", () => {
    expect(rulingKeyFromRoute({ key: "x/1" })).toBeNull();
  });
});
