import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildQueuePreamble } from "../../src/core/queue/queue-preamble.js";

const repoRoot = path.resolve(__dirname, "..", "..");
const templateFile = path.join(repoRoot, "config", "queue-preamble.md");

function cfg(list?: unknown, root = repoRoot): any {
  const coding: Record<string, unknown> = {};
  if (list !== undefined) coding.knownEnvFailures = list;
  return { repoRoot: root, defaults: { coding } };
}

describe("buildQueuePreamble", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qpre-"));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("replaces the placeholder with bullet lines, matching the template", () => {
    const out = buildQueuePreamble(cfg(["tests/cli.test.ts (2 test)", "node-modules.test.ts:101"]));
    const tpl = fs.readFileSync(templateFile, "utf8").replace(/\r\n/g, "\n");
    const expected = tpl.replace(
      "{{knownEnvFailures}}",
      "- tests/cli.test.ts (2 test)\n- node-modules.test.ts:101",
    );
    expect(out).toBe(expected);
    expect(out).toContain("CLAUDE.md");
  });

  it("writes (không có) when the list is missing or empty", () => {
    for (const c of [cfg(), cfg([])]) {
      const out = buildQueuePreamble(c);
      expect(out).toContain("(không có)");
      expect(out.trimEnd().endsWith("(không có)")).toBe(true);
    }
  });

  it("leaves no placeholder behind", () => {
    expect(buildQueuePreamble(cfg(["a"]))).not.toContain("{{");
    expect(buildQueuePreamble(cfg())).not.toContain("{{");
  });

  it("is a standalone block that does not mix into a body", () => {
    const body = "Làm việc X";
    const pre = buildQueuePreamble(cfg(["a"]));
    expect(pre).not.toContain(body);
    const full = body + "\n\n" + pre;
    expect(full.startsWith(body)).toBe(true);
    expect(full.endsWith(pre)).toBe(true);
  });

  it("accepts a custom template path", () => {
    const f = path.join(tmp, "t.md");
    fs.writeFileSync(f, "X\r\n{{knownEnvFailures}}\r\n");
    expect(buildQueuePreamble(cfg(["z"]), f)).toBe("X\n- z\n");
  });

  it("throws Vietnamese errors for a missing template or placeholder", () => {
    expect(() => buildQueuePreamble(cfg(), path.join(tmp, "none.md"))).toThrow(/Không đọc được mẫu/);
    const f = path.join(tmp, "bad.md");
    fs.writeFileSync(f, "no placeholder here");
    expect(() => buildQueuePreamble(cfg(), f)).toThrow(/thiếu ô thay thế/);
  });
});
