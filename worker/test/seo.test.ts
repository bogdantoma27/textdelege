import { describe, expect, it } from "vitest";
import { plainText, serializeJsonLd, truncateAtWord } from "../src/lib/seo";

describe("plainText", () => {
  it("collapses whitespace", () => {
    expect(plainText("  a \n\t b  ")).toBe("a b");
  });
});

describe("truncateAtWord", () => {
  it("returns short text unchanged", () => {
    expect(truncateAtWord("Un text scurt", 50)).toBe("Un text scurt");
  });

  it("cuts at a word boundary and adds an ellipsis within the limit", () => {
    const out = truncateAtWord("unu doi trei patru cinci", 14);
    expect(out).toBe("unu doi trei…");
    expect(out.length).toBeLessThanOrEqual(14);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    expect(truncateAtWord("unu doi, trei patru", 10)).toBe("unu doi…");
  });

  it("cuts inside a single long word", () => {
    expect(truncateAtWord("abcdefghijklmnop", 6)).toBe("abcde…");
  });
});

describe("serializeJsonLd", () => {
  it("escapes characters that could close the script tag", () => {
    const out = serializeJsonLd({ a: "</script><b>&" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(JSON.parse(out)).toEqual({ a: "</script><b>&" });
  });
});
