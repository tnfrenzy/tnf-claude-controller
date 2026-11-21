export type ViewMode = "city" | "office";

export const DEFAULT_VIEW: ViewMode = "city";

export type ViewAction = { type: "toggle" } | { type: "set"; view: string };

export function parseView(raw: string): ViewMode {
  return raw === "office" ? "office" : "city";
}

export function toggleView(v: ViewMode): ViewMode {
  return v === "city" ? "office" : "city";
}

export function viewReducer(state: ViewMode, action: ViewAction): ViewMode {
  switch (action.type) {
    case "toggle":
      return toggleView(state);
    case "set":
      return action.view === "city" || action.view === "office" ? action.view : state;
    default:
      return state;
  }
}
