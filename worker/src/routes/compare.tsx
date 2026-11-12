import { Hono } from "hono";
import { formatRo, isIsoDate, today } from "../lib/dates";
import { CHUNK, candidates, inChunks } from "../lib/compare";
import { t } from "../text";
import { resolveAct } from "../lib/resolve";
import type { AppEnv } from "../lib/store";
import { articleUrl, compareUrl, findArticle, parsePath } from "../lib/urls";
import { versionOn } from "../lib/versions";
import { FLAG_PAIRS, changedRows, renderActCompare, renderCompare } from "../views/compare";
import { NotFound } from "../views/not-found";

export const compareRoutes = new Hono<AppEnv>();

compareRoutes.get("*", async (c, next) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;

  if (/\/compara\/?$/.test(c.req.path)) {
    const route = parsePath(c.req.path.replace(/\/compara\/?$/, ""));
    if (route?.kind !== "article") return next();
    const [de, pana] = [params.get("de") ?? "", params.get("pana") ?? ""];
    if (!isIsoDate(de) || !isIsoDate(pana)) return c.notFound();
    const store = c.get("store");
    const act = await resolveAct(store, route.actRef);
    const entry = act === null ? undefined : findArticle(act.articles, route.slug);
    if (!act || !entry) return c.notFound();
    const [from, to] = de <= pana ? [de, pana] : [pana, de];
    let target = from === to ? articleUrl(route.actRef, entry, from) : compareUrl(route.actRef, entry, from, to);
    if (from !== to) {
      const kept = new URLSearchParams();
      for (const [name, value] of FLAG_PAIRS) {
        if (params.get(name) === value) kept.set(name, value);
      }
      if (kept.size > 0) target += `?${kept.toString()}`;
    }
    return c.redirect(target, 302);
  }

  const route = parsePath(c.req.path);
  if (route?.kind !== "compareArticle" && route?.kind !== "compareAct") return next();

  if (route.from > route.to) {
    const swapped = c.req.path.replace(`${route.from}..${route.to}`, `${route.to}..${route.from}`);
    return c.redirect(`${swapped}${url.search}`, 301);
  }

  const store = c.get("store");
  const act = await resolveAct(store, route.actRef);
  if (!act) return c.notFound();

  if (route.kind === "compareAct") {
    const { entries, capped } = candidates(act, route.from, route.to);
    const articles = await inChunks(entries, CHUNK, (entry) => store.article(act.path, entry.file));
    return c.html(
      renderActCompare(act, changedRows(entries, articles, route.from, route.to), route.from, route.to, capped),
    );
  }

  const entry = findArticle(act.articles, route.slug);
  if (!entry) return c.notFound();
  const article = await store.article(act.path, entry.file);
  if (article === null || article.versions.length === 0) return c.notFound();

  const missing = [route.from, route.to].find((day) => versionOn(article, day) === null);
  if (missing !== undefined) {
    const message = t("cmpNoVersion", { date: formatRo(missing) });
    return c.html(<NotFound path={c.req.path} message={message} />, 404);
  }

  const to = versionOn(article, route.to)!.version;
  const law = to.law ? await store.law(to.law.key) : null;
  return c.html(
    renderCompare(
      {
        now: today(),
        parallel: params.get("vedere") === "paralel",
        onlyChanges: params.get("doar") === "diferente",
        colourBlind: params.get("paleta") === "daltonism",
        granularity: params.get("granularitate") === "caractere" ? "char" : "word",
      },
      act,
      article,
      route.from,
      route.to,
      law,
    ),
  );
});
