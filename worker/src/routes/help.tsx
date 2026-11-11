import { Hono } from "hono";
import type { AppEnv } from "../lib/store";
import { parsePath } from "../lib/urls";
import { renderAbout, renderLegend } from "../views/help";

export const helpRoutes = new Hono<AppEnv>();

helpRoutes.get("*", (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "help") return next();
  switch (route.page) {
    case "despre":
      return c.html(renderAbout());
    case "legenda":
      return c.html(renderLegend());
  }
});
