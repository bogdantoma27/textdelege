import { diffChars, diffWordsWithSpace } from "diff";
import { hangingParagraph } from "./text";
import type { ArticleLine } from "./types";

export type Granularity = "word" | "char";
export type LineStatus = "same" | "changed" | "added" | "removed";

export interface DiffPart {
  value: string;
  added?: true;
  removed?: true;
}

export interface LineDiff {
  id: string;
  status: LineStatus;
  marker: string | null;
  parts: DiffPart[];
  before: ArticleLine | null;
  after: ArticleLine | null;
}

export interface DiffStats {
  same: number;
  changed: number;
  added: number;
  removed: number;
}

function coalesce(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  let removed = "";
  let added = "";
  let gap = "";
  const fold = () => {
    removed += gap;
    added += gap;
    gap = "";
  };
  const flush = () => {
    if (removed !== "") out.push({ value: removed, removed: true });
    if (added !== "") out.push({ value: added, added: true });
    removed = "";
    added = "";
    if (gap !== "") out.push({ value: gap });
    gap = "";
  };
  for (const part of parts) {
    if (part.added) {
      fold();
      added += part.value;
    } else if (part.removed) {
      fold();
      removed += part.value;
    } else if ((removed !== "" || added !== "") && part.value.trim() === "") {
      gap += part.value;
    } else {
      flush();
      out.push(part);
    }
  }
  flush();
  return out;
}

function inner(before: string, after: string, granularity: Granularity): DiffPart[] {
  const changes =
    granularity === "char" ? diffChars(before, after) : diffWordsWithSpace(before, after);
  const parts = changes.map((change): DiffPart => {
    if (change.added) return { value: change.value, added: true };
    if (change.removed) return { value: change.value, removed: true };
    return { value: change.value };
  });
  return granularity === "char" ? parts : coalesce(parts);
}

function whole(line: ArticleLine, status: "same" | "added" | "removed"): LineDiff {
  const { marker, body } = hangingParagraph(line.text);
  const part: DiffPart =
    status === "added" ? { value: body, added: true } : status === "removed" ? { value: body, removed: true } : { value: body };
  return {
    id: line.id,
    status,
    marker,
    parts: [part],
    before: status === "added" ? null : line,
    after: status === "removed" ? null : line,
  };
}

function pair(before: ArticleLine, after: ArticleLine, granularity: Granularity): LineDiff {
  if (before.text === after.text) return { ...whole(after, "same"), before };
  const old = hangingParagraph(before.text);
  const next = hangingParagraph(after.text);
  const sharedMarker = old.marker === next.marker;
  return {
    id: after.id,
    status: "changed",
    marker: sharedMarker ? next.marker : null,
    parts: sharedMarker
      ? inner(old.body, next.body, granularity)
      : inner(before.text, after.text, granularity),
    before,
    after,
  };
}

export function diffLines(before: ArticleLine[], after: ArticleLine[], granularity: Granularity): LineDiff[] {
  const oldById = new Map<string, ArticleLine>();
  for (const line of before) if (!oldById.has(line.id)) oldById.set(line.id, line);
  const matched = new Set<string>();
  const newIds = new Set(after.map((line) => line.id));

  const removedAfter = new Map<string | null, ArticleLine[]>();
  let anchor: string | null = null;
  for (const line of before) {
    if (newIds.has(line.id)) {
      anchor = line.id;
      continue;
    }
    removedAfter.set(anchor, [...(removedAfter.get(anchor) ?? []), line]);
  }
  const removed = (key: string | null) =>
    (removedAfter.get(key) ?? []).map((line) => whole(line, "removed"));

  const out: LineDiff[] = [...removed(null)];
  for (const line of after) {
    const old = oldById.get(line.id);
    if (old === undefined || matched.has(line.id)) {
      out.push(whole(line, "added"));
    } else {
      matched.add(line.id);
      out.push(pair(old, line, granularity));
    }
    out.push(...removed(line.id));
  }
  return out;
}

export function diffStats(diff: LineDiff[]): DiffStats {
  const stats: DiffStats = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const entry of diff) stats[entry.status]++;
  return stats;
}
