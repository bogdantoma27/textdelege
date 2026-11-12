import { type Child, jsx } from "hono/jsx";
import { t } from "../text";
import { Indexed } from "../views/indexed";
import { type ArticleRef, articleUrl, isPlainNumber } from "./urls";

const MARKERS = [
  /^\(\d+(?:\^\d+)?\)/,
  /^[a-z](?:\^\d+)?\)/,
  /^\d+\.\d+\.(?=\s|$)/,
  /^\d+(?:\^\d+)?\.(?=\s|$)/,
];

export function hangingParagraph(text: string): { marker: string | null; body: string } {
  for (const pattern of MARKERS) {
    const match = pattern.exec(text);
    if (match) return { marker: match[0], body: text.slice(match[0].length).trimStart() };
  }
  return { marker: null, body: text };
}

export interface UnitRef {
  alin?: string;
  lit?: string;
  pct?: string;
  line?: string;
}

const caret = (value: string) => value.replace("_", "^");

export function parseUnit(id: string): UnitRef | null {
  let match = /^alin-(\d+(?:_\d+)?)(?:-lit-([a-z](?:_\d+)?))?$/.exec(id);
  if (match) {
    const unit: UnitRef = { alin: caret(match[1]!) };
    if (match[2]) unit.lit = caret(match[2]);
    return unit;
  }
  match = /^lit-([a-z](?:_\d+)?)$/.exec(id);
  if (match) return { lit: caret(match[1]!) };
  match = /^pct-(\d+)-(\d+)$/.exec(id);
  if (match) return { pct: `${match[1]}.${match[2]}` };
  match = /^pct-(\d+(?:_\d+)?)$/.exec(id);
  if (match) return { pct: caret(match[1]!) };
  match = /^p-(\d+)$/.exec(id);
  if (match) return { line: match[1]! };
  return null;
}

export function linkableNumbers(articles: readonly ArticleRef[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { number } of articles) {
    if (seen.has(number)) repeated.add(number);
    seen.add(number);
  }
  return new Set([...seen].filter((number) => isPlainNumber(number) && !repeated.has(number)));
}

export interface CrossReferenceContext {
  actRef: string;
  date: string | null;
  articles: ReadonlySet<string>;
}

const REFERENCE =
  /\bart(?:icolul|icolele)?\.?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?!\d)(?:\s*\^\s*\(?(\d+)\)?)?(?:\s*,?\s*alin(?:eatul)?\.?\s*\(?(\d+(?:\^\d+)?)\)?)?/giu;

const OTHER_ACT =
  /^(?:[\s,]+(?:alin(?:eatul)?\.?\s*\(?\d+(?:\^\d+)?\)?|lit(?:era)?\.?\s*[a-z]\)?|pct\.?\s*\d+(?:\.\d+)?))*[\s,]+din\s+(?!prezent)/iu;

export function linkCrossReferences(body: string, ctx: CrossReferenceContext): Child[] {
  const out: Child[] = [];
  let last = 0;
  for (const match of body.matchAll(REFERENCE)) {
    const [text, digits = "", insertion, alin] = match;
    const end = match.index + text.length;
    const number = insertion ? `${digits.replaceAll(".", "")}^${insertion}` : digits.replaceAll(".", "");
    if (!ctx.articles.has(number) || OTHER_ACT.test(body.slice(end))) continue;
    const path = articleUrl(ctx.actRef, { number, file: "" }, ctx.date ?? undefined);
    const href = alin ? `${path}#alin-${alin.replace("^", "_")}` : path;
    if (match.index > last) out.push(body.slice(last, match.index));
    out.push(jsx("a", { class: "x", href, "data-ref": path }, jsx(Indexed, { text })));
    last = end;
  }
  if (last < body.length || out.length === 0) out.push(body.slice(last));
  return out;
}

export function unitText(id: string): string {
  const unit = parseUnit(id);
  if (unit === null) return id;
  const parts: string[] = [];
  if (unit.alin) parts.push(t("unitAlin", { n: unit.alin }));
  if (unit.lit) parts.push(t("unitLit", { n: unit.lit }));
  if (unit.pct) parts.push(t("unitPct", { n: unit.pct }));
  if (unit.line) parts.push(t("unitLine", { n: unit.line }));
  return parts.join(" ");
}
