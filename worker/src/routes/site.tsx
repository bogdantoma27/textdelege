import { Hono } from "hono";
import type { Context } from "hono";
import { type AppEnv, NoBuildError, type SitemapEntry } from "../lib/store";
import { actUrl, articleUrl } from "../lib/urls";
import { ORIGIN } from "../views/layout";
import { NotFound } from "../views/not-found";
import { Unavailable } from "../views/unavailable";

export function notFoundHandler(c: Context<AppEnv>) {
  return c.html(<NotFound path={c.req.path} />, 404);
}

function isStorageFailure(error: unknown): boolean {
  if (error instanceof NoBuildError) return true;
  return error instanceof Error && /\b(D1_[A-Z_]+|R2)\b/.test(error.message);
}

const RETRY_AFTER = "120";

export function errorHandler(error: Error, c: Context<AppEnv>) {
  const page = <Unavailable path={c.req.path} />;
  if (!isStorageFailure(error)) {
    console.error("unhandled error", c.req.path, error);
    return c.html(page, 500);
  }
  console.error("data store unavailable", c.req.path, error);
  c.header("Retry-After", RETRY_AFTER);
  return c.html(page, 503);
}

export const SITEMAP_SIZE = 50000;

const FIXED_PAGES = ["/", "/modificari", "/acte", "/despre", "/legenda", "/legislatie"];

const ROBOTS = `User-agent: *
Allow: /
Disallow: /cauta
Disallow: /*/compara/

Sitemap: ${ORIGIN}/sitemap.xml
`;

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const XML_TYPE = "application/xml; charset=utf-8";

function urlEntry(path: string, lastmod: string | null): string {
  const mod = lastmod === null ? "" : `<lastmod>${escapeXml(lastmod)}</lastmod>`;
  return `<url><loc>${escapeXml(`${ORIGIN}${path}`)}</loc>${mod}</url>`;
}

function entryPath(entry: SitemapEntry): string {
  return entry.number === null ? actUrl(entry.actRef) : articleUrl(entry.actRef, entry.number);
}

export const siteRoutes = new Hono<AppEnv>();

siteRoutes.get("/robots.txt", (c) => c.body(ROBOTS, 200, { "Content-Type": "text/plain; charset=utf-8" }));

siteRoutes.get("/sitemap.xml", async (c) => {
  const total = FIXED_PAGES.length + (await c.get("store").sitemapTotal());
  const children = Math.ceil(total / SITEMAP_SIZE);
  const items = Array.from(
    { length: children },
    (_, index) => `<sitemap><loc>${ORIGIN}/sitemap-${index + 1}.xml</loc></sitemap>`,
  ).join("");
  return c.body(
    `${XML_HEADER}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>\n`,
    200,
    { "Content-Type": XML_TYPE },
  );
});

siteRoutes.get("/:name{sitemap-[1-9][0-9]*\\.xml}", async (c) => {
  const n = Number(/^sitemap-(\d+)\.xml$/.exec(c.req.param("name"))?.[1]);
  const store = c.get("store");
  const total = FIXED_PAGES.length + (await store.sitemapTotal());
  if (!Number.isSafeInteger(n) || n > Math.ceil(total / SITEMAP_SIZE)) return c.notFound();
  const start = (n - 1) * SITEMAP_SIZE;
  const end = Math.min(total, start + SITEMAP_SIZE);
  const fixed = FIXED_PAGES.slice(start, end).map((path) => urlEntry(path, null));
  const from = Math.max(0, start - FIXED_PAGES.length);
  const take = end - start - fixed.length;
  const entries = take > 0 ? await store.sitemapEntries(take, from) : [];
  const rows = [...fixed, ...entries.map((entry) => urlEntry(entryPath(entry), entry.lastmod))];
  return c.body(
    `${XML_HEADER}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.join("")}</urlset>\n`,
    200,
    { "Content-Type": XML_TYPE },
  );
});
