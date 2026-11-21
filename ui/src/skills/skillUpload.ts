/** Upload example attachments through the inbox staging area at submit time. */
import type { AttachmentPlanItem } from "./skillCreate";

/** Staging limits mirrored from src/core/run/inbox.ts (20 files, 5 MB per stage). */
export const STAGE_MAX_FILES = 20;
export const STAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface StagedAttachment {
  pair: string;
  side: "input" | "expected";
  stageId: string;
  names: string[];
}

export type StageInbox = (files: File[]) => Promise<{ stageId: string }>;

/** Split files into batches that each fit one staging area. */
export function batchFiles(files: File[]): File[][] {
  const batches: File[][] = [];
  let cur: File[] = [];
  let bytes = 0;
  for (const f of files) {
    if (cur.length > 0 && (cur.length >= STAGE_MAX_FILES || bytes + f.size > STAGE_MAX_BYTES)) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(f);
    bytes += f.size;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** filesMap key: `${pair}/${side}` -> File[] in the same order as plan names. */
export function attachKey(pair: string, side: "input" | "expected"): string {
  return `${pair}/${side}`;
}

/** One stage per (pair, side) batch; stops at the first failure with a Vietnamese error. */
export async function stageAttachments(
  plan: AttachmentPlanItem[],
  filesMap: Record<string, File[]>,
  stageInbox: StageInbox,
): Promise<StagedAttachment[]> {
  const out: StagedAttachment[] = [];
  for (const item of plan) {
    const files = filesMap[attachKey(item.pair, item.side)] ?? [];
    if (files.length === 0) continue;
    for (const batch of batchFiles(files)) {
      try {
        const { stageId } = await stageInbox(batch);
        out.push({ pair: item.pair, side: item.side, stageId, names: batch.map((f) => f.name) });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(`Không tải được tệp đính kèm của ${item.pair} (${item.side === "input" ? "đầu vào" : "đầu ra"}): ${detail}`);
      }
    }
  }
  return out;
}
