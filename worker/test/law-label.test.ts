import { describe, expect, it } from "vitest";
import { labelFromKey, namesAnAct } from "../src/lib/law-label";

describe("labelFromKey", () => {
  it.each([
    ["legea-54-2023", "Legea nr. 54/2023"],
    ["oug-12-2026", "OUG nr. 12/2026"],
    ["og-27-2002", "OG nr. 27/2002"],
    ["hg-1-2020", "HG nr. 1/2020"],
    ["decret-lege-9-1990", "Decretul-lege nr. 9/1990"],
    ["decret-5-1990", "Decretul nr. 5/1990"],
    ["dcc-390-2021", "Decizia Curții Constituționale nr. 390/2021"],
    ["rectificare-mo-12-2020", "Rectificarea din Monitorul Oficial nr. 12/2020"],
  ])("writes %s as %s", (key, label) => {
    expect(labelFromKey(key)).toBe(label);
  });

  it.each(["ordin-1-2020", "legea-200", "", "Legea nr. 5/2000"])("keeps %j as it is", (key) => {
    expect(labelFromKey(key)).toBe(key);
  });

  it("tells act names from source notes", () => {
    expect(namesAnAct("Legea nr. 5/2000")).toBe(true);
    expect(namesAnAct("amending acts named in the act's README.md")).toBe(false);
  });
});
