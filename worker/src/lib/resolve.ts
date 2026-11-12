import type { Store } from "./store";
import { type Citation, parseCitation } from "./citation";
import type { ActIndexEntry, ActObject } from "./types";

export async function resolveAct(store: Store, actRef: string): Promise<ActObject | null> {
  const path = actRef.includes("/") ? actRef : await store.resolveAlias(actRef);
  return path === null ? null : store.act(path);
}

export function citedAct(index: ActIndexEntry[], citation: Citation): ActIndexEntry | null {
  const { alias, kind, chamber, number, year } = citation.act;
  if (alias !== undefined) return index.find((act) => act.alias === alias) ?? null;
  if (kind === "hotarare-parlament" && chamber === undefined) {
    const found = index.filter(
      (act) => act.path === `${kind}/camera/${year}/${number}` || act.path === `${kind}/senat/${year}/${number}`,
    );
    return found.length === 1 ? (found[0] ?? null) : null;
  }
  const path = `${kind}/${chamber === undefined ? "" : `${chamber}/`}${year}/${number}`;
  return index.find((act) => act.path === path) ?? null;
}

export function findCitedAct(index: ActIndexEntry[], input: string): ActIndexEntry | null {
  const citation = parseCitation(input);
  return citation === null ? null : citedAct(index, citation);
}
