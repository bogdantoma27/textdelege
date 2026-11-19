import { Hono } from "hono";
import { pageNumber } from "../lib/act";
import type { AppEnv } from "../lib/store";
import { lawKeyFromActRef, parsePath } from "../lib/urls";
import { namesOf } from "../views/changes";
import { renderLaw } from "../views/law";

export const lawRoutes = new Hono<AppEnv>();

lawRoutes.get("*", async (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "act" || route.tab !== null || route.date !== null) return next();
  const key = lawKeyFromActRef(route.actRef);
  if (key === null) return next();

  const store = c.get("store");
  const law = await store.law(key);
  if (law === null) return c.notFound();

  const names = await namesOf(store, law.changes.map((change) => change.act_path));
  return c.html(renderLaw(law, names, pageNumber(c.req.query("pagina") ?? null)));
});
