import type { Child } from "hono/jsx";
import { t, tPlural } from "../text";
import { actName, isCurrent, ordered } from "../lib/act-order";
import { type ChangeFilters, FEED_LIMIT, FILTER_VERBS, MAX_QUERY, filterQuery } from "../lib/change-filter";
import { formatRo } from "../lib/dates";
import { unitText } from "../lib/text";
import type { ChangeItem, Manifest, ManifestAct } from "../lib/types";
import { actUrl, articleUrl } from "../lib/urls";
import { Breadcrumbs, DataTable, DateField, DateHint, ErrorSummary, FieldError } from "./components";
import { Indexed } from "./indexed";
import { Layout, ORIGIN } from "./layout";
import { LawLink, StatusBadge, VERBS } from "./shared";

export type ActNames = Map<string, { ref: string; name: string }>;

export function actNames(manifest: Manifest): ActNames {
  return new Map(
    manifest.acts.map((act) => [act.path, { ref: act.alias ?? act.path, name: act.short ?? act.title }]),
  );
}

const TABLE_LIMIT = 200;

export const actOf = (item: ChangeItem, names: ActNames) =>
  names.get(item.act_path) ?? { ref: item.act_path, name: item.act_path };

export function changeArticle(item: ChangeItem, names: ActNames): Child {
  return (
    <a href={articleUrl(actOf(item, names).ref, item.number, item.date)}>
      <Indexed text={t("articleAbbr", { number: item.number })} />
      {item.title ? ` ${item.title}` : ""}
    </a>
  );
}

export function changeAction(item: ChangeItem): Child {
  const units = item.units.map((id) => unitText(id)).join(", ");
  return (
    <>
      <span class="verb">{t(VERBS[item.verb])}</span>
      {units !== "" && <Indexed text={` ${units}`} />}
    </>
  );
}

export function changeCells(item: ChangeItem, names: ActNames, scheduled = false): Child[] {
  const act = actOf(item, names);
  return [
    <>
      {formatRo(item.date)}
      {scheduled && (
        <>
          {" "}
          <StatusBadge id="pending" />
        </>
      )}
    </>,
    <a class="nowrap" href={actUrl(act.ref)}>
      {act.name}
    </a>,
    changeArticle(item, names),
    changeAction(item),
    item.law ? (
      <span class="nowrap">
        <LawLink lawKey={item.law.key} label={item.law.label} />
      </span>
    ) : (
      ""
    ),
  ];
}

export function changesHead(): string[] {
  return [
    t("changesColDate"),
    t("changesColAct"),
    t("changesColArticle"),
    t("changesColChange"),
    t("changesColLaw"),
  ];
}

export interface ActChoice {
  ref: string;
  name: string;
}

export interface ActChoices {
  current: ActChoice[];
  historical: ActChoice[];
}

export function actChoices(manifest: Manifest): ActChoices {
  const choice = (act: ManifestAct): ActChoice => ({ ref: act.alias ?? act.path, name: actName(act) });
  const acts = ordered(manifest.acts);
  return {
    current: acts.filter(isCurrent).map(choice),
    historical: acts.filter((act) => !isCurrent(act)).map(choice),
  };
}

export interface ChangesPage {
  title: string;
  path: string;
  items: ChangeItem[];
  upcoming: ChangeItem[];
  names: ActNames;
  filters: ChangeFilters;
  choices: ActChoices | null;
  window: "site" | "act" | null;
  invalid: Record<string, string>;
}

function FilterForm({ page }: { page: ChangesPage }) {
  const { filters } = page;
  return (
    <form class="filters" method="get" action={page.path} novalidate data-filter="">
      <div class="form-group">
        <label class="label" for="filter-q">
          {t("changesFilterSearch")}
        </label>
        <input
          class="field"
          id="filter-q"
          type="search"
          name="q"
          value={filters.q === "" ? undefined : filters.q}
          maxlength={MAX_QUERY}
          autocomplete="off"
        />
      </div>
      {page.choices !== null && (
        <div class="form-group">
          <label class="label" for="filter-act">
            {t("changesFilterAct")}
          </label>
          <select class="field" id="filter-act" name="act">
            <option value="">{t("changesFilterAny")}</option>
            {[
              { label: t("statusInForce"), acts: page.choices.current },
              { label: t("changesGroupHistorical"), acts: page.choices.historical },
            ].map(
              (group) =>
                group.acts.length > 0 && (
                  <optgroup label={group.label}>
                    {group.acts.map((act) => (
                      <option value={act.ref} selected={filters.act === act.ref}>
                        {act.name}
                      </option>
                    ))}
                  </optgroup>
                ),
            )}
          </select>
        </div>
      )}
      <div class="form-group">
        <label class="label" for="filter-verb">
          {t("changesFilterVerb")}
        </label>
        <select class="field" id="filter-verb" name="verb">
          <option value="">{t("changesFilterAny")}</option>
          {FILTER_VERBS.map((verb) => (
            <option value={verb} selected={filters.verb === verb}>
              {t(VERBS[verb])}
            </option>
          ))}
        </select>
      </div>
      <div class="form-group date">
        <label class="label" for="filter-from">
          {t("changesFilterFrom")}
        </label>
        <DateField
          id="filter-from"
          name="de"
          value={filters.from}
          typed={page.invalid.de}
          invalid={page.invalid.de !== undefined}
        />
        <DateHint id="filter-from" />
        {page.invalid.de !== undefined && <FieldError id="filter-from">{t("dateInvalid")}</FieldError>}
      </div>
      <div class="form-group date">
        <label class="label" for="filter-to">
          {t("changesFilterTo")}
        </label>
        <DateField
          id="filter-to"
          name="pana"
          value={filters.to}
          typed={page.invalid.pana}
          invalid={page.invalid.pana !== undefined}
        />
        <DateHint id="filter-to" />
        {page.invalid.pana !== undefined && <FieldError id="filter-to">{t("dateInvalid")}</FieldError>}
      </div>
      <div class="form-group submit">
        <button class="btn" type="submit">
          {t("changesFilterApply")}
        </button>
        {filterQuery(filters) !== "" && <a href={page.path}>{t("changesFilterClear")}</a>}
      </div>
    </form>
  );
}

function crumbs(page: ChangesPage) {
  const home = { href: "/", label: t("breadcrumbHome") };
  if (page.path === "/modificari") return [home];
  const ref = page.path.split("/")[2];
  const act = [...page.names.values()].find((item) => item.ref === ref);
  return act === undefined ? [home] : [home, { href: actUrl(act.ref), label: act.name }];
}

export function renderChanges(page: ChangesPage) {
  const { items, upcoming } = page;
  const shown = items.slice(0, TABLE_LIMIT);
  const query = filterQuery(page.filters);
  const trail = crumbs(page);
  const problems = [
    page.invalid.de !== undefined && { href: "#filter-from", text: t("dateInvalid") },
    page.invalid.pana !== undefined && { href: "#filter-to", text: t("dateInvalid") },
  ].filter((item) => item !== false);
  const refused = problems.length > 0;
  return (
    <Layout
      title={refused ? `${t("errorPrefix")}: ${page.title}` : page.title}
      noindex={refused}
      description={t("changesDescription")}
      canonical={`${ORIGIN}${page.path}`}
      alternates={[
        { href: `${page.path}.atom${query}`, type: "application/atom+xml", title: t("changesFeedAtom") },
      ]}
    >
      <section class="solo wide">
        <Breadcrumbs items={trail} current={trail.length === 1 ? page.title : undefined} />
        {refused && <ErrorSummary items={problems} />}
        <h1>
          <Indexed text={page.title} />
        </h1>
        <FilterForm page={page} />
        {!refused && (
          <>
            <div class="results-bar">
              <span class="count">
                {tPlural(items.length, {
                  one: "changesCountOne",
                  few: "changesCountFew",
                  many: "changesCountMany",
                })}
              </span>
              <nav aria-label={t("changesFeedsTitle")}>
                <a href={`${page.path.replace(/^\/modificari/, "/abonare")}${query}`}>{t("changesSubscribe")}</a>
                {page.path !== "/modificari" && <a href="/modificari">{t("changesAllLink")}</a>}
              </nav>
            </div>
            {page.window !== null && (
              <p class="window">
                {t(page.window === "site" ? "changesWindowSite" : "changesWindowAct", {
                  count: tPlural(FEED_LIMIT, {
                    one: "changesCountOne",
                    few: "changesCountFew",
                    many: "changesCountMany",
                  }),
                })}
              </p>
            )}
            {upcoming.length > 0 && (
              <section id="in-curand" aria-labelledby="in-curand-titlu">
                <h2 id="in-curand-titlu">{t("changesUpcoming")}</h2>
                <DataTable
                  head={changesHead()}
                  rows={upcoming.map((item) => changeCells(item, page.names, true))}
                />
              </section>
            )}
            <section aria-labelledby="aplicate">
              <h2 id="aplicate">{t("changesApplied")}</h2>
              {shown.length === 0 ? (
                <>
                  <p>{t("changesNone")}</p>
                  {query !== "" && (
                    <p>
                      <a href={page.path}>{t("changesFilterClear")}</a>
                    </p>
                  )}
                </>
              ) : (
                <DataTable
                  head={changesHead()}
                  rows={shown.map((item) => changeCells(item, page.names))}
                />
              )}
              {items.length > shown.length && (
                <p class="toc-note">
                  {t("changesLimited", { n: shown.length, total: items.length })}
                </p>
              )}
            </section>
          </>
        )}
      </section>
    </Layout>
  );
}
