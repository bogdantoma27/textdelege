import { versionOn } from "./versions";
import type { ActArticleEntry, ActObject, ArticleEvent, ArticleObject } from "./types";

export const ACT_CAP = 300;
export const CHUNK = 20;

export function candidates(
  act: ActObject,
  from: string,
  to: string,
): { entries: ActArticleEntry[]; capped: boolean } {
  const all = act.articles.filter(
    (entry) =>
      entry.last_change !== null &&
      entry.last_change > from &&
      (entry.first === null || entry.first <= to),
  );
  return { entries: all.slice(0, ACT_CAP), capped: all.length > ACT_CAP };
}

export async function inChunks<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(...(await Promise.all(items.slice(start, start + size).map(work))));
  }
  return out;
}

export function eventsIn(article: ArticleObject, from: string, to: string): ArticleEvent[] {
  return article.events.filter((event) => event.date > from && event.date <= to);
}

export function linkRange(
  article: ArticleObject,
  from: string,
  to: string,
): { from: string; to: string } | null {
  const first = article.versions[0];
  const last = article.versions[article.versions.length - 1];
  if (first === undefined || last === undefined) return null;
  const start = versionOn(article, from) ? from : first.from;
  const end = versionOn(article, to) ? to : (last.until ?? last.from);
  const [a, b] = [versionOn(article, start), versionOn(article, end)];
  return start < end && a && b && a.index !== b.index ? { from: start, to: end } : null;
}
