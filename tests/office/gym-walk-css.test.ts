import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");
const cityCss = read("ui/src/office/city.css");
const gymScene = read("ui/src/office/gym-scene.ts");

const styles = read("ui/src/styles.css");

describe("walking leg keyframes", () => {
  it("styles.css defines p-walk-l and p-walk-r", () => {
    expect(styles).toMatch(/@keyframes p-walk-l\b/);
    expect(styles).toMatch(/@keyframes p-walk-r\b/);
  });

  it(".p.walking legs use p-walk-l / p-walk-r without delay", () => {
    expect(styles).toMatch(/\.iso-office \.p\.walking \.leg\.l \{ animation: p-walk-l [^}]*\}/);
    expect(styles).toMatch(/\.iso-office \.p\.walking \.leg\.r \{ animation: p-walk-r [^}]*\}/);
    expect(styles).not.toMatch(/\.p\.walking \.leg\.r \{ animation-delay/);
  });

  it("p-step and the run legs are untouched", () => {
    expect(styles).toMatch(/@keyframes p-step \{ from \{ transform: rotate\(-26deg\); \} to \{ transform: rotate\(26deg\); \} \}/);
    expect(cityCss).toMatch(/\.iso-gym \.p\.run \.leg \{ animation: p-step /);
  });
});

describe("gym walking legs: source checks", () => {
  it("goTo sets act walking and pose stand", () => {
    const m = /a\.act = "walking"; a\.pose = "stand";/.exec(gymScene);
    expect(m).not.toBeNull();
  });

  it("city.css has no rule overriding animation or transform of .iso-gym walking legs", () => {
    const rules = cityCss.split("}").map((r) => r.trim());
    const bad = rules.filter((r) => {
      const sel = r.split("{")[0] ?? "";
      if (!/\.leg/.test(sel) || /\.(run|pedal|hang|punch)\b/.test(sel)) return false;
      if (!/\.iso-gym/.test(sel)) return false;
      return /animation|transform/.test(r.split("{")[1] ?? "");
    });
    expect(bad).toEqual([]);
    expect(cityCss).not.toMatch(/\.iso-gym[^{]*\.walking[^{]*\.leg/);
  });

  it("reduced-motion rules sit inside a media query", () => {
    const idx = [...cityCss.matchAll(/\.iso-gym \*, \.iso-gym \.p \* \{ animation: none/g)];
    expect(idx.length).toBeGreaterThan(0);
    for (const m of idx) {
      const line = cityCss.slice(cityCss.lastIndexOf("\n", m.index) + 1, m.index);
      expect(line).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*$/);
    }
  });
});
