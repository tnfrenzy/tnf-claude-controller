// Pure schedule spec parser. No clock access, no I/O.

export type ScheduleSpec = (
  | { kind: "interval"; everyMinutes: number }
  | { kind: "daily"; times: number[] }
  | { kind: "weekly"; days: number[]; times: number[] }
  | { kind: "monthly"; dayOfMonth: number; times: number[] }
) & {
  quiet?: { startMinute: number; endMinute: number };
};

export type ParseResult = { ok: true; spec: ScheduleSpec } | { ok: false; error: string };

function fail(error: string): ParseResult {
  return { ok: false, error };
}

// Parses "HH:MM" (24h) into minutes since 00:00, or null when invalid.
function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Weekday codes, index = getUTCDay() of the local date.
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Parses "08:30,17:00" into sorted unique minutes, or a failure result.
function parseTimeList(list: string): number[] | ParseResult {
  if (list === "") return fail("Thiếu danh sách giờ sau 'at'.");
  const times: number[] = [];
  for (const token of list.split(",")) {
    const minute = parseClock(token);
    if (minute === null) return fail(`Giờ không hợp lệ: '${token}' (cần HH:MM trong 00:00-23:59).`);
    if (times.includes(minute)) return fail(`Giờ bị trùng: '${token}'.`);
    times.push(minute);
  }
  times.sort((a, b) => a - b);
  return times;
}

const MIN_MS = 60000;
const DAY_MS = 86400000;

function validOffset(o: number): boolean {
  return Number.isInteger(o) && o >= -720 && o <= 840;
}

// Milliseconds since local midnight (floor-mod, works for negative epochs).
function msOfLocalDay(nowMs: number, offset: number): number {
  const local = nowMs + offset * MIN_MS;
  return ((local % DAY_MS) + DAY_MS) % DAY_MS;
}

// True when nowMs falls inside the quiet window [start, end) (may cross midnight).
export function isQuiet(spec: ScheduleSpec, nowMs: number, utcOffsetMinutes = 0): boolean {
  if (!spec.quiet || !Number.isFinite(nowMs) || !validOffset(utcOffsetMinutes)) return false;
  const ms = msOfLocalDay(nowMs, utcOffsetMinutes);
  const start = spec.quiet.startMinute * MIN_MS;
  const end = spec.quiet.endMinute * MIN_MS;
  return start < end ? ms >= start && ms < end : ms >= start || ms < end;
}

type CalendarSpec = Extract<ScheduleSpec, { kind: "weekly" } | { kind: "monthly" }>;

// Latest scheduled instant (UTC ms) <= nowMs for weekly/monthly specs, or null.
// Walks back day by day in local time (nowMs + offset); short months clamp to the last day.
function latestCalendarMarker(spec: CalendarSpec, nowMs: number, offset: number): number | null {
  if (spec.times.length === 0) return null;
  const offsetMs = offset * MIN_MS;
  const localNow = nowMs + offsetMs;
  const localToday = localNow - msOfLocalDay(nowMs, offset);
  const maxDays = spec.kind === "weekly" ? 8 : 62;
  const timesDesc = [...spec.times].sort((a, b) => b - a);
  for (let i = 0; i <= maxDays; i++) {
    const dayStart = localToday - i * DAY_MS;
    const d = new Date(dayStart);
    let match: boolean;
    if (spec.kind === "weekly") {
      match = spec.days.includes(d.getUTCDay());
    } else {
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      match = d.getUTCDate() === Math.min(spec.dayOfMonth, lastDay);
    }
    if (!match) continue;
    for (const t of timesDesc) {
      const at = dayStart + t * MIN_MS;
      if (at <= localNow) return at - offsetMs;
    }
  }
  return null;
}

// Pure due check: all time comes from parameters. Invalid input yields false.
export function isDue(
  spec: ScheduleSpec,
  nowMs: number,
  lastRunAt: number | null,
  utcOffsetMinutes = 0,
): boolean {
  if (!Number.isFinite(nowMs) || !validOffset(utcOffsetMinutes)) return false;
  if (lastRunAt !== null && (!Number.isFinite(lastRunAt) || lastRunAt > nowMs)) return false;
  if (isQuiet(spec, nowMs, utcOffsetMinutes)) return false;
  if (spec.kind === "interval") {
    return lastRunAt === null || nowMs - lastRunAt >= spec.everyMinutes * MIN_MS;
  }
  if (spec.kind === "weekly" || spec.kind === "monthly") {
    const marker = latestCalendarMarker(spec, nowMs, utcOffsetMinutes);
    if (marker === null) return false;
    return lastRunAt === null || lastRunAt < marker;
  }
  if (spec.times.length === 0) return false;
  const todayStart = nowMs - msOfLocalDay(nowMs, utcOffsetMinutes);
  let marker: number | null = null;
  for (const t of spec.times) {
    const at = todayStart + t * MIN_MS;
    if (at <= nowMs && (marker === null || at > marker)) marker = at;
  }
  if (marker === null) {
    const last = Math.max(...spec.times);
    marker = todayStart - DAY_MS + last * MIN_MS;
  }
  return lastRunAt === null || lastRunAt < marker;
}

export function parseSchedule(input: string): ParseResult {
  if (typeof input !== "string") return fail("Lịch phải là một chuỗi văn bản.");
  // Normalize: lowercase, collapse spaces, allow spaces around commas and dashes.
  const text = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ ?, ?/g, ",")
    .replace(/ ?- ?/g, "-");
  if (text === "") return fail("Lịch đang trống.");

  const quietIdx = text.indexOf(" quiet ");
  const mainPart = quietIdx >= 0 ? text.slice(0, quietIdx) : text;
  const quietPart = quietIdx >= 0 ? text.slice(quietIdx + " quiet ".length) : null;

  let base: ScheduleSpec;
  const every = /^every (\d+)m$/.exec(mainPart);
  if (every) {
    const n = Number(every[1]);
    if (!Number.isInteger(n) || n < 1 || n > 1440) {
      return fail("Chu kỳ phải từ 1 đến 1440 phút.");
    }
    base = { kind: "interval", everyMinutes: n };
  } else if (mainPart.startsWith("at ")) {
    const parsed = parseTimeList(mainPart.slice(3));
    if (!Array.isArray(parsed)) return parsed;
    base = { kind: "daily", times: parsed };
  } else if (mainPart.startsWith("weekly ") || mainPart === "weekly") {
    const rest = mainPart.slice("weekly".length).trim();
    const atIdx = rest.indexOf(" at ");
    if (atIdx < 0) return fail("Lịch tuần thiếu 'at' và giờ (dạng 'weekly mon,thu at 08:30').");
    const dayList = rest.slice(0, atIdx);
    const days: number[] = [];
    for (const token of dayList.split(",")) {
      const d = WEEKDAYS.indexOf(token);
      if (d < 0) return fail(`Mã thứ không hợp lệ: '${token}' (dùng sun, mon, tue, wed, thu, fri, sat).`);
      if (days.includes(d)) return fail(`Thứ bị trùng: '${token}'.`);
      days.push(d);
    }
    days.sort((a, b) => a - b);
    const parsed = parseTimeList(rest.slice(atIdx + " at ".length));
    if (!Array.isArray(parsed)) return parsed;
    base = { kind: "weekly", days, times: parsed };
  } else if (mainPart.startsWith("monthly ") || mainPart === "monthly") {
    const rest = mainPart.slice("monthly".length).trim();
    const atIdx = rest.indexOf(" at ");
    if (atIdx < 0) return fail("Lịch tháng thiếu 'at' và giờ (dạng 'monthly 15 at 08:30').");
    const dayText = rest.slice(0, atIdx);
    const n = /^\d{1,2}$/.test(dayText) ? Number(dayText) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 31) {
      return fail(`Ngày trong tháng phải từ 1 đến 31: '${dayText}'.`);
    }
    const parsed = parseTimeList(rest.slice(atIdx + " at ".length));
    if (!Array.isArray(parsed)) return parsed;
    base = { kind: "monthly", dayOfMonth: n, times: parsed };
  } else {
    return fail(
      "Cú pháp lịch không hợp lệ. Dùng 'every 15m', 'at 08:30', 'weekly mon,thu at 08:30' hoặc 'monthly 15 at 08:30'.",
    );
  }

  if (quietPart === null) {
    if (text.endsWith(" quiet") || /(^| )quiet( |$)/.test(mainPart)) {
      return fail("Khung yên lặng thiếu giờ (dạng 'quiet 22:00-06:00').");
    }
    return { ok: true, spec: base };
  }

  const q = /^([^-]+)-([^-]+)$/.exec(quietPart);
  if (!q) return fail("Khung yên lặng không hợp lệ (dạng 'quiet 22:00-06:00').");
  const startMinute = parseClock(q[1] ?? "");
  const endMinute = parseClock(q[2] ?? "");
  if (startMinute === null || endMinute === null) {
    return fail("Giờ trong khung yên lặng không hợp lệ (cần HH:MM trong 00:00-23:59).");
  }
  if (startMinute === endMinute) return fail("Khung yên lặng có giờ bắt đầu trùng giờ kết thúc.");
  return { ok: true, spec: { ...base, quiet: { startMinute, endMinute } } };
}
