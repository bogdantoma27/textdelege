import { Hono } from "hono";
import { genitive, t } from "../text";
import { FEED_LIMIT, applyFilters, filterQuery, parseFilters } from "../lib/change-filter";
import { formatRo, parseDate, today } from "../lib/dates";
import { type FeedEntry, atom, tagId } from "../lib/feed";
import { resolveAct } from "../lib/resolve";
import type { AppEnv, Store } from "../lib/store";
import { unitText } from "../lib/text";
import type { ChangeItem, ChangesObject, Manifest } from "../lib/types";
import { articleUrl, changesUrl, parsePath } from "../lib/urls";
import { type ActNames, type ChangesPage, actChoices, actNames, renderChanges } from "../views/changes";
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
    link: `${origin}${articleUrl(act.ref, item.number, item.date)}`,
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
  manifest: Manifest,
  route: { actRef: string | null; number: string | null },
): Promise<Scope | null> {
  const names = actNames(manifest);
  const now = today();
  if (route.actRef === null) {
    const site = await store.changes("site");
    return {
      path: changesUrl(),
      heading: t("changesHeading"),
      subject: t("subscribeSubjectSite"),
      feedTitle: t("feedSiteTitle"),
      ...splitOn(now, site),
      names,
    };
  }

  const act = await resolveAct(store, route.actRef);
  if (!act) return null;
  const ref = act.alias ?? act.path;
  const name = act.short ?? act.title;
  if (!names.has(act.path)) names.set(act.path, { ref, name });

  if (route.number === null) {
    const changes = await store.changes(act.path);
    return {
      path: changesUrl(ref),
      heading: t("changesActHeading", { act: name }),
      subject: genitive(name),
      feedTitle: t("feedActTitle", { act: name }),
      ...splitOn(now, changes),
      names,
    };
  }

  const entry = act.articles.find((candidate) => candidate.number === route.number);
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
  return {
    path: changesUrl(ref, article.number),
    heading: t("changesArticleHeading", vars),
    subject: t("subscribeSubjectArticle", vars),
    feedTitle: t("feedArticleTitle", vars),
    items: events.filter((event) => event.date <= now),
    upcoming: events.filter((event) => event.date > now),
    names,
  };
}

export const changesRoutes = new Hono<AppEnv>();

changesRoutes.get("*", async (c, next) => {
  const route = parsePath(c.req.path);
  if (route?.kind !== "changes") return next();

  const store = c.get("store");
  const manifest = await store.manifest();
  const scope = await scopeOf(store, manifest, route);
  if (scope === null) return c.notFound();

  const refs = route.actRef === null ? new Set([...scope.names.values()].map((act) => act.ref)) : null;
  const filters = parseFilters(new URL(c.req.url).searchParams, refs);
  const actPath =
    filters.act === null
      ? null
      : ([...scope.names].find(([, act]) => act.ref === filters.act)?.[0] ?? null);
  const typed = new URL(c.req.url).searchParams;
  const invalid: Record<string, string> = {};
  for (const name of ["de", "pana"]) {
    const value = (typed.get(name) ?? "").trim();
    if (value !== "" && parseDate(value) === null) invalid[name] = value;
  }
  const nameOf = (path: string) => scope.names.get(path)?.name ?? path;
  if (route.format === "html" && route.actRef === null && filters.act !== null) {
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
      choices: route.actRef === null ? actChoices(manifest) : null,
      window: route.actRef === null ? "site" : route.number === null ? "act" : null,
      invalid,
    };
    return c.html(renderChanges(page), Object.keys(invalid).length === 0 ? 200 : 400);
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
