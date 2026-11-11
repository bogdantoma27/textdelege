import { describe, expect, it } from "vitest";
import { stateAt } from "../src/views/point-in-time";
import { parseActStatus } from "../src/lib/status";

describe("parseActStatus", () => {
  it("reads an act in force", () => {
    expect(parseActStatus("in force")).toEqual({ kind: "in-force", repealedOn: null });
  });

  it("reads the repeal date", () => {
    expect(parseActStatus("repealed 2013-02-15")).toEqual({ kind: "repealed", repealedOn: "2013-02-15" });
  });

  it("reads a repeal without a date", () => {
    expect(parseActStatus("repealed")).toEqual({ kind: "repealed", repealedOn: null });
  });

  it("reads an act amended but not consolidated", () => {
    expect(parseActStatus("amended, not consolidated")).toEqual({ kind: "unconsolidated", repealedOn: null });
  });

  it("treats anything else as other", () => {
    expect(parseActStatus("in-force")).toEqual({ kind: "other", repealedOn: null });
    expect(parseActStatus("repealed 2013-2-15")).toEqual({ kind: "other", repealedOn: null });
    expect(parseActStatus("")).toEqual({ kind: "other", repealedOn: null });
  });
});

describe("stateAt", () => {
  const act = (status: string) => ({ ref: "x", name: "X", from: "2000-01-01", status, latest: "2010-05-05" });

  it("ends a repealed act on the date in the status", () => {
    expect(stateAt(act("repealed 2013-02-15"), "2013-02-14")).toBe("in-force");
    expect(stateAt(act("repealed 2013-02-15"), "2013-02-15")).toBe("repealed");
  });

  it("falls back to the newest version when the repeal has no date", () => {
    expect(stateAt(act("repealed"), "2010-05-05")).toBe("repealed");
  });

  it("keeps acts in force that the source does not mark as repealed", () => {
    expect(stateAt(act("in force"), "2030-01-01")).toBe("in-force");
    expect(stateAt(act("amended, not consolidated"), "2030-01-01")).toBe("in-force");
  });
});
