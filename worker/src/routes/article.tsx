import { Hono } from "hono";
import { parseDate, today } from "../lib/dates";
import { resolveAct } from "../lib/resolve";
import type { AppEnv } from "../lib/store";
import { articleUrl, findArticle, parsePath } from "../lib/urls";
import { versionOn } from "../lib/versions";
import { type ArticleContext, renderArticle } from "../views/article";

function context(params: URLSearchParams): Omit<ArticleContext, "now"> {
  return {
    attribution: params.get("atribuire") !== "0",
    highlightLast: params.get("ultima") === "1",
    filter: (params.get("cuprins") ?? "").slice(0, 100),
  };
}

export const articleRoutes = new Hono<AppEnv>();

articleRoutes.get("*", async (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "article") return next();

  const params = new URL(c.req.url).searchParams;

  const store = c.get("store");
  const act = await resolveAct(store, route.actRef);
  const entry = act === null ? undefined : findArticle(act.articles, route.slug);
  if (!act || !entry) return c.notFound();
  const article = await store.article(act.path, entry.file);
  if (article === null || article.versions.length === 0) return c.notFound();

  const typed = params.get("data");
  if (typed !== null) {
    const parsed = typed.trim() === "" ? "" : parseDate(typed);
    if (parsed === null) {
      if (article.versions.length < 2) return c.notFound();
      return c.html(
        renderArticle(
          { ...context(params), now: today(), invalidDate: typed.trim().slice(0, 10) },
          act,
          article,
          null,
        ),
        400,
      );
    }
    const picked = parsed === today() ? "" : parsed;
    params.delete("data");
    const rest = params.toString();
    const target = articleUrl(route.actRef, entry, picked === "" ? undefined : picked);
    return c.redirect(rest === "" ? target : `${target}?${rest}`, 302);
  }

  if (route.date !== null && route.date <= today()) {
    const shown = versionOn(article, route.date);
    const current = versionOn(article, today());
    if (shown !== null && current !== null && shown.version === current.version) {
      const rest = params.toString();
      const target = articleUrl(route.actRef, entry);
      return c.redirect(rest === "" ? target : `${target}?${rest}`, 302);
    }
  }

  return c.html(
    renderArticle(
      { ...context(params), now: today() },
      act,
      article,
      route.date,
    ),
  );
});
