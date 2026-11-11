import type { Child } from "hono/jsx";
import { type Key, t } from "../text";
import type { ActObject, ArticleObject, ArticleState, EventVerb } from "../lib/types";
import { lawUrlFromKey } from "../lib/urls";
import { Badge, type BadgeColour } from "./components";

export const VERBS: Record<EventVerb, Key> = {
  entered: "verbEntered",
  modified: "verbModified",
  completed: "verbCompleted",
  repealed: "verbRepealed",
  unconstitutional: "verbUnconstitutional",
  restated: "verbRestated",
};

export const STATE_LABEL: Record<ArticleState, Key> = {
  "in-force": "statusInForce",
  repealed: "labelRepealed",
  future: "statusFuture",
};
export const STATE_BADGE_ID: Record<ArticleState, BadgeId> = {
  "in-force": "inForce",
  repealed: "repealed",
  future: "future",
};

export const BADGES = {
  inForce: { colour: "green", label: "statusInForce", legend: "legendStateInForce" },
  repealed: { colour: "grey", label: "labelRepealed", legend: "legendStateRepealed" },
  future: { colour: "yellow", label: "statusFuture", legend: "legendStateFuture" },
  ended: { colour: "grey", label: "statusEnded", legend: "legendStateEnded" },
  superseded: { colour: "grey", label: "statusSuperseded", legend: "legendStateSuperseded" },
  applied: { colour: "green", label: "histApplied", legend: "legendStateApplied" },
  pending: { colour: "yellow", label: "histPending", legend: "legendStatePending" },
  unconsolidated: { colour: "yellow", label: "homeUnconsolidated", legend: "legendStateUnconsolidated" },
  notInForce: { colour: "grey", label: "homeNotInForce", legend: "legendStateNotInForce" },
  pitInForce: { colour: "green", label: "pitBadgeInForce", legend: "legendStatePitInForce", dated: true },
  pitFuture: { colour: "yellow", label: "pitBadgeFuture", legend: "legendStatePitFuture", dated: true },
  pitRepealed: { colour: "grey", label: "pitBadgeRepealed", legend: "legendStatePitRepealed", dated: true },
  unconstitutional: { colour: "yellow", label: "rulingsUnconstitutional", legend: "legendStateUnconstitutional" },
} satisfies Record<string, { colour: BadgeColour; label: Key; legend: Key; dated?: true }>;

export type BadgeId = keyof typeof BADGES;

export function StatusBadge({ id, children }: { id: BadgeId; children?: Child }) {
  return <Badge colour={BADGES[id].colour}>{children ?? t(BADGES[id].label)}</Badge>;
}

const OUTCOMES: Record<string, Key> = {
  admitted: "outcomeAdmitted",
  rejected: "outcomeRejected",
  other: "outcomeOther",
};

export function outcomeText(outcome: string): string {
  const key = OUTCOMES[outcome];
  return key === undefined ? outcome : t(key);
}

export const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function lawLabels(act: ActObject, article: ArticleObject): Map<string, string> {
  const labels = new Map(act.laws.map((law) => [law.key, law.label]));
  for (const version of article.versions) {
    if (version.law) labels.set(version.law.key, version.law.label);
  }
  for (const event of article.events) {
    if (event.law) labels.set(event.law.key, event.law.label);
  }
  return labels;
}

const UNNAMED_HREF = "/despre#sursa";

export function lawLabelText(lawKey: string, label: string): string {
  return lawUrlFromKey(lawKey) === null ? t("lawUnnamed") : label;
}

export function LawLink({ lawKey, label }: { lawKey: string; label: string }) {
  const href = lawUrlFromKey(lawKey);
  return href === null ? <a href={UNNAMED_HREF}>{t("lawUnnamed")}</a> : <a href={href}>{label}</a>;
}
