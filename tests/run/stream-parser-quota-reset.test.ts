import { describe, it, expect } from "vitest";
import { StreamParser } from "../../src/core/run/stream-parser.js";

function feed(info: Record<string, unknown>) {
  const parser = new StreamParser("t");
  const line = JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });
  const [ev] = parser.feedLine(line).filter((e) => e.type === "rate.limit");
  return ev as any;
}

describe("rate_limit_event resets_at", () => {
  it("converts seconds to ms and keeps status", () => {
    const ev = feed({ status: "rejected", resetsAt: 1800000000 });
    expect(ev.resets_at).toBe(1800000000000);
    expect(ev.status).toBe("rejected");
  });

  it("keeps ms as is", () => {
    expect(feed({ status: "allowed", resetsAt: 1800000000000 }).resets_at).toBe(1800000000000);
  });

  it("boundary 1e11 is treated as ms, just below as seconds", () => {
    expect(feed({ resetsAt: 1e11 }).resets_at).toBe(1e11);
    expect(feed({ resetsAt: 99999999999 }).resets_at).toBe(99999999999 * 1000);
  });

  it("null when missing", () => {
    const ev = feed({ status: "allowed" });
    expect(ev.resets_at).toBeNull();
    expect(ev.limit_type).toBeNull();
  });

  it("null when string", () => {
    expect(feed({ resetsAt: "1800000000" }).resets_at).toBeNull();
  });

  it("null when zero or negative", () => {
    expect(feed({ resetsAt: 0 }).resets_at).toBeNull();
    expect(feed({ resetsAt: -5 }).resets_at).toBeNull();
  });
});

describe("rate_limit_event limit_type", () => {
  it("keeps string", () => {
    expect(feed({ rateLimitType: "five_hour" }).limit_type).toBe("five_hour");
  });

  it("null when not a string or empty", () => {
    expect(feed({ rateLimitType: 5 }).limit_type).toBeNull();
    expect(feed({ rateLimitType: {} }).limit_type).toBeNull();
    expect(feed({ rateLimitType: "" }).limit_type).toBeNull();
  });
});
