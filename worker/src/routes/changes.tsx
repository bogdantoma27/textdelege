import { Hono } from "hono";
import { genitive, t } from "../text";
import { FEED_LIMIT, MAX_QUERY, applyFilters, filterQuery, parseFilters } from "../lib/change-filter";
import { formatRo, parseDate, today } from "../lib/dates";
import { type FeedEntry, atom, tagId } from "../lib/feed";
import { findCitedAct, resolveAct } from "../lib/resolve";
import type { AppEnv, Store } from "../lib/store";
import { unitText } from "../lib/text";
import type { ChangeItem, ChangesObject } from "../lib/types";
import { articleUrl, changesUrl, findArticle, parsePath } from "../lib/urls";
import { type ActNames, type ChangesPage, actChoices, namesOf, renderChanges } from "../views/changes";
import { ORIGIN } from "../views/layout";
import { renderSubscribe } from "../views/subscribe";
import { VERBS, lawLabelText } from "../views/shared";

const newestFirst = (a: ChangeItem, b: ChangeItem) => b.date.localeCompare(a.date);

function entryOf(item: ChangeItem, origin: string, names: ActNames): FeedEntry {
  const act = names.get(item.act_path) ?? { ref: item.act_path, name: item.act_path };
  const units = item.units.map((id) => unitText(id)).join(", ");
  const verb = t(VERBS[item.verb]);
  const change = units === "" ? verb : `${verb} ${units}`;
  const date = formatRo(item.date);
  return {
    id: tagId(
      [
        item.act_path,
        item.file,
        item.date,
        item.verb,
        item.law?.key ?? "none",
        item.units.length === 0 ? "all" : [...item.units].sort().join("+"),
      ].join("/"),
    ),
    title: t("feedEntryTitle", { act: act.name, number: item.number, verb }),
    updated: `${item.date}T00:00:00Z`,
    link: `${origin}${articleUrl(act.ref, item, item.date)}`,
    summary: item.law
      ? t("feedSummaryLaw", { change, law: lawLabelText(item.law.key, item.law.label), date })
      : t("feedSummary", { change, date }),
  };
}

interface Scope {
  path: string;
  heading: string;
  subject: string;
  feedTitle: string;
  items: ChangeItem[];
  upcoming: ChangeItem[];
  names: ActNames;
}

function splitOn(now: string, changes: ChangesObject | null) {
  const all = [...(changes?.items ?? []), ...(changes?.upcoming ?? [])];
  return {
    items: all.filter((item) => item.date <= now),
    upcoming: all.filter((item) => item.date > now),
  };
}

async function scopeOf(
  store: Store,
  route: { actRef: string | null; slug: string | null },
): Promise<Scope | null> {
  const now = today();
  const namesFor = (items: ChangeItem[], upcoming: ChangeItem[]) =>
    namesOf(store, [...items, ...upcoming].map((item) => item.act_path));
  if (route.actRef === null) {
    const site = await store.changes("site");
    const split = splitOn(now, site);
    return {
      path: changesUrl(),
      heading: t("changesHeading"),
      subject: t("subscribeSubjectSite"),
      feedTitle: t("feedSiteTitle"),
      ...split,
      names: await namesFor(split.items, split.upcoming),
    };
  }

  const act = await resolveAct(store, route.actRef);
  if (!act) return null;
  const ref = act.alias ?? act.path;
  const name = act.short ?? act.title;

  if (route.slug === null) {
    const changes = await store.changes(act.path);
    const split = splitOn(now, changes);
    const names = await namesFor(split.items, split.upcoming);
    if (!names.has(act.path)) names.set(act.path, { ref, name });
    return {
      path: changesUrl(ref),
      heading: t("changesActHeading", { act: name }),
      subject: genitive(name),
      feedTitle: t("feedActTitle", { act: name }),
      ...split,
      names,
    };
  }

  const entry = findArticle(act.articles, route.slug);
  const article = entry === undefined ? null : await store.article(act.path, entry.file);
  if (!article) return null;
  const events: ChangeItem[] = article.events.map((event) => ({
    date: event.date,
    act_path: act.path,
    file: article.file,
    number: article.number,
    title: article.title,
    verb: event.verb,
    units: event.units,
    law: event.law,
  }));
  const vars = { act: name, number: article.number };
  const names = await namesFor(events, []);
  if (!names.has(act.path)) names.set(act.path, { ref, name });
  return {
    path: changesUrl(ref, article),
    heading: t("changesArticleHeading", vars),
    subject: t("subscribeSubjectArticle", vars),
    feedTitle: t("feedArticleTitle", vars),
    items: events.filter((event) => event.date <= now),
    upcoming: events.filter((event) => event.date > now),
    names,
  };
}

/** The act that the `act` filter parameter names (by alias or by path of an act without alias), if there is one. */
async function resolveFilterAct(store: Store, ref: string | null): Promise<{ ref: string; path: string } | null> {
  if (ref === null || ref === "") return null;
  const aliased = await store.resolveAlias(ref);
  if (aliased !== null) return { ref, path: aliased };
  const found = (await store.actsByPath([ref])).get(ref);
  return found !== undefined && found.alias === null ? { ref, path: found.path } : null;
}

export const changesRoutes = new Hono<AppEnv>();

changesRoutes.get("*", async (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "changes") return next();

  const store = c.get("store");
  const params = new URL(c.req.url).searchParams;
  const [manifest, scope, named] = await Promise.all([
    store.manifest(),
    scopeOf(store, route),
    route.actRef === null ? resolveFilterAct(store, params.get("act")) : null,
  ]);
  if (scope === null) return c.notFound();

  const refs = named === null ? null : new Set([named.ref]);
  const filters = parseFilters(params, refs);
  const alt = route.actRef === null ? (params.get("alt") ?? "").trim().slice(0, MAX_QUERY).trim() : "";
  const cited = alt === "" ? null : await findCitedAct(store, alt);
  if (cited !== null) filters.act = cited.alias ?? cited.path;
  const altInvalid = alt !== "" && cited === null;
  const actPath = filters.act === null ? null : cited !== null ? cited.path : (named?.path ?? null);
  const invalid: Record<string, string> = {};
  for (const name of ["de", "pana"]) {
    const value = (params.get(name) ?? "").trim();
    if (value !== "" && parseDate(value) === null) invalid[name] = value;
  }
  const nameOf = (path: string) => scope.names.get(path)?.name ?? path;
  if (route.format === "html" && route.actRef === null && filters.act !== null && !altInvalid) {
    return c.redirect(`${changesUrl(filters.act)}${filterQuery({ ...filters, act: null })}`, 302);
  }
  if (route.format === "subscribe") {
    const query = filterQuery(filters);
    return c.html(
      renderSubscribe({
        path: `${scope.path.replace(/^\/modificari/, "/abonare")}${query}`,
        subject: scope.subject,
        scope: scope.heading,
        changes: `${scope.path}${query}`,
        feed: `${ORIGIN}${scope.path}.atom${query}`,
      }),
    );
  }
  const items = applyFilters(scope.items, filters, actPath, nameOf).sort(newestFirst);
  const upcoming = applyFilters(scope.upcoming, filters, actPath, nameOf);

  if (route.format === "html") {
    const page: ChangesPage = {
      title: scope.heading,
      path: scope.path,
      items,
      upcoming: [...upcoming].sort(newestFirst).reverse(),
      names: scope.names,
      filters,
      choices: route.actRef === null ? actChoices(manifest.acts) : null,
      window: route.actRef === null ? "site" : route.slug === null ? "act" : null,
      invalid,
      alt,
      altInvalid,
    };
    return c.html(renderChanges(page), Object.keys(invalid).length === 0 && !altInvalid ? 200 : 400);
  }

  const entries = [...items, ...upcoming]
    .sort(newestFirst)
    .slice(0, FEED_LIMIT)
    .map((item) => entryOf(item, ORIGIN, scope.names));
  const self = `${ORIGIN}${scope.path}.${route.format}${filterQuery(filters)}`;
  const newest = items[0] === undefined ? "" : `${items[0].date}T00:00:00Z`;
  return c.body(atom(entries, self, scope.feedTitle, manifest.generated, newest), 200, {
    "Content-Type": "application/atom+xml; charset=utf-8",
  });
});
