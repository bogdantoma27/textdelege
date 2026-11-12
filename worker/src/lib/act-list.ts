import { normalise } from "./citation";
import { actPathParts } from "./urls";
import { ACTS_PAGE, COUNT_CAP, type ActFilter, type ActList, type ActListItem } from "./store";
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

export function listFromIndex(index: ActIndexEntry[], filter: ActFilter): ActList {
  const q = normalise(filter.q ?? "");
  const numeric = /^[0-9]+$/.test(q);
  const matching = index
    .map(toItem)
    .filter((item) => {
      if (filter.kind !== undefined && item.kind !== filter.kind) return false;
      if (filter.year !== undefined && item.year !== filter.year) return false;
      if (filter.status === "in-force" && item.status !== "in force") return false;
      if (filter.status === "repealed" && !item.status.startsWith("repealed")) return false;
      if (q === "") return true;
      return (numeric && item.number === q) || normalise(`${item.title} ${item.short ?? ""}`).includes(q);
    })
    .sort(compare);
  const total = Math.min(matching.length, COUNT_CAP);
  const pages = Math.max(1, Math.ceil(total / ACTS_PAGE));
  const page = Math.min(Math.max(1, Math.floor(filter.page)), pages);
  return {
    items: matching.slice((page - 1) * ACTS_PAGE, page * ACTS_PAGE),
    total,
    over: matching.length > COUNT_CAP,
    page,
    pages,
  };
}
