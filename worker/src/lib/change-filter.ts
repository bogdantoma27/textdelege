import { normalise } from "./citation";
import { parseDate } from "./dates";
import type { ChangeItem, EventVerb } from "./types";
import { unitText } from "./text";

export interface ChangeFilters {
  q: string;
  act: string | null;
  verb: EventVerb | null;
  from: string | null;
  to: string | null;
}

export const FEED_LIMIT = 100;

export const MAX_QUERY = 100;

export const FILTER_VERBS: readonly EventVerb[] = [
  "entered",
  "modified",
  "completed",
  "repealed",
  "unconstitutional",
  "restated",
];

export function parseFilters(
  params: URLSearchParams,
  acts: ReadonlySet<string> | null,
): ChangeFilters {
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY).trim();
  const act = params.get("act");
  const verb = params.get("verb");
  const from = params.get("de");
  const to = params.get("pana");
  return {
    q,
    act: acts !== null && act !== null && acts.has(act) ? act : null,
    verb: FILTER_VERBS.find((known) => known === verb) ?? null,
    from: from === null ? null : parseDate(from),
    to: to === null ? null : parseDate(to),
  };
}

export function filterQuery(filters: ChangeFilters): string {
  const params = new URLSearchParams();
  if (filters.q !== "") params.set("q", filters.q);
  if (filters.act !== null) params.set("act", filters.act);
  if (filters.verb !== null) params.set("verb", filters.verb);
  if (filters.from !== null) params.set("de", filters.from);
  if (filters.to !== null) params.set("pana", filters.to);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

function haystack(item: ChangeItem, actName: string): string {
  const units = item.units.map((id) => unitText(id));
  return normalise(
    [actName, `art. ${item.number}`, item.number, item.title ?? "", item.law?.label ?? "", ...units].join(" | "),
  );
}

export function applyFilters(
  items: ChangeItem[],
  filters: ChangeFilters,
  actPath: string | null,
  actName: (path: string) => string,
): ChangeItem[] {
  const query = normalise(filters.q);
  return items.filter(
    (item) =>
      (actPath === null || item.act_path === actPath) &&
      (filters.verb === null || item.verb === filters.verb) &&
      (filters.from === null || item.date >= filters.from) &&
      (filters.to === null || item.date <= filters.to) &&
      (query === "" || haystack(item, actName(item.act_path)).includes(query)),
  );
}
