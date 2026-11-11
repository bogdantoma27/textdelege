import { jsx } from "hono/jsx";
import { describe, expect, it } from "vitest";
import { hangingParagraph, linkCrossReferences, parseUnit } from "../src/lib/text";

describe("hangingParagraph", () => {
  it.each([
    ["(1) Primul text.", "(1)", "Primul text."],
    ["(12) Alt text.", "(12)", "Alt text."],
    ["(1^1) Text inserat.", "(1^1)", "Text inserat."],
    ["a) prima literă;", "a)", "prima literă;"],
    ["a^1) litera inserată;", "a^1)", "litera inserată;"],
    ["1. primul punct;", "1.", "primul punct;"],
    ["1^1. punctul inserat;", "1^1.", "punctul inserat;"],
    ["3.1. subpunctul;", "3.1.", "subpunctul;"],
    ["(2)Fără spațiu.", "(2)", "Fără spațiu."],
  ])("splits %j", (text, marker, body) => {
    expect(hangingParagraph(text)).toEqual({ marker, body });
  });

  it.each([
    ["Un text fără marcaj."],
    ["1.103 lei se plătesc."],
    ["Art. 5 se aplică."],
    ["A) majusculă nu este literă."],
    ["(abc) nu este alineat."],
  ])("leaves %j whole", (text) => {
    expect(hangingParagraph(text)).toEqual({ marker: null, body: text });
  });

  it("keeps an empty body after a bare marker", () => {
    expect(hangingParagraph("a)")).toEqual({ marker: "a)", body: "" });
  });
});

describe("parseUnit", () => {
  it.each([
    ["alin-2", { alin: "2" }],
    ["alin-1_1", { alin: "1^1" }],
    ["alin-2-lit-c", { alin: "2", lit: "c" }],
    ["lit-a_1", { lit: "a^1" }],
    ["pct-3", { pct: "3" }],
    ["pct-3-1", { pct: "3.1" }],
    ["pct-2_1", { pct: "2^1" }],
    ["p-4", { line: "4" }],
  ])("reads %s", (id, unit) => {
    expect(parseUnit(id)).toEqual(unit);
  });

  it("returns null for ids it does not know", () => {
    expect(parseUnit("alin-2-2")).toBeNull();
    expect(parseUnit("whatever")).toBeNull();
  });
});

describe("linkCrossReferences", () => {
  const articles = new Set(["112", "112^1", "1103", "1"]);
  const render = (body: string, date: string | null = "2014-10-18") =>
    String(jsx("span", {}, ...linkCrossReferences(body, { actRef: "codul-civil", date, articles })));

  it("links an existing article and carries the page date", () => {
    const html = render("termenul prevăzut la art. 1.103.");
    expect(html).toContain(
      '<a class="x" href="/codul-civil/art-1103/2014-10-18" data-ref="/codul-civil/art-1103/2014-10-18">art. 1.103</a>.',
    );
  });

  it("uses the undated address on an undated page", () => {
    expect(render("vezi art. 1103", null)).toContain('href="/codul-civil/art-1103"');
  });

  it("links plain and inserted article numbers", () => {
    expect(render("art. 112 și art. 112^1")).toContain('href="/codul-civil/art-112/2014-10-18"');
    expect(render("art. 112 și art. 112^1")).toContain('href="/codul-civil/art-112-1/2014-10-18"');
  });

  it("anchors a paragraph that follows an article reference", () => {
    const html = render("conform art. 1103 alin. (2) se aplică");
    expect(html).toContain('href="/codul-civil/art-1103/2014-10-18#alin-2"');
    expect(html).toContain(">art. 1103 alin. (2)</a>");
  });

  it("anchors an inserted paragraph with the id used by the data", () => {
    expect(render("art. 1 alin. (2^1)")).toContain("#alin-2_1");
  });

  it("leaves articles that are not in the act as text", () => {
    const html = render("art. 9999 nu există");
    expect(html).not.toContain("<a");
    expect(html).toContain("art. 9999 nu există");
  });

  it("leaves a lone paragraph reference as text", () => {
    expect(render("alin. (2) se aplică")).not.toContain("<a");
  });

  it("leaves references to other acts as text", () => {
    expect(render("art. 1 din Legea nr. 31/1990")).not.toContain("<a");
    expect(render("art. 1 alin. (2) lit. a) din Codul muncii")).not.toContain("<a");
  });

  it("links references to this act spelled out", () => {
    expect(render("art. 1 din prezentul cod")).toContain("<a");
  });

  it("links every reference in a sentence", () => {
    expect(render("art. 1 și art. 112, dar nu art. 7").match(/<a /g)).toHaveLength(2);
  });

  it("escapes the text around the links", () => {
    const html = render("<b>art. 1</b> & more");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp; more");
    expect(html).not.toContain("<b>");
  });

  it("returns the body untouched when there is nothing to link", () => {
    expect(linkCrossReferences("niciun articol", { actRef: "x", date: null, articles })).toEqual([
      "niciun articol",
    ]);
  });
});
