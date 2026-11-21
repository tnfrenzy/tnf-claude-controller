import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";

/** Rule (CLAUDE.md "Ngôn ngữ giao diện"): the English UI must not show Vietnamese. */
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const UI_SRC = path.resolve(__dirname, "..", "..", "ui", "src");
const BASELINE = path.resolve(__dirname, "vi-literals-baseline.json");

describe("English UI has no Vietnamese", () => {
  it("every value of the English dictionary is free of Vietnamese letters", () => {
    const bad = Object.entries(dicts.en).filter(([, v]) => VI.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("every key exists in both languages", () => {
    expect(Object.keys(dicts.en).sort()).toEqual(Object.keys(dicts.vi).sort());
  });

  it("hard-coded Vietnamese in UI source never grows (use the dictionary or pick(vi, en) instead)", () => {
    const counts: Record<string, number> = {};
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== "vendor" && e.name !== "dev" && e.name !== "i18n") walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && e.name !== "i18n.ts") {
          let block = false;
          let n = 0;
          for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
            const t = line.trim();
            if (block) {
              if (t.includes("*/")) block = false;
              continue;
            }
            if (t.startsWith("/*")) {
              if (!t.includes("*/")) block = true;
              continue;
            }
            if (t.startsWith("//") || t.startsWith("*")) continue;
            if (VI.test(line.replace(/\/\/.*$/, ""))) n++;
          }
          if (n > 0) counts[path.relative(UI_SRC, p).split(path.sep).join("/")] = n;
        }
      }
    };
    walk(UI_SRC);
    if (process.env["UPDATE_VI_BASELINE"]) fs.writeFileSync(BASELINE, JSON.stringify(counts, Object.keys(counts).sort(), 1) + "\n");
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Record<string, number>;
    const grew = Object.entries(counts).filter(([f, n]) => n > (base[f] ?? 0)).map(([f, n]) => `${f}: ${n} > ${base[f] ?? 0}`);
    expect(grew).toEqual([]);
  });
});
