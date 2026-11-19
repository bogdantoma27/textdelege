import type { Store } from "./store";
import { type Citation, parseCitation } from "./citation";
import type { ActIndexEntry, ActObject } from "./types";

export async function resolveAct(store: Store, actRef: string): Promise<ActObject | null> {
  const path = actRef.includes("/") ? actRef : await store.resolveAlias(actRef);
  return path === null ? null : store.act(path);
}

export async function citedAct(store: Store, citation: Citation): Promise<ActIndexEntry | null> {
  const { alias, kind, chamber, number, year } = citation.act;
  if (alias !== undefined) {
    const path = await store.resolveAlias(alias);
    return path === null ? null : ((await store.actsByPath([path])).get(path) ?? null);
  }
  if (kind === "hotarare-parlament" && chamber === undefined) {
    const found = await store.actsByPath([`${kind}/camera/${year}/${number}`, `${kind}/senat/${year}/${number}`]);
    return found.size === 1 ? ([...found.values()][0] ?? null) : null;
  }
  const path = `${kind}/${chamber === undefined ? "" : `${chamber}/`}${year}/${number}`;
  return (await store.actsByPath([path])).get(path) ?? null;
}

export async function findCitedAct(store: Store, input: string): Promise<ActIndexEntry | null> {
  const citation = parseCitation(input);
  return citation === null ? null : citedAct(store, citation);
}
