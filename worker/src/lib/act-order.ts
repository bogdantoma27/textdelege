import { parseActStatus } from "./status";
import type { ManifestAct } from "./types";

export type OrderedAct = Pick<ManifestAct, "alias" | "title" | "short" | "status">;

export const actName = (act: OrderedAct) => act.short ?? act.title;

export const isCurrent = (act: OrderedAct) => parseActStatus(act.status).kind === "in-force";

const PRIORITY = [
  "constitutia",
  "codul-civil",
  "codul-procedura-civila",
  "codul-penal",
  "codul-procedura-penala",
  "codul-fiscal",
  "codul-procedura-fiscala",
  "codul-muncii",
  "codul-administrativ",
];

const priority = (act: OrderedAct) => {
  const index = act.alias ? PRIORITY.indexOf(act.alias) : -1;
  return index === -1 ? PRIORITY.length : index;
};

export function ordered<T extends OrderedAct>(acts: T[]): T[] {
  return [...acts].sort((a, b) => priority(a) - priority(b) || actName(a).localeCompare(actName(b), "ro"));
}
