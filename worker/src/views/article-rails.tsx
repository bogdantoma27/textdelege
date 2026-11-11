import type { Child } from "hono/jsx";
import { genitive, t } from "../text";
import { tocEntries } from "../lib/act";
import { normalise } from "../lib/citation";
import { formatRo } from "../lib/dates";
import type { ActArticleEntry, ActObject, ArticleObject, ArticleState, ArticleVersion } from "../lib/types";
import { actUrl, articleUrl, rulingUrlFromKey, subscribeUrl } from "../lib/urls";
import { Indexed } from "./indexed";
import { ORIGIN } from "./layout";
import { Panel, Support, WarningText } from "./components";
import { outcomeText } from "./shared";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

const WINDOW = 30;
const FILTER_CAP = 100;

export interface RailProps {
  act: ActObject;
  article: ArticleObject;
  actRef: string;
  date: string | null;
  now: string;
  version: ArticleVersion;
  keep: string;
  flags: Record<string, string>;
  filter: string;
}

const actName = (act: ActObject) => act.short ?? act.title;

export function matches(entry: ActArticleEntry, query: string): boolean {
  const q = query.replace(/^art\.?\s*/, "");
  if (q === "") return true;
  return (
    normalise(entry.number).startsWith(q) ||
    normalise(entry.title ?? "").includes(q) ||
    normalise(entry.lead ?? "").includes(q)
  );
}

function repealingAct(act: ActObject, day: string): string | null {
  const laws = act.timeline.find((entry) => entry.date === day)?.laws ?? [];
  return laws.length === 1 ? laws[0]!.label : null;
}

function repealNote(entry: ActArticleEntry, act: ActObject): string {
  if (entry.last_change === null) return t("stateRepealedShort");
  const by = repealingAct(act, entry.last_change);
  const date = formatRo(entry.last_change);
  return by === null
    ? t("tocRepealedOn", { date })
    : t("tocRepealedBy", { date, act: by });
}

function entryTip(entry: ActArticleEntry, state: ArticleState, act: ActObject): string | undefined {
  const parts: string[] = [];
  if (entry.title ?? entry.lead) parts.push((entry.title ?? entry.lead)!);
  if (state === "repealed") parts.push(repealNote(entry, act));
  if (state === "future") parts.push(t("stateFutureShort"));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export interface ContentsProps {
  act: ActObject;
  actRef: string;
  date: string | null;
  now: string;
  keep: string;
  flags: Record<string, string>;
  filter: string;
  path: string;
  current: string | null;
  around?: string;
  cap?: number;
  prev?: string | null;
  next?: string | null;
  all?: boolean;
}

function contentsUrl(actRef: string, date: string | null, keep: string): string {
  return `${actUrl(actRef, date ?? undefined)}/cuprins${keep}`;
}

export function Contents(props: ContentsProps) {
  const { act, actRef, date, keep, flags } = props;
  const cap = props.cap ?? FILTER_CAP;
  const query = normalise(props.filter);
  const filtering = query !== "";
  const all = tocEntries(act, date, props.now);
  const position = all.findIndex((item) => item.entry.file === props.current);
  const articleHref = (number: string) => articleUrl(actRef, number, date ?? undefined) + keep;
  let shown = all;
  let note: string | null = null;
  let before: { n: number; href: string } | null = null;
  let after: { n: number; href: string } | null = null;
  if (filtering) {
    shown = shown.filter((item) => matches(item.entry, query));
    if (shown.length > cap) {
      shown = shown.slice(0, cap);
      note = t("tocCapNote", { n: cap });
    }
  } else if (!props.all && shown.length > 2 * WINDOW + 1) {
    const centre = props.around ?? props.current;
    const at = Math.max(0, shown.findIndex((item) => item.entry.file === centre));
    const start = Math.max(0, at - WINDOW);
    const end = Math.min(shown.length, start + 2 * WINDOW + 1);
    if (start > 0) before = { n: start, href: articleHref(shown[Math.max(0, start - WINDOW)]!.entry.number) };
    if (end < shown.length) {
      after = { n: shown.length - end, href: articleHref(shown[Math.min(shown.length - 1, end - 1 + WINDOW)]!.entry.number) };
    }
    shown = shown.slice(start, end);
  }
  const width = Math.max(3, ...shown.map((item) => item.entry.number.length));
  const close = filtering ? props.path + keep : "#main";
  return (
    <>
      <div class={filtering ? "toc-sheet open" : "toc-sheet"} id="cuprins">
        <nav
          class="toc"
          aria-label={t("tocTitle")}
          style={`--nw:${width}ch`}
          data-all={before || after || filtering ? contentsUrl(actRef, date, keep) : undefined}
          data-count={t("tocCount", { n: "{n}" })}
          data-none={t("tocNoMatch")}
        >
          <div class="toc-head">
            <span class="ttl">{t("tocTitle")}</span>
            <span class="cnt">{t("tocCount", { n: all.length })}</span>
            <a class="close" href={close}>
              {t("tocClose")}
            </a>
          </div>
          <form class="flt" method="get" action={props.path} role="search">
            <label class="flt-label" for="toc-filter">
              {t("tocFilterTitle")}
            </label>
            <input
              class="field"
              id="toc-filter"
              type="search"
              name="cuprins"
              value={props.filter}
              placeholder={t("tocFilterLabel")}
              autocomplete="off"
            />
            <span class="vh" id="toc-status" role="status" />
            {Object.entries(flags).map(([name, value]) => (
              <input type="hidden" name={name} value={value} />
            ))}
          </form>
          <div class="toc-list">
          {filtering && (
            <p class="toc-note">
              <a href={props.path + keep}>{t("tocClear")}</a>
            </p>
          )}
          {shown.length === 0 && <p class="toc-note">{t("tocNoMatch")}</p>}
          {before && (
            <a class="more" href={before.href}>
              {t("tocBefore", { n: before.n })}
            </a>
          )}
          {shown.map(({ entry, state }) => {
            const current = entry.file === props.current;
            const label = state === "repealed" ? t("stateRepealedShort") : state === "future" ? t("stateFutureShort") : null;
            const excerpt = entry.title === null && entry.lead ? entry.lead : null;
            const text = entry.title ?? excerpt ?? label;
            return (
              <a
                href={articleHref(entry.number)}
                class={current ? "cur" : state === "repealed" ? "rep" : state === "future" ? "fut" : undefined}
                aria-current={current ? "page" : undefined}
                title={entryTip(entry, state, act)}
                data-n={entry.number}
                data-title={entry.title ?? undefined}
                data-lead={entry.lead ?? undefined}
              >
                <span class="n">
                  <Indexed text={entry.number} />
                </span>
                {text && <span class={excerpt === null ? "t" : "t lead"}>{text}</span>}
              </a>
            );
          })}
          {after && (
            <a class="more" href={after.href}>
              {t("tocAfter", { n: after.n })}
            </a>
          )}
          {note && <p class="toc-note">{note}</p>}
          </div>
        </nav>
      </div>
      <nav class="toc-bar" aria-label={t("tocBarLabel")}>
        {props.prev ? (
          <a class="side" href={articleHref(props.prev)}>
            <ChevronLeftIcon />
            <span>
              <Indexed text={t("articleAbbr", { number: props.prev })} />
            </span>
          </a>
        ) : (
          <span />
        )}
        <a class="open-toc" href="#cuprins">
          <span>{t("tocTitle")}</span>
          {position >= 0 && <small>{t("tocPosition", { n: position + 1, total: all.length })}</small>}
        </a>
        {props.next ? (
          <a class="side r" href={articleHref(props.next)}>
            <span>
              <Indexed text={t("articleAbbr", { number: props.next })} />
            </span>
            <ChevronRightIcon />
          </a>
        ) : (
          <span />
        )}
      </nav>
    </>
  );
}

function freshnessOf(act: ActObject): { tone: "ok" | "warn"; text: string } {
  const fresh = act.freshness;
  const name = actName(act);
  const of = genitive(name);
  const label = (key: string | null) =>
    key === null ? null : (act.laws.find((law) => law.key === key)?.label ?? key);
  const verified = fresh?.last_verified ? formatRo(fresh.last_verified) : null;
  const unverified = t("freshUnverified", { act: name });

  let tone: "ok" | "warn" = "warn";
  let text = t("freshUnknown", { act: of });
  switch (fresh?.status) {
    case "current":
      if (verified) {
        tone = "ok";
        text = t("freshCurrent", { act: name, date: verified });
      } else {
        text = unverified;
      }
      break;
    case "pending-change": {
      const change = label(fresh.newest_change);
      if (change === null) break;
      text =
        fresh.change_in_repo && fresh.newest_change_date
          ? t("freshPendingScheduled", { change, date: formatRo(fresh.newest_change_date) })
          : t("freshPending", { act: name, change });
      break;
    }
    case "stale":
      text = verified ? t("freshStale", { act: of, date: verified }) : unverified;
      break;
    case "unverified":
      text = unverified;
      break;
    case "source-unavailable":
      text = verified
        ? t("freshUnavailable", { act: of, date: verified })
        : t("freshUnavailableNever", { act: name });
      break;
  }
  return { tone, text };
}

const PORTAL_HOST = "legislatie.just.ro";

function withPortalLink(text: string, act: ActObject): Child[] {
  return text.split(PORTAL_HOST).flatMap((part, i) => (i === 0 ? [part] : [<a href={act.portal}>{PORTAL_HOST}</a>, part]));
}

export function Freshness({ act }: { act: ActObject }) {
  const { tone, text } = freshnessOf(act);
  const body = withPortalLink(text, act);
  return tone === "ok" ? <p>{body}</p> : <WarningText>{body}</WarningText>;
}

export function FreshnessWarning({ act }: { act: ActObject }) {
  const { tone, text } = freshnessOf(act);
  return tone === "ok" ? null : <WarningText class="fresh-note">{withPortalLink(text, act)}</WarningText>;
}

function RulingLink({ rulingKey, label }: { rulingKey: string; label: string }) {
  const href = rulingUrlFromKey(rulingKey);
  return href === null ? <>{label}</> : <a href={href}>{label}</a>;
}

export function CitationPanel(props: { sentence: string; permanent: string; current?: string }) {
  const { sentence, permanent } = props;
  return (
    <Panel title={t("citeTitle")}>
      <div class="cite">
        {sentence}
        <span class="addr">
          <span class="vh">{t("citeAddress")}: </span>
          {permanent.replace("https://", "")}
        </span>
      </div>
      <p class="cite-links">
        <button
          class="btn"
          type="button"
          data-copy={`${sentence}
${permanent}`}
          data-copied={t("citeCopied")}
          data-failed={t("citeCopyFailed")}
        >
          {t("citeCopy")}
        </button>
        <span class="copied" role="status" />
        <button
          class="btn secondary"
          type="button"
          data-copy={permanent}
          data-copied={t("citeCopied")}
          data-failed={t("citeCopyFailed")}
        >
          {t("citeCopyLink")}
        </button>
        <span class="copied" role="status" />
        {props.current !== undefined && (
          <a class="btn secondary" href={props.current}>
            {t("citeCurrent")}
          </a>
        )}
      </p>
    </Panel>
  );
}

export function citationOf(props: RailProps): { sentence: string; permanent: string } {
  const { act, article, actRef, date, now, version } = props;
  return {
    permanent: `${ORIGIN}${articleUrl(actRef, article.number, version.from)}`,
    sentence: t("citeSentence", {
      ref: t("articleAbbr", { number: article.number }),
      act: actName(act),
      date: formatRo(date ?? now),
    }),
  };
}

export function Rail(props: RailProps) {
  const { act, article, actRef, date, now, version, keep } = props;
  const { sentence, permanent } = citationOf(props);
  const inForce = article.versions.filter((v) => v.from <= now).at(-1);
  const upcoming = article.versions.find((v) => v.from > now && v !== version);
  const wholeAct = date
    ? t("toolWholeActOn", { act: actName(act), date: formatRo(date) })
    : t("toolWholeAct", { act: actName(act) });

  return (
    <aside class="rail">
      <CitationPanel
        sentence={sentence}
        permanent={permanent}
        current={date !== null || version !== inForce ? articleUrl(actRef, article.number) : undefined}
      />
      {article.rulings.length > 0 && (
        <Panel title={t("rulingsTitle")}>
          <ul class="plain">
            {article.rulings.map((ruling) => (
              <li>
                <RulingLink rulingKey={ruling.key} label={ruling.label} />
                <small>
                  {formatRo(ruling.date)} · {outcomeText(ruling.outcome)}
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={t("freshTitle")}>
        <Freshness act={act} />
        {upcoming && (
          <p>
            <a href={articleUrl(actRef, article.number, upcoming.from) + keep}>
              {t("freshNextVersion", { date: formatRo(upcoming.from) })}
            </a>
          </p>
        )}
      </Panel>
      <Panel title={t("toolsTitle")}>
        <ul class="plain">
          <li>
            <a href={actUrl(actRef, date ?? undefined)}>{wholeAct}</a>
          </li>
          <li>
            <a href={subscribeUrl(actRef, article.number)}>
              <Indexed text={t("toolFeed", { number: article.number })} />
            </a>
          </li>
        </ul>
      </Panel>
      <Support />
    </aside>
  );
}
