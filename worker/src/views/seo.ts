import { t } from "../text";
import { formatRo } from "../lib/dates";
import { actStateOn } from "../lib/act";
import { articleLabel } from "../lib/article-label";
import { parseActStatus } from "../lib/status";
import { plainText, truncateAtWord } from "../lib/seo";
import type { ActObject, ArticleObject, ArticleVersion } from "../lib/types";
import { actUrl } from "../lib/urls";
import { ORIGIN } from "./layout";
import { kindLabel } from "./shared";

const ACT_DESCRIPTION_MAX = 160;
const ARTICLE_TEXT_MAX = 150;

const actName = (act: ActObject) => act.short ?? act.title;

function identifier(act: ActObject): string {
  return act.number === "" ? String(act.year) : t("actIdentifier", { number: act.number, year: act.year });
}

function designation(act: ActObject): string {
  const kind = kindLabel(act.kind);
  return kind === null ? identifier(act) : `${kind} ${identifier(act)}`;
}

export function actDescription(act: ActObject, date: string | null, now: string): string {
  const name = actName(act);
  const id = identifier(act);
  const abbreviation = act.short === null || act.short.includes(id);
  let subject = "";
  if (abbreviation) {
    const at = act.title.indexOf(id);
    if (at >= 0) subject = act.title.slice(at + id.length).replace(/^[\s,;:.\-–—]+|[\s)]+$/g, "");
  }
  const named = act.short !== null && !act.short.includes(id) ? `${name} (${designation(act)})` : name;

  const state = actStateOn(act, date, now);
  const { repealedOn } = parseActStatus(act.status);
  const status =
    state === "repealed"
      ? repealedOn === null
        ? t("labelRepealed")
        : t("statusRepealed", { date: formatRo(repealedOn) })
      : t("homeInForceFrom", { date: formatRo(act.from) });

  const build = (lead: string) => t("seoActDescription", { lead, status }) + ".";
  const overhead = build("").length;
  const room = ACT_DESCRIPTION_MAX - overhead;
  let lead = named;
  if (subject !== "" && named.length + 1 + 25 <= room) {
    lead = `${named} ${truncateAtWord(subject, room - named.length - 1)}`;
  }
  return build(truncateAtWord(lead, room));
}

export function articleText(version: ArticleVersion): string {
  return plainText(version.lines.map((line) => line.text).join(" "));
}

export function articleDescription(
  act: ActObject,
  article: ArticleObject,
  version: ArticleVersion,
  repealedOn: string | null,
  showsText: boolean,
): string {
  const label = articleLabel(article, act.articles);
  const name = actName(act);
  const text = showsText ? articleText(version) : "";
  if (text !== "") {
    return t("seoArticleDescription", { label, act: name, text: truncateAtWord(text, ARTICLE_TEXT_MAX) });
  }
  if (repealedOn !== null) return t("seoArticleRepealed", { label, act: name, date: formatRo(repealedOn) });
  return t("seoArticleNoText", { label, act: name });
}

export function actJsonLd(act: ActObject, actRef: string): Record<string, unknown> {
  const url = `${ORIGIN}${actUrl(actRef)}`;
  const kind = kindLabel(act.kind);
  const { kind: status } = parseActStatus(act.status);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Legislation",
    "@id": url,
    name: act.title,
    legislationIdentifier: designation(act),
    legislationJurisdiction: "RO",
    inLanguage: "ro",
    legislationDateVersion: act.latest,
    url,
    sameAs: act.freshness?.official_url ?? act.portal,
  };
  if (act.short !== null && act.short !== act.title) data.alternateName = act.short;
  if (kind !== null) data.legislationType = kind;
  if (status === "in-force") data.legislationLegalForce = "https://schema.org/InForce";
  else if (status === "repealed") data.legislationLegalForce = "https://schema.org/NotInForce";
  return data;
}

export function articleJsonLd(
  act: ActObject,
  actRef: string,
  article: ArticleObject,
  version: ArticleVersion,
  url: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Legislation",
    "@id": url,
    name: `${articleLabel(article, act.articles)} ${actName(act)}`,
    isPartOf: { "@type": "Legislation", "@id": `${ORIGIN}${actUrl(actRef)}` },
    legislationDateVersion: version.from,
    inLanguage: "ro",
    url,
  };
}
