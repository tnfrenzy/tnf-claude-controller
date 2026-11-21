import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";

const src = readFileSync("ui/src/components/skills/GenerativeTrainForm.tsx", "utf8");

describe("GenerativeTrainForm source", () => {
  it("uses the sample-round flow", () => {
    expect(src).toContain("roundPhase");
    // the per-round file buttons moved into SampleFiles (view / open / download per format)
    expect(src).toContain("SampleFiles");
    expect(src).toContain("skillsGenSetOutputs");
    expect(readFileSync("ui/src/components/skills/SampleFiles.tsx", "utf8")).toContain("downloadSkillsGenSample");
    expect(src).toContain("skillsGenGenerateSample");
    expect(src).toContain("skillsGenFinalize");
  });
  it("start() scans GitHub (up to 10 repos) before generating the sample", () => {
    const a = src.indexOf("async function start");
    const b = src.indexOf("return (", a);
    const body = src.slice(a, b);
    expect(body).toContain("skillsGenFindGithub");
    expect(body.indexOf("skillsGenFindGithub")).toBeLessThan(body.indexOf("skillsGenGenerateSample"));
  });
  it("used i18n keys exist in vi and en", () => {
    const used = [...src.matchAll(/t\("(skillg_[a-z_]+)"\)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(10);
    for (const k of used) for (const l of ["vi", "en"] as const) expect((dicts[l] as Record<string, string>)[k]?.trim(), `${l}.${k}`).toBeTruthy();
  });
});
