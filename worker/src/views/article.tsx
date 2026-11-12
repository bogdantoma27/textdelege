import type { Child } from "hono/jsx";
import { t } from "../text";
import { dayAfter, formatRo } from "../lib/dates";
import { hangingParagraph, linkCrossReferences } from "../lib/text";
import type {
  ActObject,
  ArticleEvent,
  ArticleLine,
  ArticleNeighbour,
  ArticleObject,
  ArticleVersion,
} from "../lib/types";
import { articleLabel } from "../lib/article-label";
import { linkableNumbers, unitText } from "../lib/text";
import { type View, resolveView } from "../lib/versions";
import { SOURCE_REPOSITORY, actUrl, articleUrl, compareUrl, sourceFileUrl } from "../lib/urls";
import { Rail, Contents, FreshnessWarning, citationOf, type RailProps } from "./article-rails";
import {
  Breadcrumbs,
  DataTable,
  Inset,
  type Option,
  DatedNote,
  Options,
  OffLink,
  Pagination,
  Timeline,
  WarningText,
} from "./components";
import { Indexed } from "./indexed";
import { CopyIcon } from "./icons";
import { Layout, ORIGIN } from "./layout";
import { LawLink, StatusBadge, VERBS, lawLabels } from "./shared";

export interface ArticleContext {
  now: string;
  attribution: boolean;
  highlightLast: boolean;
  filter: string;
}

const PALETTE = 8;

function barColours(article: ArticleObject): Map<string, number> {
  const colours = new Map<string, number>();
  for (const version of article.versions) {
    for (const line of version.lines) {
      if (line.law !== "" && !colours.has(line.law)) colours.set(line.law, colours.size % PALETTE);
    }
  }
  return colours;
}

function lastDay(article: ArticleObject, version: ArticleVersion, index: number): string {
  if (index === article.versions.length - 1 && article.repealed) return article.repealed.on;
  return dayAfter(version.until ?? version.from);
}

function neighbour(
  n: ArticleNeighbour | null,
  href: (target: ArticleNeighbour) => string,
): { href: string; title: string } | undefined {
  if (n === null) return undefined;
  const state =
    n.state === "repealed"
      ? ` (${t("stateRepealedShort")})`
      : n.state === "future"
        ? ` (${t("stateFutureShort")})`
        : "";
  const title = n.title ? ` ${n.title}` : "";
  return { href: href(n), title: `${articleLabel(n)}${title}${state}` };
}

export function singleLaw(version: ArticleVersion): boolean {
  const [first, ...rest] = version.lines;
  return rest.every((line) => line.law === first?.law && line.since === first.since);
}

export function Paragraph(props: {
  line: ArticleLine;
  bar: number | undefined;
  last: boolean;
  label: string | undefined;
  linked: (body: string) => Child[];
  attribution: boolean;
  changeHref?: string;
  anchored?: boolean;
  copy?: string;
  idPrefix?: string;
}) {
  const { line } = props;
  const { marker, body } = hangingParagraph(line.text);
  const anchor = `${props.idPrefix ?? ""}${line.id}`;
  const classes = ["p", `b${props.bar === undefined ? 0 : props.bar + 1}`];
  if (props.last) classes.push("last");
  return (
    <div class={classes.join(" ")} id={anchor}>
      <p class={marker === null ? "nm" : undefined}>
        {marker !== null && (
          <span class="n">
            {props.anchored ? (
              <a href={`#${anchor}`}>
                <Indexed text={marker} />
              </a>
            ) : (
              <Indexed text={marker} />
            )}
          </span>
        )}
        {props.linked(body).map((part) => (typeof part === "string" ? <Indexed text={part} /> : part))}
      </p>
      {props.copy !== undefined && marker !== null && (
        <>
          <button
            class="copy"
            type="button"
            title={t("citeCopyPara")}
            data-copy={props.copy}
            data-copied={t("citeCopied")}
            data-failed={t("citeCopyFailed")}
          >
            <CopyIcon />
            <span class="vh">{t("citeCopyPara")}</span>
          </button>
          <span class="copied" role="status" />
        </>
      )}
      {((props.attribution && line.law !== "") || props.last) && (
        <div class="who">
          {props.attribution && line.law !== "" && (
            <span class="by">
              <LawLink lawKey={line.law} label={props.label ?? line.law} />
              <span>· {t("attributionSince", { date: formatRo(line.since) })}</span>
            </span>
          )}
          {props.last &&
            (props.changeHref === undefined ? (
              <span class="here">{t("changedHere")}</span>
            ) : (
              <a class="here" href={props.changeHref}>
                {t("changedHere")}
              </a>
            ))}
        </div>
      )}
    </div>
  );
}

function History(props: {
  article: ArticleObject;
  shown?: string;
  href: (from: string, to?: string) => string;
}) {
  const { article } = props;
  const versionStart = (index: number | null) =>
    index === null ? undefined : article.versions[index]?.from;

  const rows = article.events.map((event: ArticleEvent) => {
    const units = event.units.map((id) => unitText(id)).join(", ");
    const from = versionStart(event.from_version);
    const to = versionStart(event.to_version);
    let action: Child = "";
    if (event.from_version === null && to !== undefined) {
      action = to === props.shown ? <OffLink>{t("viewInitial")}</OffLink> : <a href={props.href(to)}>{t("viewInitial")}</a>;
    } else if (from !== undefined && to !== undefined && from < to) {
      action = <a href={props.href(from, to)}>{t("historyCompare")}</a>;
    }
    return [
      formatRo(event.date),
      <>
        <span class="verb">{t(VERBS[event.verb])}</span>
        {units !== "" && <Indexed text={` ${units}`} />}
      </>,
      event.law ? <LawLink lawKey={event.law.key} label={event.law.label} /> : "",
      action,
    ];
  });

  return (
    <>
      <h2>{t("historyHeading")}</h2>
      <DataTable
        head={[
          t("historyDate"),
          t("historyEvent"),
          t("historyBy"),
          t("historyAction"),
        ]}
        rows={rows}
      />
    </>
  );
}

export function renderArticle(
  ctx: ArticleContext,
  act: ActObject,
  article: ArticleObject,
  date: string | null,
) {
  const view = resolveView(article, date, ctx.now);
  if (view === null) throw new Error(`${article.file} has no versions`);
  const { version, index } = view.hit;

  const actRef = act.alias ?? act.path;
  const dateArg = date ?? undefined;
  const path = articleUrl(actRef, article, dateArg);
  const flags: Record<string, string> = {};
  if (!ctx.attribution) flags.atribuire = "0";
  if (ctx.highlightLast) flags.ultima = "1";
  const query = new URLSearchParams(flags).toString();
  const keep = query === "" ? "" : `?${query}`;
  const onDate = (on: string) => articleUrl(actRef, article, on) + keep;
  const current = articleUrl(actRef, article) + keep;

  const first = article.versions[0]!;
  const last = article.versions[article.versions.length - 1]!;
  const name = act.short ?? act.title;
  const showsText = view.kind !== "beforeFirst";
  const attributed = !singleLaw(version);
  const rail: RailProps = {
    act,
    article,
    actRef,
    date,
    now: ctx.now,
    version,
    keep,
    flags,
    filter: ctx.filter,
  };
  const cite = citationOf(rail);

  const previous = view.kind === "beforeFirst" ? undefined : article.versions[index - 1];
  const compare = previous
    ? compareUrl(actRef, article, previous.from, version.from)
    : compareUrl(actRef, article, first.from, last.from);
  const inForce = last.until === null || last.until >= ctx.now;
  const toCurrent =
    showsText && inForce && index < article.versions.length - 1
      ? compareUrl(actRef, article, version.from, last.from)
      : undefined;

  const options: Option[] = [
    ...(article.versions.some((v) => !singleLaw(v))
      ? [{ param: "atribuire", label: t("toggleAttribution"), checked: ctx.attribution, on: "1", off: "0", flips: "attr", disabled: !attributed }]
      : []),
    ...(article.versions.length > 1
      ? [{ param: "ultima", label: t("toggleLast"), checked: ctx.highlightLast, on: "1", flips: "hl", disabled: !(showsText && index > 0 && version.lines.some((line) => line.since === version.from)) }]
      : []),
  ];

  const heading = articleLabel(article, act.articles);
  const title = `${heading} ${name}`;
  const description = article.title ? `${title}: ${article.title}` : title;
  const canonical = `${ORIGIN}${path}`;

  return (
    <Layout
      title={title}
      description={description}
      canonical={canonical}
      script="/article.js"
      toc={<Contents {...rail} path={path} current={article.file} prev={article.prev} next={article.next} />}
      rail={<Rail {...rail} />}
      cite={{ sentence: cite.sentence, address: cite.permanent }}
    >
      <article class={articleClasses(ctx, attributed)}>
        <Breadcrumbs
          items={[
            { href: "/", label: t("breadcrumbHome") },
            { href: actUrl(actRef, dateArg), label: name },
          ]}
          aside={date !== null && <DatedNote date={date} exit={current} />}
        />
        <div class="head">
          <div>
            <h1>
              <Indexed text={heading} />
              {article.title && <span class="ttl">{article.title}</span>}
            </h1>
            {showsText && <StatusRow view={view} {...{ act, article, ctx }} />}
          </div>
          {options.length > 0 && (
            <Options
              legend={t("togglesLabel")}
              action={path}
              params={ctx.filter === "" ? {} : { cuprins: ctx.filter }}
              options={options}
            />
          )}
        </div>
        <FreshnessWarning act={act} />
        <Notices view={view} {...{ article, date, onDate }} />

        <section class="time" aria-label={t("timePanelLabel")}>
          <p class="compare-links">
            {article.versions.length > 1 ? (
              <a href={compare}>{t(toCurrent === compare ? "compareWithCurrent" : "compareVersions")}</a>
            ) : (
              <OffLink>{t("compareVersions")}</OffLink>
            )}
            {toCurrent !== undefined && toCurrent !== compare && (
              <a href={toCurrent}>{t("compareWithCurrent")}</a>
            )}
          </p>
          <Timeline
            today={ctx.now}
            pick
            current={showsText ? version.from : undefined}
            points={article.versions.map((v) => ({
              date: v.from,
              href: onDate(v.from),
              name: v.law?.label ?? "",
            }))}
          />
        </section>

        {showsText && (
          <>
            <LawText
              act={act}
              article={article}
              actRef={actRef}
              date={date}
              version={version}
              index={index}
              now={ctx.now}
              attribution={attributed}
              changeHref={previous ? compareUrl(actRef, article, previous.from, version.from) : undefined}
            />
            <SourceLine act={act} article={article} version={version} address={`${ORIGIN}${articleUrl(actRef, article, version.from)}`} />
          </>
        )}

        <History
          article={article}
          shown={showsText ? version.from : undefined}
          href={(from, to) => (to === undefined ? onDate(from) : compareUrl(actRef, article, from, to))}
        />
        <Pagination
          prev={neighbour(article.prev, (n) => articleUrl(actRef, n, dateArg) + keep)}
          next={neighbour(article.next, (n) => articleUrl(actRef, n, dateArg) + keep)}
        />
      </article>
    </Layout>
  );
}

function articleClasses(ctx: ArticleContext, attributed: boolean): string | undefined {
  const classes = [attributed && ctx.attribution && "attr", ctx.highlightLast && "hl"];
  return classes.filter(Boolean).join(" ") || undefined;
}

function StatusRow(props: { view: View; act: ActObject; article: ArticleObject; ctx: ArticleContext }) {
  const { view, act, article, ctx } = props;
  const { version, index } = view.hit;
  const from = formatRo(version.from);
  const verified = act.freshness?.last_verified;

  let badge: Child;
  let validity: string;
  const repealMark = article.repealed !== null && version.until === null && article.repealed.on <= version.from;
  if (repealMark && version.from <= ctx.now) {
    badge = <StatusBadge id="repealed">{t("statusRepealed", { date: formatRo(article.repealed!.on) })}</StatusBadge>;
    validity = "";
  } else if (view.kind === "ended") {
    const until = version.until ?? version.from;
    badge = article.repealed ? (
      <StatusBadge id="repealed">{t("statusRepealed", { date: formatRo(lastDay(article, version, index)) })}</StatusBadge>
    ) : (
      <StatusBadge id="ended" />
    );
    validity = t("validityRange", { from, until: formatRo(until) });
  } else if (version.from > ctx.now) {
    badge = <StatusBadge id="future" />;
    validity = t("validityFuture", { from });
  } else if (version.until !== null && version.until < ctx.now) {
    badge = <StatusBadge id="superseded" />;
    validity = t("validityRange", { from, until: formatRo(version.until) });
  } else {
    badge = <StatusBadge id="inForce" />;
    validity =
      version.until === null
        ? t("validityCurrent", { from })
        : t("validityRange", { from, until: formatRo(version.until) });
  }

  return (
    <div class="status">
      {badge}
      {validity !== "" && <span>{validity}</span>}
      <span class="fact">
        {verified ? t("statusVerified", { date: formatRo(verified) }) : t("statusUnverified")}
      </span>
    </div>
  );
}

function Notices(props: {
  view: View;
  article: ArticleObject;
  date: string | null;
  onDate: (on: string) => string;
}) {
  const { view, article } = props;
  const { version, index } = view.hit;

  if (view.kind === "beforeFirst") {
    return (
      <WarningText>
        {t("notInForceAt", { date: formatRo(props.date ?? version.from) })}{" "}
        <a href={props.onDate(version.from)} data-pick="">
          {t("firstVersionLink", { date: formatRo(version.from) })}
        </a>
      </WarningText>
    );
  }
  if (view.kind === "notYet") {
    return <Inset>{t("notYetInForce", { date: formatRo(version.from) })}</Inset>;
  }
  if (view.kind === "ended") {
    if (article.repealed) {
      return (
        <WarningText>
          {t("repealedNotice", { date: formatRo(lastDay(article, version, index)) })}
        </WarningText>
      );
    }
    return <WarningText>{t("endedNotice", { date: formatRo(version.until ?? version.from) })}</WarningText>;
  }
  return null;
}

function LawText(props: {
  act: ActObject;
  article: ArticleObject;
  actRef: string;
  date: string | null;
  version: ArticleVersion;
  index: number;
  now: string;
  attribution: boolean;
  changeHref: string | undefined;
}) {
  const { act, article, actRef, date, version, index } = props;
  const labels = lawLabels(act, article);
  const colours = barColours(article);
  const numbers = linkableNumbers(act.articles);
  const linked = (body: string) => linkCrossReferences(body, { actRef, date, articles: numbers });
  const permanent = `${ORIGIN}${articleUrl(actRef, article, version.from)}`;
  const copyText = (line: ArticleLine) =>
    `${t("citeParagraph", {
      ref: `${articleLabel(article, act.articles)} ${unitText(line.id)}`,
      act: act.short ?? act.title,
      date: formatRo(date ?? props.now),
    })}, ${permanent}#${line.id}`;
  return (
    <div class="law" lang="ro">
      {version.lines.map((line) => (
        <Paragraph
          line={line}
          bar={colours.get(line.law)}
          last={index > 0 && line.since === version.from}
          label={labels.get(line.law)}
          linked={linked}
          attribution={props.attribution}
          changeHref={props.changeHref}
          anchored
          copy={copyText(line)}
        />
      ))}
    </div>
  );
}

function SourceLine(props: {
  act: ActObject;
  article: ArticleObject;
  version: ArticleVersion;
  address: string;
}) {
  const { act, article, version } = props;
  let host = act.portal;
  try {
    host = new URL(act.portal).hostname;
  } catch {
  }
  const blob = sourceFileUrl(act, article, version);
  const issue = new URLSearchParams({
    title: t("reportTitle", { act: act.short ?? act.title, article: articleLabel(article, act.articles) }),
    body: t("reportBody", {
      act: act.short ?? act.title,
      article: articleLabel(article, act.articles),
      date: formatRo(version.from),
      commit: version.commit,
      address: props.address,
    }),
  });
  return (
    <div class="src">
      <p>
        <span>
          {t("sourceOfficial")} <a href={act.portal}>{host}</a>
        </span>
        <span>
          <a href={blob}>{t("sourceRepo")}</a>
        </span>
        <span class="report">
          <a href={`${SOURCE_REPOSITORY}/issues/new?${issue.toString()}`}>{t("reportIssue")}</a>
        </span>
      </p>
    </div>
  );
}
