import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { today } from "../src/lib/dates";
import app from "../src/index";
import { createStore, resetStoreCache } from "../src/lib/store";
import { PRE_PAINT, SCRIPTED_SPECULATION_RULES, SPECULATION_RULES } from "../src/views/layout";
import { seedObjects } from "./seed";
import { replaceObject } from "./support";

// The page is stored from a copy of the body, so read it before asking again.
async function get(path: string, origin = "https://example.com"): Promise<Response> {
  const response = await exports.default.fetch(`${origin}${path}`, { redirect: "manual" });
  return new Response(await response.arrayBuffer(), response);
}

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** The page is stored by waitUntil after the response, so give the store a moment before calling it a miss. */
async function again(path: string): Promise<Response> {
  let response = await get(path);
  for (let attempt = 0; attempt < 20 && response.headers.get("Cache-Status") !== "textdelege; hit"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    response = await get(path);
  }
  expect(response.headers.get("Cache-Status")).toBe("textdelege; hit");
  return response;
}

beforeEach(() => vi.unstubAllGlobals());

describe("the store of a request", () => {
  it("reads the manifest from storage once for a page that is not cached", async () => {
    let manifestReads = 0;
    const data = new Proxy(env.DATA, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property !== "get") return typeof member === "function" ? member.bind(target) : member;
        return (key: string, ...rest: unknown[]) => {
          if (key === "manifest.json") manifestReads++;
          return (member as (...args: unknown[]) => unknown).call(target, key, ...rest);
        };
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const response = await app.fetch(new Request("https://example.com/codul-civil/art-1?cuprins=unica"), { ...env, DATA: data }, context);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<h1");
    expect(manifestReads).toBe(1);
  });

  it("keeps the manifest for a minute across requests of the same isolate", async () => {
    let manifestReads = 0;
    const data = new Proxy(env.DATA, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (property !== "get") return typeof member === "function" ? member.bind(target) : member;
        return (key: string, ...rest: unknown[]) => {
          if (key === "manifest.json") manifestReads++;
          return (member as (...args: unknown[]) => unknown).call(target, key, ...rest);
        };
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    for (const path of ["/despre", "/legenda", "/despre"]) {
      const response = await app.fetch(new Request(`https://example.com${path}?cuprins=manifest`), { ...env, DATA: data }, context);
      expect(response.status).toBe(200);
    }
    expect(manifestReads).toBe(1);
    resetStoreCache();
    await app.fetch(new Request("https://example.com/legenda?cuprins=manifest2"), { ...env, DATA: data }, context);
    expect(manifestReads).toBe(2);
  });
});

describe("security headers", () => {
  it("sends the policy and the other headers on pages, errors and the health check", async () => {
    for (const path of ["/codul-civil", "/nu-exista", "/healthz", "/modificari.atom"]) {
      const headers = (await get(path)).headers;
      expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headers.get("Permissions-Policy")).toBe("camera=(), geolocation=(), microphone=()");
      expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
      expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    }
  });

  it("allows the inline scripts of the layout by their hashes and nothing else inline", async () => {
    const policy = (await get("/codul-civil")).headers.get("Content-Security-Policy")!;
    const directives = Object.fromEntries(policy.split("; ").map((d) => [d.slice(0, d.indexOf(" ")), d.slice(d.indexOf(" ") + 1)]));
    expect(directives["script-src"]).toBe(
      `'self' 'inline-speculation-rules' 'sha256-${await hash(PRE_PAINT)}' 'sha256-${await hash(SPECULATION_RULES)}' 'sha256-${await hash(SCRIPTED_SPECULATION_RULES)}'`,
    );
    expect(directives["style-src"]).toBe("'self' 'unsafe-inline'");
    expect(directives["connect-src"]).toBe("'self'");
    expect(directives["form-action"]).toBe("'self'");
    expect(directives["frame-ancestors"]).toBe("'none'");
    expect(directives["object-src"]).toBe("'none'");
    expect(directives["base-uri"]).toBe("'none'");
  });

  it("asks for HTTPS only when answering over HTTPS", async () => {
    expect((await get("/codul-civil", "http://localhost:8787")).headers.get("Strict-Transport-Security")).toBeNull();
  });
});

describe("page cache", () => {
  afterEach(() => seedObjects(env));

  it("stores a successful page and serves it again, under the build and the day", async () => {
    const path = "/codul-civil/art-1";
    const first = await get(path);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=604800");
    const body = await first.text();
    const second = await again(path);
    expect(await second.text()).toBe(body);
    expect(second.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    const build = (await (await get("/healthz")).json<{ build: string }>()).build;
    const version = env.CF_VERSION_METADATA?.id ?? "";
    expect(await caches.default.match(`https://example.com/_cache/${build}/${version}/${today()}${path}`)).toBeDefined();
  });

  it("starts afresh with a new build", async () => {
    const path = "/codul-civil/art-2";
    await get(path);
    await again(path);
    const manifest = await createStore(env).manifest();
    const restore = await replaceObject("manifest.json", { ...manifest, build: "20261109T060000Z-abcdef0" });
    try {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
    } finally {
      await restore();
    }
  });

  it("ignores a Cache-Control: no-cache request header", async () => {
    const path = "/codul-civil/art-1/2014-10-18";
    await get(path);
    await again(path);
    const forced = await exports.default.fetch(`https://example.com${path}`, { headers: { "Cache-Control": "no-cache" } });
    expect(forced.headers.get("Cache-Status")).toBe("textdelege; hit");
  });

  it("gives every address with unknown parameters the entry of the bare address", async () => {
    const path = "/codul-civil/art-1/2015-02-02";
    expect((await get(path)).headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
    await again(path);
    for (const variant of [`${path}?x=123`, `${path}?utm_source=a&fbclid=b`, `${path}?cuprins=`, `${path}?atribuire=&zz=1`]) {
      expect((await get(variant)).headers.get("Cache-Status"), variant).toBe("textdelege; hit");
    }
    // A parameter the page reads is part of the key, whatever its position.
    expect((await get(`${path}?ultima=1&atribuire=0`)).headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
    expect((await get(`${path}?atribuire=0&ultima=1&x=1`)).headers.get("Cache-Status")).toBe("textdelege; hit");
  });

  it("stores a 404 for five minutes under the same key rules", async () => {
    const first = await get("/nu-exista-nicaieri");
    expect(first.status).toBe(404);
    expect(first.headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=300");
    const second = await get("/nu-exista-nicaieri?x=1");
    expect(second.status).toBe(404);
    expect(second.headers.get("Cache-Status")).toBe("textdelege; hit");
    expect((await get("/sitemap-999.xml")).headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=300");
  });

  it("stores a search page like any other, and does not store its redirects", async () => {
    const path = "/cauta?q=text";
    const first = await get(path);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=604800");
    await again(path);
    const redirect = await get("/cauta?q=art.+1+Codul+civil");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Cache-Status")).toBeNull();
    expect((await get("/cauta?q=art.+1+Codul+civil")).status).toBe(302);
  });

  it("stores the home page as one entry: the second visit is a hit", async () => {
    const first = await get("/");
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=604800");
    expect((await get("/")).headers.get("Cache-Status")).toBe("textdelege; hit");
  });

  it("keeps the health check and server errors out of the cache", async () => {
    const response = await get("/healthz");
    expect(response.headers.get("Cache-Status")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBeNull();
    const broken = new Proxy(env.DB, {
      get(target, property) {
        if (property !== "prepare") return Reflect.get(target, property, target);
        return () => {
          throw new Error("D1_ERROR: broken");
        };
      },
    });
    const context = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    const failed = await app.fetch(new Request("https://example.com/cauta?q=eroare-dbx"), { ...env, DB: broken }, context);
    expect(failed.status).toBe(503);
    expect(failed.headers.get("Cache-Status")).toBeNull();
    expect((await get("/cauta?q=eroare-dbx")).headers.get("Cache-Status")).toBe("textdelege; fwd=miss; stored");
  });

  it("does not store redirects", async () => {
    const response = await get("/la-data/2019-01-01");
    expect(response.status).toBe(301);
    expect(response.headers.get("Cache-Status")).toBeNull();
  });
});
