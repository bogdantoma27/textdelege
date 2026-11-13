import { normalise } from "./citation";
import { actPathParts } from "./urls";
import { ACTS_PAGE, type ActFilter, type ActList, type ActListItem } from "./store";
import type { ActIndexEntry } from "./types";

function toItem(entry: ActIndexEntry): ActListItem {
  const { year, number } = actPathParts(entry.path);
  const parsedYear = /^[0-9]+$/.test(year ?? "") ? Number(year) : null;
  return {
    path: entry.path,
    alias: entry.alias,
    kind: entry.kind,
    title: entry.title,
    short: entry.short,
    status: entry.status,
    year: parsedYear,
    number: number === "" ? null : number,
    articles: entry.articles,
  };
}

const numberOf = (item: ActListItem) => Number.parseInt(item.number ?? "", 10) || 0;

function compare(a: ActListItem, b: ActListItem): number {
  if (a.year !== b.year) {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  }
  return numberOf(b) - numberOf(a) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

interface Prepared {
  item: ActListItem;
  folded: string;
}

// Normalising every title is the costly part of a text filter; do it once per loaded index.
const prepared = new WeakMap<ActIndexEntry[], Prepared[]>();

function prepare(index: ActIndexEntry[]): Prepared[] {
  let rows = prepared.get(index);
  if (rows === undefined) {
    rows = index.map((entry) => ({ item: toItem(entry), folded: normalise(`${entry.title} ${entry.short ?? ""}`) }));
    prepared.set(index, rows);
  }
  return rows;
}

/** The list of /acte, from the act index in memory: no database query, exact counts. */
export function listFromIndex(index: ActIndexEntry[], filter: ActFilter): ActList {
  const q = normalise(filter.q ?? "");
  const numeric = /^[0-9]+$/.test(q);
  const matching = prepare(index)
    .filter(({ item, folded }) => {
      if (filter.kind !== undefined && item.kind !== filter.kind) return false;
      if (filter.year !== undefined && item.year !== filter.year) return false;
      if (filter.status === "in-force" && item.status !== "in force") return false;
      if (filter.status === "repealed" && !item.status.startsWith("repealed")) return false;
      if (q === "") return true;
      return (numeric && item.number === q) || folded.includes(q);
    })
    .map(({ item }) => item)
    .sort(compare);
  const total = matching.length;
  const pages = Math.max(1, Math.ceil(total / ACTS_PAGE));
  const page = Math.min(Math.max(1, Math.floor(filter.page)), pages);
  return { items: matching.slice((page - 1) * ACTS_PAGE, page * ACTS_PAGE), total, page, pages };
}
