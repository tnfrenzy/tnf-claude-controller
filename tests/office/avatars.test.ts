import { describe, expect, it, vi } from "vitest";
import { lookFor, LOOK } from "../../ui/src/components/office/IsoPerson.js";
import { AVATARS, AVATAR_CATEGORIES, getAvatarMap, getAvatarStyle, saveAvatarStyle, saveAvatarMap, parseAvatarMap, resolveAvatarLook, lookWithFallback, serializeAvatarMap, setAvatar } from "../../ui/src/skills/avatars.js";

describe("avatars", () => {
  it("parse is tolerant", () => {
    expect(parseAvatarMap("{bad")).toEqual({});
    expect(parseAvatarMap("[1]")).toEqual({});
    expect(parseAvatarMap("")).toEqual({});
    expect(parseAvatarMap('{"a":"spy","b":"nope","c":5}')).toEqual({ a: "spy" });
  });

  it("round-trips and empty serializes to empty string", () => {
    const m = { analyst: "spy", qa: "it" };
    expect(parseAvatarMap(serializeAvatarMap(m))).toEqual(m);
    expect(serializeAvatarMap({})).toBe("");
  });

  it("setAvatar is immutable", () => {
    const m = { analyst: "spy" };
    const added = setAvatar(m, "qa", "it");
    expect(added).toEqual({ analyst: "spy", qa: "it" });
    expect(m).toEqual({ analyst: "spy" });
    const removed = setAvatar(added, "analyst", "");
    expect(removed).toEqual({ qa: "it" });
    expect(added.analyst).toBe("spy");
  });

  it("lookWithFallback prefers avatar, else fallback", () => {
    const fb = { tie: "#123456", hairStyle: 0, hair: "#000000", skin: "#ffffff" };
    expect(lookWithFallback("analyst", { analyst: "spy" }, fb)).toBe(AVATARS.find((a) => a.id === "spy")!.look);
    expect(lookWithFallback("analyst", {}, fb)).toBe(fb);
  });

  it("resolveAvatarLook", () => {
    expect(resolveAvatarLook("analyst", { analyst: "spy" })).toBe(AVATARS.find((a) => a.id === "spy")!.look);
    expect(resolveAvatarLook("analyst", {})).toBeUndefined();
  });

  it("resolveAvatarLook returns looks with new layers and ignores unknown ids/roles", () => {
    for (const id of ["accountant", "photographer", "astronaut"]) {
      const preset = AVATARS.find((a) => a.id === id)!;
      expect(resolveAvatarLook("analyst", { analyst: id })).toBe(preset.look);
    }
    expect(AVATARS.some((a) => a.look.headgear || a.look.neckwear)).toBe(true);
    for (const a of AVATARS) {
      if (a.look.headgear) expect(["cap", "glasses", "headset", "hardhat"]).toContain(a.look.headgear);
      if (a.look.neckwear) expect(["bow", "badge", "blouse"]).toContain(a.look.neckwear);
      if (a.look.suit) expect(a.look.suit).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(resolveAvatarLook("analyst", { analyst: "nope" })).toBeUndefined();
    expect(resolveAvatarLook("qa", { analyst: "spy" })).toBeUndefined();
  });

  it("lookFor honours override and fallback", () => {
    const preset = AVATARS[0].look;
    expect(lookFor("analyst")).toBe(LOOK.analyst);
    expect(lookFor("analyst", preset)).toBe(preset);
    expect(lookFor("xyz").tie).toBe("#8aa0c0");
  });

  it("getAvatarMap reads stored map and tolerates junk", () => {
    const store: Record<string, string> = { "tnf.avatars": '{"qa":"it"}' };
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    expect(getAvatarMap()).toEqual({ qa: "it" });
    store["tnf.avatars"] = "{bad";
    expect(getAvatarMap()).toEqual({});
    saveAvatarMap({ analyst: "spy" });
    expect(getAvatarMap()).toEqual({ analyst: "spy" });
    vi.unstubAllGlobals();
  });

  it("avatar style defaults to 2d, round-trips, and normalises junk", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    expect(getAvatarStyle()).toBe("2d");
    saveAvatarStyle("3d");
    expect(getAvatarStyle()).toBe("3d");
    saveAvatarStyle("2d");
    expect(getAvatarStyle()).toBe("2d");
    for (const junk of ["xyz", "3D", ""]) {
      store["tnf.avatarStyle"] = junk;
      expect(getAvatarStyle()).toBe("2d");
    }
    saveAvatarStyle("3d");
    saveAvatarStyle("xyz");
    expect(store["tnf.avatarStyle"]).toBe("2d");
    expect(getAvatarStyle()).toBe("2d");
    vi.unstubAllGlobals();
  });

  it("avatar style tolerates throwing localStorage", () => {
    const boom = () => { throw new Error("denied"); };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(getAvatarStyle()).toBe("2d");
    expect(() => saveAvatarStyle("3d")).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("every preset has category and non-empty unique vi/en labels", () => {
    for (const a of AVATARS) {
      expect(typeof a.labelVi).toBe("string");
      expect(typeof a.labelEn).toBe("string");
      expect(a.labelVi.trim()).not.toBe("");
      expect(a.labelEn.trim()).not.toBe("");
      expect(AVATAR_CATEGORIES).toContain(a.category);
    }
    expect(new Set(AVATARS.map((a) => a.labelVi)).size).toBe(AVATARS.length);
    expect(new Set(AVATARS.map((a) => a.labelEn)).size).toBe(AVATARS.length);
  });

  it("parseAvatarMap accepts new preset ids and drops unknown ones", () => {
    const wanted = ["accountant", "photographer", "astronaut"];
    const ids = wanted.every((id) => AVATARS.some((a) => a.id === id))
      ? wanted
      : AVATARS.slice(-3).map((a) => a.id);
    const good: Record<string, string> = { r1: ids[0], r2: ids[1], r3: ids[2] };
    expect(parseAvatarMap(JSON.stringify(good))).toEqual(good);
    const mixed = { ok: ids[0], a: "nope", b: "", c: 7, d: null, e: ids[2] };
    expect(parseAvatarMap(JSON.stringify(mixed))).toEqual({ ok: ids[0], e: ids[2] });
  });

  it("getAvatarStyle handles null and non-string stored values", () => {
    try {
      vi.stubGlobal("localStorage", { getItem: () => null });
      expect(getAvatarStyle()).toBe("2d");
      vi.stubGlobal("localStorage", { getItem: () => 3 });
      expect(getAvatarStyle()).toBe("2d");
      vi.stubGlobal("localStorage", { getItem: () => "null" });
      expect(getAvatarStyle()).toBe("2d");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("presets are valid", () => {
    expect(AVATARS.length).toBeGreaterThanOrEqual(6);
    for (const a of AVATARS) {
      expect(a.look.hairStyle).toBeGreaterThanOrEqual(0);
      expect(a.look.hairStyle).toBeLessThanOrEqual(5);
      for (const c of [a.look.tie, a.look.hair, a.look.skin]) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (a.look.suit) expect(a.look.suit).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("has about 20 unique presets with categories", () => {
    expect(AVATARS.length).toBeGreaterThanOrEqual(18);
    expect(AVATARS.length).toBeLessThanOrEqual(22);
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(AVATARS.length);
    for (const id of ["spy", "it", "manager", "designer", "scientist", "clerk"]) {
      expect(AVATARS.some((a) => a.id === id)).toBe(true);
    }
    expect(AVATARS[0].id).toBe("spy");
    for (const a of AVATARS) expect(AVATAR_CATEGORIES).toContain(a.category);
    for (const c of AVATAR_CATEGORIES) expect(AVATARS.filter((a) => a.category === c).length).toBeGreaterThanOrEqual(2);
    const old = { a: "spy", b: "it", c: "manager", d: "designer", e: "scientist", f: "clerk" };
    expect(parseAvatarMap(JSON.stringify(old))).toEqual(old);
  });
});
