import type { ArticleObject, ArticleVersion } from "./types";

export interface VersionHit {
  version: ArticleVersion;
  index: number;
}

export type View =
  | { kind: "exact"; hit: VersionHit }
  | { kind: "ended"; hit: VersionHit }
  | { kind: "notYet"; hit: VersionHit }
  | { kind: "beforeFirst"; hit: VersionHit };

export function versionOn(article: ArticleObject, date: string): VersionHit | null {
  const index = article.versions.findIndex(
    (version) => version.from <= date && (version.until === null || date <= version.until),
  );
  const version = article.versions[index];
  return version === undefined ? null : { version, index };
}

export function resolveView(article: ArticleObject, date: string | null, now: string): View | null {
  const first = article.versions[0];
  if (first === undefined) return null;
  const day = date ?? now;

  const exact = versionOn(article, day);
  if (exact) return { kind: "exact", hit: exact };

  if (day < first.from) {
    return { kind: date === null ? "notYet" : "beforeFirst", hit: { version: first, index: 0 } };
  }
  let index = article.versions.length - 1;
  while (index > 0 && (article.versions[index]?.from ?? "") > day) index--;
  return { kind: "ended", hit: { version: article.versions[index]!, index } };
}
