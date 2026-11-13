import type { Child } from "hono/jsx";
import { t } from "../text";
import { formatRo, today as currentDate } from "../lib/dates";
import { SITE_REPOSITORY, SOURCE_REPOSITORY, SUPPORT_URL } from "../lib/urls";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, CupIcon, ExternalIcon } from "./icons";
import { Indexed } from "./indexed";

export type BadgeColour = "green" | "grey" | "yellow" | "red";

export function Badge({ colour, children }: { colour: BadgeColour; children: Child }) {
  return <strong class={`badge badge-${colour}`}>{children}</strong>;
}

export function DatedNote({ date, exit, exitLabel }: { date: string; exit: string; exitLabel?: string }) {
  return (
    <aside class="dated" aria-label={t("bannerTitle")}>
      <p>
        {t("bannerText", { date: formatRo(date) })} <a href={exit}>{exitLabel ?? t("bannerExit")}</a>
      </p>
    </aside>
  );
}

export function DateField(props: {
  id: string;
  name: string;
  value: string | null;
  typed?: string;
  invalid?: boolean;
  required?: boolean;
}) {
  const pick = t("datePick");
  return (
    <div class="date-input">
      <input
        class="field date"
        id={props.id}
        type="text"
        name={props.name}
        value={props.typed ?? (props.value === null ? undefined : formatRo(props.value))}
        aria-invalid={props.invalid ? "true" : undefined}
        aria-describedby={props.invalid ? `${props.id}-hint ${props.id}-error` : `${props.id}-hint`}
        placeholder={t("dateFormat")}
        autocomplete="off"
        maxlength={10}
        required={props.required}
      />
      <input class="date-picker" type="date" tabindex={-1} aria-hidden="true" />
      <button class="date-open" type="button" hidden aria-label={pick} title={pick} data-calendar={props.id}>
        <CalendarIcon />
      </button>
    </div>
  );
}

export function DateHint({ id }: { id: string }) {
  return (
    <p class="hint" id={`${id}-hint`}>
      {t("dateHint")}
    </p>
  );
}

export function FieldError({ id, children }: { id: string; children: Child }) {
  return (
    <p class="error-message" id={`${id}-error`}>
      <span class="vh">{t("errorPrefix")}: </span>
      {children}
    </p>
  );
}

export function ErrorSummary({ items }: { items: { href: string; text: string }[] }) {
  return (
    <div class="error-summary" role="alert">
      <h2>{t("errorSummaryTitle")}</h2>
      <ul>
        {items.map((item) => (
          <li>
            <a href={item.href}>{item.text}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Option {
  param: string;
  label: string;
  checked: boolean;
  on: string;
  off?: string;
  flips?: string;
  disabled?: boolean;
  class?: string;
}

export function Options(props: {
  legend: string;
  hideLegend?: boolean;
  action: string;
  params?: Record<string, string>;
  options: Option[];
}) {
  return (
    <form class="options inline" method="get" action={props.action}>
      {Object.entries(props.params ?? {}).map(([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ))}
      <fieldset>
        <legend class={props.hideLegend ? "vh" : undefined}>{props.legend}</legend>
        <div class="checkboxes">
          {props.options.map((option) => (
            <>
              <div class={option.class ? `checkbox ${option.class}` : "checkbox"}>
                <input
                  id={`optiune-${option.param}`}
                  type="checkbox"
                  name={option.param}
                  value={option.on}
                  checked={option.checked}
                  disabled={option.disabled}
                  data-param={option.param}
                  data-on={option.on}
                  data-off={option.off ?? ""}
                  data-flips={option.flips}
                />
                <label for={`optiune-${option.param}`}>
                  {option.label}
                  {option.disabled && <span class="vh"> ({t("optionNotApplicable")})</span>}
                </label>
              </div>
              {option.off !== undefined && !option.disabled && <input type="hidden" name={option.param} value={option.off} />}
            </>
          ))}
        </div>
      </fieldset>
      <button class="btn secondary apply" type="submit">
        {t("optionsApply")}
      </button>
    </form>
  );
}

export function Panel({ title, children, class: extra }: { title: string; children?: Child; class?: string }) {
  return (
    <section class={extra === undefined ? "panel" : `panel ${extra}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Support() {
  return (
    <Panel title={t("supportTitle")}>
      <p>
        <a class="btn kofi" href={SUPPORT_URL}>
          <CupIcon />
          {t("supportKofi")}
        </a>
      </p>
      <ul class="plain">
        <li>
          <a href={SOURCE_REPOSITORY}>
            {t("footerSourceData")}
            <ExternalIcon />
          </a>
        </li>
        <li>
          <a href={SITE_REPOSITORY}>
            {t("supportCode")}
            <ExternalIcon />
          </a>
        </li>
      </ul>
    </Panel>
  );
}

export function SummaryList({ rows }: { rows: { label: string; value: Child }[] }) {
  return (
    <dl class="summary">
      {rows.map((row) => (
        <div class="summary-row">
          <dt class="summary-key">{row.label}</dt>
          <dd class="summary-value">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Inset({ children }: { children: Child }) {
  return <div class="inset">{children}</div>;
}

export function WarningText({ children, class: extra }: { children: Child; class?: string }) {
  return (
    <div class={extra === undefined ? "warning" : `warning ${extra}`}>
      <strong class="warning-text">
        <span class="vh">{t("warningLabel")}: </span>
        {children}
      </strong>
    </div>
  );
}

export function Breadcrumbs({
  items,
  current,
  aside,
}: {
  items: { href: string; label: Child }[];
  current?: Child;
  aside?: Child;
}) {
  const nav = (
    <nav class="crumbs" aria-label={t("breadcrumbLabel")}>
      <ol>
        {items.map((item) => (
          <li>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
        {current !== undefined && <li aria-current="page">{current}</li>}
      </ol>
    </nav>
  );
  if (aside === undefined || aside === null || aside === false) return nav;
  return (
    <div class="crumb-row">
      {nav}
      {aside}
    </div>
  );
}

export type Tab = {
  href: string;
  label: string;
  current: boolean;
  panel?: string;
};

export function Tabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  return (
    <nav class="tabs" aria-label={label}>
      <ul class="tabs-list">
        {tabs.map((tab) => (
          <li class={tab.current ? "tabs-item selected" : "tabs-item"}>
            <a href={tab.href} aria-current={tab.current ? "page" : undefined} data-panel={tab.panel} data-text={tab.label}>
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type Neighbour = { href: string; title: string };

export function OffLink({ children, class: extra }: { children: Child; class?: string }) {
  return (
    <span class={extra ? `off ${extra}` : "off"} aria-disabled="true">
      {children}
    </span>
  );
}

export function Pagination(props: {
  prev?: Neighbour;
  next?: Neighbour;
  captions?: { prev: string; next: string };
  label?: string;
}) {
  if (!props.prev && !props.next) return null;
  const prevCaption = props.captions?.prev ?? t("previous");
  const nextCaption = props.captions?.next ?? t("next");
  return (
    <nav class="pagination" aria-label={props.label ?? t("prevNextLabel")}>
      <div class="pagination-prev">
        {props.prev ? (
          <a href={props.prev.href} rel="prev">
            <span class="pagination-title">
              <ChevronLeftIcon size={20} />
              {prevCaption}
            </span>
            <span class="vh">: </span>
            <span class="pagination-label">
              <Indexed text={props.prev.title} />
            </span>
          </a>
        ) : (
          <OffLink>
            <span class="pagination-title">
              <ChevronLeftIcon size={20} />
              {prevCaption}
            </span>
          </OffLink>
        )}
      </div>
      <div class="pagination-next">
        {props.next ? (
          <a href={props.next.href} rel="next">
            <span class="pagination-title">
              {nextCaption}
              <ChevronRightIcon size={20} />
            </span>
            <span class="vh">: </span>
            <span class="pagination-label">
              <Indexed text={props.next.title} />
            </span>
          </a>
        ) : (
          <OffLink>
            <span class="pagination-title">
              {nextCaption}
              <ChevronRightIcon size={20} />
            </span>
          </OffLink>
        )}
      </div>
    </nav>
  );
}

const PAGE_REACH = 1;

function visiblePages(current: number, pages: number): (number | null)[] {
  const wanted = new Set([1, pages]);
  for (let n = current - PAGE_REACH; n <= current + PAGE_REACH; n++) {
    if (n >= 1 && n <= pages) wanted.add(n);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  return sorted.flatMap((n, i) => (i > 0 && n - sorted[i - 1]! > 1 ? [null, n] : [n]));
}

export function PageNumbers(props: { current: number; pages: number; href: (page: number) => string }) {
  if (props.pages <= 1) return null;
  const { current, pages } = props;
  return (
    <nav class="page-numbers" aria-label={t("pagesLabel")}>
      <ul>
        <li class="page-step">
          {current > 1 ? (
            <a href={props.href(current - 1)} rel="prev">
              <ChevronLeftIcon size={20} />
              {t("pagePrev")}
            </a>
          ) : (
            <OffLink>
              <ChevronLeftIcon size={20} />
              {t("pagePrev")}
            </OffLink>
          )}
        </li>
        {visiblePages(current, pages).map((n) =>
          n === null ? (
            <li class="page-gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li>
              {n === current ? (
                <span class="page-current" aria-label={t("pageNumber", { n })} aria-current="page">
                  {n}
                </span>
              ) : (
                <a href={props.href(n)} aria-label={t("pageNumber", { n })}>
                  {n}
                </a>
              )}
            </li>
          ),
        )}
        <li class="page-step">
          {current < pages ? (
            <a href={props.href(current + 1)} rel="next">
              {t("pageNext")}
              <ChevronRightIcon size={20} />
            </a>
          ) : (
            <OffLink>
              {t("pageNext")}
              <ChevronRightIcon size={20} />
            </OffLink>
          )}
        </li>
      </ul>
    </nav>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: Child[][] }) {
  return (
    <div class="table-wrap">
      <table class="data stack">
        <thead>
          <tr>
            {head.map((cell) => (
              <th scope="col">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr>
              {row.map((cell, i) => (
                <td data-label={head[i]}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type TimelinePoint = { date: string; href: string; name: string };

const TRACK_START = 4;
const TRACK_END = 96;
const MERGE_BELOW = 20;
const MS_PER_DAY = 86_400_000;

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY;
const percent = (value: number) => Math.round(value * 100) / 100;

function positions(sorted: TimelinePoint[]): number[] {
  const first = dayNumber(sorted[0]!.date);
  const span = dayNumber(sorted[sorted.length - 1]!.date) - first;
  if (span === 0) return sorted.map(() => 50);
  return sorted.map(
    (p) => TRACK_START + ((dayNumber(p.date) - first) / span) * (TRACK_END - TRACK_START),
  );
}

const EVEN_WIDTH_EM = 7.5;
const PROPORTIONAL_LIMIT = 4;

function crowded(at: number[]): boolean {
  return at.length > PROPORTIONAL_LIMIT || at.some((value, i) => i > 0 && value - at[i - 1]! < MERGE_BELOW);
}

const evenPositions = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * 100);

export function Timeline(props: {
  points: TimelinePoint[];
  current?: string;
  from?: string;
  to?: string;
  today?: string;
  pick?: boolean;
}) {
  if (props.points.length === 0) return null;
  const sorted = [...props.points].sort((a, b) => a.date.localeCompare(b.date));
  const proportional = positions(sorted);
  const even = crowded(proportional);
  const at = even ? evenPositions(sorted.length) : proportional;
  const now = props.today ?? currentDate();
  const [from, to] =
    props.from !== undefined && props.to !== undefined && props.from > props.to
      ? [props.to, props.from]
      : [props.from, props.to];
  const ends = new Set([from, to].filter((d): d is string => d !== undefined));
  const fromAt = at[sorted.findIndex((p) => p.date === from)];
  const toAt = at[sorted.findIndex((p) => p.date === to)];

  const body = (
    <>
      <div class="ln" />
      {fromAt !== undefined && toAt !== undefined && (
        <div
          class="span"
          style={`left:${percent(fromAt)}%;width:${percent(toAt - fromAt)}%`}
        />
      )}
      <ol>
        {sorted.map((point, index) => {
          const isCurrent = point.date === props.current;
          const isFuture = point.date > now;
          const classes = [
            "pt",
            isCurrent && "cur",
            ends.has(point.date) && "rng",
            isFuture && "fut",
          ].filter(Boolean);
          const name = [
            `${formatRo(point.date)}, ${point.name}`,
            isFuture && t("timelineFuture"),
            ends.has(point.date) && t("timelineRangeEnd"),
          ]
            .filter(Boolean)
            .join(", ");
          const row = [
            isCurrent && "cur",
            ends.has(point.date) && "rng",
            !even && at[index]! < 12 && "start",
            !even && (isCurrent || ends.has(point.date)) && at[index]! > 88 && "end",
          ].filter(Boolean);
          return (
            <li class={row.length > 0 ? row.join(" ") : undefined} style={`left:${percent(at[index]!)}%`}>
              {isCurrent ? (
                <span class={classes.join(" ")} aria-current="true">
                  <span class="vh">{t("timelineCurrent")}</span>
                </span>
              ) : (
                <a
                  class={classes.join(" ")}
                  href={point.href}
                  aria-label={name}
                  title={point.name === "" ? undefined : point.name}
                  data-pick={props.pick ? "" : undefined}
                />
              )}
              <span class={isCurrent ? "lbl cur" : "lbl"}>{formatRo(point.date)}</span>
              {isCurrent && (
                <span class="now" aria-hidden="true">
                  {t("timelineCurrent")}
                </span>
              )}
              {point.name !== "" && <span class="act">{point.name}</span>}
            </li>
          );
        })}
      </ol>
    </>
  );

  return (
    <nav class={even ? "track even" : "track"} aria-label={t("timelineLabel")}>
      {even ? (
        <div class="track-in" style={`min-width:${sorted.length * EVEN_WIDTH_EM}em`}>
          {body}
        </div>
      ) : (
        body
      )}
    </nav>
  );
}
