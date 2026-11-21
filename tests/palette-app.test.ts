import { describe, expect, it, vi } from "vitest";
import { runPaletteAction } from "../ui/src/paletteActions.js";

function handlers() {
  return { navigate: vi.fn(), pickEnv: vi.fn(), onOpen: vi.fn() };
}

describe("runPaletteAction", () => {
  it("hash calls navigate only", () => {
    const h = handlers();
    runPaletteAction({ kind: "hash", hash: "#/runs/abc" }, h);
    expect(h.navigate).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalledWith("#/runs/abc");
    expect(h.pickEnv).not.toHaveBeenCalled();
    expect(h.onOpen).not.toHaveBeenCalled();
  });

  it("env calls pickEnv only", () => {
    const h = handlers();
    runPaletteAction({ kind: "env", name: "controller" }, h);
    expect(h.pickEnv).toHaveBeenCalledTimes(1);
    expect(h.pickEnv).toHaveBeenCalledWith("controller");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.onOpen).not.toHaveBeenCalled();
  });

  it("open calls onOpen only", () => {
    const h = handlers();
    runPaletteAction({ kind: "open", id: "settings" }, h);
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onOpen).toHaveBeenCalledWith("settings");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.pickEnv).not.toHaveBeenCalled();
  });
});
