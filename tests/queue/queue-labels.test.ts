import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { buildQueueLabels, QUEUE_LABEL_NAMES, QUEUE_REASON_CODES, QUEUE_STATUS_KEYS } from "../../ui/src/queue/queue-labels.js";

const langs = ["vi", "en"] as const;
const PLACEHOLDERS: Record<string, string[]> = {
  noSelection: [], needTwo: [], notRunnable: ["id"], diffBatch: ["batches"], dependency: ["a", "b"],
  fileOverlap: ["a", "b", "file"], hotspot: ["a", "b", "file"], noSlots: ["n"], ackWarnings: ["id"],
  alreadyRan: [], mergedOrSkipped: [], cancelRunFirst: [],
};

describe("queue labels", () => {
  it("all queue_* keys exist in both languages and are non-empty", () => {
    const viKeys = Object.keys(dicts.vi).filter((k) => k.startsWith("queue_")).sort();
    const enKeys = Object.keys(dicts.en).filter((k) => k.startsWith("queue_")).sort();
    expect(viKeys.length).toBeGreaterThan(40);
    expect(enKeys).toEqual(viKeys);
    for (const l of langs) for (const k of viKeys) expect((dicts[l] as Record<string, string>)[k]!.trim().length, `${l}.${k}`).toBeGreaterThan(0);
  });

  it("buildQueueLabels returns 46 labels, 7 statuses and 12 reasons", () => {
    expect(QUEUE_LABEL_NAMES.length).toBe(46);
    expect(Object.keys(QUEUE_STATUS_KEYS).length).toBe(7);
    expect(QUEUE_REASON_CODES.length).toBe(12);
    for (const l of langs) {
      const lb = buildQueueLabels(dicts[l]) as unknown as Record<string, unknown>;
      for (const n of QUEUE_LABEL_NAMES) expect(String(lb[n]).trim().length, `${l}.${n}`).toBeGreaterThan(0);
      const status = lb.status as Record<string, string>;
      for (const code of Object.keys(QUEUE_STATUS_KEYS)) expect(status[code]!.length, `${l}.status.${code}`).toBeGreaterThan(0);
      const reasons = lb.reasons as Record<string, string>;
      for (const c of QUEUE_REASON_CODES) {
        expect(reasons[c]!.length, `${l}.reason.${c}`).toBeGreaterThan(0);
        expect(reasons[c], `${l}.reason.${c} is not the raw code`).not.toBe(c);
      }
    }
  });

  it("reason templates contain exactly the placeholders queue.ts passes", () => {
    for (const l of langs) {
      const reasons = buildQueueLabels(dicts[l]).reasons;
      for (const c of QUEUE_REASON_CODES) {
        const found = [...new Set([...reasons[c]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
        expect(found, `${l}.${c}`).toEqual([...PLACEHOLDERS[c]!].sort());
      }
    }
  });

  it("vi differs from en for main labels and carries the estimate wording", () => {
    const vi = buildQueueLabels(dicts.vi);
    const en = buildQueueLabels(dicts.en);
    for (const n of ["title", "estimate", "approveRun", "runParallel", "skip", "loadWarning"] as const) expect(vi[n]).not.toBe(en[n]);
    expect(vi.estimate).toBe("Ước tính");
    expect(dicts.vi.queue_estimate_note).toContain("ước tính");
  });
});
