import { describe, expect, it } from "vitest";
import { attachKey, batchFiles, stageAttachments } from "../../ui/src/skills/skillUpload";

function file(name: string, size: number): File {
  return { name, size } as unknown as File;
}

describe("stageAttachments", () => {
  it("makes one stage per pair and side", async () => {
    const plan = [
      { pair: "train-1", side: "input" as const, names: ["a.txt"] },
      { pair: "train-1", side: "expected" as const, names: ["b.txt"] },
      { pair: "holdout-1", side: "input" as const, names: ["c.txt"] },
      { pair: "holdout-1", side: "expected" as const, names: ["d.txt"] },
    ];
    const map: Record<string, File[]> = {};
    for (const p of plan) map[attachKey(p.pair, p.side)] = [file(p.names[0], 10)];
    let n = 0;
    const out = await stageAttachments(plan, map, async () => ({ stageId: `s${++n}` }));
    expect(out).toEqual([
      { pair: "train-1", side: "input", stageId: "s1", names: ["a.txt"] },
      { pair: "train-1", side: "expected", stageId: "s2", names: ["b.txt"] },
      { pair: "holdout-1", side: "input", stageId: "s3", names: ["c.txt"] },
      { pair: "holdout-1", side: "expected", stageId: "s4", names: ["d.txt"] },
    ]);
  });

  it("keeps exactly 5 MB in one stage and splits above it", () => {
    const MB = 1024 * 1024;
    const five = Array.from({ length: 5 }, (_, i) => file(`f${i}.txt`, MB));
    expect(batchFiles(five)).toHaveLength(1);
    expect(batchFiles([...five, file("g.txt", 1)])).toHaveLength(2);
  });

  it("splits more than 20 files", () => {
    const many = Array.from({ length: 21 }, (_, i) => file(`f${i}.txt`, 1));
    expect(batchFiles(many).map((b) => b.length)).toEqual([20, 1]);
  });

  it("multiple batches give multiple entries for the same pair and side", async () => {
    const MB = 1024 * 1024;
    const files = [...Array.from({ length: 5 }, (_, i) => file(`f${i}.txt`, MB)), file("g.txt", 1)];
    const plan = [{ pair: "train-1", side: "input" as const, names: files.map((f) => f.name) }];
    let n = 0;
    const out = await stageAttachments(plan, { [attachKey("train-1", "input")]: files }, async () => ({ stageId: `s${++n}` }));
    expect(out).toHaveLength(2);
    expect(out[1].names).toEqual(["g.txt"]);
  });

  it("throws a Vietnamese error and stops calling later stages", async () => {
    const plan = [
      { pair: "train-1", side: "input" as const, names: ["a.txt"] },
      { pair: "train-1", side: "expected" as const, names: ["b.txt"] },
    ];
    const map = { [attachKey("train-1", "input")]: [file("a.txt", 1)], [attachKey("train-1", "expected")]: [file("b.txt", 1)] };
    let calls = 0;
    await expect(
      stageAttachments(plan, map, async () => {
        calls++;
        throw new Error("mạng lỗi");
      }),
    ).rejects.toThrow(/Không tải được tệp đính kèm/);
    expect(calls).toBe(1);
  });
});
