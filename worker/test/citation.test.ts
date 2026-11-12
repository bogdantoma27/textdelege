import { describe, expect, it } from "vitest";
import { citationUrl, normalise, parseCitation } from "../src/lib/citation";

const alias = (name: string) => ({ act: { alias: name } });
const numbered = (kind: string, number: string, year: string) => ({
  act: { kind, number, year },
});

describe("normalise", () => {
  it("maps cedilla forms, strips diacritics, lowercases and collapses spaces", () => {
    expect(normalise("Constitu\u0163ia  României")).toBe("constitutia romaniei");
    expect(normalise("\u015e\u0163șțăî")).toBe("ststai");
    expect(normalise("alin.1 lit.a")).toBe("alin. 1 lit. a");
    expect(normalise("art.52")).toBe("art. 52");
    expect(normalise("  Codul\t muncii ")).toBe("codul muncii");
  });

  it("composes decomposed input", () => {
    expect(normalise("s\u0326")).toBe("s");
  });
});

describe("parseCitation", () => {
  const cases: [string, unknown][] = [
    [
      "art. 52 alin. (1) lit. c) din Codul muncii",
      { ...alias("codul-muncii"), article: "52", alin: "1", lit: "c" },
    ],
    ["Codului muncii art. 52", { ...alias("codul-muncii"), article: "52" }],
    ["C. muncii, art. 52", { ...alias("codul-muncii"), article: "52" }],
    ["art.52 alin.1 codul muncii", { ...alias("codul-muncii"), article: "52", alin: "1" }],
    ["Codul muncii", alias("codul-muncii")],
    ["CM art. 5", { ...alias("codul-muncii"), article: "5" }],
    ["Legea nr. 31/1990 art. 194", { ...numbered("lege", "31", "1990"), article: "194" }],
    ["Legea 31/1990, art. 194", { ...numbered("lege", "31", "1990"), article: "194" }],
    ["art. 194 din Legii nr. 31/1990", { ...numbered("lege", "31", "1990"), article: "194" }],
    ["Legea nr. 287/2009 privind Codul civil", numbered("lege", "287", "2009")],
    ["OUG 57/2019", numbered("oug", "57", "2019")],
    ["O.U.G. nr. 57/2019 art. 10", { ...numbered("oug", "57", "2019"), article: "10" }],
    ["Ordonanța de urgență nr. 57/2019", numbered("oug", "57", "2019")],
    ["OG 2/2001", numbered("og", "2", "2001")],
    ["O.G. nr. 2/2001", numbered("og", "2", "2001")],
    ["HG 10/2016", numbered("hg", "10", "2016")],
    ["H.G. nr. 10/2016", numbered("hg", "10", "2016")],
    ["art. 1.103 Cod civil", { ...alias("codul-civil"), article: "1103" }],
    ["art. 52^1 Codul penal", { ...alias("codul-penal"), article: "52^1" }],
    ["art. 52 ind. 1 CP", { ...alias("codul-penal"), article: "52^1" }],
    ["art. 16 din Constituție", { ...alias("constitutia"), article: "16" }],
    ["art. 16 din Constitu\u0163ia României", { ...alias("constitutia"), article: "16" }],
    [
      "Constituției art. 16 alin. (2)",
      { ...alias("constitutia"), article: "16", alin: "2" },
    ],
    ["art. 1 C. civ.", { ...alias("codul-civil"), article: "1" }],
    ["art. 1 NCC", { ...alias("codul-civil"), article: "1" }],
    ["art. 1 CC", { ...alias("codul-civil"), article: "1" }],
    ["art. 2 NCP", { ...alias("codul-penal"), article: "2" }],
    ["art. 3 C. pen.", { ...alias("codul-penal"), article: "3" }],
    ["art. 4 Codul de procedură civilă", { ...alias("codul-procedura-civila"), article: "4" }],
    ["art. 4 Codului de procedura civila", { ...alias("codul-procedura-civila"), article: "4" }],
    ["art. 4 C. proc. civ.", { ...alias("codul-procedura-civila"), article: "4" }],
    ["art. 4 CPC", { ...alias("codul-procedura-civila"), article: "4" }],
    ["art. 4 NCPC", { ...alias("codul-procedura-civila"), article: "4" }],
    ["art. 5 Codul de procedură penală", { ...alias("codul-procedura-penala"), article: "5" }],
    ["art. 5 C. proc. pen.", { ...alias("codul-procedura-penala"), article: "5" }],
    ["art. 5 CPP", { ...alias("codul-procedura-penala"), article: "5" }],
    ["art. 5 NCPP", { ...alias("codul-procedura-penala"), article: "5" }],
    ["art. 6 Codul fiscal", { ...alias("codul-fiscal"), article: "6" }],
    ["art. 6 C. fisc.", { ...alias("codul-fiscal"), article: "6" }],
    ["art. 6 CF", { ...alias("codul-fiscal"), article: "6" }],
    ["art. 7 Codul de procedură fiscală", { ...alias("codul-procedura-fiscala"), article: "7" }],
    ["art. 7 CPF", { ...alias("codul-procedura-fiscala"), article: "7" }],
    ["art. 8 Codul administrativ", { ...alias("codul-administrativ"), article: "8" }],
    ["art. 8 C. adm.", { ...alias("codul-administrativ"), article: "8" }],
    ["art. 8 CA", { ...alias("codul-administrativ"), article: "8" }],
    ["art. 9 Codul vamal", { ...alias("codul-vamal"), article: "9" }],
    ["art. 9 Codul silvic", { ...alias("codul-silvic"), article: "9" }],
    ["art. 9 Codul consumului", { ...alias("codul-consumului"), article: "9" }],
    ["art. 9 Codul aerian", { ...alias("codul-aerian"), article: "9" }],
    ["art. 9 Codului vamal", { ...alias("codul-vamal"), article: "9" }],
    [
      "art. 5 alin. 2 lit. a Codul civil",
      { ...alias("codul-civil"), article: "5", alin: "2", lit: "a" },
    ],
    [
      "art. 5 alin. (1^1) Codul civil",
      { ...alias("codul-civil"), article: "5", alin: "1^1" },
    ],
  ];

  it.each(cases)("parses %s", (input, expected) => {
    expect(parseCitation(input)).toEqual(expected);
  });

  it.each([
    "ca",
    "cp",
    "impozit ca venit",
    "cf. art. 5",
    "art. 5 ca",
    "c a art. 5",
    "art. 5 cp",
    "art. 5 C P",
    `art. 5 Codul civil ${"x".repeat(200)}`,
  ])("returns null for %j", (input) => {
    expect(parseCitation(input)).toBeNull();
  });

  it.each([
    ["art. 5 CP", "codul-penal"],
    ["art. 5 C.P.", "codul-penal"],
    ["art. 10 CA", "codul-administrativ"],
    ["art. 10 C.F.", "codul-fiscal"],
  ])("accepts uppercase short code in %s", (input, name) => {
    expect(parseCitation(input)?.act).toEqual({ alias: name });
  });

  it.each(["impozit pe venit", "art. 52", "", "   ", "alin. 1 lit. a"])(
    "returns null for %j",
    (input) => {
      expect(parseCitation(input)).toBeNull();
    },
  );
});

describe("citationUrl", () => {
  const urlCases: [string, string | null][] = [
    ["Codul muncii", "/codul-muncii"],
    ["art. 1.103 Cod civil", "/codul-civil/art-1103"],
    ["art. 52^1 Codul penal", "/codul-penal/art-52-1"],
    ["art. 52 alin. (1) lit. c) din Codul muncii", "/codul-muncii/art-52#alin-1-lit-c"],
    ["art.52 alin.1 codul muncii", "/codul-muncii/art-52#alin-1"],
    ["Legea nr. 31/1990 art. 194", "/lege/1990/31/art-194"],
    ["art. 5 alin. (1^1) Codul civil", "/codul-civil/art-5#alin-1_1"],
    ["OUG 57/2019", "/oug/2019/57"],
    ["O.U.G. nr. 57/2019 art. 10 alin. 2", "/oug/2019/57/art-10#alin-2"],
    ["OG 2/2001", "/og/2001/2"],
    ["HG 10/2016", "/hg/2016/10"],
    ["Decretul-lege nr. 115/1938", "/decret-lege/1938/115"],
    ["D.-L. 115/1938", "/decret-lege/1938/115"],
    ["Decretul nr. 1/1990", "/decret/1990/1"],
    ["Hotărârea Parlamentului nr. 1/2000", "/hotarare-parlament/2000/1"],
    ["HP 1/2000", "/hotarare-parlament/2000/1"],
    ["Hotărârea Guvernului nr. 1/2000 art. 3", "/hg/2000/1/art-3"],
    ["impozit pe venit", null],
  ];

  it.each(urlCases)("maps %s", (input, expected) => {
    const citation = parseCitation(input);
    expect(citation ? citationUrl(citation) : null).toBe(expected);
  });

  it("returns null for incomplete numbered acts", () => {
    expect(citationUrl({ act: { kind: "lege", number: "31" } })).toBeNull();
    expect(citationUrl({ act: {} })).toBeNull();
  });
});
