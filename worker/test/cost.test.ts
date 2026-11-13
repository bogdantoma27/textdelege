import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { QUERY_PARAMS, canonicalQuery } from "../src/lib/query-params";
import { isHeavy, rateLimitKey } from "../src/lib/rate-limit";

function context() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  return { ctx, settle: () => Promise.all(pending) };
}

function limiter(allow: boolean) {
  const keys: string[] = [];
  const binding: RateLimit = {
    async limit({ key }) {
      keys.push(key);
      return { success: allow };
    },
  };
  return { binding, keys };
}

async function fetchWith(path: string, bindings: Partial<Cloudflare.Env>, headers: HeadersInit = {}) {
  const { ctx, settle } = context();
  const response = await app.fetch(new Request(`https://example.com${path}`, { headers }), { ...env, ...bindings }, ctx);
  const copy = new Response(await response.arrayBuffer(), response);
  await settle();
  return copy;
}

describe("query parameters of the cache key", () => {
  it("keeps the known ones sorted, first value only, no empties", () => {
    expect(canonicalQuery(new URLSearchParams("x=1"))).toBe("");
    expect(canonicalQuery(new URLSearchParams("q=&in_force=&zz=2"))).toBe("");
    expect(canonicalQuery(new URLSearchParams("q=b&in_force=1&utm=3"))).toBe("?in_force=1&q=b");
    expect(canonicalQuery(new URLSearchParams("in_force=1&q=b"))).toBe("?in_force=1&q=b");
    expect(canonicalQuery(new URLSearchParams("q=a&q=b"))).toBe("?q=a");
    expect(canonicalQuery(new URLSearchParams("q=a%26b c"))).toBe("?q=a%26b+c");
  });

  it("lists every parameter that a route, a view or the filters read", () => {
    const sources = import.meta.glob(["../src/routes/*.tsx", "../src/lib/change-filter.ts", "../src/views/compare.tsx"], {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const read = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/(?:params|searchParams)\.(?:get|has|getAll)\("([a-z_]+)"\)/g)) read.add(match[1]!);
      for (const match of text.matchAll(/req\.query\("([a-z_]+)"\)/g)) read.add(match[1]!);
      // the comparison page keeps its flags in FLAGS, the filters read theirs by name
      for (const match of text.matchAll(/params\.get\(name\)/g)) void match;
    }
    for (const name of ["vedere", "doar", "paleta", "granularitate", "de", "pana", "act", "verb", "alt", "q"]) {
      expect(Object.values(sources).some((text) => text.includes(`"${name}"`)), name).toBe(true);
    }
    expect(read.size).toBeGreaterThan(12);
    const listed = new Set<string>(QUERY_PARAMS);
    expect([...read].filter((name) => !listed.has(name))).toEqual([]);
  });

  it("lists nothing that no source mentions", () => {
    const sources = import.meta.glob(["../src/routes/*.tsx", "../src/lib/change-filter.ts", "../src/views/compare.tsx"], {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const everything = Object.values(sources).join("\n");
    expect(QUERY_PARAMS.filter((name) => !everything.includes(`"${name}"`))).toEqual([]);
  });
});

describe("rate limits on cache misses", () => {
  it("lets a request through when the binding is absent", async () => {
    expect((await fetchWith("/despre?cuprins=nolimit", {})).status).toBe(200);
  });

  it("answers a miss over the limit with 429, Retry-After and a small Romanian page, never stored", async () => {
    const miss = limiter(false);
    const response = await fetchWith("/despre?cuprins=over", { MISS_LIMITER: miss.binding }, { "cf-connecting-ip": "203.0.113.9" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cache-Status")).toBeNull();
    expect(await response.text()).toContain("Prea multe cereri");
    expect(miss.keys).toEqual(["203.0.113.9"]);
    // Nothing was stored: with room again, the same address is built and served.
    const later = await fetchWith("/despre?cuprins=over", { MISS_LIMITER: limiter(true).binding });
    expect(later.status).toBe(200);
    expect(later.headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
  });

  it("never limits a hit", async () => {
    const open = limiter(true);
    const first = await fetchWith("/despre?cuprins=hit", { MISS_LIMITER: open.binding });
    expect(first.headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
    const shut = limiter(false);
    const again = await fetchWith("/despre?cuprins=hit", { MISS_LIMITER: shut.binding, HEAVY_LIMITER: shut.binding });
    expect(again.status).toBe(200);
    expect(again.headers.get("Cache-Status")).toBe("textdelege; hit");
    expect(shut.keys).toEqual([]);
  });

  it("counts a heavy route against both limiters and an ordinary one against the first only", async () => {
    const calls: string[] = [];
    const named = (name: string, allow = true): RateLimit => ({
      async limit() {
        calls.push(name);
        return { success: allow };
      },
    });
    expect((await fetchWith("/cauta?q=text", { MISS_LIMITER: named("miss"), HEAVY_LIMITER: named("heavy") })).status).toBe(200);
    expect(calls).toEqual(["miss", "heavy"]);
    calls.length = 0;
    expect((await fetchWith("/despre?cuprins=plain", { MISS_LIMITER: named("miss"), HEAVY_LIMITER: named("heavy", false) })).status).toBe(200);
    expect(calls).toEqual(["miss"]);
    calls.length = 0;
    const heavy = await fetchWith("/cauta?q=altceva", { MISS_LIMITER: named("miss"), HEAVY_LIMITER: named("heavy", false) });
    expect(heavy.status).toBe(429);
    expect(calls).toEqual(["miss", "heavy"]);
  });

  it("refuses a heavy miss with 503 when the sitewide limiter trips, after the per-client one", async () => {
    const calls: string[] = [];
    const named = (name: string, allow = true): RateLimit => ({
      async limit({ key }) {
        calls.push(`${name}:${key}`);
        return { success: allow };
      },
    });
    const response = await fetchWith(
      "/codul-civil/art-1/2013-03-03",
      { MISS_LIMITER: named("miss"), HEAVY_LIMITER: named("heavy"), SITE_HEAVY_LIMITER: named("site", false) },
      { "cf-connecting-ip": "203.0.113.9" },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cache-Status")).toBeNull();
    expect(await response.text()).toContain("Textul legilor rămâne disponibil");
    expect(calls).toEqual(["miss:203.0.113.9", "heavy:203.0.113.9", "site:all"]);
    calls.length = 0;
    const perClient = await fetchWith("/cauta?q=text", { HEAVY_LIMITER: named("heavy", false), SITE_HEAVY_LIMITER: named("site", false) });
    expect(perClient.status).toBe(429);
    expect(calls).toEqual(["heavy:unknown"]);
    calls.length = 0;
    expect((await fetchWith("/despre?cuprins=sitewide", { SITE_HEAVY_LIMITER: named("site", false) })).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("turns every heavy miss into 503 when HEAVY_ROUTES is off, and touches nothing else", async () => {
    expect(env.HEAVY_ROUTES).toBe("on");
    const heavy = await fetchWith("/cauta?q=text", { HEAVY_ROUTES: "off" });
    expect(heavy.status).toBe(503);
    expect(heavy.headers.get("Retry-After")).toBe("60");
    expect(heavy.headers.get("Cache-Status")).toBeNull();
    expect((await fetchWith("/codul-civil/art-1/2013-03-03", { HEAVY_ROUTES: "off" })).status).toBe(503);
    expect((await fetchWith("/sitemap.xml", { HEAVY_ROUTES: "off" })).status).toBe(503);
    // ordinary pages and cache hits are not affected
    expect((await fetchWith("/despre?cuprins=switch", { HEAVY_ROUTES: "off" })).status).toBe(200);
    expect((await fetchWith("/cauta?q=text", {})).status).toBe(200);
    const hit = await fetchWith("/cauta?q=text", { HEAVY_ROUTES: "off" });
    expect(hit.status).toBe(200);
    expect(hit.headers.get("Cache-Status")).toBe("textdelege; hit");
  });

  it("fails open when the limiter throws", async () => {
    const broken: RateLimit = {
      async limit() {
        throw new Error("down");
      },
    };
    expect((await fetchWith("/despre?cuprins=failopen", { MISS_LIMITER: broken })).status).toBe(200);
  });

  it("names the expensive routes", () => {
    for (const [path, search] of [
      ["/cauta", "?q=a"],
      ["/cauta", ""],
      ["/acte", ""],
      ["/codul-civil/art-1/compara/2011-10-01..2023-07-09", ""],
      ["/codul-civil/compara/2011-10-01..2023-07-09", ""],
      ["/modificari", "?verb=modified"],
      ["/modificari/lege/2009/287", "?de=2020-01-01"],
      ["/legislatie", ""],
      ["/legislatie/2020-01-01", ""],
      ["/sitemap.xml", ""],
      ["/sitemap-1.xml", ""],
      ["/codul-civil/2014-10-18", ""],
      ["/codul-civil/art-1/2014-10-18", ""],
      ["/lege/2009/287/2014-10-18", ""],
      ["/legislatie/2014-10-18", ""],
    ] as const) {
      expect(isHeavy(path, search), path + search).toBe(true);
    }
    for (const [path, search] of [
      ["/", ""],
      ["/modificari", ""],
      ["/modificari/lege/2009/287", ""],
      ["/codul-civil", "?pagina=2"],
      ["/codul-civil/art-1", ""],
      ["/despre", ""],
      ["/actele-mele", ""],
      ["/codul-civil/art-1-2014-10-18x", ""],
      ["/jurisprudenta/ccr/2019/1", ""],
    ] as const) {
      expect(isHeavy(path, search), path + search).toBe(false);
    }
  });

  it("buckets an IPv6 address by its /64", () => {
    expect(rateLimitKey("203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(rateLimitKey("2001:DB8::1")).toBe("2001:db8:0:0::/64");
  });
});
