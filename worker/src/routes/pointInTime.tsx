import { type Context, Hono } from "hono";
import { ordered } from "../lib/act-order";
import { parseDate, today } from "../lib/dates";
import type { AppEnv } from "../lib/store";
import { parsePath } from "../lib/urls";
import { type PitAct, renderPointInTime } from "../views/point-in-time";

export const pointInTimeRoutes = new Hono<AppEnv>();

async function pointInTimePage(c: Context<AppEnv>, date: string, invalid?: string) {
  const store = c.get("store");
  const manifest = await store.manifest();
  const acts: PitAct[] = await Promise.all(
    ordered(manifest.acts).map(async (entry) => ({
      ref: entry.alias ?? entry.path,
      name: entry.short ?? entry.title,
      from: (await store.act(entry.path))?.from ?? null,
      status: entry.status,
      latest: entry.latest,
    })),
  );
  return c.html(renderPointInTime(date, acts, today(), invalid), invalid === undefined ? 200 : 400);
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
