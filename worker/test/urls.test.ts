import { describe, expect, it } from "vitest";
import {
  actUrl,
  articleSlug,
  articleUrl,
  changesUrl,
  compareUrl,
  lawUrlFromKey,
  numberFromSlug,
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
    expect(numberFromSlug(slug)).toBe(number);
  });

  it.each(["art-", "art", "1112", "art-x", "art-01x", "arts-1", "art--1", "art-1-", "art-01", "art-0", "art-112-01"])(
    "rejects %s",
    (slug) => {
      expect(numberFromSlug(slug)).toBeNull();
    },
  );
});

describe("url builders", () => {
  it("builds article, act, compare, ruling, law and changes urls", () => {
    expect(articleUrl("codul-civil", "1")).toBe("/codul-civil/art-1");
    expect(articleUrl("codul-penal", "112^1")).toBe("/codul-penal/art-112-1");
    expect(articleUrl("lege/2009/287", "1112", "2014-10-18")).toBe(
      "/lege/2009/287/art-1112/2014-10-18",
    );
    expect(actUrl("codul-civil")).toBe("/codul-civil");
    expect(actUrl("codul-civil", "2014-10-18")).toBe("/codul-civil/2014-10-18");
    expect(compareUrl("codul-civil", "1112", "2014-10-19", "2021-03-13")).toBe(
      "/codul-civil/art-1112/compara/2014-10-19..2021-03-13",
    );
    expect(compareUrl("codul-civil", null, "2014-10-19", "2021-03-13")).toBe(
      "/codul-civil/compara/2014-10-19..2021-03-13",
    );
    expect(changesUrl()).toBe("/modificari");
    expect(changesUrl("codul-civil")).toBe("/modificari/codul-civil");
    expect(changesUrl("codul-civil", "1112")).toBe("/modificari/codul-civil/art-1112");
    expect(subscribeUrl()).toBe("/abonare");
    expect(subscribeUrl("lege/2009/287", "1112")).toBe("/abonare/lege/2009/287/art-1112");
  });
});

describe("parsePath", () => {
  const act = (actRef: string, date: string | null = null, tab: string | null = null) => ({
    kind: "act",
    actRef,
    date,
    tab,
  });
  const article = (actRef: string, number: string, date: string | null = null) => ({
    kind: "article",
    actRef,
    number,
    date,
  });
  const changes = (actRef: string | null, number: string | null, format: string) => ({
    kind: "changes",
    actRef,
    number,
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
    ["/hotarare-parlament/2000/1", act("hotarare-parlament/2000/1")],
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
    ["/codul-civil/art-1", article("codul-civil", "1")],
    ["/codul-penal/art-112-1", article("codul-penal", "112^1")],
    ["/lege/2009/287/art-1112", article("lege/2009/287", "1112")],
    ["/lege/2009/287/art-1112/2014-10-18", article("lege/2009/287", "1112", "2014-10-18")],
    ["/codul-civil/art-1112/2014-10-18/", article("codul-civil", "1112", "2014-10-18")],
    ["/codul-civil/art-%31", article("codul-civil", "1")],
    [
      "/codul-civil/art-1112/compara/2014-10-19..2021-03-13",
      {
        kind: "compareArticle",
        actRef: "codul-civil",
        number: "1112",
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
    ["/modificari/codul-civil/art-1112", changes("codul-civil", "1112", "html")],
    ["/modificari/codul-civil/art-1112.atom", changes("codul-civil", "1112", "atom")],
    ["/abonare", changes(null, null, "subscribe")],
    ["/abonare/codul-civil", changes("codul-civil", null, "subscribe")],
    ["/abonare/codul-civil/art-112-1", changes("codul-civil", "112^1", "subscribe")],
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
    expect(parsePath(articleUrl("codul-penal", "112^1", "2020-01-01"))).toEqual(
      article("codul-penal", "112^1", "2020-01-01"),
    );
    expect(parsePath(changesUrl("lege/2009/287", "2029^10"))).toEqual(
      changes("lege/2009/287", "2029^10", "html"),
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
