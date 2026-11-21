import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LESSONS_MAX_BYTES, appendLesson, lessonForFailure, lessonsPath, readLessons } from "../../src/core/ideas/lessons.js";

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-lessons-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("lessons.md", () => {
  it("writes a dated single line in its own file (not memory.md)", () => {
    expect(appendLesson(dir, "p", "Lệnh A lỗi:\nthiếu export", new Date("2026-11-11T08:00:00Z"))).toBe(true);
    expect(lessonsPath(dir, "p")).toMatch(/projects[\\/]p[\\/]lessons\.md$/);
    expect(readLessons(dir, "p")).toBe("- 2026-11-11: Lệnh A lỗi: thiếu export");
    expect(fs.existsSync(path.join(dir, "projects", "p", "memory.md"))).toBe(false);
  });

  it("a repeated lesson moves to the end instead of being duplicated", () => {
    appendLesson(dir, "p", "một", new Date("2026-11-01T00:00:00Z"));
    appendLesson(dir, "p", "hai", new Date("2026-11-02T00:00:00Z"));
    appendLesson(dir, "p", "Một", new Date("2026-11-03T00:00:00Z"));
    expect(readLessons(dir, "p").split("\n")).toEqual(["- 2026-11-02: hai", "- 2026-11-03: Một"]);
  });

  it("keeps only the newest lines within about 4 KB; long lines are cut", () => {
    for (let i = 0; i < 100; i++) appendLesson(dir, "p", `bài học số ${i} ${"x".repeat(80)}`);
    const size = fs.statSync(lessonsPath(dir, "p")).size;
    expect(size).toBeLessThanOrEqual(LESSONS_MAX_BYTES);
    const lines = readLessons(dir, "p").split("\n");
    expect(lines.at(-1)).toContain("bài học số 99");
    expect(lines[0]).not.toContain("bài học số 0 ");
    appendLesson(dir, "q", "y".repeat(1000));
    expect(readLessons(dir, "q").length).toBeLessThan(320);
  });

  it("refuses unsafe project names and empty text; reading a missing file gives empty", () => {
    expect(appendLesson(dir, "../x", "a")).toBe(false);
    expect(appendLesson(dir, "p", "   ")).toBe(false);
    expect(readLessons(dir, "nope")).toBe("");
  });

  it("failure lesson names the command, idea, reason, files and verify", () => {
    const t = lessonForFailure({ id: "ui", title: "Nút", ideaTitle: "Báo cáo", files: ["a.ts"], verify: "npm test" }, "không có commit");
    expect(t).toBe('Lệnh "Nút" (ui, ý tưởng "Báo cáo") lỗi: không có commit. Tệp: a.ts. verify: npm test.');
  });
});
