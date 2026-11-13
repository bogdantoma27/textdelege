import type { Child } from "hono/jsx";
import { type Key, t } from "../text";
import {
  HISTORY_PAGE,
  type HistoryRow,
  TEXT_PAGE,
  type Paged,
  actStateOn,
  historyRows,
  monitorRef,
  paginate,
} from "../lib/act";
import { dayBefore, formatRo } from "../lib/dates";
import { articleLabel } from "../lib/article-label";
import { linkCrossReferences, linkableNumbers } from "../lib/text";
import type { ActArticleEntry, ActObject, ArticleObject, ArticleRuling, LawObject, TimelineEntry } from "../lib/types";
import { type ArticleRef, actUrl, articleSlugFor, articleUrl, changesUrl, compareUrl, lawUrlFromKey, subscribeUrl } from "../lib/urls";
import { headingPathIndexes, headingText, headingsBefore, lastHeadingBefore } from "../lib/headings";
import { resolveView } from "../lib/versions";
import { Paragraph } from "./article";
import { CitationPanel, Contents, Freshness, FreshnessWarning, freshnessIsOk, freshnessLine } from "./article-rails";
import { Breadcrumbs, DataTable, ErrorSummary, FieldError, Pagination, Panel, Support, Tabs, DatedNote } from "./components";
import { Indexed } from "./indexed";
import { Layout, ORIGIN } from "./layout";
import { LawLink, STATE_BADGE_ID, STATE_LABEL, StatusBadge, lawLabelText, outcomeText, type BadgeId } from "./shared";
import type { ActNames } from "./changes";
import { ChangesMade } from "./law";

export type ActTab = "text" | "istoric" | "jurisprudenta" | "statistici" | "date";

export interface ActContext {
  now: string;
  date: string | null;
  filter: string;
  page: number | null;
  invalid?: string;
}

export interface ActText {
  paged: Paged<ActArticleEntry>;
  articles: (ArticleObject | null)[];
}

const FILTER_CAP = 200;

const TABS: { tab: ActTab; label: Key; slug: string }[] = [
  { tab: "text", label: "tabText", slug: "" },
  { tab: "istoric", label: "tabHistory", slug: "istoric" },
  { tab: "jurisprudenta", label: "tabRulings", slug: "jurisprudenta" },
  { tab: "statistici", label: "tabStats", slug: "statistici" },
  { tab: "date", label: "tabData", slug: "date" },
];

const KINDS: Record<string, Key> = {
  lege: "kindLege",
  law: "kindLege",
  oug: "kindOug",
  og: "kindOg",
  hg: "kindHg",
  decret: "kindDecret",
  "decret-lege": "kindDecretLege",
  constitutie: "kindConstitutie",
  constitution: "kindConstitutie",
  cod: "kindCod",
  "hotarare-parlament": "kindHotarareParlament",
  code: "kindCod",
};

const actName = (act: ActObject) => act.short ?? act.title;

function tabPath(actRef: string, tab: (typeof TABS)[number], date: string | null): string {
  return tab.tab === "text" ? actUrl(actRef, date ?? undefined) : `/${actRef}/${tab.slug}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Header(props: { ctx: ActContext; act: ActObject; actRef: string; tab: ActTab }) {
  const { ctx, act, actRef } = props;
  const state = actStateOn(act, ctx.date, ctx.now);
  const kind = KINDS[act.kind];
  const identifier =
    act.number === ""
      ? String(act.year)
      : t("actIdentifier", { number: act.number, year: act.year });
  const monitor = monitorRef(act.title);
  const official = act.freshness?.official_url ?? act.portal;
  const verified = act.freshness?.last_verified;

  const inForce = state === "in-force";
  const status = inForce ? t("homeInForceFrom", { date: formatRo(act.from) }) : t(STATE_LABEL[state]);
  const facts: { label: string; value: Child }[] = [
    ...(inForce ? [] : [{ label: t("metaInForceFrom"), value: formatRo(act.from) }]),
    { label: t("metaLatest"), value: <a href={changesUrl(actRef)}>{formatRo(act.latest)}</a> },
  ];
  if (monitor !== null) {
    facts.push({
      label: t("metaMo"),
      value: t("moNumberDate", { number: monitor.number, date: monitor.date }),
    });
  }
  facts.push({ label: t("sourceOfficial"), value: <a href={official}>{hostOf(official)}</a> });

  const note = freshnessLine(act);

  return (
    <>
      <Breadcrumbs
        items={[
          { href: "/", label: t("breadcrumbHome") },
          { href: "/#coduri", label: t("navCodes") },
        ]}
        aside={
          ctx.date !== null && (
            <DatedNote date={ctx.date} exit={tabPath(actRef, TABS.find((item) => item.tab === props.tab)!, null)} />
          )
        }
      />
      {ctx.invalid !== undefined && <ErrorSummary items={[{ href: "#data", text: t("dateInvalid") }]} />}
      <p class="caption">{kind === undefined ? identifier : `${t(kind)} ${identifier}`}</p>
      <h1>{actName(act)}</h1>
      <div class="status">
        <StatusBadge id={STATE_BADGE_ID[state]}>{status}</StatusBadge>
        {facts.map((fact) => (
          <span class="fact">
            {fact.label} <b>{fact.value}</b>
          </span>
        ))}
        {verified && freshnessIsOk(act) && <span class="fact">{t("statusVerified", { date: formatRo(verified) })}</span>}
      </div>
      <FreshnessWarning act={act} />
      {note !== null && <p class="fresh-line">{note}</p>}
      <section class="time compact" aria-label={t("timePanelActLabel")}>
        <form class={ctx.invalid === undefined ? "date-form" : "date-form error"} method="get" action={actUrl(actRef)} novalidate data-filter="">
          <label class="label" for="data">
            {t("timeLabel")}
          </label>
          {ctx.invalid !== undefined && <FieldError id="data">{t("dateInvalid")}</FieldError>}
          <div class="date-row">
            <DatePicker act={act} ctx={ctx} />
            <button class="btn" type="submit">
              {t("timeSubmit")}
            </button>
          </div>
        </form>
      </section>
      <Tabs
        label={t("actTabsLabel")}
        tabs={TABS.map((item) => ({
          href: tabPath(actRef, item, ctx.date),
          label: t(item.label),
          current: item.tab === props.tab,
        }))}
      />
    </>
  );
}

function DatePicker({ act, ctx }: { act: ActObject; ctx: ActContext }) {
  const timeline = [...act.timeline].sort((a, b) => a.date.localeCompare(b.date));
  const current = timeline.filter((entry) => entry.date <= ctx.now).at(-1)?.date;
  const merged = current !== undefined && act.latest <= current ? current : undefined;
  const days = timeline.reverse().filter((entry) => entry.date !== merged);
  let shown = "";
  if (ctx.date !== null) {
    const day = ctx.date;
    const before = days.find((entry) => entry.date <= day);
    const today = merged !== undefined && day >= merged && (before === undefined || before.date < merged);
    shown = today ? "" : (before ?? days.at(-1))?.date ?? "";
  }
  const label = (entry: TimelineEntry) => {
    const named = [...entry.laws].sort((a, b) => Number(lawUrlFromKey(a.key) === null) - Number(lawUrlFromKey(b.key) === null));
    const law = named[0] === undefined ? undefined : lawLabelText(named[0].key, named[0].label);
    const text =
      law === undefined
        ? formatRo(entry.date)
        : entry.laws.length > 1
          ? t("timeOptionMore", { date: formatRo(entry.date), law, n: entry.laws.length - 1 })
          : t("timeOption", { date: formatRo(entry.date), law });
    return entry.date > ctx.now ? `${text} ${t("timeOptionFuture")}` : text;
  };
  return (
    <select class="field" id="data" name="data" aria-invalid={ctx.invalid !== undefined ? "true" : undefined}>
      <option value="" selected={shown === ""}>
        {t("timeToday")}
      </option>
      {days.map((entry) => (
        <option value={entry.date} selected={entry.date === shown}>
          {label(entry)}
        </option>
      ))}
    </select>
  );
}

function rangeTitle(act: ActObject, page: number): string {
  const first = act.articles[(page - 1) * TEXT_PAGE];
  const last = act.articles[Math.min(page * TEXT_PAGE, act.articles.length) - 1];
  return `${t("articleAbbr", { number: first?.number ?? "" })}–${last?.number ?? ""}`;
}

function Pages(props: {
  paged: { page: number; pages: number };
  href: (page: number) => string;
  title: (page: number) => string;
}) {
  const { paged } = props;
  return (
    <Pagination
      label={t("pagesLabel")}
      captions={{ prev: t("pagePrev"), next: t("pageNext") }}
      prev={
        paged.page > 1
          ? { href: props.href(paged.page - 1), title: props.title(paged.page - 1) }
          : undefined
      }
      next={
        paged.page < paged.pages
          ? { href: props.href(paged.page + 1), title: props.title(paged.page + 1) }
          : undefined
      }
    />
  );
}

function ArticleBlock(props: {
  ctx: ActContext;
  actRef: string;
  entry: ActArticleEntry;
  article: ArticleObject | null;
  numbers: ReadonlySet<string>;
  articles: readonly ArticleRef[];
}) {
  const { ctx, actRef, entry, article, numbers, articles } = props;
  const slug = articleSlugFor(entry);
  const view = article === null ? null : resolveView(article, ctx.date, ctx.now);
  let badge: BadgeId | null = null;
  if (view !== null && view.kind !== "exact") {
    badge = view.kind === "ended" ? (article?.repealed ? "repealed" : "ended") : "future";
  }
  const linked = (body: string) => linkCrossReferences(body, { actRef, date: ctx.date, articles: numbers });
  return (
    <section class="art" id={slug}>
      <h3>
        <a href={articleUrl(actRef, entry, ctx.date ?? undefined)}>
          <Indexed text={articleLabel(entry, articles)} />
        </a>
        {entry.title && ` ${entry.title}`}
        {badge !== null && (
          <>
            {" "}
            <StatusBadge id={badge} />
          </>
        )}
      </h3>
      {article === null && <p class="toc-note">{t("articleMissing")}</p>}
      {view?.kind === "exact" && article !== null && article.versions.length === 1 && (
        <p class="prov">{t("provOriginal", { date: formatRo(view.hit.version.from) })}</p>
      )}
      {view?.kind === "exact" && article !== null && article.versions.length > 1 && view.hit.version.law !== null && (
        <p class="prov">
          {t("metaLatest")}: <LawLink lawKey={view.hit.version.law.key} label={view.hit.version.law.label} />{" "}
          · {t("attributionSince", { date: formatRo(view.hit.version.from) })}
        </p>
      )}
      {view?.kind === "exact" && (
        <div class="law flow" lang="ro">
          {view.hit.version.lines.map((line) => (
            <Paragraph
              line={line}
              bar={undefined}
              last={false}
              label={undefined}
              linked={linked}
              attribution={false}
              idPrefix={`${slug}-`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FullText(props: {
  ctx: ActContext;
  act: ActObject;
  actRef: string;
  path: string;
  text: ActText;
}) {
  const { ctx, act, actRef, path, text } = props;
  const filterQuery = ctx.filter === "" ? "" : `&cuprins=${encodeURIComponent(ctx.filter)}`;
  const { paged } = text;
  const first = paged.items[0];
  const last = paged.items[paged.items.length - 1];
  const numbers = linkableNumbers(act.articles);
  const headings = act.headings ?? [];
  const start = lastHeadingBefore(act, (paged.page - 1) * TEXT_PAGE);
  let seen = start;
  const context =
    first === undefined || headings.length === 0
      ? []
      : headingPathIndexes(act, { ...first, heading: first.heading ?? (start >= 0 ? start : undefined) }).filter(
          (index) => index <= start,
        );
  return (
    <section aria-labelledby="textul">
      <h2 id="textul">{t("actFullTextHeading")}</h2>
      <p class="actions">
        <span>
          <Indexed
            text={t("actPageRange", {
              first: first?.number ?? "",
              last: last?.number ?? "",
              total: paged.total,
              page: paged.page,
              pages: paged.pages,
            })}
          />
        </span>
      </p>
      {paged.pages > 1 && (
        <div class="pages-top">
          <Pages
            paged={paged}
            href={(page) => `${path}?pagina=${page}${filterQuery}`}
            title={(page) => rangeTitle(act, page)}
          />
        </div>
      )}
      {context.length > 0 && (
        <p class="where">{context.map((index) => headingText(headings[index]!)).join(" › ")}</p>
      )}
      {paged.items.map((entry, index) => {
        const starting = headingsBefore(act, entry, seen);
        seen = Math.max(seen, entry.heading ?? -1);
        return (
          <>
            {starting.map(({ heading }) => (
              <h3 class={`hd d${heading.depth}`}>
                <span class="hd-label">{heading.label}</span>
                {heading.name !== "" && ` ${heading.name}`}
              </h3>
            ))}
            <ArticleBlock
              ctx={ctx}
              actRef={actRef}
              entry={entry}
              article={text.articles[index] ?? null}
              numbers={numbers}
              articles={act.articles}
            />
          </>
        );
      })}
      <Pages
        paged={paged}
        href={(page) => `${path}?pagina=${page}${filterQuery}`}
        title={(page) => rangeTitle(act, page)}
      />
    </section>
  );
}

function History(props: {
  ctx: ActContext;
  act: ActObject;
  actRef: string;
  paged: Paged<HistoryRow>;
}) {
  const { ctx, act, actRef, paged } = props;
  const rows = historyRows(act, ctx.now);
  const earliest = rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0]?.date ?? "");
  const path = `/${actRef}/istoric`;
  return (
    <section>
      <h2>{t("histHeading")}</h2>
      {rows.length === 0 ? (
        <p>{t("histNone")}</p>
      ) : (
        <DataTable
          head={[
            t("historyDate"),
            t("histLaw"),
            t("histArticles"),
            t("histState"),
            t("historyAction"),
          ]}
          rows={paged.items.map((row) => [
            formatRo(row.date),
            row.laws.map((law, index) => (
              <>
                {index > 0 && ", "}
                <LawLink lawKey={law.key} label={law.label} />
              </>
            )),
            String(row.articles),
            <StatusBadge id={row.pending ? "pending" : "applied"} />,
            row.date === earliest ? (
              <a href={actUrl(actRef, row.date)}>{t("viewInitial")}</a>
            ) : (
              <a href={compareUrl(actRef, null, dayBefore(row.date), row.date)}>{t("cmpCompare")}</a>
            ),
          ])}
        />
      )}
      <Pages
        paged={paged}
        href={(page) => `${path}?pagina=${page}`}
        title={(page) => `${page}/${paged.pages}`}
      />
    </section>
  );
}

function groupRulings(rows: ArticleRuling[]): { number: string; file: string; title: string | null; rows: ArticleRuling[] }[] {
  const groups = new Map<string, { number: string; file: string; title: string | null; rows: ArticleRuling[] }>();
  for (const row of rows) {
    const group = groups.get(row.file) ?? { number: row.number, file: row.file, title: row.title, rows: [] };
    group.rows.push(row);
    groups.set(row.file, group);
  }
  return [...groups.values()];
}

function Rulings(props: { act: ActObject; actRef: string; byArticle: ArticleRuling[] }) {
  const { act, actRef } = props;
  const groups = groupRulings(props.byArticle);
  return (
    <section>
      <h2>{t("rulingsActHeading")}</h2>
      {act.rulings.length === 0 ? (
        <p>{t("rulingsNone")}</p>
      ) : (
        <ul class="plain columns">
          {act.rulings.map((ruling) => (
            <li>
              <LawLink lawKey={ruling.key} label={ruling.label} />
              {ruling.finds_unconstitutional && (
                <>
                  {" "}
                  <StatusBadge id="unconstitutional" />
                </>
              )}
              <small>
                {formatRo(ruling.date)} · {outcomeText(ruling.outcome)}
              </small>
            </li>
          ))}
        </ul>
      )}
      <h2>{t("rulingsByArticleHeading")}</h2>
      {groups.length === 0 && <p>{t("rulingsByArticleNone")}</p>}
      {groups.map((group) => (
        <>
          <h3>
            <a href={articleUrl(actRef, group)}>
              <Indexed text={articleLabel(group, act.articles)} />
            </a>
            {group.title && ` ${group.title}`}
          </h3>
          <ul class="plain columns">
            {group.rows.map((row) => (
              <li>
                <LawLink lawKey={row.key} label={row.label} />
                <small>
                  {formatRo(row.date)} · {outcomeText(row.outcome)}
                </small>
              </li>
            ))}
          </ul>
        </>
      ))}
    </section>
  );
}

function Statistics(props: { act: ActObject; actRef: string }) {
  const { act, actRef } = props;
  const years = Object.entries(act.stats.changes_per_year).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...years.map(([, count]) => count));
  const { most_amended: most } = act.stats;
  return (
    <section>
      <h2>{t("statsYears")}</h2>
      {years.length === 0 ? (
        <p>{t("statsNone")}</p>
      ) : (
        <DataTable
          head={[t("statsYear"), t("statsCount")]}
          rows={years.map(([year, count]) => [
            year,
            <div class="bars">
              <span
                class="bar"
                style={`width:${Math.round((count / max) * 1000) / 10}%`}
                aria-hidden="true"
              />
              <b>{count}</b>
            </div>,
          ])}
        />
      )}
      {most.length > 0 && (
        <>
          <h2>{t("statsMost")}</h2>
          <ul class="plain columns">
            {most.map((item) => (
              <li>
                <a href={articleUrl(actRef, item)}>
                  <Indexed text={articleLabel(item, act.articles)} />
                  {item.title ? ` ${item.title}` : ""}
                </a>
                <small>{t("tocChanges", { n: item.changes })}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Data(props: { act: ActObject; actRef: string }) {
  const { act, actRef } = props;
  const feed = changesUrl(actRef);
  const official = act.freshness?.official_url ?? act.portal;
  const links: [Key, string][] = [
    ["dataFeedAtom", `${feed}.atom`],
    ["dataSource", `https://github.com/lexifina/romania-law/tree/main/${act.path}`],
    ["dataOfficial", official],
  ];
  return (
    <section>
      <h2>{t("dataHeading")}</h2>
      <ul class="plain">
        {links.map(([label, href]) => (
          <li>
            <a href={href}>{t(label)}</a>
          </li>
        ))}
      </ul>
      <h2>{t("dataLicenceHeading")}</h2>
      <p>{t("dataLicence")}</p>
    </section>
  );
}

function Rail(props: { ctx: ActContext; act: ActObject; actRef: string }) {
  const { ctx, act, actRef } = props;
  const day = ctx.date ?? ctx.now;
  const permanent = `${ORIGIN}${actUrl(actRef, ctx.date ?? (act.latest <= ctx.now ? act.latest : ctx.now))}`;
  const sentence = t("actCiteSentence", { act: act.title, date: formatRo(day) });
  return (
    <aside class="rail">
      <CitationPanel sentence={sentence} permanent={permanent} current={ctx.date !== null ? actUrl(actRef) : undefined} />
      <Panel title={t("freshTitle")}>
        <Freshness act={act} />
      </Panel>
      <Panel title={t("toolsTitle")}>
        <ul class="plain tools">
          <li>
            <a href={subscribeUrl(actRef)}>{t("toolActFeed", { act: actName(act) })}</a>
          </li>
        </ul>
      </Panel>
      <Support />
    </aside>
  );
}

export function renderAct(
  ctx: ActContext,
  act: ActObject,
  tab: ActTab,
  text?: ActText,
  rulings: ArticleRuling[] = [],
  made?: { law: LawObject; names: ActNames },
) {
  const actRef = act.alias ?? act.path;
  const current = TABS.find((item) => item.tab === tab)!;
  const path = tabPath(actRef, current, ctx.date);
  const name = actName(act);
  const named = tab === "text" ? name : `${name}: ${t(current.label)}`;
  const title = ctx.invalid === undefined ? named : `${t("errorPrefix")}: ${named}`;
  const props = { act, actRef };

  const history = tab === "istoric" ? paginate(historyRows(act, ctx.now), ctx.page ?? 1, HISTORY_PAGE) : null;
  const shownPage = tab === "text" ? (text?.paged.page ?? 1) : (history?.page ?? 1);
  const canonical = `${ORIGIN}${path}${shownPage > 1 ? `?pagina=${shownPage}` : ""}`;
  const around = text?.paged.items[0]?.file ?? act.articles[0]?.file;

  return (
    <Layout
      title={title}
      description={act.title}
      canonical={canonical}
      noindex={ctx.invalid !== undefined}
      script="/article.js"
      toc={
        <Contents
          act={act}
          actRef={actRef}
          date={ctx.date}
          now={ctx.now}
          keep=""
          flags={{}}
          filter={ctx.filter}
          path={tabPath(actRef, TABS[0]!, ctx.date)}
          current={null}
          around={around}
          cap={FILTER_CAP}
        />
      }
      rail={<Rail {...props} ctx={ctx} />}
    >
      <section class="solo wide">
        <Header ctx={ctx} act={act} actRef={actRef} tab={tab} />
        <div class="tabs-panel">
          {tab === "text" && text !== undefined && <FullText {...props} ctx={ctx} path={path} text={text} />}
          {tab === "text" && made !== undefined && (
            <ChangesMade law={made.law} names={made.names} requested={1} pageHref={null} />
          )}
          {history !== null && <History {...props} ctx={ctx} paged={history} />}
          {tab === "jurisprudenta" && <Rulings {...props} byArticle={rulings} />}
          {tab === "statistici" && <Statistics {...props} />}
          {tab === "date" && <Data {...props} />}
        </div>
      </section>
    </Layout>
  );
}
