import { Hono } from "hono";
import { pageNumber } from "../lib/act";
import type { AppEnv } from "../lib/store";
import { lawKeyFromActRef, parsePath } from "../lib/urls";
import { actNames } from "../views/changes";
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

  const index = await store.actIndex();
  return c.html(renderLaw(law, actNames(index), pageNumber(c.req.query("pagina") ?? null)));
});
