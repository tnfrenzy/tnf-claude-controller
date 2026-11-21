import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfficeCharacter, charPose } from "../../ui/src/components/office/OfficeCharacter.js";
import { ROLE_COLORS } from "../../ui/src/office/layout.js";

type Group = keyof typeof ROLE_COLORS;
const GROUPS = Object.keys(ROLE_COLORS) as Group[];
const POSE_CLASSES = ["char-typing", "char-think", "char-tool", "char-wait", "char-gone"];

function render(over: Record<string, unknown> = {}): string {
  const props = { group: "analyst", activity: "idle", phase: "working", ok: true, seated: true, ...over };
  return renderToStaticMarkup(createElement(OfficeCharacter, props as never));
}

/** Token-exact class match (char-think must not match char-think-bubble). */
function hasClass(html: string, cls: string): boolean {
  return [...html.matchAll(/class="([^"]*)"/g)].some((m) => m[1].split(/\s+/).includes(cls));
}

const CASES: [string, string, string][] = [
  ["typing", "working", "typing"],
  ["thinking", "working", "think"],
  ["tool", "working", "tool"],
  ["idle", "working", "wait"],
  ["idle", "left", "gone"],
];

describe("charPose", () => {
  it("maps activity to pose, left wins, seated does not matter", () => {
    for (const seated of [true, false]) {
      expect(charPose("typing", "working", seated)).toBe("typing");
      expect(charPose("thinking", "working", seated)).toBe("think");
      expect(charPose("tool", "working", seated)).toBe("tool");
      expect(charPose("idle", "working", seated)).toBe("wait");
      for (const a of ["idle", "tool", "typing", "thinking"] as const) expect(charPose(a, "left", seated)).toBe("gone");
    }
  });
});

describe("OfficeCharacter", () => {
  it("renders exactly one pose class with matching data-pose", () => {
    for (const [activity, phase, pose] of CASES) {
      const html = render({ activity, phase });
      expect(html).toContain(`data-pose="${pose}"`);
      const present = POSE_CLASSES.filter((c) => hasClass(html, c));
      expect(present).toEqual([`char-${pose}`]);
    }
  });

  it("shows the think bubble only when thinking", () => {
    for (const [activity, phase, pose] of CASES) {
      expect(hasClass(render({ activity, phase }), "char-think-bubble")).toBe(pose === "think");
    }
  });

  it("uses the role color for every group", () => {
    for (const group of GROUPS) expect(render({ group })).toContain(ROLE_COLORS[group]);
  });

  it("marks ok/fail only when gone", () => {
    const okHtml = render({ phase: "left", ok: true });
    expect(hasClass(okHtml, "char-ok")).toBe(true);
    expect(hasClass(okHtml, "char-fail")).toBe(false);
    const failHtml = render({ phase: "left", ok: false });
    expect(hasClass(failHtml, "char-fail")).toBe(true);
    expect(hasClass(failHtml, "char-ok")).toBe(false);
    const working = render({ activity: "typing", ok: false });
    expect(hasClass(working, "char-ok")).toBe(false);
    expect(hasClass(working, "char-fail")).toBe(false);
  });

  it("walking shows legs and marks the walking class even when seated", () => {
    const html = render({ seated: true, walking: true });
    expect(hasClass(html, "char-walking")).toBe(true);
    expect(html).toContain('data-walking="1"');
    expect(hasClass(html, "char-legs")).toBe(true);
    const still = render({ seated: true });
    expect(hasClass(still, "char-walking")).toBe(false);
    expect(still).not.toContain("data-walking");
    expect(hasClass(still, "char-legs")).toBe(false);
  });

  it("left + walking stays gone", () => {
    const html = render({ phase: "left", walking: true });
    expect(html).toContain('data-pose="gone"');
    expect(hasClass(html, "char-walking")).toBe(false);
  });

  it("differs between seated and standing", () => {
    expect(render({ seated: true })).not.toBe(render({ seated: false }));
  });
});
