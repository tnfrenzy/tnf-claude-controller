import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StreamParser } from "../../src/core/run/stream-parser.js";
import type { NormalizedEvent } from "../../src/core/run/events.js";
import { isHiddenWhenToolsOff, TOOL_RELATED_TYPES } from "../../ui/src/run/timelineFilter";

const FIX = path.resolve(__dirname, "..", "..", "fixtures");

function parse(file: string) {
  const parser = new StreamParser(file);
  const events: NormalizedEvent[] = [];
  for (const line of fs.readFileSync(path.join(FIX, file), "utf8").split(/\r?\n/)) events.push(...parser.feedLine(line));
  return events;
}

describe("isHiddenWhenToolsOff", () => {
  it("hides tool related types", () => {
    for (const type of ["tool.use", "tool.result", "permission.denied", "agent.progress"]) {
      expect(isHiddenWhenToolsOff({ type })).toBe(true);
    }
  });
  it("keeps other types", () => {
    for (const type of ["text.message", "agent.started", "agent.finished", "agent.verdict", "vcs.commit", "run.result"]) {
      expect(isHiddenWhenToolsOff({ type })).toBe(false);
    }
  });
  it("on a real stream no tool related event type remains once tools are off", () => {
    const events = parse("real-coding.stream.jsonl");
    expect(events.some((e) => e.type === "tool.use")).toBe(true);
    const shown = events.filter((e) => !isHiddenWhenToolsOff(e));
    const types = new Set<string>(TOOL_RELATED_TYPES);
    expect(shown.some((e) => types.has(e.type))).toBe(false);
    expect(shown.length).toBeGreaterThan(0);
    // with tools on nothing is hidden
    expect(events.filter(() => true)).toHaveLength(events.length);
  });
});
