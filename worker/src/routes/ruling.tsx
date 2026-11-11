import { Hono } from "hono";
import { t } from "../text";
import type { AppEnv } from "../lib/store";
import type { ActObject } from "../lib/types";
import { actUrl, articleUrl, parsePath, rulingKeyFromRoute } from "../lib/urls";
import { type AffectedArticle, renderRuling } from "../views/ruling";

export const rulingRoutes = new Hono<AppEnv>();

rulingRoutes.get("*", async (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "ruling") return next();
  const key = rulingKeyFromRoute(route);
  if (key === null) return c.notFound();

  const store = c.get("store");
  const ruling = await store.ruling(key);
  if (ruling === null) return c.notFound();

  const paths = [...new Set(ruling.articles.map((article) => article.act_path))];
  const acts = new Map<string, ActObject | null>(
    await Promise.all(paths.map(async (path) => [path, await store.act(path)] as const)),
  );

  const affected: AffectedArticle[] = [];
  for (const { act_path, file } of ruling.articles) {
    const act = acts.get(act_path);
    const entry = act?.articles.find((candidate) => candidate.file === file);
    if (!act || !entry) continue;
    affected.push({
      href: articleUrl(act.alias ?? act.path, entry.number, ruling.binding_from ?? undefined),
      actHref: actUrl(act.alias ?? act.path),
      article: t("articleAbbr", { number: entry.number }),
      act: act.short ?? act.title,
    });
  }
  return c.html(renderRuling(ruling, affected));
});
