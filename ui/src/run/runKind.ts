export type PickKind = "research" | "coding";

/** No run-type choice any more: a project with a repo always runs coding, anything else is research. */
export function effectiveKind(hasRepo: boolean): PickKind {
  return hasRepo ? "coding" : "research";
}
