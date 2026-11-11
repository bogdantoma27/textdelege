import type { Child } from "hono/jsx";
import { t } from "../text";
import { formatRo, isIsoDate } from "../lib/dates";
import type { RulingObject } from "../lib/types";
import { rulingUrlFromKey } from "../lib/urls";
import { CitationPanel } from "./article-rails";
import { Breadcrumbs, Panel, SummaryList, Support } from "./components";
import { Indexed } from "./indexed";
import { Layout, ORIGIN } from "./layout";
import { outcomeText } from "./shared";

export interface AffectedArticle {
  href: string;
  article: string;
  act: string;
  actHref: string;
}

const scalar = (value: unknown): string | number | null =>
  typeof value === "string" || typeof value === "number" ? value : null;

function moText(mo: Record<string, unknown>): string | null {
  const number = scalar(mo["number"]);
  const date = scalar(mo["date"]);
  if (number === null || typeof date !== "string") return null;
  return t("rulingMoValue", {
    part: scalar(mo["part"]) ?? "I",
    number,
    bis: mo["bis"] === true ? " bis" : "",
    date: isIsoDate(date) ? formatRo(date) : date,
  });
}

const paragraphs = (text: string) => text.split(/\r?\n/).filter((line) => line.trim() !== "");

const HEADING_MARK = /^#{1,6}\s+/;

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function textLines(ruling: RulingObject): { text: string; heading: boolean }[] {
  const known = new Set([squash(ruling.heading), squash(ruling.label)]);
  const lines: { text: string; heading: boolean }[] = [];
  for (const line of paragraphs(ruling.text ?? "")) {
    if (!HEADING_MARK.test(line)) {
      lines.push({ text: line, heading: false });
      continue;
    }
    const text = line.replace(HEADING_MARK, "").trim();
    if (text !== "" && !known.has(squash(text))) lines.push({ text, heading: true });
  }
  return lines;
}

export function renderRuling(ruling: RulingObject, affected: AffectedArticle[]) {
  const path = rulingUrlFromKey(ruling.key) ?? "/";
  const permanent = `${ORIGIN}${path}`;
  const mo = moText(ruling.mo);
  const lines = textLines(ruling);
  const home = { href: "/", label: t("breadcrumbHome") };
  const acts = new Set(affected.map((item) => item.actHref));
  const crumbs = acts.size === 1 ? [home, { href: affected[0]!.actHref, label: affected[0]!.act }] : [home];

  const rows: { label: string; value: Child }[] = [{ label: t("rulingDate"), value: formatRo(ruling.date) }];
  if (mo !== null) rows.push({ label: t("metaMo"), value: mo });
  if (ruling.binding_from !== null) {
    rows.push({ label: t("rulingBindingFrom"), value: formatRo(ruling.binding_from) });
  }
  rows.push({ label: t("rulingOutcome"), value: outcomeText(ruling.outcome) });
  if (ruling.court === "ccr" && ruling.finds_unconstitutional) {
    rows.push({ label: t("rulingFinding"), value: t("rulingFindingValue") });
  }
  if (ruling.dossiers.length > 0) {
    rows.push({ label: t("rulingDossiers"), value: ruling.dossiers.join(", ") });
  }

  return (
    <Layout
      title={ruling.label}
      canonical={permanent}
      noindex
      script="/article.js"
      rail={
        <aside class="rail">
          <CitationPanel sentence={ruling.label} permanent={permanent} />
          {ruling.source !== null && (
            <Panel title={t("sourceTitle")}>
              <a href={ruling.source}>{t("rulingSourceLink")}</a>
            </Panel>
          )}
          <Support />
        </aside>
      }
    >
      <section class="solo doc">
        <Breadcrumbs items={crumbs} />
        <p class="caption" lang="ro">
          {ruling.court_name}
        </p>
        <h1 lang="ro">{ruling.label}</h1>
        <p class="sub" lang="ro">
          {ruling.heading}
        </p>
        {ruling.subtitle !== null && (
          <p class="sub" lang="ro">
            {ruling.subtitle}
          </p>
        )}
        <SummaryList rows={rows} />
        {ruling.operative.length > 0 && (
          <section aria-labelledby="dispozitiv">
            <h2 id="dispozitiv">{t("rulingOperative")}</h2>
            <div class="law" lang="ro">
              {ruling.operative.map((item) => (
                <p>{item}</p>
              ))}
            </div>
          </section>
        )}
        {affected.length > 0 && (
          <section aria-labelledby="vizate">
            <h2 id="vizate">{t("rulingAffected")}</h2>
            <ul class="plain columns">
              {affected.map((item) => (
                <li>
                  <a href={item.href}>
                    <Indexed text={t("rulingAffectedItem", { article: item.article, act: item.act })} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {lines.length > 0 && (
          <details class="details ruling-text">
            <summary>{t("rulingText")}</summary>
            <div class="law" lang="ro">
              {lines.map((line) => (line.heading ? <h3>{line.text}</h3> : <p>{line.text}</p>))}
            </div>
          </details>
        )}
      </section>
    </Layout>
  );
}
