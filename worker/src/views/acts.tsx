import { t, tPlural } from "../text";
import type { ActList, ActListItem } from "../lib/store";
import { parseActStatus } from "../lib/status";
import { actUrl } from "../lib/urls";
import { Breadcrumbs, ErrorSummary, FieldError, PageNumbers } from "./components";
import { Layout, ORIGIN } from "./layout";
import { KINDS, StatusBadge, grouped, kindPlural } from "./shared";

export const MAX_TEXT = 100;

export const STATUS_PARAMS = { vigoare: "in-force", abrogate: "repealed" } as const;

export interface ActsQuery {
  kind: string | null;
  year: string;
  status: keyof typeof STATUS_PARAMS | null;
  q: string;
  yearInvalid: boolean;
}

export function actsQueryString(query: ActsQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.kind !== null) params.set("tip", query.kind);
  if (query.year !== "") params.set("an", query.year);
  if (query.status !== null) params.set("stare", query.status);
  if (query.q !== "") params.set("q", query.q);
  if (page > 1) params.set("pagina", String(page));
  const text = params.toString();
  return text === "" ? "/acte" : `/acte?${text}`;
}

function StatusCell({ status }: { status: string }) {
  const { kind } = parseActStatus(status);
  if (kind === "in-force") return <StatusBadge id="inForce" />;
  if (kind === "repealed") return <StatusBadge id="repealed" />;
  if (kind === "unconsolidated") return <StatusBadge id="unconsolidated" />;
  return <StatusBadge id="notInForce" />;
}

const COUNTS = { one: "actsCountOne", few: "actsCountFew", many: "actsCountMany" } as const;
const ARTICLES = {
  one: "homeArticlesCountOne",
  few: "homeArticlesCountFew",
  many: "homeArticlesCountMany",
} as const;

function Row({ act }: { act: ActListItem }) {
  const identifier =
    act.number !== null && act.year !== null ? t("actIdentifier", { number: act.number, year: act.year }) : "";
  return (
    <li>
      <div class="doc-main">
        <a class="doc-link" href={actUrl(act.alias ?? act.path)}>
          {act.short ?? act.title}
        </a>
        <p class="doc-meta">
          <StatusCell status={act.status} />
          {identifier !== "" && <span>{identifier}</span>}
          {act.articles !== null && <span>{tPlural(act.articles, ARTICLES, { n: grouped(act.articles) })}</span>}
        </p>
      </div>
    </li>
  );
}

function FilterForm({ query }: { query: ActsQuery }) {
  return (
    <form class="filters" method="get" action="/acte" novalidate data-filter="">
      <div class="form-group">
        <label class="label" for="acte-tip">
          {t("actsFilterKind")}
        </label>
        <select class="field" id="acte-tip" name="tip">
          <option value="">{t("actsStatusAny")}</option>
          {KINDS.map((kind) => (
            <option value={kind} selected={query.kind === kind}>
              {kindPlural(kind)}
            </option>
          ))}
        </select>
      </div>
      <div class={query.yearInvalid ? "form-group error" : "form-group"}>
        <label class="label" for="acte-an">
          {t("actsFilterYear")}
        </label>
        {query.yearInvalid && <FieldError id="acte-an">{t("actsYearInvalid")}</FieldError>}
        <input
          class="field"
          id="acte-an"
          type="text"
          inputmode="numeric"
          name="an"
          value={query.year === "" ? undefined : query.year}
          maxlength={4}
          autocomplete="off"
          aria-invalid={query.yearInvalid ? "true" : undefined}
          aria-describedby={query.yearInvalid ? "acte-an-error" : undefined}
        />
      </div>
      <div class="form-group">
        <label class="label" for="acte-stare">
          {t("actsFilterStatus")}
        </label>
        <select class="field" id="acte-stare" name="stare">
          <option value="">{t("actsStatusAny")}</option>
          <option value="vigoare" selected={query.status === "vigoare"}>
            {t("actsStatusInForce")}
          </option>
          <option value="abrogate" selected={query.status === "abrogate"}>
            {t("actsStatusRepealed")}
          </option>
        </select>
      </div>
      <div class="form-group">
        <label class="label" for="acte-q">
          {t("actsFilterText")}
        </label>
        <input
          class="field"
          id="acte-q"
          type="search"
          name="q"
          value={query.q === "" ? undefined : query.q}
          maxlength={MAX_TEXT}
          autocomplete="off"
        />
      </div>
      <div class="form-group submit">
        <button class="btn" type="submit">
          {t("actsFilterApply")}
        </button>
      </div>
    </form>
  );
}

export function renderActs(query: ActsQuery, list: ActList) {
  const heading = t("actsHeading");
  const refused = query.yearInvalid;
  const first = (list.page - 1) * 50 + 1;
  const last = (list.page - 1) * 50 + list.items.length;
  return (
    <Layout
      title={refused ? `${t("errorPrefix")}: ${heading}` : heading}
      canonical={`${ORIGIN}${actsQueryString({ ...query, year: query.yearInvalid ? "" : query.year }, list.page)}`}
      noindex={refused}
      description={t("actsIntro")}
    >
      <section class="solo wide">
        <Breadcrumbs items={[{ href: "/", label: t("breadcrumbHome") }]} current={heading} />
        {refused && <ErrorSummary items={[{ href: "#acte-an", text: t("actsYearInvalid") }]} />}
        <h1>{heading}</h1>
        <FilterForm query={query} />
        {!refused && list.items.length === 0 && <p>{t("actsNone")}</p>}
        {!refused && list.items.length > 0 && (
          <section aria-label={t("actsListLabel")}>
            <div class="results-bar">
              <span class="count">
                {tPlural(list.total, COUNTS, { n: grouped(list.total) })}
              </span>
              {list.pages > 1 && (
                <span class="count">
                  {t("actsRange", {
                    first: grouped(first),
                    last: grouped(last),
                    total: grouped(list.total),
                  })}
                </span>
              )}
            </div>
            <ul class="doc-list">
              {list.items.map((act) => (
                <Row act={act} />
              ))}
            </ul>
            <PageNumbers current={list.page} pages={list.pages} href={(n) => actsQueryString(query, n)} />
          </section>
        )}
      </section>
    </Layout>
  );
}
