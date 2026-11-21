import type { PopupId } from "./lib/popup";
import type { PaletteAction } from "./palette";

export function runPaletteAction(
  a: PaletteAction,
  h: { navigate: (hash: string) => void; pickEnv: (name: string) => void; onOpen: (id: PopupId) => void },
): void {
  switch (a.kind) {
    case "hash":
      h.navigate(a.hash);
      break;
    case "env":
      h.pickEnv(a.name);
      break;
    case "open":
      h.onOpen(a.id);
      break;
  }
}
