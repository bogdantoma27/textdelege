import type { ActArticleEntry, ActHeading, ActObject } from "./types";

export function headingOf(act: ActObject, entry: ActArticleEntry): ActHeading | undefined {
  return entry.heading === undefined ? undefined : act.headings?.[entry.heading];
}

/** Indexes of the heading of an entry and of the nearest earlier heading of each smaller depth. */
export function headingPathIndexes(act: ActObject, entry: ActArticleEntry): number[] {
  const headings = act.headings;
  if (headings === undefined || entry.heading === undefined) return [];
  const own = headings[entry.heading];
  if (own === undefined) return [];
  const path = [entry.heading];
  let depth = own.depth;
  for (let index = entry.heading - 1; index >= 0 && depth > 0; index--) {
    const earlier = headings[index]!;
    if (earlier.depth < depth) {
      path.unshift(index);
      depth = earlier.depth;
    }
  }
  return path;
}

export function headingPath(act: ActObject, entry: ActArticleEntry): ActHeading[] {
  return headingPathIndexes(act, entry).map((index) => act.headings![index]!);
}

export function headingText(heading: ActHeading): string {
  return heading.name === "" ? heading.label : `${heading.label} ${heading.name}`;
}

/** Index of the last heading that an article before `position` belongs to, or -1. */
export function lastHeadingBefore(act: ActObject, position: number): number {
  let last = -1;
  for (let i = 0; i < position && i < act.articles.length; i++) last = Math.max(last, act.articles[i]!.heading ?? -1);
  return last;
}

/** The headings that start after heading `seen` and up to the entry's own, outermost first. */
export function headingsBefore(act: ActObject, entry: ActArticleEntry, seen: number): { heading: ActHeading; index: number }[] {
  const headings = act.headings;
  if (headings === undefined || entry.heading === undefined) return [];
  const result: { heading: ActHeading; index: number }[] = [];
  for (let index = seen + 1; index <= entry.heading; index++) result.push({ heading: headings[index]!, index });
  return result;
}
