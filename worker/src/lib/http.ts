import type { MiddlewareHandler } from "hono";
import { PRE_PAINT, SCRIPTED_SPECULATION_RULES, SPECULATION_RULES } from "../views/layout";
import { today } from "./dates";
import type { AppEnv } from "./store";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

let policy: Promise<string> | undefined;

// Inline scripts are allowed by hash only; keep the policy free of unsafe-inline for scripts.
function contentSecurityPolicy(): Promise<string> {
  policy ??= Promise.all([PRE_PAINT, SPECULATION_RULES, SCRIPTED_SPECULATION_RULES].map(sha256)).then((hashes) =>
    [
      "default-src 'self'",
      `script-src 'self' 'inline-speculation-rules' ${hashes.map((hash) => `'sha256-${hash}'`).join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  return policy;
}

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const response = new Response(c.res.body, c.res);
  const headers = response.headers;
  headers.set("Content-Security-Policy", await contentSecurityPolicy());
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (new URL(c.req.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  c.res = response;
};

const UNCACHED = new Set(["/healthz"]);

const CACHE_CONTROL = "public, max-age=300, s-maxage=604800";

export const pageCache: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  if (c.req.method !== "GET" || UNCACHED.has(url.pathname)) return next();
  let build: string;
  try {
    build = (await c.get("store").manifest()).build;
  } catch {
    return next();
  }
  const version = c.env.CF_VERSION_METADATA?.id ?? "";
  const key = new Request(`${url.origin}/_cache/${build}/${version}/${today()}${url.pathname}${url.search}`);
  const cache = caches.default;
  const fresh = /\bno-cache\b/.test(c.req.header("Cache-Control") ?? "");
  const stored = fresh ? undefined : await cache.match(key);
  if (stored !== undefined) {
    const hit = new Response(stored.body, stored);
    hit.headers.set("Cache-Status", "textdelege; hit");
    return hit;
  }
  await next();
  if (c.res.status !== 200) return;
  const response = new Response(c.res.body, c.res);
  response.headers.set("Cache-Control", CACHE_CONTROL);
  c.executionCtx.waitUntil(cache.put(key, response.clone()));
  response.headers.set("Cache-Status", "textdelege; fwd=miss; stored");
  c.res = response;
};
