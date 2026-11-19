import { type Context, Hono } from "hono";
import { ordered } from "../lib/act-order";
import { pageNumber } from "../lib/act";
import { parseDate, today } from "../lib/dates";
import type { AppEnv, Store } from "../lib/store";
import type { ActIndexEntry, Manifest } from "../lib/types";
import { parsePath } from "../lib/urls";
import { type PitAct, type PitOthers, PAGE_SIZE, renderPointInTime } from "../views/point-in-time";

const KIND_ORDER = ["lege", "oug", "og", "hg", "decret-lege", "decret", "hotarare-parlament"];

const kindRank = (kind: string) => {
  const rank = KIND_ORDER.indexOf(kind);
  return rank === -1 ? KIND_ORDER.length : rank;
};

async function otherActs(
  store: Store,
  featured: Manifest["acts"],
  tip: string | undefined,
  rawPage: string | undefined,
): Promise<PitOthers | null> {
  // Counts per kind come from the build's memo; the featured acts (read from D1, one bounded query) are taken out.
  const [all, featuredRows] = await Promise.all([store.kindCounts(), store.actsByPath(featured.map((act) => act.path))]);
  const counts = new Map(all);
  for (const { kind } of featuredRows.values()) counts.set(kind, (counts.get(kind) ?? 0) - 1);
  const kinds = [...counts]
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.kind.localeCompare(b.kind));
  if (kinds.length === 0) return null;
  const selected = kinds.find((entry) => entry.kind === tip)?.kind ?? kinds[0]!.kind;
  const total = kinds.find((entry) => entry.kind === selected)!.count;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageNumber(rawPage ?? null), pages);
  const members = await store.actsOfKind(
    selected,
    featured.map((act) => act.path),
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  );
  const items: PitAct[] = members.map((act) => toPitAct(act, act.from));
  return { kinds, selected, items, page, pages };
}

function toPitAct(entry: Omit<ActIndexEntry, "kind" | "from" | "articles">, from: string | null): PitAct {
  return {
    ref: entry.alias ?? entry.path,
    name: entry.short ?? entry.title,
    from,
    status: entry.status,
    latest: entry.latest,
  };
}

export const pointInTimeRoutes = new Hono<AppEnv>();

async function pointInTimePage(c: Context<AppEnv>, date: string, invalid?: string) {
  const store = c.get("store");
  const manifest = await store.manifest();
  const acts: PitAct[] = ordered(manifest.acts).map((entry) => toPitAct(entry, entry.from ?? null));
  const others = await otherActs(
    store,
    manifest.acts,
    c.req.query("tip"),
    c.req.query("pagina"),
  );
  return c.html(renderPointInTime(date, acts, today(), invalid, others), invalid === undefined ? 200 : 400);
}

pointInTimeRoutes.get("/legislatie", async (c) => {
  const typed = (c.req.query("data") ?? "").trim();
  if (typed === "") return c.redirect(`/legislatie/${today()}`, 302);
  const picked = parseDate(typed);
  return picked === null ? await pointInTimePage(c, today(), typed) : c.redirect(`/legislatie/${picked}`, 302);
});

pointInTimeRoutes.get("/la-data/:date?", (c) => {
  const url = new URL(c.req.url);
  const date = c.req.param("date");
  return c.redirect(`/legislatie${date === undefined ? "" : `/${date}`}${url.search}`, 301);
});

pointInTimeRoutes.get("*", (c, next) => {
  const route = parsePath(c.req.path);
  return route?.kind === "pointInTime" ? pointInTimePage(c, route.date) : next();
});
