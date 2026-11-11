import type { Child } from "hono/jsx";
import { type Key, type PluralForm, t, tPlural } from "../text";
import { ACT_CAP, eventsIn, linkRange } from "../lib/compare";
import { dayBefore, formatRo } from "../lib/dates";
import { type Granularity, type LineDiff, type DiffPart, diffLines, diffStats } from "../lib/diff";
import type {
  ActArticleEntry,
  ActObject,
  ArticleEvent,
  ArticleObject,
  ArticleVersion,
  LawChange,
  LawObject,
  LawRef,
} from "../lib/types";
import { unitText } from "../lib/text";
import { actUrl, articleUrl, compareUrl, sourceFileUrl } from "../lib/urls";
import { versionOn } from "../lib/versions";
import { CitationPanel, Contents, type RailProps } from "./article-rails";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon } from "./icons";
import { LawLink, VERBS, lawLabels } from "./shared";
import { Indexed } from "./indexed";
import { Layout, ORIGIN } from "./layout";
import { Breadcrumbs, OffLink, Options, Pagination, Panel, SummaryList, Support, Timeline, WarningText } from "./components";

export interface CompareContext {
  now: string;
  parallel: boolean;
  onlyChanges: boolean;
  colourBlind: boolean;
  granularity: Granularity;
}

type Flag = "parallel" | "onlyChanges" | "colourBlind" | "chars";

const FLAGS: Record<Flag, [name: string, value: string]> = {
  parallel: ["vedere", "paralel"],
  onlyChanges: ["doar", "diferente"],
  colourBlind: ["paleta", "daltonism"],
  chars: ["granularitate", "caractere"],
};

export const FLAG_PAIRS = Object.values(FLAGS);

const SAME_LAW_CAP = 30;
const NAMED_UNITS = 4;

function flagState(ctx: CompareContext): Record<Flag, boolean> {
  return {
    parallel: ctx.parallel,
    onlyChanges: ctx.onlyChanges,
    colourBlind: ctx.colourBlind,
    chars: ctx.granularity === "char",
  };
}

function flagParams(ctx: CompareContext, skip?: Flag): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [flag, on] of Object.entries(flagState(ctx)) as [Flag, boolean][]) {
    if (on && flag !== skip) params[FLAGS[flag][0]] = FLAGS[flag][1];
  }
  return params;
}

function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query === "" ? path : `${path}?${query}`;
}

const CHANGES: Record<PluralForm, Key> = {
  one: "cmpChangesOne",
  few: "cmpChangesFew",
  many: "cmpChangesMany",
};
const COLLAPSED: Record<PluralForm, Key> = {
  one: "cmpCollapsedOne",
  few: "cmpCollapsedFew",
  many: "cmpCollapsedMany",
};
const ACT_COUNT: Record<PluralForm, Key> = {
  one: "cmpActCountOne",
  few: "cmpActCountFew",
  many: "cmpActCountMany",
};

export const changesPhrase = (n: number) => tPlural(n, CHANGES, {});

const dayRange = (from: string, to: string) =>
  t("cmpRange", { from: formatRo(from), to: formatRo(to) });

const rangeText = (from: string, until: string | null) =>
  until === null ? t("cmpRangeOpen", { from: formatRo(from) }) : dayRange(from, until);

const blob = sourceFileUrl;

function unitList(ids: string[]): string {
  if (ids.length > NAMED_UNITS) return t("cmpManyUnits", { n: ids.length });
  return ids.map((id) => unitText(id)).join(", ");
}

function Stats({ diff }: { diff: LineDiff[] }) {
  const stats = diffStats(diff);
  const total = stats.changed + stats.added + stats.removed;
  if (total === 0) return <span class="cnt">{t("cmpNoChanges")}</span>;
  const changedIds = diff.filter((entry) => entry.status !== "same").map((entry) => entry.id);
  const sameIds = diff.filter((entry) => entry.status === "same").map((entry) => entry.id);
  return (
    <span>
      <span class="cnt">{changesPhrase(total)}</span>{" "}
      <Indexed text={t("cmpIn", { units: unitList(changedIds) })} />
      {sameIds.length > 0 && (
        <Indexed
          text={` · ${t(sameIds.length === 1 ? "cmpUnchangedOne" : "cmpUnchangedMany", { units: unitList(sameIds) })}`}
        />
      )}
    </span>
  );
}

function Parts({ parts, side }: { parts: DiffPart[]; side: "both" | "old" | "new" }) {
  return (
    <>
      {parts.map((part) => {
        if (part.removed) {
          return side === "new" ? null : (
            <del>
              <span class="vh">{t("cmpDelStart")}</span>
              <Indexed text={part.value} />
              <span class="vh">{t("cmpDelEnd")}</span>
            </del>
          );
        }
        if (part.added) {
          return side === "old" ? null : (
            <ins>
              <span class="vh">{t("cmpInsStart")}</span>
              <Indexed text={part.value} />
              <span class="vh">{t("cmpInsEnd")}</span>
            </ins>
          );
        }
        return <Indexed text={part.value} />;
      })}
    </>
  );
}

function Text({ entry, side }: { entry: LineDiff; side: "both" | "old" | "new" }) {
  const marker = entry.marker;
  return (
    <p class={marker === null ? "nm" : undefined}>
      {marker !== null && (
        <span class="n">
          <Indexed text={marker} />
        </span>
      )}
      <Parts parts={entry.parts} side={side} />
    </p>
  );
}

interface Source {
  law: LawRef | null;
  since: string;
}

function sourceFor(
  article: ArticleObject,
  fromIndex: number,
  toIndex: number,
  labels: Map<string, string>,
): (entry: LineDiff) => Source {
  const to = article.versions[toIndex]!;
  return (entry) => {
    const after = entry.after;
    if (after === null) {
      for (let index = fromIndex + 1; index <= toIndex; index++) {
        const version = article.versions[index]!;
        if (!version.lines.some((line) => line.id === entry.id)) {
          return { law: version.law, since: version.from };
        }
      }
      return { law: to.law, since: to.from };
    }
    if (after.law !== "") {
      return { law: { key: after.law, label: labels.get(after.law) ?? after.law }, since: after.since };
    }
    return { law: to.law, since: after.since };
  };
}

const STATUS: Record<"changed" | "added" | "removed", Key> = {
  changed: "cmpStatusChanged",
  added: "cmpStatusAdded",
  removed: "cmpStatusRemoved",
};

function Steps(props: { at: number; total: number }) {
  const { at, total } = props;
  if (total < 2) return null;
  return (
    <span class="step">
      {at > 1 ? (
        <a href={`#schimbare-${at - 1}`} aria-label={t("cmpPrev")}>
          <ArrowUpIcon />
        </a>
      ) : (
        <OffLink>
          <ArrowUpIcon />
          <span class="vh">{t("cmpPrev")}</span>
        </OffLink>
      )}
      {at < total ? (
        <a href={`#schimbare-${at + 1}`} aria-label={t("cmpNext")}>
          <ArrowDownIcon />
        </a>
      ) : (
        <OffLink>
          <ArrowDownIcon />
          <span class="vh">{t("cmpNext")}</span>
        </OffLink>
      )}
    </span>
  );
}

function Cause(props: {
  entry: LineDiff;
  source: Source;
  at: number;
  total: number;
}) {
  const { entry, source } = props;
  if (entry.status === "same") return <div class="chg">{t("cmpUnchangedBlock")}</div>;
  return (
    <div class="chg">
      <b>{t(STATUS[entry.status])}</b>
      {source.law && (
        <>
          {" "}
          {t("cmpBy")} <LawLink lawKey={source.law.key} label={source.law.label} />
        </>
      )}
      <span>· {t("cmpEffective", { date: formatRo(source.since) })}</span>
      <Steps at={props.at} total={props.total} />
    </div>
  );
}

type Item =
  | { kind: "line"; entry: LineDiff; at: number }
  | { kind: "gap"; count: number };

function items(diff: LineDiff[], collapse: boolean): Item[] {
  const out: Item[] = [];
  let at = 0;
  for (const entry of diff) {
    if (entry.status !== "same") at++;
    const last = out[out.length - 1];
    if (collapse && entry.status === "same") {
      if (last?.kind === "gap") last.count++;
      else out.push({ kind: "gap", count: 1 });
    } else {
      out.push({ kind: "line", entry, at: entry.status === "same" ? 0 : at });
    }
  }
  return out;
}

function Gap({ count }: { count: number }) {
  return <div class="gap">{tPlural(count, COLLAPSED)}</div>;
}

function InlineText(props: {
  list: Item[];
  to: ArticleVersion;
  sourceOf: (entry: LineDiff) => Source;
  total: number;
}) {
  return (
    <div class="law" lang="ro">
      {props.list.map((item) => {
        if (item.kind === "gap") return <Gap count={item.count} />;
        const { entry, at } = item;
        return (
          <div class={`p ${entry.status}`} id={at === 0 ? entry.id : `schimbare-${at}`}>
            <Text entry={entry} side="both" />
            <Cause
              entry={entry}
              source={props.sourceOf(entry)}
              at={at}
              total={props.total}
            />
          </div>
        );
      })}
    </div>
  );
}

function ParallelText(props: {
  list: Item[];
  from: ArticleVersion;
  to: ArticleVersion;
  sourceOf: (entry: LineDiff) => Source;
  total: number;
}) {
  return (
    <div class="law sbs" lang="ro">
      <div class="pair head">
        <div class="cell">
          <b>{t("cmpOld")}</b> {rangeText(props.from.from, props.from.until)}
        </div>
        <div class="cell">
          <b>{t("cmpNew")}</b> {rangeText(props.to.from, props.to.until)}
        </div>
      </div>
      {props.list.map((item) => {
        if (item.kind === "gap") return <Gap count={item.count} />;
        const { entry, at } = item;
        const hasOld = entry.status !== "added";
        const hasNew = entry.status !== "removed";
        const cause = (
          <Cause
            entry={entry}
            source={props.sourceOf(entry)}
            at={at}
            total={props.total}
          />
        );
        return (
          <div class="pair" id={at === 0 ? entry.id : `schimbare-${at}`}>
            {hasOld ? (
              <div class={`cell old ${entry.status}`}>
                <div class="p">
                  <Text entry={entry} side="old" />
                  {!hasNew && cause}
                </div>
              </div>
            ) : (
              <div class="cell old empty" aria-hidden="true" />
            )}
            {hasNew ? (
              <div class={`cell new ${entry.status}`}>
                <div class="p">
                  <Text entry={entry} side="new" />
                  {cause}
                </div>
              </div>
            ) : (
              <div class="cell new empty" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function VersionInfo(props: { version: ArticleVersion; by: Key }) {
  const { version } = props;
  return (
    <>
      {rangeText(version.from, version.until)}
      {version.law && (
        <span class="by">
          {t(props.by)} <LawLink lawKey={version.law.key} label={version.law.label} />
        </span>
      )}
    </>
  );
}

function titleOf(act: ActObject, file: string): string | null {
  return act.articles.find((entry) => entry.file === file)?.title ?? null;
}

function SameLaw(props: {
  act: ActObject;
  actRef: string;
  article: ArticleObject;
  to: ArticleVersion;
  law: LawObject | null;
}) {
  const { act, actRef, article, to, law } = props;
  const rows: LawChange[] = (law?.changes ?? []).filter(
    (change) => change.act_path === act.path && change.date === to.from && change.file !== article.file,
  );
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SAME_LAW_CAP);
  return (
    <>
      <h2>{t("cmpSameLawHeading", { act: act.short ?? act.title })}</h2>
      <div class="table-wrap">
        <table class="data same-law">
          <thead>
            <tr>
              <th scope="col">{t("cmpColArticle")}</th>
              <th scope="col">{t("cmpColWhat")}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {shown.map((change) => {
              const entry = act.articles.find((candidate) => candidate.file === change.file);
              const title = titleOf(act, change.file);
              const units = change.units.map((id) => unitText(id)).join(", ");
              const comparable =
                (change.verb === "modified" || change.verb === "completed") &&
                entry?.first != null &&
                entry.first < change.date;
              return (
                <tr>
                  <td>
                    <a href={articleUrl(actRef, change.number, change.date)}>
                      <Indexed text={t("articleAbbr", { number: change.number })} />
                    </a>
                    {title && ` ${title}`}
                  </td>
                  <td>
                    <span class="verb">{t(VERBS[change.verb])}</span>
                    {units !== "" && <Indexed text={` ${units}`} />}
                  </td>
                  <td>
                    {comparable ? (
                      <a href={compareUrl(actRef, change.number, dayBefore(change.date), change.date)}>
                        {t("cmpCompare")}
                      </a>
                    ) : (
                      <a href={articleUrl(actRef, change.number, change.date)}>{t("cmpOpen")}</a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <p class="toc-note">{t("cmpMore", { n: rows.length - shown.length })}</p>
      )}
    </>
  );
}

function LawPanel(props: { version: ArticleVersion; law: LawObject | null }) {
  const { version, law } = props;
  if (version.law === null) return null;
  const inForce = law?.in_force.includes(version.from) ? version.from : law?.in_force[0];
  const details = [law?.mo, inForce ? t("cmpLawInForce", { date: formatRo(inForce) }) : null]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" · ");
  return (
    <Panel title={t("cmpLawTitle")}>
      <ul class="plain">
        <li>
          <LawLink lawKey={version.law.key} label={version.law.label} />
          {details !== "" && <small>{details}</small>}
        </li>
      </ul>
    </Panel>
  );
}

function Pick(props: {
  article: ArticleObject;
  actRef: string;
  from: string;
  to: string;
  ctx: CompareContext;
}) {
  const { article } = props;
  const options = (selected: string) =>
    article.versions.map((version) => (
      <option value={version.from} selected={version.from === selected ? true : undefined}>
        {version.law ? `${formatRo(version.from)} · ${version.law.label}` : formatRo(version.from)}
      </option>
    ));
  return (
    <form class="pick" data-filter="" method="get" action={`${articleUrl(props.actRef, article.number)}/compara`}>
      <fieldset>
        <legend>{t("cmpPickTitle")}</legend>
        <div class="pick-fields">
          <div>
            <label class="label" for="de">
              {t("cmpPickOld")}
            </label>
            <select class="field" id="de" name="de">
              {options(props.from)}
            </select>
          </div>
          <div>
            <label class="label" for="pana">
              {t("cmpPickNew")}
            </label>
            <select class="field" id="pana" name="pana">
              {options(props.to)}
            </select>
          </div>
          <button class="btn" type="submit">
            {t("cmpCompare")}
          </button>
        </div>
      </fieldset>
      {Object.entries(flagParams(props.ctx)).map(([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ))}
    </form>
  );
}

export function renderCompare(
  ctx: CompareContext,
  act: ActObject,
  article: ArticleObject,
  from: string,
  to: string,
  law: LawObject | null,
) {
  const fromHit = versionOn(article, from);
  const toHit = versionOn(article, to);
  if (fromHit === null || toHit === null) throw new Error(`${article.file} has no version on ${from} or ${to}`);
  const older = fromHit.version;
  const newer = toHit.version;

  const actRef = act.alias ?? act.path;
  const name = act.short ?? act.title;
  const heading = t("articleAbbr", { number: article.number });
  const path = compareUrl(actRef, article.number, from, to);
  const here = (over: Record<string, string>) => withQuery(path, over);
  const keep = flagParams(ctx);
  const title = `${heading} ${name}: ${t("cmpKicker")} ${dayRange(from, to)}`;

  const diff = diffLines(older.lines, newer.lines, ctx.granularity);
  const counts = diffStats(diff);
  const total = counts.changed + counts.added + counts.removed;
  const sourceOf = sourceFor(article, fromHit.index, toHit.index, lawLabels(act, article));
  const list = items(diff, ctx.onlyChanges);

  const option = (flag: Flag, label: string, extra?: { class?: string; flips?: string }) => ({
    param: FLAGS[flag][0],
    on: FLAGS[flag][1],
    label,
    checked: flagState(ctx)[flag],
    ...extra,
  });

  const rail: RailProps = {
    act,
    article,
    actRef,
    date: null,
    now: ctx.now,
    version: newer,
    keep: "",
    flags: {},
    filter: "",
  };
  const previous = fromHit.index > 0 ? article.versions[fromHit.index - 1] : undefined;
  const permanent = `${ORIGIN}${path}`;

  return (
    <Layout
      title={title}
      description={title}
      canonical={permanent}
      noindex
      script="/article.js"
      toc={<Contents {...rail} path={articleUrl(actRef, article.number)} current={article.file} />}
      rail={
        <aside class="rail">
          <CitationPanel
            permanent={permanent}
            sentence={t("cmpCiteSentence", {
              ref: heading,
              act: name,
              from: formatRo(from),
              to: formatRo(to),
            })}
          />
          <LawPanel version={newer} law={law} />
          <Support />
        </aside>
      }
    >
      <article class={ctx.colourBlind ? "cmp cb" : "cmp"}>
        <Breadcrumbs
          items={[
            { href: "/", label: t("breadcrumbHome") },
            { href: actUrl(actRef), label: name },
            { href: articleUrl(actRef, article.number), label: <Indexed text={heading} /> },
          ]}
        />
        <p class="caption">
          {name} · {t("cmpKicker")}
        </p>
        <h1>
          <Indexed text={heading} />
          {article.title && ` ${article.title}`}
        </h1>

        <div class="versions" role="group" aria-label={t("cmpVersionsLabel")}>
          <SummaryList
            rows={[
              { label: t("cmpOld"), value: <VersionInfo version={older} by="cmpFormBy" /> },
              {
                label: t("cmpNew"),
                value: (
                  <VersionInfo
                    version={newer}
                    by={toHit.index > fromHit.index ? "cmpModifiedBy" : "cmpFormBy"}
                  />
                ),
              },
            ]}
          />
        </div>

        <Pick article={article} actRef={actRef} from={older.from} to={newer.from} ctx={ctx} />

        <section class="time" aria-label={t("timePanelLabel")}>
          <Timeline
            today={ctx.now}
            from={older.from}
            to={newer.from}
            points={article.versions.map((version) => ({
              date: version.from,
              href: articleUrl(actRef, article.number, version.from),
              name: version.law?.label ?? "",
            }))}
          />
        </section>

        <Options
          legend={t("cmpBarLabel")}
          action={path}
          params={ctx.granularity === "char" ? { [FLAGS.chars[0]]: FLAGS.chars[1] } : {}}
          options={[
            option("parallel", t("cmpParallel"), { class: "wide-only" }),
            option("onlyChanges", t("cmpOnlyChanges")),
            option("colourBlind", t("cmpColourBlind"), { flips: "cb" }),
          ]}
        />

        <div class="dbar">
          <Stats diff={diff} />
          {total > 1 && (
            <span class="step" role="group" aria-label={t("cmpStepLabel")}>
              <a href={`#schimbare-${total}`}>
                <ArrowUpIcon />
                {t("cmpPrev")}
              </a>
              <a href="#schimbare-1">
                {t("cmpNext")}
                <ArrowDownIcon />
              </a>
            </span>
          )}
        </div>

        {ctx.parallel ? (
          <ParallelText list={list} from={older} to={newer} sourceOf={sourceOf} total={total} />
        ) : (
          <InlineText list={list} to={newer} sourceOf={sourceOf} total={total} />
        )}

        <div class="legend">
          <span>
            <del>{t("cmpLegendDel")}</del>
          </span>
          <span>
            <ins>{t("cmpLegendIns")}</ins>
          </span>
          <span>
            {t("cmpAligned")} {t(ctx.granularity === "char" ? "cmpGranChar" : "cmpGranWord")}{" "}
            <a
              href={here({
                ...flagParams(ctx, "chars"),
                ...(ctx.granularity === "char" ? {} : { [FLAGS.chars[0]]: FLAGS.chars[1] }),
              })}
            >
              {t(ctx.granularity === "char" ? "cmpSwitchWord" : "cmpSwitchChar")}
            </a>
          </span>
        </div>

        <div class="src">
          <p>
            <span>
              {t("cmpRepoOld")} <a href={blob(act, article, older)}>{t("sourceRepo")}</a>
            </span>
            <span>
              {t("cmpRepoNew")} <a href={blob(act, article, newer)}>{t("sourceRepo")}</a>
            </span>
            <span>
              {t("sourceOfficial")} <a href={act.portal}>{hostOf(act.portal)}</a>
            </span>
          </p>
        </div>

        <SameLaw act={act} actRef={actRef} article={article} to={newer} law={law} />

        {previous && (
          <Pagination
            captions={{ prev: t("cmpPrevVersion"), next: t("next") }}
            prev={{
              href: withQuery(compareUrl(actRef, article.number, previous.from, older.from), keep),
              title: dayRange(previous.from, older.from),
            }}
          />
        )}
        <p class="back">
          <a href={articleUrl(actRef, article.number)}>
            <ChevronLeftIcon size={16} />
            <Indexed text={t("cmpBackLink", { number: article.number })} />
          </a>
        </p>
      </article>
    </Layout>
  );
}

function hostOf(portal: string): string {
  try {
    return new URL(portal).hostname;
  } catch {
    return portal;
  }
}

export interface ActCompareRow {
  entry: ActArticleEntry;
  article: ArticleObject;
  events: ArticleEvent[];
}

export function changedRows(
  entries: ActArticleEntry[],
  articles: (ArticleObject | null)[],
  from: string,
  to: string,
): ActCompareRow[] {
  const rows: ActCompareRow[] = [];
  entries.forEach((entry, index) => {
    const article = articles[index];
    if (article === null || article === undefined) return;
    const events = eventsIn(article, from, to);
    if (events.length > 0) rows.push({ entry, article, events });
  });
  return rows;
}

export function renderActCompare(
  act: ActObject,
  rows: ActCompareRow[],
  from: string,
  to: string,
  capped: boolean,
) {
  const actRef = act.alias ?? act.path;
  const name = act.short ?? act.title;
  const path = compareUrl(actRef, null, from, to);
  const heading = t("cmpActHeading", { act: name });
  const range = t("cmpActRange", { from: formatRo(from), to: formatRo(to) });

  return (
    <Layout
      title={`${heading}: ${range}`}
      description={`${heading}: ${range}`}
      canonical={`${ORIGIN}${path}`}
      noindex
    >
      <section class="solo wide">
        <Breadcrumbs
          items={[
            { href: "/", label: t("breadcrumbHome") },
            { href: actUrl(actRef), label: name },
          ]}
        />
        <p class="caption">{t("cmpKicker")}</p>
        <h1>{heading}</h1>
        <div class="dbar">
          <span class="cnt">{range}</span>
          <span>
            {rows.length === 0
              ? t("cmpActNone")
              : tPlural(rows.length, ACT_COUNT, {})}
          </span>
        </div>
        {capped && <WarningText>{t("cmpActCapped", { n: ACT_CAP })}</WarningText>}
        {rows.length > 0 && (
          <div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th scope="col">{t("cmpColArticle")}</th>
                  <th scope="col">{t("cmpColWhat")}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ActRow actRef={actRef} row={row} from={from} to={to} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}

function ActRow(props: { actRef: string; row: ActCompareRow; from: string; to: string }) {
  const { actRef, row } = props;
  const range = linkRange(row.article, props.from, props.to);
  const link: Child = range ? (
    <a href={compareUrl(actRef, row.article.number, range.from, range.to)}>{t("cmpCompare")}</a>
  ) : (
    <a href={articleUrl(actRef, row.article.number)}>{t("cmpOpen")}</a>
  );
  return (
    <tr>
      <td>
        <a href={articleUrl(actRef, row.article.number)}>
          <Indexed text={t("articleAbbr", { number: row.article.number })} />
        </a>
        {row.article.title && ` ${row.article.title}`}
      </td>
      <td>
        {row.events.map((event) => {
          const units = event.units.map((id) => unitText(id)).join(", ");
          return (
            <div>
              <span class="verb">{t(VERBS[event.verb])}</span>
              {units !== "" && <Indexed text={` ${units}`} />} · {formatRo(event.date)}
              {event.law && (
                <>
                  {" · "}
                  <LawLink lawKey={event.law.key} label={event.law.label} />
                </>
              )}
            </div>
          );
        })}
      </td>
      <td>{link}</td>
    </tr>
  );
}
