import { describe, expect, it } from "vitest";
import { headingPath, headingsBefore, headingText, lastHeadingBefore } from "../src/lib/headings";
import type { ActArticleEntry, ActObject } from "../src/lib/types";

const headings = [
  { kind: "ttl", label: "Titlul PRELIMINAR", name: "Despre legea civilă", depth: 0 },
  { kind: "crt", label: "Cartea I", name: "Despre persoane", depth: 0 },
  { kind: "ttl", label: "Titlul I", name: "Dispoziții generale", depth: 1 },
  { kind: "ttl", label: "Titlul II", name: "Persoana fizică", depth: 1 },
  { kind: "cap", label: "Capitolul I", name: "Capacitatea", depth: 2 },
  { kind: "sec", label: "Secțiunea 1", name: "Folosința", depth: 3 },
  { kind: "sec", label: "Secțiunea 2", name: "", depth: 3 },
  { kind: "crt", label: "Cartea a II-a", name: "Despre familie", depth: 0 },
];

const entry = (number: string, heading?: number) => ({ number, heading }) as ActArticleEntry;
const act = { headings, articles: [] } as unknown as ActObject;

describe("headingPath", () => {
  it("walks back to the nearest earlier heading of each smaller depth", () => {
    expect(headingPath(act, entry("9", 6)).map((h) => h.label)).toEqual([
      "Cartea I",
      "Titlul II",
      "Capitolul I",
      "Secțiunea 2",
    ]);
    expect(headingPath(act, entry("3", 2)).map((h) => h.label)).toEqual(["Cartea I", "Titlul I"]);
  });

  it("does not pick up headings of an earlier branch", () => {
    expect(headingPath(act, entry("1", 0)).map((h) => h.label)).toEqual(["Titlul PRELIMINAR"]);
    expect(headingPath(act, entry("20", 7)).map((h) => h.label)).toEqual(["Cartea a II-a"]);
  });

  it("is empty without a heading or without headings", () => {
    expect(headingPath(act, entry("5"))).toEqual([]);
    expect(headingPath({ articles: [] } as unknown as ActObject, entry("5", 1))).toEqual([]);
    expect(headingPath(act, entry("5", 99))).toEqual([]);
  });
});

describe("headingText", () => {
  it("joins the label and the name, or shows the label alone", () => {
    expect(headingText(headings[1]!)).toBe("Cartea I Despre persoane");
    expect(headingText(headings[6]!)).toBe("Secțiunea 2");
  });
});

describe("headingsBefore", () => {
  it("lists the headings after the last seen one up to the article's own", () => {
    expect(headingsBefore(act, entry("4", 5), 2).map((h) => h.index)).toEqual([3, 4, 5]);
    expect(headingsBefore(act, entry("4", 5), 5)).toEqual([]);
    expect(headingsBefore(act, entry("1", 0), -1).map((h) => h.index)).toEqual([0]);
    expect(headingsBefore(act, entry("4"), 2)).toEqual([]);
  });
});

describe("lastHeadingBefore", () => {
  it("is the highest heading among the articles before a position", () => {
    const withArticles = { headings, articles: [entry("1", 0), entry("2"), entry("3", 2), entry("4")] } as unknown as ActObject;
    expect(lastHeadingBefore(withArticles, 0)).toBe(-1);
    expect(lastHeadingBefore(withArticles, 2)).toBe(0);
    expect(lastHeadingBefore(withArticles, 4)).toBe(2);
  });
});
