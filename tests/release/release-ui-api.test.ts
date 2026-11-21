import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

describe("release UI api wrappers (structure)", () => {
  const api = read("ui/src/api.ts");
  it("has getReleaseConfig / putReleaseConfig on /release-config", () => {
    expect(api).toMatch(/getReleaseConfig:/);
    expect(api).toMatch(/putReleaseConfig:/);
    expect(api).toMatch(/\/release-config`/);
    expect(api).toMatch(/method: "PUT"/);
  });
  it("releaseExecute returns a releaseId and waitReleaseLog polls the log", () => {
    expect(api).toMatch(/releaseExecute[\s\S]{0,200}releaseId: string/);
    expect(api).toMatch(/export async function waitReleaseLog/);
    expect(api).toMatch(/\/api\/releases\//);
  });
  it("status type carries release flags and RunPage uses the poller", () => {
    expect(read("ui/src/types.ts")).toMatch(/release\?: \{ viaTunnel: boolean; allowed: boolean \}/);
    // the poller also reports progress (current step, elapsed time) through its 4th argument
    expect(read("ui/src/pages/RunPage.tsx")).toMatch(/waitReleaseLog\(releaseId, [^)]*\(l\) => setRelProgress\(l\)\)/);
  });
});
