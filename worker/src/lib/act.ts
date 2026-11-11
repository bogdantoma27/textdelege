import { today } from "./dates";
import { parseActStatus } from "./status";
import type { ActArticleEntry, ActObject, ArticleState, LawRef, TimelineEntry } from "./types";

export const TEXT_PAGE = 50;
export const HISTORY_PAGE = 100;

export interface TocEntry {
  entry: ActArticleEntry;
  state: ArticleState;
}

function stateOn(entry: ActArticleEntry, day: string): ArticleState {
  if (entry.first !== null && entry.first > day) return "future";
  if (entry.state === "repealed") {
    return entry.last_change === null || entry.last_change <= day ? "repealed" : "in-force";
  }
  return "in-force";
}

export function tocEntries(act: ActObject, date: string | null, now: string = today()): TocEntry[] {
  const day = date ?? now;
  return act.articles.map((entry) => ({ entry, state: stateOn(entry, day) }));
}

export function actStateOn(act: ActObject, date: string | null, now: string): ArticleState {
  if ((date ?? now) < act.from) return "future";
  const { kind, repealedOn } = parseActStatus(act.status);
  if (kind !== "repealed") return "in-force";
  return repealedOn === null || repealedOn <= (date ?? now) ? "repealed" : "in-force";
}

export function pageNumber(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

export interface Paged<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(items: readonly T[], page: number, size: number): Paged<T> {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  return {
    items: items.slice((current - 1) * size, current * size),
    page: current,
    pages,
    total: items.length,
  };
}

export interface HistoryRow {
  date: string;
  laws: LawRef[];
  articles: number;
  pending: boolean;
}

export function historyRows(act: ActObject, now: string): HistoryRow[] {
  return [...act.timeline]
    .sort((a: TimelineEntry, b: TimelineEntry) => b.date.localeCompare(a.date))
    .map((event) => ({
      date: event.date,
      laws: event.laws,
      articles: event.articles,
      pending: event.date > now,
    }));
}

export interface MonitorRef {
  number: string;
  date: string;
}

const MONITOR =
  /,?\s*publicat[ăa]?\s+în\s+Monitorul\s+Oficial(?:\s+al\s+României)?(?:,?\s*Partea\s+I)?,?\s*nr\.?\s*(\d+)\s+din\s+(\d{1,2}\s+\p{L}+\s+\d{4}|\d{1,2}[./]\d{1,2}[./]\d{4})\s*\.?\s*$/iu;

export function monitorRef(title: string): MonitorRef | null {
  const match = MONITOR.exec(title);
  return match ? { number: match[1] ?? "", date: match[2] ?? "" } : null;
}
