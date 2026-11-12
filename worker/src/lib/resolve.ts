import type { Store } from "./store";
import { parseCitation } from "./citation";
import type { ActIndexEntry, ActObject } from "./types";

export async function resolveAct(store: Store, actRef: string): Promise<ActObject | null> {
  const path = actRef.includes("/") ? actRef : await store.resolveAlias(actRef);
  return path === null ? null : store.act(path);
}

export function findCitedAct(index: ActIndexEntry[], input: string): ActIndexEntry | null {
  const citation = parseCitation(input);
  if (citation === null) return null;
  const { alias, kind, number, year } = citation.act;
  if (alias !== undefined) return index.find((act) => act.alias === alias) ?? null;
  const path = `${kind}/${year}/${number}`;
  return index.find((act) => act.path === path) ?? null;
}
