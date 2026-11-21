import { describe, it, expect } from "vitest";
import { RELEASE_TEMPLATES, validateReleaseConfig } from "../../src/core/release/config.js";

describe("release templates", () => {
  it("web-vps has the expected step order without build or ssh-deploy", () => {
    const types = RELEASE_TEMPLATES["web-vps"]!.steps.map((s) => s.type);
    expect(types).toEqual(["bump", "build", "tag", "git-push", "project-script", "healthcheck"]);
    expect(types).not.toContain("ssh-deploy");
    const builds = RELEASE_TEMPLATES["web-vps"]!.steps.filter((s) => s.type === "build");
    expect(builds).toEqual([{ type: "build", script: "test" }]);
  });

  it("web-vps template passes validation", () => {
    expect(() => validateReleaseConfig(RELEASE_TEMPLATES["web-vps"])).not.toThrow();
  });

  it("windows-installer runs the tests first, then bumps the version", () => {
    expect(RELEASE_TEMPLATES["windows-installer"]!.steps).toEqual([
      { type: "build", script: "test" },
      { type: "bump" },
      { type: "build", script: "package" },
      { type: "build", script: "installer" },
    ]);
  });
});
