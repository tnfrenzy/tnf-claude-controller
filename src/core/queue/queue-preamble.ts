import fs from "node:fs";
import path from "node:path";
import type { ControllerConfig } from "../app/config.js";

const PLACEHOLDER = "{{knownEnvFailures}}";

/**
 * Builds the shared "controller conventions" block for queued commands.
 *
 * Pure apart from reading the template file. Returns ONLY the block; the
 * caller appends it AFTER the command body, separated by a blank line
 * (body + "\n\n" + preamble). It is never part of the body.
 *
 * Deliberate deviation from PLANNER-QUEUE.md section 7: when there are no
 * known env failures the section is kept and filled with the line
 * "(không có)" instead of being dropped.
 */
export function buildQueuePreamble(
  config: Pick<ControllerConfig, "defaults" | "repoRoot">,
  templatePath?: string,
): string {
  const file = templatePath ?? path.join(config.repoRoot, "config", "queue-preamble.md");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`Không đọc được mẫu đoạn quy ước chung: ${file} (${(e as Error).message})`);
  }
  const template = raw.replace(/\r\n/g, "\n");
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`Mẫu đoạn quy ước chung thiếu ô thay thế ${PLACEHOLDER}: ${file}`);
  }
  const list = config.defaults.coding.knownEnvFailures;
  const items = (Array.isArray(list) ? list : []).filter(
    (s): s is string => typeof s === "string" && s.trim() !== "",
  );
  const lines = items.length > 0 ? items.map((s) => `- ${s}`).join("\n") : "(không có)";
  const out = template.split(PLACEHOLDER).join(lines);
  if (out.includes(PLACEHOLDER)) {
    throw new Error(`Đoạn quy ước chung còn sót ô thay thế ${PLACEHOLDER} sau khi dựng.`);
  }
  return out;
}
