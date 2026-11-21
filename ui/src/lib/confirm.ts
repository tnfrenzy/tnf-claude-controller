/** Pure two-step confirmation: idle -> confirm -> execute (cancel returns to idle). */
export type ConfirmState = "idle" | "confirm" | "execute";
export type ConfirmAction = "ask" | "confirm" | "cancel" | "done";

export function nextConfirmStep(state: ConfirmState, action: ConfirmAction): ConfirmState {
  if (action === "cancel" || action === "done") return "idle";
  if (action === "ask") return state === "idle" ? "confirm" : state;
  if (action === "confirm") return state === "confirm" ? "execute" : state;
  return state;
}
