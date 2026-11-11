import { Hono } from "hono";
import { TEXT_PAGE, pageNumber, paginate } from "../lib/act";
import { CHUNK, inChunks } from "../lib/compare";
import { parseDate, today } from "../lib/dates";
import { resolveAct } from "../lib/resolve";
import type { AppEnv } from "../lib/store";
import { actUrl, parsePath } from "../lib/urls";
import { type ActTab, renderAct } from "../views/act";
import { Contents } from "../views/article-rails";

const TAB_OF: Record<string, ActTab> = {
  istoric: "istoric",
  jurisprudenta: "jurisprudenta",
  statistici: "statistici",
  date: "date",
};

export const actRoutes = new Hono<AppEnv>();

actRoutes.get("*", async (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "contents") return next();
  const store = c.get("store");
  const act = await resolveAct(store, route.actRef);
  if (!act) return next();
  const params = new URL(c.req.url).searchParams;
  const flags: Record<string, string> = {};
  if (params.get("atribuire") === "0") flags.atribuire = "0";
  if (params.get("ultima") === "1") flags.ultima = "1";
  const query = new URLSearchParams(flags).toString();
  return c.html(
    String(
      <Contents
        act={act}
        actRef={route.actRef}
        date={route.date}
        now={today()}
        keep={query === "" ? "" : `?${query}`}
        flags={flags}
        filter=""
        path={actUrl(route.actRef, route.date ?? undefined)}
        current={null}
        all
      />,
    ),
  );
});

actRoutes.get("*", async (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "act") return next();

  const params = new URL(c.req.url).searchParams;
  const store = c.get("store");
  const act = await resolveAct(store, route.actRef);
  if (!act) return next();

  const typed = params.get("data");
  let invalid: string | undefined;
  if (typed !== null) {
    const parsed = typed.trim() === "" ? "" : parseDate(typed);
    if (parsed !== null) {
      const picked = parsed === today() ? "" : parsed;
      params.delete("data");
      const rest = params.toString();
      const target = actUrl(route.actRef, picked === "" ? undefined : picked);
      return c.redirect(rest === "" ? target : `${target}?${rest}`, 302);
    }
    invalid = typed;
  }

  if (route.date !== null && route.date <= today() && act.latest <= route.date) {
    const rest = params.toString();
    const target = actUrl(route.actRef);
    return c.redirect(rest === "" ? target : `${target}?${rest}`, 302);
  }

  const tab = route.tab === null ? "text" : (TAB_OF[route.tab] ?? "text");
  const raw = params.get("pagina");
  const ctx = {
    now: today(),
    date: route.date,
    filter: (params.get("cuprins") ?? "").slice(0, 100),
    page: raw === null ? null : pageNumber(raw),
    invalid,
  };

  let text;
  if (tab === "text") {
    const paged = paginate(act.articles, ctx.page ?? 1, TEXT_PAGE);
    const articles = await inChunks(paged.items, CHUNK, (entry) => store.article(act.path, entry.file));
    text = { paged, articles };
  }
  const rulings = tab === "jurisprudenta" ? await store.actRulings(act.path) : undefined;
  return c.html(renderAct(ctx, act, tab, text, rulings), invalid === undefined ? 200 : 400);
});
