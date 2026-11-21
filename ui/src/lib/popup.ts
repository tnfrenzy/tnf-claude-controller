export type PopupId = "cmd" | "runs" | "run" | "history" | "library" | "settings" | "addFloor" | "floor" | "addSkillFloor" | "skillFloor" | "skillOverview" | "addApiFloor" | "apiFloor" | "design3d" | "design3dFloor" | "workshop3d" | "videostudio" | "videostudioFloor";

export interface PopupPayload {
  runId?: string;
  /** Empty string = default floor. */
  projectName?: string;
  floorNo?: number;
  [key: string]: unknown;
}

export interface PopupState {
  open: PopupId | null;
  payload?: PopupPayload;
}

export type PopupAction =
  | { type: "open"; id: PopupId; payload?: PopupPayload }
  | { type: "close" }
  | { type: "toggle"; id: PopupId; payload?: PopupPayload };

export const initialPopupState: PopupState = { open: null };

function opened(id: PopupId, payload?: PopupPayload): PopupState {
  return payload ? { open: id, payload } : { open: id };
}

/** One popup at a time: opening replaces whatever is open. */
export function popupReducer(state: PopupState, action: PopupAction): PopupState {
  switch (action.type) {
    case "open":
      return opened(action.id, action.payload);
    case "close":
      return state.open === null ? state : initialPopupState;
    case "toggle":
      return state.open === action.id ? initialPopupState : opened(action.id, action.payload);
    default:
      return state;
  }
}

const POPUP_IDS: readonly PopupId[] = ["cmd", "runs", "run", "history", "library", "settings", "addFloor", "floor", "addSkillFloor", "skillFloor", "skillOverview", "addApiFloor", "apiFloor", "design3d", "design3dFloor", "workshop3d", "videostudio", "videostudioFloor"];

/**
 * Deep links: #/runs/<id>, #/history, #/library, #/w3d/<slug>. '#/office' is the main screen (no popup).
 * '#/cmd', empty hash and '#token=...' open nothing (api.ts sets '#/cmd' after reading the token).
 */
export function popupFromHash(hash: string): PopupState | null {
  const h = (hash ?? "").replace(/^#/, "");
  if (!h || h.startsWith("token=")) return null;
  const [pathPart = ""] = h.split("?", 2);
  const parts = pathPart.replace(/^\/+/, "").split("/").filter(Boolean);
  const head = parts[0];
  if (head === "runs" && parts[1]) return opened("run", { runId: decodeURIComponent(parts[1]) });
  if (head === "history") return opened("history");
  if (head === "library") return opened("library");
  // A 3D workshop session room: #/w3d/<slug>.
  if (head === "w3d" && parts[1]) return opened("workshop3d", { slug: decodeURIComponent(parts[1]) });
  // "Tạo hàng loạt" (batch library) of the 3D workshop window, no session needed: #/w3d-batch.
  if (head === "w3d-batch") return opened("workshop3d", { tab: "batch" });
  // Dev / demo room of the 3D workshop: every state with fake data, no API needed. Dev build only (vite dev / vitest).
  if (head === "w3d-demo" && import.meta.env.DEV) return opened("workshop3d", { demo: true });
  // "#/office" is the main screen itself (no popup).
  return null;
}

export function isPopupId(v: string): v is PopupId {
  return (POPUP_IDS as readonly string[]).includes(v);
}
