import { describe, expect, it } from "vitest";
import { quotaNoticeText } from "../../ui/src/run/costEstimate.js";

const t = { quota: "Hạn mức", quota_5h: "5 giờ", quota_7d: "7 ngày", quota_run: "Run đang chạy", quota_account: "Toàn tài khoản" };
const rl = { five_hour_pct: 17, seven_day_pct: 40 };

describe("quotaNoticeText", () => {
  it("shows per-run consumption when a run is live", () => {
    const s = quotaNoticeText(rl, [{ created_at: 1, quota_start: 15 }], t);
    expect(s).toContain("2.0%");
    expect(s).toContain("Run đang chạy");
    expect(s).not.toContain("17");
  });
  it("shows account level without a running run", () => {
    const s = quotaNoticeText(rl, [], t);
    expect(s).toContain("Toàn tài khoản");
    expect(s).toContain("17.0%");
    expect(s).toContain("40.0%");
  });
});
