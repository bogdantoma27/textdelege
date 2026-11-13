import { type Key, type PluralForm, t, tPlural } from "../text";
import { formatRo } from "../lib/dates";
import { actName, isCurrent, ordered } from "../lib/act-order";
import { parseActStatus } from "../lib/status";
import type { ActIndexEntry, ChangeItem, ChangesObject, EventVerb, Manifest, ManifestAct } from "../lib/types";
import { actUrl, lawKeyFromActRef, subscribeUrl } from "../lib/urls";
import { type ActNames, actOf, changeAction, changeArticle } from "./changes";
import { DateField, DateHint, Tabs } from "./components";
import { Layout, ORIGIN, SearchForm } from "./layout";
import { LawLink, StatusBadge, grouped } from "./shared";

const RECENT = 6;
const UPCOMING = 4;

/** Laws people look for by a name the act itself does not carry. Entries missing from the act index are skipped. */
export const POPULAR: { path: string; name: string }[] = [
  { path: "oug/2002/195", name: "Codul rutier" },
  { path: "lege/2014/85", name: "Codul insolvenței" },
  { path: "lege/1990/31", name: "Legea societăților" },
  { path: "lege/2023/198", name: "Legea învățământului preuniversitar" },
  { path: "lege/2006/95", name: "Legea sănătății" },
  { path: "lege/1991/50", name: "Legea autorizării construcțiilor" },
  { path: "lege/2004/554", name: "Legea contenciosului administrativ" },
  { path: "lege/2001/544", name: "Legea accesului la informații publice" },
  { path: "lege/2016/98", name: "Legea achizițiilor publice" },
  { path: "lege/2018/196", name: "Legea asociațiilor de proprietari" },
  { path: "lege/1995/51", name: "Legea avocaturii" },
  { path: "lege/2004/272", name: "Legea drepturilor copilului" },
  { path: "lege/2001/10", name: "Legea imobilelor preluate abuziv" },
  { path: "lege/1991/18", name: "Legea fondului funciar" },
  { path: "lege/2006/448", name: "Legea persoanelor cu handicap" },
  { path: "lege/2023/360", name: "Legea pensiilor publice" },
];

const KIND_LINKS: { kind: string; label: Key }[] = [
  { kind: "lege", label: "homeKindLege" },
  { kind: "oug", label: "homeKindOug" },
  { kind: "og", label: "homeKindOg" },
  { kind: "decret-lege", label: "homeKindDecretLege" },
  { kind: "hotarare-parlament", label: "homeKindHotarareParlament" },
];

const RECENT_FORMS: Record<EventVerb, Record<PluralForm, Key>> = {
  entered: { one: "homeRecentEnteredOne", few: "homeRecentEnteredFew", many: "homeRecentEnteredMany" },
  modified: { one: "homeRecentModifiedOne", few: "homeRecentModifiedFew", many: "homeRecentModifiedMany" },
  completed: { one: "homeRecentCompletedOne", few: "homeRecentCompletedFew", many: "homeRecentCompletedMany" },
  repealed: { one: "homeRecentRepealedOne", few: "homeRecentRepealedFew", many: "homeRecentRepealedMany" },
  unconstitutional: {
    one: "homeRecentUnconstitutionalOne",
    few: "homeRecentUnconstitutionalFew",
    many: "homeRecentUnconstitutionalMany",
  },
  restated: { one: "homeRecentRestatedOne", few: "homeRecentRestatedFew", many: "homeRecentRestatedMany" },
};

/** Consecutive changes of one act, on one day, of one kind, become one line. */
export function groupChanges(items: ChangeItem[]): ChangeItem[][] {
  const groups: ChangeItem[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    const first = last?.[0];
    if (last !== undefined && first?.act_path === item.act_path && first.date === item.date && first.verb === item.verb) {
      last.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}

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

function Sentence({ text, href, label }: { text: string; href: string; label: string }) {
  const [before = "", after = ""] = text.split("{link}");
  return (
    <p>
      {before}
      <a href={href}>{label}</a>
      {after}
    </p>
  );
}

function DoSection() {
  return (
    <section class="home-do" aria-labelledby="ce-poti-titlu">
      <h2 id="ce-poti-titlu">{t("homeDoHeading")}</h2>
      <Sentence text={t("homeDoDate")} href="/codul-muncii/art-41/2007-04-22" label={t("homeDoDateLink")} />
      <Sentence
        text={t("homeDoCompare")}
        href="/codul-muncii/art-41/compara/2007-04-22..2011-05-18"
        label={t("homeDoCompareLink")}
      />
      <Sentence text={t("homeDoSubscribe")} href={subscribeUrl()} label={t("homeDoSubscribeLink")} />
    </section>
  );
}

function DateRow({ now }: { now: string }) {
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
      <DoSection />
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

function Recent({ items, names }: { items: ChangeItem[]; names: ActNames }) {
  const groups = groupChanges(items).slice(0, RECENT);
  return (
    <section aria-labelledby="recente">
      <h2 id="recente">{t("homeRecentHeading")}</h2>
      {groups.length === 0 ? (
        <p>{t("changesNone")}</p>
      ) : (
        <ul class="plain home-recent">
          {groups.map((group) => {
            const [item] = group;
            if (item === undefined) return null;
            const act = actOf(item, names);
            const own = lawKeyFromActRef(item.act_path);
            const law = item.law !== null && group.every((other) => other.law?.key === item.law?.key) ? item.law : null;
            return (
              <li>
                <time datetime={item.date}>{formatRo(item.date)}</time>
                <a href={actUrl(act.ref)}>{act.name}</a> ·{" "}
                {tPlural(group.length, RECENT_FORMS[item.verb], { n: grouped(group.length) })}
                {law !== null && law.key !== own && (
                  <>
                    {" "}
                    {t("homeRecentVia")} <LawLink lawKey={law.key} label={law.label} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p>
        <a href="/modificari">{t("homeAllChanges")}</a>
      </p>
    </section>
  );
}

function Kinds({ index }: { index: ActIndexEntry[] }) {
  const count = (kind: string) => index.filter((entry) => entry.kind === kind).length;
  const links = [
    ...KIND_LINKS.map(({ kind, label }) => ({ href: `/acte?tip=${kind}`, text: `${t(label)} (${grouped(count(kind))})` })),
    { href: "/acte", text: `${t("homeAllActs")} (${grouped(index.length)})` },
  ];
  return (
    <p class="home-kinds" aria-label={t("homeKindsLabel")}>
      {links.map((link, i) => (
        <>
          {i > 0 && " · "}
          <a href={link.href}>{link.text}</a>
        </>
      ))}
    </p>
  );
}

function Popular({ index }: { index: ActIndexEntry[] }) {
  const byPath = new Map(index.map((entry) => [entry.path, entry]));
  const shown = POPULAR.flatMap(({ path, name }) => {
    const entry = byPath.get(path);
    return entry === undefined ? [] : [{ name, href: actUrl(entry.alias ?? entry.path) }];
  });
  return (
    <section aria-labelledby="populare-titlu">
      <h2 id="populare-titlu">{t("homePopularHeading")}</h2>
      {shown.length > 0 && (
        <ul class="plain columns home-popular">
          {shown.map((item) => (
            <li>
              <a href={item.href}>{item.name}</a>
            </li>
          ))}
        </ul>
      )}
      <Kinds index={index} />
    </section>
  );
}

export function renderHome(
  ctx: { now: string; historical: boolean },
  manifest: Manifest,
  changes: ChangesObject | null,
  names: ActNames,
  index: ActIndexEntry[] = [],
) {
  const acts = ordered(manifest.acts);
  const current = acts.filter(isCurrent);
  const historical = acts.filter((act) => !isCurrent(act));
  const tabbed = historical.length > 0;
  const showHistorical = ctx.historical && tabbed;
  const upcoming = (changes?.upcoming ?? []).slice(0, UPCOMING);

  return (
    <Layout
      title={t("homeHeading")}
      description={t("homeDescription")}
      canonical={`${ORIGIN}/`}
      home
    >
      <section class="solo wide">
        <div class="home-top">
          <Hero />
          <div class="home-recents">
            <Recent items={changes?.items ?? []} names={names} />
            {upcoming.length > 0 && <Upcoming items={upcoming} names={names} />}
          </div>
        </div>
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
        </section>
        <Popular index={index} />
        <DateRow now={ctx.now} />
        <Facts manifest={manifest} />
      </section>
    </Layout>
  );
}
