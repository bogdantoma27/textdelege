import { type Context, Hono } from "hono";
import { ordered } from "../lib/act-order";
import { pageNumber } from "../lib/act";
import { parseDate, today } from "../lib/dates";
import type { AppEnv } from "../lib/store";
import type { ActIndexEntry } from "../lib/types";
import { actPathParts, parsePath } from "../lib/urls";
import { type PitAct, type PitOthers, PAGE_SIZE, renderPointInTime } from "../views/point-in-time";

const KIND_ORDER = ["lege", "oug", "og", "hg", "decret-lege", "decret", "hotarare-parlament"];

const kindRank = (kind: string) => {
  const rank = KIND_ORDER.indexOf(kind);
  return rank === -1 ? KIND_ORDER.length : rank;
};

function byNewest(a: ActIndexEntry, b: ActIndexEntry): number {
  const { year: yearA, number: numberA } = actPathParts(a.path);
  const { year: yearB, number: numberB } = actPathParts(b.path);
  return (
    Number(yearB) - Number(yearA) || Number(numberB) - Number(numberA) || a.path.localeCompare(b.path)
  );
}

function otherActs(rest: ActIndexEntry[], tip: string | undefined, rawPage: string | undefined): PitOthers | null {
  if (rest.length === 0) return null;
  const counts = new Map<string, number>();
  for (const act of rest) counts.set(act.kind, (counts.get(act.kind) ?? 0) + 1);
  const kinds = [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.kind.localeCompare(b.kind));
  const selected = kinds.find((entry) => entry.kind === tip)?.kind ?? kinds[0]!.kind;
  const members = rest.filter((act) => act.kind === selected).sort(byNewest);
  const pages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
  const page = Math.min(pageNumber(rawPage ?? null), pages);
  const items: PitAct[] = members.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((act) => toPitAct(act, act.from));
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
  const [manifest, index] = await Promise.all([store.manifest(), store.actIndex()]);
  const fromOf = new Map(index.map((entry) => [entry.path, entry.from]));
  const acts: PitAct[] = ordered(manifest.acts).map((entry) => toPitAct(entry, fromOf.get(entry.path) ?? null));
  const featured = new Set(manifest.acts.map((entry) => entry.path));
  const others = otherActs(
    index.filter((entry) => !featured.has(entry.path)),
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
