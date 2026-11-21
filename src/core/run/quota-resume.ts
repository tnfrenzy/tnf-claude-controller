// Ý tưởng chờ tới mốc reset hạn mức rồi tiếp tục lấy từ claude-auto-resume (MIT); không chép mã, mã TypeScript tự viết.

export const QUOTA_RESUME_MARK = "[Tự tiếp tục sau hạn mức lần";
const AUTO_RESUME_MARK_LEGACY = "[Tự động tiếp tục lần";

const MAX_AHEAD_MS = 8 * 86400000;
const FULL_PCT = 95;

const QUOTA_RE =
  /hit your limit|usage limit|limit reached|rate.?limit|quota (exceeded|reached)|hết hạn mức|hạn mức (đã )?hết/i;

export function normalizeEpochMs(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return v < 1e11 ? v * 1000 : v;
}

export function isQuotaStopError(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  let text: string;
  if (typeof error === "string") text = error;
  else if (error instanceof Error) text = error.message;
  else {
    try {
      text = String(error);
    } catch {
      return false;
    }
  }
  if (!text) return false;
  return QUOTA_RE.test(text.normalize("NFC"));
}

export interface ResumeSnapshot {
  five_hour_pct: number | null;
  seven_day_pct: number | null;
  five_hour_resets_at: number | null;
  seven_day_resets_at: number | null;
}

export function computeResumeAt(input: {
  eventResetsAt: number | null;
  snapshot: ResumeSnapshot | null;
  now: number;
  marginSec: number;
  fallbackMin: number;
}): { resumeAt: number; source: "event" | "snapshot" | "fallback" } {
  const { now, marginSec, fallbackMin } = input;
  const valid = (v: unknown): number | null => {
    const ms = normalizeEpochMs(v);
    return ms !== null && ms > now && ms <= now + MAX_AHEAD_MS ? ms : null;
  };
  const marginMs = marginSec * 1000;

  const ev = valid(input.eventResetsAt);
  if (ev !== null) return { resumeAt: ev + marginMs, source: "event" };

  const snap = input.snapshot;
  if (snap) {
    const pairs: Array<[number | null, number | null]> = [
      [snap.five_hour_pct, snap.five_hour_resets_at],
      [snap.seven_day_pct, snap.seven_day_resets_at],
    ];
    let best: number | null = null;
    for (const [pct, at] of pairs) {
      if (typeof pct !== "number" || !(pct >= FULL_PCT)) continue;
      const ms = valid(at);
      if (ms !== null && (best === null || ms > best)) best = ms;
    }
    if (best !== null) return { resumeAt: best + marginMs, source: "snapshot" };
  }

  return { resumeAt: now + fallbackMin * 60000, source: "fallback" };
}

export function quotaResumePrompt(attempt: number, max: number): string {
  return [
    `${QUOTA_RESUME_MARK} ${attempt}/${max}]`,
    "Hạn mức đã được làm mới. Hãy chạy `git status` và `git log` trong thư mục làm việc để xem phần đã xong.",
    "Sau đó làm tiếp phần còn lại của yêu cầu gốc, không làm lại phần đã xong, và commit ngay khi xong.",
  ].join("\n");
}

export function isResumePrompt(prompt: unknown): boolean {
  if (typeof prompt !== "string") return false;
  const t = prompt.trim();
  return t.startsWith(QUOTA_RESUME_MARK) || t.startsWith(AUTO_RESUME_MARK_LEGACY);
}
