import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatCountdown, startCountdownTimer } from "../../ui/src/quotaCountdown.js";
import { QuotaResumeCountdown, QuotaResumeCountdownView } from "../../ui/src/components/run/QuotaResumeCountdown.js";

function findButton(node: unknown): ReactElement<any> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const f = findButton(c);
      if (f) return f;
    }
    return null;
  }
  const el = node as ReactElement<any>;
  if (el.type === "button") return el;
  return findButton(el.props?.children);
}

describe("QuotaResumeCountdown", () => {
  const base = { resumeAt: 1_000_000, label: "Tiep tuc sau", cancelLabel: "Huy hen" };
  it("renders label, countdown, cancel label", () => {
    const html = renderToStaticMarkup(
      createElement(QuotaResumeCountdownView, { ...base, onCancel: () => {}, msLeft: 3725000 }),
    );
    expect(html).toContain("Tiep tuc sau");
    expect(html).toContain("Huy hen");
    expect(html).toContain("1:02:05");
    expect(html).not.toContain("disabled");
  });
  it("marks button disabled when busy", () => {
    const html = renderToStaticMarkup(
      createElement(QuotaResumeCountdownView, { ...base, onCancel: () => {}, msLeft: 1000, busy: true }),
    );
    expect(html).toContain("disabled");
  });
  it("calls onCancel once on click", () => {
    const onCancel = vi.fn();
    const tree = QuotaResumeCountdownView({ ...base, onCancel, msLeft: 1000 });
    const btn = findButton(tree);
    expect(btn).not.toBeNull();
    btn!.props.onClick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it("stateful component renders", () => {
    const html = renderToStaticMarkup(
      createElement(QuotaResumeCountdown, { ...base, resumeAt: Date.now() - 5, onCancel: () => {} }),
    );
    expect(html).toContain("0:00:00");
  });
});

describe("formatCountdown", () => {
  it("formats H:MM:SS", () => {
    expect(formatCountdown(3725000)).toBe("1:02:05");
    expect(formatCountdown(59999)).toBe("0:00:59");
    expect(formatCountdown(36000000)).toBe("10:00:00");
  });
  it("clamps invalid and non-positive to zero", () => {
    expect(formatCountdown(-5)).toBe("0:00:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00:00");
    expect(formatCountdown(0)).toBe("0:00:00");
    expect(formatCountdown(Infinity)).toBe("0:00:00");
  });
});

describe("startCountdownTimer", () => {
  afterEach(() => vi.useRealTimers());
  it("ticks each second and stops after cleanup", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const stop = startCountdownTimer(onTick);
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
});
