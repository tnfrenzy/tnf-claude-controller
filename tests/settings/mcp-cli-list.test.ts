import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_GRANTS, planMcp } from "../../src/core/run/grants.js";
import { runClaudeMcpList } from "../../src/core/mcp/mcp-cli.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function script(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcplist-"));
  dirs.push(dir);
  const f = path.join(dir, "fake.mjs");
  fs.writeFileSync(f, body, "utf8");
  return f;
}

describe("runClaudeMcpList", () => {
  it("drains a large stderr and resolves with the parsed stdout on close", async () => {
    const f = script([
      'process.stderr.write("x".repeat(500000));',
      'process.stdout.write("srv-a: npx a - √ Connected\\n");',
      'process.stdout.write("srv-b: https://e.com (HTTP) - ! Needs authentication\\n");',
    ].join("\n"));
    const items = await runClaudeMcpList(process.execPath, process.env, 30_000, [f]);
    expect(items.map((i) => [i.name, i.status])).toEqual([["srv-a", "connected"], ["srv-b", "needs_auth"]]);
  });
  it("rejects with the stderr tail when nothing was printed", async () => {
    const f = script('process.stderr.write("boom reason"); process.exit(1);');
    await expect(runClaudeMcpList(process.execPath, process.env, 30_000, [f])).rejects.toThrow(/boom reason/);
  });
});

describe("planMcp with CLI connectors", () => {
  it("denies a non-granted cli server as a whole when another cli server is granted", () => {
    const a = { id: "plugin:a:x", name: "a", kind: "cli" as const, enabled: true };
    const b = { id: "plugin:b:y", name: "b", kind: "cli" as const, enabled: true };
    const plan = planMcp({ ...DEFAULT_GRANTS, mcp: { [a.id]: "full" as const } }, [a, b]);
    expect(plan.allowed).toEqual(["mcp__plugin_a_x"]);
    expect(plan.disallowed).toContain("mcp__plugin_b_y");
    expect(plan.strict).toBe(false);
  });
});
