import { pick } from "../lib/lang";
/** Pure helpers to build and read back weekly/monthly schedule strings (see src/core/queue/schedule-spec.ts). */

export type ScheduleForm = {
  mode: "weekly" | "monthly";
  days: number[];
  dayOfMonth: number;
  time: string;
  quiet: string;
};

export const WEEKDAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const QUIET_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function buildSchedule(form: ScheduleForm): { ok: true; text: string } | { ok: false; error: string } {
  const time = form.time.trim();
  if (!TIME_RE.test(time)) return { ok: false, error: pick("Giờ chạy phải có dạng HH:MM (ví dụ 08:30).", "Run time must look like HH:MM (for example 08:30).") };
  const quiet = form.quiet.trim();
  if (quiet !== "" && !QUIET_RE.test(quiet)) return { ok: false, error: pick("Giờ yên lặng phải trống hoặc có dạng HH:MM-HH:MM.", "Quiet hours must be empty or look like HH:MM-HH:MM.") };
  let head: string;
  if (form.mode === "weekly") {
    const days = [...new Set(form.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (days.length === 0) return { ok: false, error: pick("Chọn ít nhất một thứ trong tuần.", "Pick at least one day of the week.") };
    head = `weekly ${days.map((d) => WEEKDAY_CODES[d]).join(",")}`;
  } else {
    const n = form.dayOfMonth;
    if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, error: pick("Ngày trong tháng phải từ 1 đến 31.", "Day of month must be 1 to 31.") };
    head = `monthly ${n}`;
  }
  const text = `${head} at ${time}${quiet ? ` quiet ${quiet}` : ""}`;
  return { ok: true, text };
}

export function parseScheduleForm(text: string | null): ScheduleForm | null {
  if (!text) return null;
  const s = text.trim().replace(/\s+/g, " ").toLowerCase();
  const m = /^(weekly|monthly) (.+?) at ([0-9:]+)(?:,[0-9:,]+)?(?: quiet (\S+))?$/.exec(s);
  if (!m) return null;
  const mode = m[1];
  const spec = m[2] ?? "";
  const time = m[3] ?? "";
  const quiet = m[4];
  if (!TIME_RE.test(time)) return null;
  if (mode === "weekly") {
    const days: number[] = [];
    for (const part of spec.split(",").map((x) => x.trim())) {
      const i = (WEEKDAY_CODES as readonly string[]).indexOf(part);
      if (i < 0) return null;
      if (!days.includes(i)) days.push(i);
    }
    days.sort((a, b) => a - b);
    return { mode: "weekly", days, dayOfMonth: 1, time, quiet: quiet ?? "" };
  }
  const n = Number(spec);
  if (!Number.isInteger(n) || n < 1 || n > 31) return null;
  return { mode: "monthly", days: [], dayOfMonth: n, time, quiet: quiet ?? "" };
}
