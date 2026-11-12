import { isIsoDate } from "./dates";

export type Route =
  | { kind: "home" }
  | { kind: "search" }
  | { kind: "act"; actRef: string; date: string | null; tab: string | null }
  | { kind: "contents"; actRef: string; date: string | null }
  | { kind: "article"; actRef: string; slug: string; date: string | null }
  | { kind: "compareArticle"; actRef: string; slug: string; from: string; to: string }
  | { kind: "compareAct"; actRef: string; from: string; to: string }
  | { kind: "ruling"; key: string }
  | {
      kind: "changes";
      actRef: string | null;
      slug: string | null;
      format: "html" | "atom" | "subscribe";
    }
  | { kind: "pointInTime"; date: string }
  | { kind: "help"; page: "despre" | "legenda" };

const NUMBERED_KINDS = new Set(["lege", "oug", "og", "hg", "decret", "decret-lege"]);
const PARLIAMENT = "hotarare-parlament";
const CHAMBERS = new Set(["camera", "senat"]);
const PANELS = new Set(["ril", "hp", "hp-penal", "su", "scaf", "alte"]);
const TABS = new Set(["istoric", "jurisprudenta", "statistici", "date"]);
const HELP = new Set(["despre", "legenda"]);
const RESERVED = new Set([
  "modificari",
  "jurisprudenta",
  "legislatie",
  "acte",
  "la-data",
  "despre",
  "legenda",
  "cauta",
  "abonare",
  "healthz",
]);

const DIGITS = /^\d+$/;
const ALIAS = /^[a-z][a-z0-9-]*$/;
const SLUG = /^art-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLAIN_NUMBER = /^[1-9]\d*(?:\^[1-9]\d*)*$/;

export interface ArticleRef {
  number: string;
  file: string;
}

export const isPlainNumber = (number: string) => PLAIN_NUMBER.test(number);

export function articleSlug(number: string): string {
  return `art-${number.replaceAll("^", "-")}`;
}

export function articleSlugFor(article: ArticleRef): string {
  return isPlainNumber(article.number) ? articleSlug(article.number) : article.file;
}

export function isArticleSlug(slug: string): boolean {
  return SLUG.test(slug);
}

export function findArticle<T extends ArticleRef>(articles: readonly T[], slug: string): T | undefined {
  return articles.find((article) => articleSlugFor(article) === slug);
}

export interface ActPathParts {
  kind: string;
  chamber: string | null;
  year: string;
  number: string;
}

export function actPathParts(path: string): ActPathParts {
  const [kind = "", ...rest] = path.split("/");
  const chamber = kind === PARLIAMENT && rest.length === 3 ? (rest.shift() ?? null) : null;
  const [year = "", number = ""] = rest;
  return { kind, chamber, year, number };
}

export function actUrl(actRef: string, date?: string): string {
  return date ? `/${actRef}/${date}` : `/${actRef}`;
}

export function articleUrl(actRef: string, article: ArticleRef, date?: string): string {
  const base = `/${actRef}/${articleSlugFor(article)}`;
  return date ? `${base}/${date}` : base;
}

export function compareUrl(actRef: string, article: ArticleRef | null, from: string, to: string): string {
  const middle = article === null ? "" : `/${articleSlugFor(article)}`;
  return `/${actRef}${middle}/compara/${from}..${to}`;
}

const RULING_CCR = /^dcc-(\d+)-(\d{4})$/;
const RULING_ICCJ = /^iccj-(ril|hp-penal|hp|su|scaf|alte)-(\d+)-(\d{4})$/;
const LAW_KEY = /^(legea|oug|og|hg|decret)-(\d+)-(\d{4})$/;

export function rulingUrlFromKey(key: string): string | null {
  const ccr = RULING_CCR.exec(key);
  if (ccr) return `/jurisprudenta/ccr/${ccr[2]}/${ccr[1]}`;
  const iccj = RULING_ICCJ.exec(key);
  if (iccj) return `/jurisprudenta/iccj/${iccj[1]}/${iccj[3]}/${iccj[2]}`;
  return null;
}

export function rulingKeyFromRoute(route: { key: string }): string | null {
  const [court, ...rest] = route.key.split("/");
  if (court === "ccr" && rest.length === 2) return `dcc-${rest[1]}-${rest[0]}`;
  if (court === "iccj" && rest.length === 3) return `iccj-${rest[0]}-${rest[2]}-${rest[1]}`;
  return null;
}

export function lawUrlFromKey(key: string): string | null {
  const law = LAW_KEY.exec(key);
  if (law) return `/${law[1] === "legea" ? "lege" : law[1]}/${law[3]}/${law[2]}`;
  return rulingUrlFromKey(key);
}

const LAW_PATH = /^(lege|oug|og|hg|decret)\/(\d+)\/(\d+)$/;

export function lawKeyFromActRef(actRef: string): string | null {
  const match = LAW_PATH.exec(actRef);
  if (!match) return null;
  return `${match[1] === "lege" ? "legea" : match[1]}-${match[3]}-${match[2]}`;
}

export function changesUrl(actRef?: string, article?: ArticleRef): string {
  if (!actRef) return "/modificari";
  return article === undefined
    ? `/modificari/${actRef}`
    : `/modificari/${actRef}/${articleSlugFor(article)}`;
}

export function subscribeUrl(actRef?: string, article?: ArticleRef): string {
  return changesUrl(actRef, article).replace(/^\/modificari/, "/abonare");
}

function readActRef(segments: string[]): { actRef: string; used: number } | null {
  const first = segments[0];
  if (first === undefined || RESERVED.has(first)) return null;
  if (first === PARLIAMENT) {
    const [, chamber, year, number] = segments;
    if (chamber === undefined || year === undefined || number === undefined) return null;
    if (!CHAMBERS.has(chamber) || !DIGITS.test(year) || !DIGITS.test(number)) return null;
    return { actRef: `${first}/${chamber}/${year}/${number}`, used: 4 };
  }
  if (NUMBERED_KINDS.has(first)) {
    const [, year, number] = segments;
    if (year === undefined || number === undefined) return null;
    if (!DIGITS.test(year) || !DIGITS.test(number)) return null;
    return { actRef: `${first}/${year}/${number}`, used: 3 };
  }
  if (first === "constitutie") {
    const year = segments[1];
    if (year === undefined || !DIGITS.test(year)) return null;
    return { actRef: `constitutie/${year}`, used: 2 };
  }
  if (first === "cod") {
    const [, year, name] = segments;
    if (year === undefined || name === undefined) return null;
    if (!DIGITS.test(year) || !ALIAS.test(name)) return null;
    return { actRef: `cod/${year}/${name}`, used: 3 };
  }
  if (!ALIAS.test(first)) return null;
  return { actRef: first, used: 1 };
}

function parseRange(range: string): { from: string; to: string } | null {
  const parts = range.split("..");
  if (parts.length !== 2) return null;
  const [from = "", to = ""] = parts;
  if (!isIsoDate(from) || !isIsoDate(to) || from === to) return null;
  return { from, to };
}

function parseActRoute(segments: string[]): Route | null {
  const ref = readActRef(segments);
  if (!ref) return null;
  const { actRef } = ref;
  const rest = segments.slice(ref.used);
  const [head, second, third] = rest;

  if (head === undefined) return { kind: "act", actRef, date: null, tab: null };

  if (head === "compara") {
    if (second === undefined || rest.length !== 2) return null;
    const range = parseRange(second);
    return range ? { kind: "compareAct", actRef, ...range } : null;
  }

  if (rest.length === 1 && head === "cuprins") return { kind: "contents", actRef, date: null };
  if (rest.length === 2 && second === "cuprins") {
    return isIsoDate(head) ? { kind: "contents", actRef, date: head } : null;
  }

  if (rest.length === 1) {
    if (TABS.has(head)) return { kind: "act", actRef, date: null, tab: head };
    if (DIGITS.test(head.slice(0, 4)) && head.includes("-")) {
      return isIsoDate(head) ? { kind: "act", actRef, date: head, tab: null } : null;
    }
  }

  if (!isArticleSlug(head)) return null;
  const slug = head;

  if (rest.length === 1) return { kind: "article", actRef, slug, date: null };
  if (rest.length === 2 && second !== undefined) {
    return isIsoDate(second) ? { kind: "article", actRef, slug, date: second } : null;
  }
  if (rest.length === 3 && second === "compara" && third !== undefined) {
    const range = parseRange(third);
    return range ? { kind: "compareArticle", actRef, slug, ...range } : null;
  }
  return null;
}

function parseChanges(segments: string[]): Route | null {
  let format: "html" | "atom" | "subscribe" = "html";
  const last = segments.length - 1;
  const match = /^(.+)\.atom$/.exec(segments[last] ?? "");
  if (match) {
    format = "atom";
    segments = [...segments.slice(0, last), match[1] ?? ""];
  }
  if (segments[0] !== "modificari") return null;
  const rest = segments.slice(1);
  if (rest.length === 0) return { kind: "changes", actRef: null, slug: null, format };
  const ref = readActRef(rest);
  if (!ref) return null;
  const tail = rest.slice(ref.used);
  if (tail.length === 0) return { kind: "changes", actRef: ref.actRef, slug: null, format };
  if (tail.length > 1) return null;
  const slug = tail[0] ?? "";
  return isArticleSlug(slug) ? { kind: "changes", actRef: ref.actRef, slug, format } : null;
}

function parseRuling(segments: string[]): Route | null {
  const [, court, ...rest] = segments;
  if (court === "ccr") {
    if (rest.length !== 2 || !rest.every((part) => DIGITS.test(part))) return null;
    return { kind: "ruling", key: `ccr/${rest.join("/")}` };
  }
  if (court === "iccj") {
    const [panel = "", year = "", number = ""] = rest;
    if (rest.length !== 3 || !PANELS.has(panel)) return null;
    if (!DIGITS.test(year) || !DIGITS.test(number)) return null;
    return { kind: "ruling", key: `iccj/${panel}/${year}/${number}` };
  }
  return null;
}

export function parsePath(pathname: string): Route | null {
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed === "") return { kind: "home" };
  if (!trimmed.startsWith("/")) return null;

  let segments: string[];
  try {
    segments = trimmed.slice(1).split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.some((segment) => segment === "")) return null;

  const first = segments[0] ?? "";
  const second = segments[1] ?? "";
  if (first === "cauta") return segments.length === 1 ? { kind: "search" } : null;
  if (first === "legislatie") {
    return segments.length === 2 && isIsoDate(second)
      ? { kind: "pointInTime", date: second }
      : null;
  }
  if (HELP.has(first)) {
    return segments.length === 1 ? { kind: "help", page: first as "despre" | "legenda" } : null;
  }
  if (first === "jurisprudenta") return parseRuling(segments);
  if (first === "modificari" || first === "modificari.atom") {
    return parseChanges(segments);
  }
  if (first === "abonare") {
    if (segments.some((segment) => segment.endsWith(".atom"))) return null;
    const route = parseChanges(["modificari", ...segments.slice(1)]);
    return route?.kind === "changes" ? { ...route, format: "subscribe" } : null;
  }
  return parseActRoute(segments);
}

export const SOURCE_REPOSITORY = "https://github.com/lexifina/romania-law";
export function sourceFileUrl(
  act: { path: string },
  article: { file: string },
  version: { commit: string; path?: string },
): string {
  const path = version.path || `${act.path}/${article.file}.md`;
  return `${SOURCE_REPOSITORY}/blob/${version.commit}/${path}`;
}

export const SITE_REPOSITORY = "https://github.com/bogdantoma27/textdelege";
export const SUPPORT_URL = "https://ko-fi.com/bogdantoma27";
