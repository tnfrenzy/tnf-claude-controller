// Fake sessions for the dev / demo mode of the 3D workshop popup (no API needed).
import type { Workshop3DSession } from "../types";

/** Every state of the session machine, in the order a real session goes through them. */
export const W3D_DEMO_STATES = [
  "intake", "awaiting_user", "art", "planning", "modeling", "building", "materials", "rendering", "reviewing", "optimizing", "presenting", "done",
  "paused", "stopped", "failed", "waiting_quota",
] as const;

export function mockWorkshop3DSession(state: string, issues = 0): Workshop3DSession {
  return {
    brief: { title: "Cabin thang máy 630 kg" },
    snapshot: {
      state,
      round: Math.max(1, W3D_DEMO_STATES.indexOf(state as (typeof W3D_DEMO_STATES)[number]) < 6 ? 1 : 2),
      fixRounds: issues > 0 ? 1 : 0,
      issues: Array.from({ length: issues }, (_, i) => ({ id: `i${i}`, text: `Lỗi ${i + 1}` })),
      questions: state === "awaiting_user" ? ["Kích thước cabin là bao nhiêu?", "Vật liệu vách ưu tiên?", "Cần bản AR không?"] : [],
      costUsd: 0.42,
      note: state === "waiting_quota" ? "Hết hạn mức tạm thời, sẽ tự chạy lại." : "",
      ...(state === "failed" ? { error: "Bước dựng GLB báo lỗi (dữ liệu giả)." } : {}),
    },
    files: [],
    renders: [],
  };
}
