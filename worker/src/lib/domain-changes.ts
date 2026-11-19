import { FEED_LIMIT } from "./change-filter";
import { today } from "./dates";
import { type Domain, DOMAINS, domainUrl, monthUrl } from "./domains";
import type { Store } from "./store";
import type { ActIndexEntry, ChangeItem } from "./types";

export interface DomainAct {
  path: string;
  ref: string;
  name: string;
}

export interface DomainMonth {
  /** YYYY-MM */
  month: string;
  count: number;
  /** Changes grouped by act, in the order of the domain's act list. */
  acts: { act: DomainAct; items: ChangeItem[] }[];
}

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The months with applied changes, newest first, from the per-act changes objects (2-3 R2 reads, no D1).
 * An act's object holds only its latest FEED_LIMIT applied changes, so when it is full its oldest month
 * may be cut off and is left out rather than shown incomplete.
 */
export async function domainMonths(store: Store, index: ActIndexEntry[], domain: Domain): Promise<DomainMonth[]> {
  const now = today();
  const found = domain.acts
    .map((path) => index.find((entry) => entry.path === path))
    .filter((entry) => entry !== undefined);
  const loaded = await Promise.all(
    found.map(async (entry) => ({
      act: { path: entry.path, ref: entry.alias ?? entry.path, name: entry.short ?? entry.title },
      changes: await store.changes(entry.path),
    })),
  );
  const byMonth = new Map<string, DomainMonth>();
  for (const { act, changes } of loaded) {
    if (changes === null) continue;
    const applied = [...changes.items, ...changes.upcoming].filter((item) => item.date <= now);
    const oldest =
      changes.items.length >= FEED_LIMIT
        ? changes.items.reduce((min, item) => (item.date < min ? item.date : min), "9999-99-99").slice(0, 7)
        : null;
    for (const item of applied) {
      const month = item.date.slice(0, 7);
      if (month === oldest) continue;
      let entry = byMonth.get(month);
      if (entry === undefined) byMonth.set(month, (entry = { month, count: 0, acts: [] }));
      let group = entry.acts.find((candidate) => candidate.act.path === act.path);
      if (group === undefined) entry.acts.push((group = { act, items: [] }));
      group.items.push(item);
      entry.count += 1;
    }
  }
  for (const entry of byMonth.values()) {
    for (const group of entry.acts) group.items.sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file));
    entry.acts.sort((a, b) => domain.acts.indexOf(a.act.path) - domain.acts.indexOf(b.act.path));
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** Sitemap paths of the index, the domain pages and their months. */
export async function domainSitemapPaths(store: Store): Promise<string[]> {
  const index = await store.actIndex();
  const paths: string[] = [];
  for (const domain of DOMAINS) {
    const months = await domainMonths(store, index, domain);
    if (months.length === 0) continue;
    paths.push(domainUrl(domain));
    for (const { month } of months) paths.push(monthUrl(domain, month));
  }
  return paths.length === 0 ? paths : ["/ce-s-a-schimbat", ...paths];
}
