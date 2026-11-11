import { type Key, t } from "../text";
import { formatRo } from "../lib/dates";
import { parseActStatus } from "../lib/status";
import type { ArticleState } from "../lib/types";
import { actUrl } from "../lib/urls";
import { Breadcrumbs, DatedNote, DateField, DateHint, ErrorSummary, FieldError, Inset } from "./components";
import { Layout, ORIGIN } from "./layout";
import { BADGES, type BadgeId, StatusBadge } from "./shared";

export interface PitAct {
  ref: string;
  name: string;
  from: string | null;
  status: string;
  latest: string;
}

export function stateAt(act: PitAct, date: string): ArticleState {
  if (act.from !== null && act.from > date) return "future";
  const { kind, repealedOn } = parseActStatus(act.status);
  if (kind === "repealed" && (repealedOn ?? act.latest) <= date) return "repealed";
  return "in-force";
}

const GROUPS: { state: ArticleState; heading: Key; badge: BadgeId }[] = [
  { state: "in-force", heading: "pitGroupInForce", badge: "pitInForce" },
  { state: "future", heading: "pitGroupFuture", badge: "pitFuture" },
  { state: "repealed", heading: "pitGroupRepealed", badge: "pitRepealed" },
];

function DateForm({ date, invalid }: { date: string; invalid?: string }) {
  return (
    <form class={invalid === undefined ? "date-form" : "date-form error"} method="get" action="/legislatie" novalidate data-filter="">
      <label class="label" for="pit-date">
        {t("pitChooseLabel")}
      </label>
      <DateHint id="pit-date" />
      {invalid !== undefined && <FieldError id="pit-date">{t("dateInvalid")}</FieldError>}
      <div class="date-row">
        <DateField id="pit-date" name="data" value={date} typed={invalid} invalid={invalid !== undefined} required />
        <button class="btn" type="submit">
          {t("pitChooseSubmit")}
        </button>
      </div>
    </form>
  );
}

function renderInvalidDate(date: string, invalid: string) {
  const heading = t("homeDateHeading");
  return (
    <Layout title={`${t("errorPrefix")}: ${heading}`} canonical={`${ORIGIN}/legislatie`} noindex>
      <section class="solo">
        <Breadcrumbs items={[{ href: "/", label: t("breadcrumbHome") }]} current={heading} />
        <ErrorSummary items={[{ href: "#pit-date", text: t("dateInvalid") }]} />
        <h1>{heading}</h1>
        <Inset>{t("pitIntro")}</Inset>
        <DateForm date={date} invalid={invalid} />
      </section>
    </Layout>
  );
}

export function renderPointInTime(date: string, acts: PitAct[], now: string, invalid?: string) {
  if (invalid !== undefined) return renderInvalidDate(now, invalid);
  const heading = t("pitHeading", { date: formatRo(date) });
  const dated = date === now ? undefined : date;
  const day = formatRo(date);
  return (
    <Layout title={heading} canonical={`${ORIGIN}/legislatie/${date}`}>
      <section class="solo">
        <Breadcrumbs
          items={[{ href: "/", label: t("breadcrumbHome") }]}
          current={heading}
          aside={dated !== undefined && <DatedNote date={dated} exit="/" exitLabel={t("pitExit")} />}
        />
        <h1>{heading}</h1>
        <Inset>{t("pitIntro")}</Inset>
        <DateForm date={date} />
        {GROUPS.map((group) => {
          const members = acts.filter((act) => stateAt(act, date) === group.state);
          if (members.length === 0) return null;
          return (
            <section aria-labelledby={`acte-${group.state}`}>
              <h2 id={`acte-${group.state}`}>{t(group.heading, { date: day })}</h2>
              <ul class="doc-list grid">
                {members.map((act) => (
                  <li>
                    <div class="doc-main">
                      <a class="doc-link" href={actUrl(act.ref, dated)}>
                        {act.name}
                      </a>
                      <p class="doc-meta">
                        <StatusBadge id={group.badge}>{t(BADGES[group.badge].label, { date: day })}</StatusBadge>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </section>
    </Layout>
  );
}
