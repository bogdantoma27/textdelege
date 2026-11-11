import { articleSlug } from "./urls";

export interface Citation {
  act: { alias?: string; kind?: string; number?: string; year?: string };
  article?: string;
  alin?: string;
  lit?: string;
}

export function normalise(input: string): string {
  return input
    // Written as escapes: the legacy cedilla code points (U+015E/F, U+0162/3) differ from the comma forms.
    .normalize("NFC")
    .replace(/\u015f/g, "ș")
    .replace(/\u015e/g, "Ș")
    .replace(/\u0163/g, "ț")
    .replace(/\u0162/g, "Ț")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .replace(/\b(art|alin|lit)\.(?=\S)/g, "$1. ")
    .replace(/\s+/g, " ")
    .trim();
}

function abbreviation(letters: string): string {
  return `${[...letters].join("\\.?")}\\.?`;
}

const CODE_PATTERNS: [string, string][] = [
  ["constitutia", "constitutia|constitutiei|constitutie"],
  ["codul-procedura-civila", `cod(?:ul|ului)? de procedura civila|c\\. ?proc\\. ?civ\\.?|n?${abbreviation("cpc")}`],
  ["codul-procedura-penala", `cod(?:ul|ului)? de procedura penala|c\\. ?proc\\. ?pen\\.?|n?${abbreviation("cpp")}`],
  ["codul-procedura-fiscala", `cod(?:ul|ului)? de procedura fiscala|c\\. ?proc\\. ?fisc\\.?|${abbreviation("cpf")}`],
  ["codul-civil", `cod(?:ul|ului)? civil|c\\. ?civ\\.?|${abbreviation("ncc")}`],
  ["codul-penal", `cod(?:ul|ului)? penal|c\\. ?pen\\.?|${abbreviation("ncp")}`],
  ["codul-muncii", `cod(?:ul|ului)? muncii|c\\. ?muncii`],
  ["codul-fiscal", `cod(?:ul|ului)? fiscal|c\\. ?fisc\\.?`],
  ["codul-administrativ", `cod(?:ul|ului)? administrativ|c\\. ?adm\\.?`],
  ["codul-vamal", "cod(?:ul|ului)? vamal"],
  ["codul-silvic", "cod(?:ul|ului)? silvic"],
  ["codul-consumului", "cod(?:ul|ului)? consumului"],
  ["codul-aerian", "cod(?:ul|ului)? aerian"],
];

const CODE_REGEXES = CODE_PATTERNS.map(
  ([alias, source]) => [alias, new RegExp(`(?<![a-z0-9])(?:${source})(?![a-z0-9])`)] as const,
);

const NUMBERED_PATTERNS: [string, string][] = [
  ["lege", "legea|legii|lege"],
  ["oug", "o\\.? ?u\\.? ?g\\.?|ordonanta de urgenta(?: a guvernului)?"],
  ["og", "o\\.? ?g\\.?|ordonanta(?: guvernului)?"],
  ["hg", "h\\.? ?g\\.?|hotararea(?: guvernului)?"],
];

const NUMBERED_REGEXES = NUMBERED_PATTERNS.map(
  ([kind, source]) =>
    [
      kind,
      new RegExp(
        `(?<![a-z0-9])(?:${source}) ?(?:nr\\.? ?)?(\\d+) ?(?:/| din )(\\d{4})(?![0-9])`,
      ),
    ] as const,
);

const ARTICLE = /(?<![a-z])art(?:icolul)?\.? ?(\d+(?:\.\d+)*)(?: ?(?:\^|ind\.? ?|indice ?)\(?(\d+)\)?)?/;
const ALIN = /(?<![a-z])alin(?:eatul)?\.? ?\(?(\d+(?:\^\d+)?)\)?/;
const LIT = /(?<![a-z])lit(?:era)?\.? ?\(?([a-z])\)?(?![a-z])/;

const SHORT_CODES: [string, RegExp][] = [
  ["codul-civil", /(?<![A-Za-z0-9])C\.?C\.?(?![A-Za-z0-9])/],
  ["codul-penal", /(?<![A-Za-z0-9])C\.?P\.?(?![A-Za-z0-9])/],
  ["codul-muncii", /(?<![A-Za-z0-9])C\.?M\.?(?![A-Za-z0-9])/],
  ["codul-fiscal", /(?<![A-Za-z0-9])C\.?F\.?(?![A-Za-z0-9])/],
  ["codul-administrativ", /(?<![A-Za-z0-9])C\.?A\.?(?![A-Za-z0-9])/],
];

const MAX_LENGTH = 200;

function findAct(text: string, original: string): Citation["act"] | null {
  for (const [kind, regex] of NUMBERED_REGEXES) {
    const match = regex.exec(text);
    if (match) return { kind, number: match[1], year: match[2] };
  }
  for (const [alias, regex] of CODE_REGEXES) {
    if (regex.test(text)) return { alias };
  }
  for (const [alias, regex] of SHORT_CODES) {
    if (regex.test(original)) return { alias };
  }
  return null;
}

export function parseCitation(input: string): Citation | null {
  if (input.length > MAX_LENGTH) return null;
  const text = normalise(input);
  const act = findAct(text, input.normalize("NFC"));
  if (!act) return null;
  const citation: Citation = { act };

  const article = ARTICLE.exec(text);
  if (article) {
    const base = (article[1] ?? "").replaceAll(".", "");
    citation.article = article[2] ? `${base}^${article[2]}` : base;
    const rest = text.slice(article.index + article[0].length);
    const alin = ALIN.exec(rest);
    if (alin) citation.alin = alin[1];
    const lit = LIT.exec(rest);
    if (lit) citation.lit = lit[1];
  }
  return citation;
}

export function citationUrl(c: Citation): string | null {
  let base: string;
  if (c.act.alias) {
    base = `/${c.act.alias}`;
  } else if (c.act.kind && c.act.number && c.act.year) {
    base = `/${c.act.kind}/${c.act.year}/${c.act.number}`;
  } else {
    return null;
  }
  if (!c.article) return base;
  const path = `${base}/${articleSlug(c.article)}`;
  const parts: string[] = [];
  if (c.alin) parts.push(`alin-${c.alin.replaceAll("^", "_")}`);
  if (c.lit) parts.push(`lit-${c.lit}`);
  return parts.length > 0 ? `${path}#${parts.join("-")}` : path;
}
