import type { Child } from "hono/jsx";
import { type Key, t } from "../text";
import { formatRo } from "../lib/dates";
import { sinceDay, unavailableSources } from "../lib/outages";
import type { ArticleLine, EventVerb } from "../lib/types";
import { SITE_REPOSITORY, SOURCE_REPOSITORY } from "../lib/urls";
import { Paragraph } from "./article";
import { Breadcrumbs } from "./components";
import { Layout, ORIGIN } from "./layout";
import { BADGES, StatusBadge, VERBS } from "./shared";

function Section(props: { id: string; title: string; children?: Child }) {
  return (
    <section id={props.id} aria-labelledby={`${props.id}-titlu`}>
      <h2 id={`${props.id}-titlu`}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function HelpPage(props: { path: string; title: string; lead: string; children?: Child }) {
  return (
    <Layout title={props.title} description={props.lead} canonical={`${ORIGIN}${props.path}`}>
      <section class="solo doc">
        <Breadcrumbs items={[{ href: "/", label: t("breadcrumbHome") }]} current={props.title} />
        <h1>{props.title}</h1>
        <p>{props.lead}</p>
        {props.children}
      </section>
    </Layout>
  );
}

const STATUSES: { name: Key; text: Key }[] = [
  { name: "aboutStatusCurrent", text: "aboutStatusCurrentText" },
  { name: "aboutStatusPending", text: "aboutStatusPendingText" },
  { name: "aboutStatusStale", text: "aboutStatusStaleText" },
  { name: "aboutStatusUnverified", text: "aboutStatusUnverifiedText" },
  { name: "aboutStatusUnavailable", text: "aboutStatusUnavailableText" },
];

export function renderAbout() {
  const text = (key: Key) => <p>{t(key)}</p>;
  const linked = (key: Key, label: Key, href: string) => {
    const [before, after] = t(key).split("{link}");
    return (
      <p>
        {before}
        <a href={href}>{t(label)}</a>
        {after}
      </p>
    );
  };
  const down = unavailableSources();
  const [dataBefore, dataAfter] = t("aboutDataText").split("{repo}");
  return (
    <HelpPage path="/despre" title={t("aboutTitle")} lead={t("aboutLead")}>
      <Section id="sursa" title={t("aboutDataHeading")}>
        <p>
          {dataBefore}
          <a href={SOURCE_REPOSITORY}>lexifina/romania-law</a>
          {dataAfter}
        </p>
      </Section>
      <Section id="versiuni" title={t("aboutVersionsHeading")}>
        {text("aboutVersionsText")}
      </Section>
      <Section id="actualitate" title={t("aboutFreshHeading")}>
        {text("aboutFreshText")}
        {down.length > 0 && (
          <>
            {text("aboutSourcesDown")}
            <ul>
              {down.map((source) => (
                <li>
                  {(() => {
                    const since = sinceDay(source);
                    return since === null
                      ? source.name
                      : t("aboutSourceSince", { name: source.name, date: formatRo(since) });
                  })()}
                </li>
              ))}
            </ul>
          </>
        )}
        <dl class="terms">
          {STATUSES.map((status) => (
            <>
              <dt>{t(status.name)}</dt>
              <dd>{t(status.text)}</dd>
            </>
          ))}
        </dl>
      </Section>
      <Section id="limitari" title={t("aboutLimitsHeading")}>
        {text("aboutLimitsUnofficial")}
        {text("aboutLimitsAmended")}
        {text("aboutLimitsHeadings")}
      </Section>
      <Section id="licenta" title={t("aboutLicenceHeading")}>
        {text("aboutLicenceLaw")}
        {text("aboutLicenceData")}
        {text("aboutLicenceCode")}
      </Section>
      <Section id="date-personale" title={t("aboutPersonalHeading")}>
        {text("aboutPersonalActs")}
        {text("aboutPersonalIndex")}
        {text("aboutPersonalContact")}
      </Section>
      <Section id="contact" title={t("aboutContactHeading")}>
        {linked("aboutContactData", "aboutContactDataLink", `${SOURCE_REPOSITORY}/issues`)}
        {linked("aboutContactSite", "aboutContactSiteLink", `${SITE_REPOSITORY}/issues`)}
      </Section>
    </HelpPage>
  );
}

const VERB_TEXT: Record<EventVerb, Key> = {
  entered: "legendVerbEntered",
  modified: "legendVerbModified",
  completed: "legendVerbCompleted",
  repealed: "legendVerbRepealed",
  unconstitutional: "legendVerbUnconstitutional",
  restated: "legendVerbRestated",
};

const BARS = 8;

const sample = (id: string, text: string): ArticleLine => ({ id, text, since: "", law: "" });
const plain = (body: string) => [body];

function Sample(props: { line: ArticleLine; bar?: number; last?: boolean }) {
  return (
    <Paragraph
      line={props.line}
      bar={props.bar}
      last={props.last ?? false}
      label={undefined}
      linked={plain}
      attribution={false}
      idPrefix="legenda-"
    />
  );
}

export function renderLegend() {
  return (
    <HelpPage path="/legenda" title={t("legendTitle")} lead={t("legendIntro")}>
      <Section id="verbe" title={t("legendVerbsHeading")}>
        <dl class="terms">
          {(Object.keys(VERBS) as EventVerb[]).map((verb) => (
            <>
              <dt>{t(VERBS[verb])}</dt>
              <dd>{t(VERB_TEXT[verb])}</dd>
            </>
          ))}
        </dl>
      </Section>
      <Section id="stari" title={t("legendStatesHeading")}>
        <dl class="terms">
          {(Object.keys(BADGES) as (keyof typeof BADGES)[]).map((id) => (
            <>
              <dt>
                <StatusBadge id={id}>
                  {t(BADGES[id].label, { date: t("dateFormat") })}
                </StatusBadge>
              </dt>
              <dd>{t(BADGES[id].legend)}</dd>
            </>
          ))}
        </dl>
      </Section>
      <Section id="comparatii" title={t("legendDiffHeading")}>
        <p>
          <ins>{t("cmpLegendIns")}</ins> {t("legendDiffIns")}
        </p>
        <p>
          <del>{t("cmpLegendDel")}</del> {t("legendDiffDel")}
        </p>
        <p class="cb">
          <ins>{t("cmpLegendIns")}</ins> <del>{t("cmpLegendDel")}</del>{" "}
          {t("legendDiffColourBlind")}
        </p>
      </Section>
      <Section id="bare" title={t("legendBarsHeading")}>
        <p>{t("legendBarsText")}</p>
        <div class="law attr hl">
          {Array.from({ length: BARS }, (_, index) => (
            <Sample bar={index} line={sample(`bara-${index + 1}`, t("legendBarLine", { n: index + 1 }))} />
          ))}
          <Sample line={sample("bara-necunoscuta", t("legendBarUnknown"))} />
          <Sample bar={0} last line={sample("bara-ultima", t("legendBarLast"))} />
        </div>
      </Section>
    </HelpPage>
  );
}
