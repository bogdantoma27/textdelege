import { Hono } from "hono";
import { today } from "../lib/dates";
import type { AppEnv } from "../lib/store";
import { actNames } from "../views/changes";
import { POPULAR, renderHome } from "../views/home";

export const homeRoutes = new Hono<AppEnv>();

homeRoutes.get("/", async (c) => {
  const store = c.get("store");
  const [manifest, changes, kinds] = await Promise.all([store.manifest(), store.changes("site"), store.kindCounts()]);
  const shown = [...(changes?.items ?? []), ...(changes?.upcoming ?? [])].map((item) => item.act_path);
  const acts = await store.actsByPath([...POPULAR.map((popular) => popular.path), ...shown]);
  const popular = new Map(POPULAR.flatMap(({ path }) => (acts.has(path) ? [[path, acts.get(path)!] as const] : [])));
  return c.html(
    renderHome({ now: today(), historical: c.req.query("coduri") === "istorice" }, manifest, changes, actNames([...acts.values()]), popular, kinds),
  );
});
