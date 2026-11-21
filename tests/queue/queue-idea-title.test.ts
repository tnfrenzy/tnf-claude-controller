import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { QueueStore } from "../../src/core/queue/queue-store.js";
import { deriveIdeaTitle } from "../../src/core/ideas/queue-split.js";

describe("deriveIdeaTitle", () => {
  it("takes the first non-empty line without markdown bullets", () => {
    expect(deriveIdeaTitle("\n\n- Thêm nút X\nchi tiết…")).toBe("Thêm nút X");
    expect(deriveIdeaTitle("## Tiêu đề\nbody")).toBe("Tiêu đề");
  });
  it("cuts to 80 chars and handles empty", () => {
    expect(deriveIdeaTitle("a".repeat(200))).toHaveLength(80);
    expect(deriveIdeaTitle("  \n ")).toBe("");
  });
});

describe("queue-store ideaTitle", () => {
  it("round-trips, cuts to 80, and defaults old commands to empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qit-"));
    const q = new QueueStore(dir);
    q.addCommands(
      "proj",
      [
        { id: "a", title: "A", body: "do a", ideaTitle: "Thêm nút X", sourceRef: "r1" },
        { id: "b", title: "B", body: "do b", ideaTitle: "z".repeat(100) },
      ],
      { hasRepo: true },
    );
    const list = q.list("proj");
    expect(list[0]!.ideaTitle).toBe("Thêm nút X");
    expect(list[1]!.ideaTitle).toHaveLength(80);
    // Simulate an old file lacking the field.
    const file = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).find((e) => e.isFile() && e.name.endsWith(".json"));
    const fp = path.join(file!.parentPath, file!.name);
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    for (const c of data.commands) delete c.ideaTitle;
    fs.writeFileSync(fp, JSON.stringify(data));
    expect(new QueueStore(dir).list("proj").map((c) => c.ideaTitle)).toEqual(["", ""]);
  });
});
