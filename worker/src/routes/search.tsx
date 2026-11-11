import { Hono } from "hono";
import { type Citation, citationUrl, parseCitation } from "../lib/citation";
import { COUNT_CAP, type AppEnv, type Store } from "../lib/store";
import type { Manifest } from "../lib/types";
import { lawKeyFromActRef, lawUrlFromKey } from "../lib/urls";
import { actNames } from "../views/changes";
import { pageNumber } from "../lib/act";
import { HITS_LIMIT, MAX_QUERY, renderSearch } from "../views/search";

function isSelected(manifest: Manifest, citation: Citation): boolean {
  const { alias, kind, number, year } = citation.act;
  if (alias !== undefined) return manifest.acts.some((act) => act.alias === alias);
  return manifest.acts.some((act) => act.path === `${kind}/${year}/${number}`);
}

async function amendingActUrl(store: Store, citation: Citation): Promise<string | null> {
  const { kind, number, year } = citation.act;
  if (kind === undefined || number === undefined || year === undefined) return null;
  const key = lawKeyFromActRef(`${kind}/${year}/${number}`);
  if (key === null || (await store.law(key)) === null) return null;
  return lawUrlFromKey(key);
}

export const LIVE_LIMIT = 8;

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get("/cauta", async (c) => {
  const query = (c.req.query("q") ?? "").slice(0, MAX_QUERY).trim();
  const inForce = c.req.query("in_force") === "1";
  const store = c.get("store");
  const manifest = await store.manifest();
  const names = actNames(manifest);

  if (query === "") return c.html(renderSearch({ query, inForce, hits: null, total: 0, over: false, live: false, page: 1, pages: 1, names }));

  const citation = parseCitation(query);
  const target = citation === null ? null : citationUrl(citation);
  if (citation !== null && target !== null && isSelected(manifest, citation)) {
    return c.redirect(target, 302);
  }
  const law = citation === null ? null : await amendingActUrl(store, citation);
  if (law !== null) return c.redirect(law, 302);

  if (c.req.query("live") === "1") {
    const hits = await store.search(query, inForce, LIVE_LIMIT);
    return c.html(renderSearch({ query, inForce, hits, total: hits.length, over: false, live: true, page: 1, pages: 1, names }));
  }

  const counted = await store.searchCount(query, inForce);
  const over = counted > COUNT_CAP;
  const total = Math.min(counted, COUNT_CAP);
  const pages = Math.max(1, Math.ceil(total / HITS_LIMIT));
  const page = Math.min(pageNumber(c.req.query("pagina") ?? null), pages);
  const hits = total === 0 ? [] : await store.search(query, inForce, HITS_LIMIT, (page - 1) * HITS_LIMIT);
  return c.html(renderSearch({ query, inForce, hits, total, over, live: false, page, pages, names }));
});
