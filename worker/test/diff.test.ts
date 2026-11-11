import { describe, expect, it } from "vitest";
import { diffLines, diffStats } from "../src/lib/diff";
import type { ArticleLine } from "../src/lib/types";

const line = (id: string, text: string): ArticleLine => ({ id, text, since: "2011-10-01", law: "x" });
const joined = (parts: { value: string }[]) => parts.map((part) => part.value).join("");

describe("diffLines", () => {
  it("aligns by paragraph id and marks added and removed paragraphs in order", () => {
    const before = [line("alin-1", "(1) Unu."), line("alin-2", "(2) Doi."), line("alin-3", "(3) Trei.")];
    const after = [line("alin-1", "(1) Unu."), line("alin-3", "(3) Trei!"), line("alin-4", "(4) Patru.")];
    const result = diffLines(before, after, "word");
    expect(result.map((entry) => [entry.id, entry.status])).toEqual([
      ["alin-1", "same"],
      ["alin-2", "removed"],
      ["alin-3", "changed"],
      ["alin-4", "added"],
    ]);
    expect(diffStats(result)).toEqual({ same: 1, changed: 1, added: 1, removed: 1 });
  });

  it("puts removed lines after their preceding neighbour, or first when none precedes", () => {
    const before = [line("a", "A."), line("b", "B."), line("c", "C.")];
    const after = [line("c", "C."), line("d", "D.")];
    expect(diffLines(before, after, "word").map((entry) => `${entry.id}:${entry.status}`)).toEqual([
      "a:removed",
      "b:removed",
      "c:same",
      "d:added",
    ]);
    const mid = diffLines([line("a", "A."), line("b", "B."), line("c", "C.")], [line("a", "A."), line("c", "C.")], "word");
    expect(mid.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("gives whole-line parts to added, removed and same lines", () => {
    const [removed, added, same] = diffLines(
      [line("a", "(1) Vechi."), line("c", "Egal.")],
      [line("b", "(1) Nou."), line("c", "Egal.")],
      "word",
    );
    expect(removed?.parts).toEqual([{ value: "Vechi.", removed: true }]);
    expect(removed?.marker).toBe("(1)");
    expect(added?.parts).toEqual([{ value: "Nou.", added: true }]);
    expect(same?.parts).toEqual([{ value: "Egal." }]);
  });

  it("word diff on an art. 1112 style paragraph yields two changes", () => {
    const old =
      "(2) Citația trebuie să precizeze că, dacă succesibilul nu a acceptat în termenul prevăzut la art. 1.103, se consideră că a renunțat la moștenire.";
    const next =
      "(2) Citația trebuie să precizeze că, dacă succesibilul nu a acceptat în termenul de decădere prevăzut la art. 1.103, se consideră că a renunțat expres la moștenire.";
    const [entry] = diffLines([line("alin-2", old)], [line("alin-2", next)], "word");
    expect(entry?.status).toBe("changed");
    expect(entry?.marker).toBe("(2)");
    const marked = entry!.parts.filter((part) => part.added || part.removed);
    expect(marked).toEqual([
      { value: "de decădere ", added: true },
      { value: "expres ", added: true },
    ]);
    expect(joined(entry!.parts.filter((part) => !part.added))).toBe(old.replace("(2) ", ""));
    expect(joined(entry!.parts.filter((part) => !part.removed))).toBe(next.replace("(2) ", ""));
  });

  it("joins a rewritten phrase into one deletion followed by one insertion", () => {
    const [entry] = diffLines(
      [line("a", "Dacă se consideră că a renunțat, atunci.")],
      [line("a", "Dacă este prezumat că renunță, atunci.")],
      "word",
    );
    const marked = entry!.parts.filter((part) => part.added || part.removed);
    expect(marked.map((part) => `${part.removed ? "-" : "+"}${part.value}`)).toEqual([
      "-se consideră",
      "+este prezumat",
      "-a renunțat",
      "+renunță",
    ]);
    expect(joined(entry!.parts.filter((part) => !part.added))).toBe(
      "Dacă se consideră că a renunțat, atunci.",
    );
    expect(joined(entry!.parts.filter((part) => !part.removed))).toBe(
      "Dacă este prezumat că renunță, atunci.",
    );
  });

  it("splits inside words at character granularity", () => {
    const a = [line("a", "Succesorul decide.")];
    const b = [line("a", "Succesorii decid.")];
    const word = diffLines(a, b, "word")[0]!.parts;
    const chars = diffLines(a, b, "char")[0]!.parts;
    expect(word.some((part) => part.removed && part.value.includes("Succesorul"))).toBe(true);
    expect(chars.some((part) => !part.added && !part.removed && part.value.startsWith("Succesor"))).toBe(true);
    expect(chars.some((part) => part.added && part.value === "ii")).toBe(true);
    expect(joined(chars.filter((part) => !part.removed))).toBe("Succesorii decid.");
  });

  it("keeps a differing marker inside the diff", () => {
    const [entry] = diffLines([line("a", "(2) Text.")], [line("a", "(3) Text.")], "word");
    expect(entry?.marker).toBeNull();
    expect(joined(entry!.parts.filter((part) => !part.removed))).toBe("(3) Text.");
  });

  it("returns an empty list for two empty versions", () => {
    expect(diffLines([], [], "word")).toEqual([]);
  });
});
