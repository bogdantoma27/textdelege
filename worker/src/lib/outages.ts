import { AsyncLocalStorage } from "node:async_hooks";
import type { OfficialSource } from "./types";

const scope = new AsyncLocalStorage<{ down: OfficialSource[]; built: string | null }>();

export function withSources<T>(sources: OfficialSource[], render: () => T, built: string | null = null): T {
  return scope.run({ down: sources.filter((source) => source.state === "unavailable"), built }, render);
}

export const unavailableSources = (): OfficialSource[] => scope.getStore()?.down ?? [];

export const builtDay = (): string | null => scope.getStore()?.built ?? null;

export function sinceDay(source: OfficialSource): string | null {
  return (source.unavailable_since ?? source.last_successful_contact)?.slice(0, 10) ?? null;
}
