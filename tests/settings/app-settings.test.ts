import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clampMaxRuns, loadAppSettings, saveAppSettings } from "../../src/core/app/app-settings.js";

describe("app settings", () => {
  it("clamps max runs to 1..ceiling and rejects non-numbers", () => {
    expect(clampMaxRuns(0)).toBe(1);
    expect(clampMaxRuns(2.9)).toBe(2);
    expect(clampMaxRuns(99)).toBe(10);
    expect(clampMaxRuns("2")).toBeNull();
    expect(clampMaxRuns(NaN)).toBeNull();
  });
  it("saves and loads; broken files give defaults", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-as-"));
    expect(loadAppSettings(d)).toEqual({});
    saveAppSettings(d, { maxRuns: 3 });
    expect(loadAppSettings(d)).toEqual({ maxRuns: 3 });
    fs.writeFileSync(path.join(d, "app-settings.json"), "{bad", "utf8");
    expect(loadAppSettings(d)).toEqual({});
  });
});
