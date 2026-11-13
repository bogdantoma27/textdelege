import { type Key, type PluralForm, t, tPlural } from "../text";
import { formatRo } from "../lib/dates";
import { actName, isCurrent, ordered } from "../lib/act-order";
import { parseActStatus } from "../lib/status";
import type { ChangeItem, ChangesObject, Manifest, ManifestAct } from "../lib/types";
import { SOURCE_REPOSITORY, actUrl } from "../lib/urls";
import { type ActNames, actOf, changeAction, changeArticle, changeCells, changesHead } from "./changes";
import { DataTable, DateField, DateHint, Tabs } from "./components";
import { Layout, ORIGIN, SearchForm } from "./layout";
import { StatusBadge, grouped } from "./shared";

const RECENT = 10;
const UPCOMING = 10;

function CodeBadge({ act }: { act: ManifestAct }) {
  const { kind, repealedOn } = parseActStatus(act.status);
  switch (kind) {
    case "in-force":
      return act.from === undefined ? null : <span class="fact">{t("homeSince", { date: formatRo(act.from) })}</span>;
    case "repealed":
      return (
        <StatusBadge id="repealed">
          {repealedOn === null ? t("homeRepealed") : t("homeRepealedOn", { date: formatRo(repealedOn) })}
        </StatusBadge>
      );
    case "unconsolidated":
      return <StatusBadge id="unconsolidated" />;
    default:
      return <StatusBadge id="notInForce" />;
  }
}

const ARTICLES: Record<PluralForm, Key> = {
  one: "homeArticlesCountOne",
  few: "homeArticlesCountFew",
  many: "homeArticlesCountMany",
};
const VERSIONS: Record<PluralForm, Key> = {
  one: "homeVersionsCountOne",
  few: "homeVersionsCountFew",
  many: "homeVersionsCountMany",
};

function codeFacts(act: ManifestAct): string {
  return [
    act.articles === undefined ? null : tPlural(act.articles, ARTICLES, { n: grouped(act.articles) }),
    act.versions === undefined ? null : tPlural(act.versions, VERSIONS, { n: grouped(act.versions) }),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

function CodeList(props: { acts: ManifestAct[]; now: string; id: string; tabbed: boolean; hidden: boolean }) {
  const { now } = props;
  return (
    <div class={props.tabbed ? "tabs-panel" : undefined} id={props.id} hidden={props.hidden}>
      <ul class="doc-list">
        {props.acts.map((act) => {
          const facts = codeFacts(act);
          const lastChange = isCurrent(act) && act.latest <= now;
          return (
            <li>
              <div class="doc-main">
                <a class="doc-link" href={actUrl(act.alias ?? act.path)}>
                  {actName(act)}
                </a>
                <p class="doc-meta">
                  <CodeBadge act={act} />
                  {facts !== "" && <span>{facts}</span>}
                </p>
              </div>
              {lastChange && <p class="doc-last">{t("homeLastChange", { date: formatRo(act.latest) })}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Hero() {
  return (
    <section class="home-hero" aria-labelledby="home-titlu">
      <h1 id="home-titlu">{t("homeHeading")}</h1>
      <p class="lede">{t("homeIntro")}</p>
      <SearchForm id="q" class="omni hero-search" placeholder={t("searchPlaceholderShort")} />
      <p class="hero-hint">{t("searchHint")}</p>
    </section>
  );
}

const ACTS: Record<PluralForm, Key> = {
  one: "homeActsCountOne",
  few: "homeActsCountFew",
  many: "homeActsCountMany",
};
const RULINGS: Record<PluralForm, Key> = {
  one: "homeRulingsCountOne",
  few: "homeRulingsCountFew",
  many: "homeRulingsCountMany",
};

function Facts({ manifest }: { manifest: Manifest }) {
  const { counts } = manifest;
  const verified = manifest.freshness.checked_against_official_source;
  const parts = [
    tPlural(counts.acts, ACTS, { n: grouped(counts.acts) }),
    tPlural(counts.articles, ARTICLES, { n: grouped(counts.articles) }),
    tPlural(counts.versions, VERSIONS, { n: grouped(counts.versions) }),
    tPlural(counts.rulings, RULINGS, { n: grouped(counts.rulings) }),
    ...(verified ? [t("homeFactsVerified", { date: formatRo(verified) })] : []),
  ];
  return <p class="home-facts">{parts.join(" · ")}</p>;
}

function DateRow({ now }: { now: string }) {
  const [dataBefore, dataAfter] = t("homeData").split("{repo}");
  return (
    <div class="home-row">
      <section class="home-date" aria-labelledby="la-data-titlu">
        <h2 id="la-data-titlu">{t("homeDateHeading")}</h2>
        <p>{t("homeDateHint")}</p>
        <form class="date-form" method="get" action="/legislatie" novalidate data-filter="">
          <label class="label" for="data">
            {t("homeDateLabel")}
          </label>
          <DateHint id="data" />
          <div class="date-row">
            <DateField id="data" name="data" value={now} required />
            <button class="btn" type="submit">
              {t("homeDateShow")}
            </button>
          </div>
        </form>
      </section>
      <section class="home-about" aria-labelledby="despre-date">
        <h2 id="despre-date">{t("homeAboutHeading")}</h2>
        <p>
          {dataBefore}
          <a href={SOURCE_REPOSITORY}>lexifina/romania-law</a>
          {dataAfter} <a href="/despre">{t("homeAboutLink")}</a>
        </p>
      </section>
    </div>
  );
}

function Upcoming({ items, names }: { items: ChangeItem[]; names: ActNames }) {
  return (
    <section aria-labelledby="in-curand-titlu">
      <h2 id="in-curand-titlu">{t("footerUpcoming")}</h2>
      <ul class="plain upcoming">
        {items.map((item) => {
          const act = actOf(item, names);
          return (
            <li>
              <time class="upcoming-date" datetime={item.date}>
                {formatRo(item.date)}
              </time>
              <a href={actUrl(act.ref)}>{act.name}</a>, {changeArticle(item, names)}
              <span class="upcoming-what">{changeAction(item)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function renderHome(
  ctx: { now: string; historical: boolean },
  manifest: Manifest,
  changes: ChangesObject | null,
  names: ActNames,
) {
  const acts = ordered(manifest.acts);
  const current = acts.filter(isCurrent);
  const historical = acts.filter((act) => !isCurrent(act));
  const tabbed = historical.length > 0;
  const showHistorical = ctx.historical && tabbed;
  const recent = (changes?.items ?? []).slice(0, RECENT);
  const upcoming = (changes?.upcoming ?? []).slice(0, UPCOMING);
  const head = changesHead();

  return (
    <Layout
      title={t("homeHeading")}
      description={t("homeDescription")}
      canonical={`${ORIGIN}/`}
      home
    >
      <section class="solo wide">
        <Hero />
        <section id="coduri" aria-labelledby="coduri-titlu">
          <h2 id="coduri-titlu">{t("navCodes")}</h2>
          {tabbed && (
            <Tabs
              label={t("navCodes")}
              tabs={[
                {
                  href: "/#coduri",
                  label: t("homeTabInForce", { count: current.length }),
                  current: !showHistorical,
                  panel: "coduri-vigoare",
                },
                {
                  href: "/?coduri=istorice#coduri",
                  label: t("homeTabHistorical", { count: historical.length }),
                  current: showHistorical,
                  panel: "coduri-istorice",
                },
              ]}
            />
          )}
          <CodeList acts={current} now={ctx.now} id="coduri-vigoare" tabbed={tabbed} hidden={showHistorical} />
          {tabbed && (
            <CodeList acts={historical} now={ctx.now} id="coduri-istorice" tabbed hidden={!showHistorical} />
          )}
          <p>
            <a href="/acte">{t("homeAllActs")}</a>
          </p>
        </section>
        <DateRow now={ctx.now} />
        <div class={upcoming.length > 0 ? "home-changes split" : "home-changes"}>
          <section aria-labelledby="recente">
            <h2 id="recente">{t("homeRecentHeading")}</h2>
            {recent.length === 0 ? (
              <p>{t("changesNone")}</p>
            ) : (
              <DataTable head={head} rows={recent.map((item) => changeCells(item, names))} />
            )}
            <p>
              <a href="/modificari">{t("homeAllChanges")}</a>
            </p>
          </section>
          {upcoming.length > 0 && <Upcoming items={upcoming} names={names} />}
        </div>
        <Facts manifest={manifest} />
      </section>
    </Layout>
  );
}
