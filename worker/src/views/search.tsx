import { articleLabel } from "../lib/article-label";
import { t, tPlural } from "../text";
import type { SearchHit } from "../lib/types";
import { articleUrl } from "../lib/urls";
import type { ActNames } from "./changes";
import { Breadcrumbs, PageNumbers } from "./components";
import { Indexed } from "./indexed";
import { Layout, ORIGIN } from "./layout";
import { STATE_BADGE_ID, StatusBadge, grouped } from "./shared";

export const HITS_LIMIT = 20;

export const MAX_QUERY = 200;

const resultsUrl = (query: string, inForce: boolean, page: number) => {
  const params = new URLSearchParams({ q: query });
  if (inForce) params.set("in_force", "1");
  if (page > 1) params.set("pagina", String(page));
  return `/cauta?${params}`;
};

const exampleHref = (query: string) => `/cauta?q=${encodeURIComponent(query)}`;

function Examples() {
  const examples = [t("searchExampleOne"), t("searchExampleTwo")];
  return (
    <p class="examples">
      {t("searchExamplesLead")} <a href={exampleHref(examples[0]!)}>{examples[0]}</a>,{" "}
      <a href={exampleHref(examples[1]!)}>{examples[1]}</a>
    </p>
  );
}

function SearchBox(props: { query: string; inForce: boolean }) {
  return (
    <form class="search-filters" action="/cauta" method="get" data-filter="">
      <label class="label" for="q-results">
        {t("searchFieldLabel")}
      </label>
      <div class="search-row">
        <input
          class="field"
          id="q-results"
          type="search"
          name="q"
          value={props.query === "" ? undefined : props.query}
          maxlength={MAX_QUERY}
          autocomplete="off"
        />
        <button class="btn secondary" type="submit">
          {t("searchButton")}
        </button>
      </div>
      <div class="checkboxes">
        <div class="checkbox">
          <input id="in-force" type="checkbox" name="in_force" value="1" checked={props.inForce} />
          <label for="in-force">{t("searchInForce")}</label>
        </div>
      </div>
    </form>
  );
}

function Hit({ hit, names }: { hit: SearchHit; names: ActNames }) {
  const act = names.get(hit.actPath) ?? { ref: hit.actPath, name: hit.actPath };
  return (
    <li class="hit">
      <h2 class="hit-head">
        <a href={articleUrl(act.ref, hit)}>
          {act.name}, <Indexed text={articleLabel(hit)} />
          {hit.title ? `: ${hit.title}` : ""}
        </a>
        {hit.state !== "in-force" && (
          <>
            {" "}
            <StatusBadge id={STATE_BADGE_ID[hit.state]} />
          </>
        )}
      </h2>
      {/* The snippet is HTML-safe: Store.search escapes it and adds only <mark> tags. */}
      <p class="snippet" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
    </li>
  );
}

export interface SearchPage {
  query: string;
  inForce: boolean;
  hits: SearchHit[] | null;
  total: number;
  over: boolean;
  live: boolean;
  page: number;
  pages: number;
  names: ActNames;
}

export function renderSearch(page: SearchPage) {
  const { hits, query } = page;
  const tips = [
    t("searchTipSpelling"),
    t("searchTipFewer"),
    ...(page.inForce ? [t("searchTipAllStates")] : []),
    t("searchTipCitation"),
  ];
  return (
    <Layout
      title={t("searchTitle")}
      canonical={`${ORIGIN}/cauta`}
      query={query}
      pageSearch
      noindex
    >
      <section class="solo wide">
        <Breadcrumbs items={[{ href: "/", label: t("breadcrumbHome") }]} current={t("searchTitle")} />
        <h1>{t("searchTitle")}</h1>
        <SearchBox query={query} inForce={page.inForce} />
        {hits === null && <Examples />}
        {hits !== null && hits.length === 0 && (
          <section>
            <h2>{t("searchNone", { q: query })}</h2>
            <p>{t("searchTipsLead")}</p>
            <ul>
              {tips.map((tip) => (
                <li>{tip}</li>
              ))}
            </ul>
          </section>
        )}
        {hits !== null && hits.length > 0 && (
          <section>
            {!page.live && (
              <div class="results-bar">
                <span class="count">
                  {page.over
                    ? t("searchCountOver", { n: grouped(page.total) })
                    : page.pages > 1
                    ? t("searchRange", {
                        first: grouped((page.page - 1) * HITS_LIMIT + 1),
                        last: grouped((page.page - 1) * HITS_LIMIT + hits.length),
                        total: grouped(page.total),
                      })
                    : tPlural(page.total, {
                        one: "searchResultsOne",
                        few: "searchResultsFew",
                        many: "searchResultsMany",
                      })}
                </span>
              </div>
            )}
            <ul class="plain hits">
              {hits.map((hit) => (
                <Hit hit={hit} names={page.names} />
              ))}
            </ul>
            <PageNumbers
              current={page.page}
              pages={page.pages}
              href={(n) => resultsUrl(query, page.inForce, n)}
            />
          </section>
        )}
      </section>
    </Layout>
  );
}
