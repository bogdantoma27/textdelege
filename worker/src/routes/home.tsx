import { Hono } from "hono";
import { today } from "../lib/dates";
import type { AppEnv } from "../lib/store";
import { actNames } from "../views/changes";
import { renderHome } from "../views/home";

export const homeRoutes = new Hono<AppEnv>();

homeRoutes.get("/", async (c) => {
  const store = c.get("store");
  const [manifest, changes, index] = await Promise.all([store.manifest(), store.changes("site"), store.actIndex()]);
  return c.html(renderHome({ now: today(), historical: c.req.query("coduri") === "istorice" }, manifest, changes, actNames(index)));
});
