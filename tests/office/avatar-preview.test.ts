import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVATARS } from "../../ui/src/skills/avatars.js";
import { AvatarPreview } from "../../ui/src/components/settings/AvatarPreview.js";

const css = readFileSync("ui/src/styles.css", "utf8");

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(AvatarPreview, props as never));
}

describe("AvatarPreview", () => {
  it("2d mode renders svg without 3d class", () => {
    const html = render({ mode: "2d" });
    expect(html).toContain("avatar-preview--2d");
    expect(html).toContain("<svg");
    expect(html).toContain("iso-office");
    expect(html).not.toContain("--3d");
  });

  it("3d mode sets class and data-mode", () => {
    const html = render({ mode: "3d" });
    expect(html).toContain("avatar-preview--3d");
    expect(html).toContain('data-mode="3d"');
  });

  it("defaults to a valid mode when not given", () => {
    expect(render({})).toMatch(/avatar-preview--(2d|3d)/);
  });

  it("walking adds walking class, default is idle", () => {
    expect(render({ mode: "2d", motion: "walking" })).toContain("walking");
    const html = render({ mode: "2d" });
    expect(html).toContain("idle");
    expect(html).not.toContain("walking");
  });

  it("avatarId changes the look", () => {
    const a = render({ mode: "2d", avatarId: AVATARS[0].id });
    const b = render({ mode: "2d", avatarId: AVATARS[1].id });
    expect(a).toContain("<svg");
    expect(a).not.toBe(b);
    const fills = (h: string) => [...h.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]).join(",");
    expect(fills(a)).not.toBe(fills(b));
  });

  it("css has 3d spin and reduced-motion rules", () => {
    for (const token of ["perspective", "preserve-3d", "rotateY", "avatar-spin"]) expect(css).toContain(token);
    const blocks: string[] = [];
    let idx = css.indexOf("@media (prefers-reduced-motion: reduce)");
    while (idx >= 0) {
      let depth = 0;
      let end = idx;
      for (let i = css.indexOf("{", idx); i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) {
          end = i;
          break;
        }
      }
      blocks.push(css.slice(idx, end + 1));
      idx = css.indexOf("@media (prefers-reduced-motion: reduce)", end);
    }
    expect(blocks.some((b) => b.includes("avatar-preview"))).toBe(true);
  });
});
