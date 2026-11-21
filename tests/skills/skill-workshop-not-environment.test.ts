import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("skill training is not an environment", () => {
  it("server hides the skill-workshop project from /api/projects", () => {
    const src = fs.readFileSync("src/server/http.ts", "utf8");
    expect(src).toContain("x.name !== SKILL_WORKSHOP_PROJECT");
  });
});
