import { describe, expect, it } from "vitest";
import { foldPrompt } from "../../src/core/run/prompt-file.js";

describe("foldPrompt", () => {
  const long = ["Sửa vật liệu cho cửa kính.", "Chỉ góc trước.", "", "Chỉ dẫn:", "x".repeat(1200)].join("\n");
  it("keeps the first two lines and points to the guidance file", () => {
    const r = foldPrompt(long, "C:/runs/a/instructions-a.md");
    expect(r.prompt.split("\n")[0]).toBe("Sửa vật liệu cho cửa kính.");
    expect(r.prompt).toContain("Chỉ góc trước.");
    expect(r.prompt).toContain("C:/runs/a/instructions-a.md");
    expect(r.prompt.length).toBeLessThan(500);
    expect(r.file).toBe(long);
  });
  it("leaves short prompts and prompts without a tail alone", () => {
    expect(foldPrompt("Làm việc A.", "f.md")).toEqual({ prompt: "Làm việc A.", file: null });
    const two = `${"a".repeat(500)}\n${"b".repeat(500)}`;
    expect(foldPrompt(two, "f.md").file).toBeNull();
  });
});
