import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../ui/src/components/settings/ReleaseConfigSection.tsx", import.meta.url), "utf8");

describe("ReleaseConfigSection dry run and real release (static)", () => {
  it("uses the pure helpers and the release APIs", () => {
    for (const s of ["canRunReal", "needsCancelWarning", "formatCommandLine", "formatTargets", "api.releaseDryRun", "api.releaseExecute", "api.getRelease"]) {
      expect(src).toContain(s);
    }
  });
  it("disables the real button through tunnel or canRunReal and explains why", () => {
    expect(src).toContain("props.release?.viaTunnel) || !canRunReal(");
    expect(src).toContain("relcfg_tunnel_disabled");
    expect(src).toContain("relcfg_confirm_push");
  });
  it("polls every 3 s with REST and cleans up the interval", () => {
    expect(src).toContain("setInterval(tick, 3000)");
    expect(src).toContain("clearInterval");
    expect(src).not.toContain("WebSocket");
  });
  it("shows the 40-minute lock warning without a cancel button", () => {
    expect(src).toContain("relcfg_cancel_warning");
    expect(src).toContain("relcfg_cancel_ack");
    expect(src).not.toContain("relcfg_cancel}");
  });
});
