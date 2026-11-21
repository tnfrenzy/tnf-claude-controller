import { roleLabel } from "../../i18n";

/** Verdict badge (critic: APPROVED / APPROVED_WITH_CONCERNS / NEEDS_REVISION / BLOCKED; qa: PASS / FAIL). */
export type VerdictTone = "ok" | "warn" | "err" | "neutral";

export function verdictTone(v: string): VerdictTone {
  const u = v.toUpperCase();
  if (u === "APPROVED" || u === "PASS") return "ok";
  if (u === "APPROVED_WITH_CONCERNS" || u === "PASS_ENV") return "warn";
  if (u === "NEEDS_REVISION" || u === "BLOCKED" || u === "FAIL") return "err";
  return "neutral";
}

const LABEL_VI: Record<string, string> = {
  APPROVED: "Duyệt",
  APPROVED_WITH_CONCERNS: "Duyệt có lưu ý",
  NEEDS_REVISION: "Cần sửa",
  BLOCKED: "Chặn",
  PASS: "Đạt",
  PASS_ENV: "Đạt (lỗi môi trường đã biết)",
  FAIL: "Không đạt",
};

export function verdictLabel(v: string, lang: string): string {
  const u = v.toUpperCase();
  return lang === "vi" && LABEL_VI[u] ? `${LABEL_VI[u]} · ${u}` : u;
}

export function VerdictBadge({ verdict, lang = "vi", role, note }: { verdict: string; lang?: string; role?: string; note?: string }) {
  const tone = verdictTone(verdict);
  const icon = tone === "ok" ? "✔" : tone === "warn" ? "⚠" : tone === "err" ? "✖" : "•";
  const base = role ? `${roleLabel(role, lang === "en" ? "en" : "vi")}: ${verdict}` : verdict;
  return (
    <span className={`verdict ${tone}`} title={note ? `${base} - ${note}` : base}>
      {icon} {verdictLabel(verdict, lang)}
    </span>
  );
}
