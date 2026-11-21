import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("cmdk dependency", () => {
  it("is declared in devDependencies (1.x) and not in dependencies", () => {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    expect(pkg.devDependencies).toHaveProperty("cmdk");
    expect(String(pkg.devDependencies.cmdk)).toMatch(/^\^?1\./);
    expect(pkg.dependencies ?? {}).not.toHaveProperty("cmdk");
  });

  it("exports Command as a React component", async () => {
    const mod = await import("cmdk");
    expect(mod.Command).toBeDefined();
    const t = typeof mod.Command;
    expect(["function", "object"]).toContain(t);
    if (t === "object") {
      const c = mod.Command as unknown as Record<string, unknown>;
      expect(c.$$typeof !== undefined || c.render !== undefined).toBe(true);
    }
  });
});
