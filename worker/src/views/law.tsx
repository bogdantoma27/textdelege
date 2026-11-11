import type { Child } from "hono/jsx";
import { type Key, type PluralForm, t, tPlural } from "../text";
import { dayBefore, formatRo } from "../lib/dates";
import { unitText } from "../lib/text";
import { paginate } from "../lib/act";
import type { EventVerb, LawChange, LawObject } from "../lib/types";
import { actUrl, articleUrl, compareUrl, lawUrlFromKey } from "../lib/urls";
import { CitationPanel } from "./article-rails";
import type { ActNames } from "./changes";
import { Breadcrumbs, DataTable, PageNumbers, Panel, SummaryList, Support } from "./components";
import { Indexed } from "./indexed";
import { Layout, ORIGIN } from "./layout";
import { VERBS, grouped } from "./shared";

const LAW_PAGE = 100;

export interface ChangeGroup {
  ref: string;
  name: string;
  changes: LawChange[];
}

function groupChanges(changes: LawChange[], names: ActNames): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const change of changes) {
    const act = names.get(change.act_path) ?? { ref: change.act_path, name: change.act_path };
    const group = groups.get(change.act_path) ?? { ref: act.ref, name: act.name, changes: [] };
    group.changes.push(change);
    groups.set(change.act_path, group);
  }
  return [...groups.values()];
}

interface ActSummary {
  articles: Set<string>;
  byVerb: Map<EventVerb, Set<string>>;
}

function summarize(changes: LawChange[]): { acts: Map<string, ActSummary>; articles: number } {
  const acts = new Map<string, ActSummary>();
  const all = new Set<string>();
  for (const change of changes) {
    const summary = acts.get(change.act_path) ?? { articles: new Set(), byVerb: new Map() };
    const article = `${change.act_path}/${change.file}`;
    summary.articles.add(article);
    const verb = summary.byVerb.get(change.verb) ?? new Set();
    verb.add(article);
    summary.byVerb.set(change.verb, verb);
    acts.set(change.act_path, summary);
    all.add(article);
  }
  return { acts, articles: all.size };
}

const ARTICLES: Record<PluralForm, Key> = {
  one: "lawArticlesOne",
  few: "lawArticlesFew",
  many: "lawArticlesMany",
};
const ACTS: Record<PluralForm, Key> = { one: "lawActsOne", few: "lawActsFew", many: "lawActsMany" };

const articlesText = (n: number) => tPlural(n, ARTICLES, { n: grouped(n) });

function InForce({ days }: { days: string[] }) {
  const sorted = [...days].sort();
  if (sorted.length === 1) return <>{formatRo(sorted[0]!)}</>;
  const count = tPlural(
    sorted.length,
    { one: "lawDatesFew", few: "lawDatesFew", many: "lawDatesMany" },
    { n: sorted.length },
  );
  return (
    <>
      {t("lawDatesRange", { first: formatRo(sorted[0]!), last: formatRo(sorted[sorted.length - 1]!), count })}
      <details>
        <summary>{t("lawDatesAll")}</summary>
        <ul class="plain">
          {sorted.map((day) => (
            <li>{formatRo(day)}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

const PORTAL = "https://legislatie.just.ro/";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Row(ref: string, change: LawChange): Child[] {
  const units = change.units.map((id) => unitText(id)).join(", ");
  const compare = change.verb === "modified" || change.verb === "completed";
  return [
    <a href={articleUrl(ref, change.number, change.date)}>
      <Indexed text={t("articleAbbr", { number: change.number })} />
    </a>,
    <>
      <span class="verb">{t(VERBS[change.verb])}</span>
      {units !== "" && <Indexed text={` ${units}`} />}
    </>,
    formatRo(change.date),
    compare ? (
      <a href={compareUrl(ref, change.number, dayBefore(change.date), change.date)}>{t("cmpCompare")}</a>
    ) : (
      <a href={articleUrl(ref, change.number, change.date)}>{t("lawViewText")}</a>
    ),
  ];
}

export function renderLaw(law: LawObject, names: ActNames, requested: number) {
  const paged = paginate(law.changes, requested, LAW_PAGE);
  const groups = groupChanges(paged.items, names);
  const summary = summarize(law.changes);
  const verbs = (Object.keys(VERBS) as EventVerb[]).filter((verb) =>
    [...summary.acts.values()].some((act) => act.byVerb.has(verb)),
  );
  const path = lawUrlFromKey(law.key) ?? "/";
  const pageHref = (n: number) => `${path}${n > 1 ? `?pagina=${n}` : ""}`;
  const permanent = `${ORIGIN}${path}`;
  const nameOf = (actPath: string) => names.get(actPath)?.name ?? actPath;
  const official = law.source ?? PORTAL;
  const rows: { label: string; value: Child }[] = [];
  if (law.published !== null) rows.push({ label: t("lawPublished"), value: formatRo(law.published) });
  if (law.enacted !== null) rows.push({ label: t("lawEnacted"), value: formatRo(law.enacted) });
  if (law.in_force.length > 0) {
    rows.push({ label: t("lawInForce"), value: <InForce days={law.in_force} /> });
  }
  if (law.mo !== null) rows.push({ label: t("metaMo"), value: <span lang="ro">{law.mo}</span> });

  const head = [
    t("changesColArticle"),
    t("changesColChange"),
    t("changesColDate"),
    t("lawColText"),
  ];

  return (
    <Layout
      title={law.label}
      script="/article.js"
      canonical={paged.page > 1 ? `${permanent}?pagina=${paged.page}` : permanent}
      rail={
        <aside class="rail">
          <CitationPanel sentence={law.label} permanent={permanent} />
          <Panel title={t("sourceTitle")}>
            <p>
              <a href={official}>{hostOf(official)}</a>
            </p>
            <p>{t("lawOwnText")}</p>
          </Panel>
          <Support />
        </aside>
      }
    >
      <section class="solo wide doc">
        <Breadcrumbs
          items={[
            { href: "/", label: t("breadcrumbHome") },
            { href: "/modificari", label: t("navChanges") },
          ]}
        />
        <h1>{law.label}</h1>
        {law.title !== "" && law.title !== law.label && (
          <p class="sub" lang="ro">
            {law.title}
          </p>
        )}
        {rows.length > 0 && (
          <SummaryList rows={rows} />
        )}
        <section aria-labelledby="modificari-aduse">
          <h2 id="modificari-aduse">{t("lawChangesHeading")}</h2>
          {groups.length === 0 && <p>{t("lawChangesNone")}</p>}
          {groups.length > 0 && (
            <>
              <p>
                {t("lawSummary", {
                  articles: articlesText(summary.articles),
                  acts: tPlural(summary.acts.size, ACTS, { n: grouped(summary.acts.size) }),
                })}
              </p>
              <DataTable
                head={[t("changesColAct"), ...verbs.map((verb) => t(VERBS[verb])), t("lawColTotal")]}
                rows={[...summary.acts].map(([actPath, act]) => [
                  nameOf(actPath),
                  ...verbs.map((verb) => String(act.byVerb.get(verb)?.size ?? 0)),
                  String(act.articles.size),
                ])}
              />
              {paged.pages > 1 && (
                <p class="results-bar">
                  <span class="count">
                    {t("lawRange", {
                      first: grouped((paged.page - 1) * LAW_PAGE + 1),
                      last: grouped((paged.page - 1) * LAW_PAGE + paged.items.length),
                      total: grouped(paged.total),
                    })}
                  </span>
                </p>
              )}
            </>
          )}
          {groups.map((group) => (
            <>
              <h3>
                <a href={actUrl(group.ref)}>{group.name}</a>{" "}
                <span class="group-count">
                  ({articlesText(summary.acts.get(group.changes[0]!.act_path)?.articles.size ?? 0)})
                </span>
              </h3>
              <DataTable head={head} rows={group.changes.map((change) => Row(group.ref, change))} />
            </>
          ))}
          <PageNumbers current={paged.page} pages={paged.pages} href={pageHref} />
        </section>
      </section>
    </Layout>
  );
}
