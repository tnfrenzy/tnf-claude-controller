import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVATARS, AVATAR_CATEGORIES } from "../../ui/src/skills/avatars.js";
import { AvatarPicker, buildPickerItems, nextAvatarIndex } from "../../ui/src/components/settings/AvatarPicker.js";

const css = readFileSync("ui/src/styles.css", "utf8");

function render(props: Record<string, unknown>): string {
  const full = { value: "", onChange: () => {}, style: "2d", lang: "vi", ...props };
  return renderToStaticMarkup(createElement(AvatarPicker, full as never));
}

function radios(html: string): string[] {
  return html.match(/<button[^>]*role="radio"[^>]*>/g) ?? [];
}

describe("nextAvatarIndex", () => {
  it("wraps forward and backward", () => {
    expect(nextAvatarIndex(0, "ArrowRight", 5)).toBe(1);
    expect(nextAvatarIndex(4, "ArrowRight", 5)).toBe(0);
    expect(nextAvatarIndex(4, "ArrowDown", 5)).toBe(0);
    expect(nextAvatarIndex(2, "ArrowDown", 5)).toBe(3);
    expect(nextAvatarIndex(2, "ArrowLeft", 5)).toBe(1);
    expect(nextAvatarIndex(0, "ArrowLeft", 5)).toBe(4);
    expect(nextAvatarIndex(0, "ArrowUp", 5)).toBe(4);
    expect(nextAvatarIndex(3, "ArrowUp", 5)).toBe(2);
  });
  it("handles Home, End, unknown keys and empty count", () => {
    expect(nextAvatarIndex(3, "Home", 5)).toBe(0);
    expect(nextAvatarIndex(1, "End", 5)).toBe(4);
    expect(nextAvatarIndex(2, "a", 5)).toBe(2);
    expect(nextAvatarIndex(2, "ArrowRight", 0)).toBe(0);
  });
});

describe("buildPickerItems", () => {
  it("vi: default first, total count, category order", () => {
    const { items, groups } = buildPickerItems("vi");
    expect(items[0]).toMatchObject({ id: "", label: "Mặc định" });
    expect(items.length).toBe(1 + AVATARS.length);
    const order = AVATAR_CATEGORIES.filter((c) => AVATARS.some((a) => a.category === c));
    expect(groups.map((g) => g.category)).toEqual(order);
    expect(items.slice(1).map((i) => i.id)).toEqual(groups.flatMap((g) => g.items.map((i) => i.id)));
  });
  it("en uses labelEn and Default", () => {
    const { items } = buildPickerItems("en");
    expect(items[0]?.label).toBe("Default");
    expect(items[1]?.label).toBe(AVATARS.find((a) => a.id === items[1]?.id)?.labelEn);
  });
});

describe("AvatarPicker render", () => {
  it("value empty selects default", () => {
    const html = render({ value: "" });
    expect(html).toContain('role="radiogroup"');
    const r = radios(html);
    expect(r.length).toBe(1 + AVATARS.length);
    expect(r.filter((b) => b.includes('aria-checked="true"')).length).toBe(1);
    expect(r[0]).toContain('aria-checked="true"');
    expect(r[0]).toContain("avatar-picker__card--selected");
    expect(r[0]).toContain('tabindex="0"');
    expect(r.slice(1).every((b) => b.includes('tabindex="-1"'))).toBe(true);
  });
  it("value of a preset selects only it", () => {
    const id = AVATARS[0]!.id;
    const r = radios(render({ value: id }));
    expect(r.filter((b) => b.includes('aria-checked="true"')).length).toBe(1);
    expect(r[0]).toContain('aria-checked="false"');
    expect(r[0]).toContain('tabindex="-1"');
    const { items } = buildPickerItems("vi");
    const idx = items.findIndex((i) => i.id === id);
    expect(r[idx]).toContain('aria-checked="true"');
    expect(r[idx]).toContain('tabindex="0"');
  });
  it("invalid value: none checked, default tabbable", () => {
    const r = radios(render({ value: "zzz" }));
    expect(r.some((b) => b.includes('aria-checked="true"'))).toBe(false);
    expect(r[0]).toContain('tabindex="0"');
  });
  it("style switches preview mode", () => {
    expect(render({ style: "3d" })).toContain("avatar-preview--3d");
    expect(render({ style: "2d" })).not.toContain("avatar-preview--3d");
  });
  it("group titles follow lang", () => {
    expect(render({ lang: "vi" })).toContain("Văn phòng");
    expect(render({ lang: "en" })).toContain("Office");
  });
});

describe("AvatarPicker css", () => {
  const escape = (s: string): string => s.replace(/[.\\-]/g, "\\$&");
  const ruleCount = (sel: string): number =>
    (css.match(new RegExp(`^${escape(sel)}\\s*\\{`, "gm")) ?? []).length;

  it("defines each picker selector exactly once at rule start", () => {
    const selectors = [
      ".avatar-picker",
      ".avatar-picker__grid",
      ".avatar-picker__group",
      ".avatar-picker__title",
      ".avatar-picker__card",
      ".avatar-picker__card:hover",
      ".avatar-picker__card:focus-visible",
      ".avatar-picker__card--selected",
      ".avatar-picker__label",
      ".avatar-picker__check",
    ];
    for (const sel of selectors) expect(ruleCount(sel), sel).toBe(1);
  });
  it("grid uses grid-template-columns", () => {
    const m = css.match(/^\.avatar-picker__grid\s*\{([^}]*)\}/m);
    expect(m?.[1]).toContain("grid-template-columns");
  });
  it("picker rules use theme variables and no hex colors", () => {
    const lines = css.split("\n").filter((l) => l.startsWith(".avatar-picker"));
    expect(lines.length).toBeGreaterThanOrEqual(10);
    for (const l of lines) expect(l).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const joined = lines.join("\n");
    expect(joined).toContain("var(--accent)");
    expect(joined).toContain("var(--border)");
  });
});

describe("AvatarPicker 3d animation and reduced motion css", () => {
  const blocks: { start: number; end: number; text: string }[] = [];
  for (const m of css.matchAll(/^@media \(prefers-reduced-motion: reduce\)\s*\{/gm)) {
    const start = m.index ?? 0;
    let depth = 0;
    for (let i = start + m[0].length - 1; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        blocks.push({ start, end: i, text: css.slice(start, i + 1) });
        break;
      }
    }
  }
  const mine = blocks.find((b) => b.text.includes(".avatar-preview .avatar-preview__svg"));
  const start = mine?.start ?? -1;
  const end = mine?.end ?? -1;
  const block = mine?.text ?? "";

  it("defines avatar-spin keyframes and uses them for 3d preview", () => {
    expect(css).toMatch(/^@keyframes avatar-spin\s*\{/m);
    expect(css).toMatch(/^\.avatar-preview--3d \.avatar-preview__svg\s*\{[^}]*animation:\s*avatar-spin/m);
  });
  it("reduced-motion block is balanced and disables svg animation", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toMatch(/\.avatar-preview \.avatar-preview__svg\s*\{[^}]*animation:\s*none/);
  });
  it("picker cards have no animation or transition", () => {
    const outside = block ? css.replace(block, "") : css;
    const cardRules = outside.match(/^\.avatar-picker__card[^{]*\{[^}]*\}/gm) ?? [];
    expect(cardRules.length).toBeGreaterThan(0);
    for (const r of cardRules) expect(r).not.toMatch(/\b(animation|transition)\s*:/);
  });
});
