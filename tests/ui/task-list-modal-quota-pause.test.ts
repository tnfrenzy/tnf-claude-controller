import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cancelQueuePause, isQueuePaused } from "../../ui/src/queue/quotaPause.js";
import { QueuePausedNotice } from "../../ui/src/components/run/QueuePausedNotice.js";

const base = { pausedUntil: 5_000_000, pauseReason: "het han muc XYZ", msLeft: 60000, onCancel: () => {} };

describe("isQueuePaused", () => {
  it("true only for a future number", () => {
    expect(isQueuePaused({ pausedUntil: 2000 }, 1000)).toBe(true);
    expect(isQueuePaused({ pausedUntil: null }, 1000)).toBe(false);
    expect(isQueuePaused({}, 1000)).toBe(false);
    expect(isQueuePaused(undefined, 1000)).toBe(false);
    expect(isQueuePaused({ pausedUntil: 500 }, 1000)).toBe(false);
  });
});

describe("cancelQueuePause", () => {
  it("cancels the right run then reloads", async () => {
    const api = { cancelQuotaResume: vi.fn(async () => ({ ok: true })) };
    const reload = vi.fn();
    await cancelQueuePause(api, { pauseRunId: "r9" }, reload);
    expect(api.cancelQuotaResume).toHaveBeenCalledWith("r9");
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("does nothing when pauseRunId null", async () => {
    const api = { cancelQuotaResume: vi.fn() };
    const reload = vi.fn();
    await cancelQueuePause(api, { pauseRunId: null }, reload);
    expect(api.cancelQuotaResume).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("QueuePausedNotice", () => {
  it("shows reason, hint and button with pauseRunId, no raw {time}", () => {
    const html = renderToStaticMarkup(createElement(QueuePausedNotice, { ...base, pauseRunId: "r1" }));
    expect(html).toContain("het han muc XYZ");
    expect(html).toContain("<button");
    expect(html).toContain("0:01:00");
    expect(html).not.toContain("{time}");
    expect(html).toMatch(/dừng chạy cả hàng đợi|stop the whole queue/);
  });
  it("hides button and hint when pauseRunId null", () => {
    const html = renderToStaticMarkup(createElement(QueuePausedNotice, { ...base, pauseRunId: null }));
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/dừng chạy cả hàng đợi|stop the whole queue/);
    expect(html).toContain("het han muc XYZ");
  });
});
