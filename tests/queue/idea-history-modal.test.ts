import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dicts } from "../../ui/src/i18n";

const src = readFileSync(fileURLToPath(new URL("../../ui/src/components/queue/IdeaHistoryModal.tsx", import.meta.url)), "utf8");

describe("IdeaHistoryModal", () => {
  it("uses Modal, historyCommands and run links", () => {
    expect(src).toContain("historyCommands");
    expect(src).toContain("#/runs/");
    expect(src).toContain("Modal");
    expect(src).toContain("idea_historyEmpty");
  });
  it("i18n has every idea_* key in vi and en", () => {
    const keys = ["idea_approveAll", "idea_runAll", "idea_stop", "idea_history", "idea_historyEmpty", "idea_noActive", "idea_branch"] as const;
    for (const k of keys) {
      expect(dicts.vi[k]).toBeTruthy();
      expect(dicts.en[k]).toBeTruthy();
    }
    expect(dicts.vi.idea_approveAll).toBe("Duyệt tất cả");
    expect(dicts.vi.idea_runAll).toBe("Chạy tất cả");
    expect(dicts.vi.idea_history).toBe("Lịch sử");
    expect(dicts.vi.idea_noActive).toBe("Không còn task đang chờ");
  });
});
