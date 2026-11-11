export type ActStatusKind = "in-force" | "repealed" | "unconsolidated" | "other";

export interface ActStatus {
  kind: ActStatusKind;
  repealedOn: string | null;
}

export function parseActStatus(status: string): ActStatus {
  if (status === "in force") return { kind: "in-force", repealedOn: null };
  if (status === "repealed") return { kind: "repealed", repealedOn: null };
  const repealed = /^repealed (\d{4}-\d{2}-\d{2})$/.exec(status);
  if (repealed) return { kind: "repealed", repealedOn: repealed[1]! };
  if (status === "amended, not consolidated") return { kind: "unconsolidated", repealedOn: null };
  return { kind: "other", repealedOn: null };
}
