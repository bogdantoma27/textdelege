/**
 * Every query parameter that a route or view reads. The page cache builds its key from these
 * only, so an unknown parameter (`?x=123`) shares the entry of the bare address.
 * test/query-params.test.ts fails when a route reads a parameter that is not listed here.
 */
export const QUERY_PARAMS = [
  "act", // /modificari filter (act)
  "alt", // /modificari filter (other act)
  "an", // /acte year
  "atribuire", // article/act text: attribution toggle
  "coduri", // home: historical tab
  "cuprins", // contents filter
  "data", // point in time
  "de", // dates: from (changes, comparison)
  "doar", // comparison: only changes
  "granularitate", // comparison: word/character
  "in_force", // search
  "live", // search: live results
  "pagina", // paging
  "paleta", // comparison: colour-blind palette
  "pana", // dates: until (changes, comparison)
  "q", // search text
  "stare", // /acte state
  "tip", // /acte kind
  "ultima", // article text: highlight the last change
  "vedere", // comparison: side by side
  "verb", // /modificari filter (verb)
] as const;

const ALLOWED = new Set<string>(QUERY_PARAMS);

/** The query string of the cache key: known parameters only, first value, no empties, sorted. */
export function canonicalQuery(params: URLSearchParams): string {
  const kept = new Map<string, string>();
  for (const [name, value] of params) {
    if (value !== "" && ALLOWED.has(name) && !kept.has(name)) kept.set(name, value);
  }
  const sorted = [...kept].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted.length === 0 ? "" : `?${new URLSearchParams(sorted).toString()}`;
}
