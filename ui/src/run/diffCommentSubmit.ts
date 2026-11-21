import { parsePatch } from "../components/run/DiffView.js";

/** Union of file paths across several patches (diff.patch, uncommitted.patch); empty/undefined are skipped. */
export function allowedFilesOf(...patches: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  for (const p of patches) {
    if (!p) continue;
    for (const f of parsePatch(p)) seen.add(f.path);
  }
  return [...seen];
}
