import { describe, expect, it } from "vitest";
import { resolveView, versionOn } from "../src/lib/versions";
import type { ArticleObject, ArticleVersion } from "../src/lib/types";

function version(from: string, until: string | null): ArticleVersion {
  return { from, until, commit: "c".repeat(40), law_commit: "d".repeat(40), law: null, kind: "law", lines: [] };
}

function article(versions: ArticleVersion[]): ArticleObject {
  return { versions } as ArticleObject;
}

const TWO = article([version("2011-10-01", "2023-07-08"), version("2023-07-09", null)]);
const GAP = article([version("2012-01-01", "2019-12-31"), version("2022-01-01", null)]);
const REPEALED = article([version("2012-01-01", "2019-12-31")]);
const FUTURE = article([version("2030-01-01", null)]);

describe("versionOn", () => {
  it("includes both ends of a version", () => {
    expect(versionOn(TWO, "2011-10-01")?.index).toBe(0);
    expect(versionOn(TWO, "2023-07-08")?.index).toBe(0);
    expect(versionOn(TWO, "2023-07-09")?.index).toBe(1);
  });

  it("treats an open version as running forever", () => {
    expect(versionOn(TWO, "2099-01-01")?.index).toBe(1);
  });

  it("returns null before the first version and inside a gap", () => {
    expect(versionOn(TWO, "2011-09-30")).toBeNull();
    expect(versionOn(GAP, "2020-06-01")).toBeNull();
    expect(versionOn(REPEALED, "2020-01-01")).toBeNull();
  });

  it("returns the version object together with its index", () => {
    const hit = versionOn(TWO, "2020-01-01");
    expect(hit?.version).toBe(TWO.versions[0]);
  });
});

describe("resolveView", () => {
  it("shows the version covering today when there is no date", () => {
    expect(resolveView(TWO, null, "2026-11-08")).toMatchObject({ kind: "exact", hit: { index: 1 } });
  });

  it("shows the version covering the date when there is one", () => {
    expect(resolveView(TWO, "2014-10-18", "2026-11-08")).toMatchObject({ kind: "exact", hit: { index: 0 } });
  });

  it("falls back to the latest earlier version after a repeal or inside a gap", () => {
    expect(resolveView(REPEALED, null, "2026-11-08")).toMatchObject({ kind: "ended", hit: { index: 0 } });
    expect(resolveView(GAP, "2020-06-01", "2026-11-08")).toMatchObject({ kind: "ended", hit: { index: 0 } });
  });

  it("shows the first version with a notice when only future versions exist", () => {
    expect(resolveView(FUTURE, null, "2026-11-08")).toMatchObject({ kind: "notYet", hit: { index: 0 } });
  });

  it("reports a dated page before the first version", () => {
    expect(resolveView(TWO, "2005-01-01", "2026-11-08")).toMatchObject({
      kind: "beforeFirst",
      hit: { index: 0 },
    });
  });

  it("returns null for an article without versions", () => {
    expect(resolveView(article([]), null, "2026-11-08")).toBeNull();
  });
});
