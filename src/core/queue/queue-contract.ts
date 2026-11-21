/** Contract block of a queued command: the idea's blueprint plus the command's own consumes/produces/acceptance. Pure. */
import type { QueueBlueprint } from "./queue-plan.js";

export interface ContractCommand {
  id: string;
  verify?: string;
  consumes?: string[];
  produces?: string[];
  acceptance?: string[];
}

/**
 * Text appended after the command body (before the shared conventions block) so a run in its own worktree knows
 * the frame and the interfaces it must respect. Empty string when there is nothing to tell.
 */
export function buildContractBlock(cmd: ContractCommand, blueprint: QueueBlueprint | null | undefined): string {
  const lines: string[] = [];
  if (blueprint) {
    lines.push("Khung chung của ý tưởng (blueprint, mọi lệnh cùng ý tưởng đều theo khung này):");
    lines.push(`- Mục tiêu: ${blueprint.goal}`);
    if (blueprint.architecture) lines.push(`- Kiến trúc: ${blueprint.architecture}`);
    if (blueprint.constraints.length) {
      lines.push("- Ràng buộc:");
      for (const c of blueprint.constraints) lines.push(`  - ${c}`);
    }
    if (blueprint.interfaces.length) {
      lines.push("- Giao diện giữa các lệnh (tên phải giữ đúng):");
      for (const i of blueprint.interfaces) {
        lines.push(`  - ${i.name} (lệnh ${i.owner})${i.description ? `: ${i.description}` : ""}${i.owner === cmd.id ? " ← lệnh này cung cấp" : ""}`);
      }
    }
  }
  const own: string[] = [];
  if (cmd.consumes?.length) own.push(`- Dùng (consumes): ${cmd.consumes.join(", ")}. Các lệnh khác cung cấp chúng; nếu chưa có trong worktree thì tạo bản tối thiểu ĐÚNG tên và chữ ký này, không đổi tên.`);
  if (cmd.produces?.length) own.push(`- Cung cấp (produces): ${cmd.produces.join(", ")}. Phải xuất đúng tên này để lệnh khác dùng được.`);
  if (cmd.acceptance?.length) {
    own.push("- Tiêu chí nghiệm thu:");
    for (const a of cmd.acceptance) own.push(`- ${a}`);
  }
  if (own.length || (lines.length && cmd.verify)) {
    if (lines.length) lines.push("");
    lines.push(`Hợp đồng của lệnh này (${cmd.id}):`);
    lines.push(...own);
    if (cmd.verify) lines.push(`- Lệnh kiểm tra (verify): ${cmd.verify}. Viết test cho phần mình làm và chạy lệnh này trước khi commit.`);
  }
  return lines.join("\n");
}
