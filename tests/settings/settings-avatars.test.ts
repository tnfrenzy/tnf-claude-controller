import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AVATARS, AVATAR_CATEGORIES } from "../../ui/src/skills/avatars";

const panel = readFileSync("ui/src/pages/SettingsPanel.tsx", "utf8");
const i18n = readFileSync("ui/src/i18n.ts", "utf8");

describe("settings avatar picker", () => {
  it("SettingsPanel uses the avatar helpers", () => {
    for (const s of ["getAvatarMap", "saveAvatarMap", "AvatarPicker", "getAvatarStyle", "DEFAULT_ROLES", "role_models_coding"]) {
      expect(panel).toContain(s);
    }
    // the 2D/3D avatar style toggle was removed: style is only read, never saved here
    expect(panel).not.toContain("saveAvatarStyle(");
  });
  it("uses AvatarPicker instead of select/optgroup", () => {
    expect(panel).toContain("<AvatarPicker");
    expect(panel).not.toContain("optgroup");
  });
  it("has per-role toggle and reset", () => {
    for (const s of ["aria-expanded", "openRole", "ss_avatars_reset", "saveAvatarMap({})"]) {
      expect(panel).toContain(s);
    }
  });
  it("category keys exist in vi and en and cover every category", () => {
    for (const c of AVATAR_CATEGORIES) {
      const k = `ss_avatars_cat_${c}`;
      const re = new RegExp(`^  ${k}: "([^"]+)",`, "gm");
      expect(i18n.match(re)?.length).toBe(2);
    }
    for (const a of AVATARS) expect(AVATAR_CATEGORIES).toContain(a.category);
  });
  it("i18n has style/expand keys in vi and en", () => {
    for (const k of [
      "ss_avatars_style",
      "ss_avatars_style_2d",
      "ss_avatars_style_3d",
      "ss_avatar_expand",
      "ss_avatar_collapse",
    ]) {
      const re = new RegExp(`^  ${k}: "([^"]+)",`, "gm");
      expect(i18n.match(re)?.length).toBe(2);
    }
  });
  it("i18n has new keys in vi and en", () => {
    for (const k of ["ss_avatars", "ss_avatars_hint", "ss_avatar_default", "ss_avatars_reset"]) {
      const n = i18n.split(`  ${k}:`).length - 1;
      expect(n).toBeGreaterThanOrEqual(2);
    }
  });
});
