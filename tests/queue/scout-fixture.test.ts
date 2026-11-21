import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseScoutProposals } from "../../src/core/ideas/scout-proposals";

describe("scout offline fixture", () => {
  it("result text parses into at least one valid proposal", () => {
    const file = path.join(__dirname, "..", "..", "fixtures", "scout-proposals.stream.jsonl");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as { type: string; result?: string });
    const result = events.find((e) => e.type === "result");
    expect(typeof result?.result).toBe("string");
    const parsed = parseScoutProposals(result!.result as string);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.proposals.length).toBeGreaterThanOrEqual(1);
  });
});
