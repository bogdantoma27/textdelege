import { t } from "../text";
import type { ArticleRef } from "./urls";

const ambiguity = new WeakMap<readonly ArticleRef[], ReadonlySet<string>>();

function ambiguousNumbers(articles: readonly ArticleRef[]): ReadonlySet<string> {
  let found = ambiguity.get(articles);
  if (found === undefined) {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const { number } of articles) {
      if (seen.has(number)) repeated.add(number);
      seen.add(number);
    }
    found = repeated;
    ambiguity.set(articles, found);
  }
  return found;
}

export function articleLabel(article: ArticleRef, siblings?: readonly ArticleRef[]): string {
  const label =
    article.number.toUpperCase() === "UNIC" ? t("articleUnique") : t("articleAbbr", { number: article.number });
  if (siblings === undefined || !ambiguousNumbers(siblings).has(article.number)) return label;
  const title = /^art-t(\d+)-/.exec(article.file)?.[1];
  return title === undefined ? label : `${label} (${t("articleTitleSuffix", { n: title })})`;
}
