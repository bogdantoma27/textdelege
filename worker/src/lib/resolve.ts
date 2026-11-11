import type { Store } from "./store";
import type { ActObject } from "./types";

export async function resolveAct(store: Store, actRef: string): Promise<ActObject | null> {
  const path = actRef.includes("/") ? actRef : await store.resolveAlias(actRef);
  return path === null ? null : store.act(path);
}
