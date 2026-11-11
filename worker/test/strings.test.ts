import { describe, expect, it } from "vitest";
import { genitive, pluralForm, t, tPlural } from "../src/text";
import { strings } from "../src/text/strings";

describe("strings", () => {
  it("has no empty strings", () => {
    for (const [key, value] of Object.entries(strings)) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});

describe("t", () => {
  it("returns the string of the key", () => {
    expect(t("navCodes")).toBe(strings.navCodes);
  });

  it("interpolates variables", () => {
    expect(t("bannerText", { date: "08.11.2026" })).toContain("08.11.2026");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(t("bannerText", {})).toContain("{date}");
  });
});

describe("genitive", () => {
  it("declines the first word of an act name", () => {
    expect(genitive("Codul civil")).toBe("Codului civil");
    expect(genitive("Legea nr. 31/1990")).toBe("Legii nr. 31/1990");
  });

  it("leaves other names as they are", () => {
    expect(genitive("Alt text")).toBe("Alt text");
  });
});

describe("pluralForm", () => {
  it.each([
    [0, "few"],
    [1, "one"],
    [2, "few"],
    [19, "few"],
    [20, "many"],
    [21, "many"],
    [101, "few"],
    [120, "many"],
  ] as const)("reads %i as %s", (n, form) => {
    expect(pluralForm(n)).toBe(form);
  });
});

describe("tPlural", () => {
  it("picks the string of the plural form and fills in the count", () => {
    const keys = { one: "changesCountOne", few: "changesCountFew", many: "changesCountMany" } as const;
    expect(tPlural(1, keys)).toBe(t("changesCountOne", { n: 1 }));
    expect(tPlural(20, keys)).toBe(t("changesCountMany", { n: 20 }));
  });
});

describe("the string table", () => {
  const sources = Object.values(
    import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
  ).join("\n");

  it("has no key the views never use", () => {
    const unused = Object.keys(strings).filter((key) => !new RegExp(`["'\`]${key}["'\`]`).test(sources));
    expect(unused).toEqual([]);
  });
});
