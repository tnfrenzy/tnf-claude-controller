import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createW3DStore, safeRel } from "../../src/core/workshop3d/store.js";
import { W3D_STATES, type W3DBrief } from "../../src/core/workshop3d/types.js";

const brief: W3DBrief = { title: "Cabin", object: "cabin", params: { width: 1100 }, detail: "high", attachments: [] };
const mk = () => createW3DStore(fs.mkdtempSync(path.join(os.tmpdir(), "w3d-store-")), () => new Date("2026-11-10T08:09:10Z"));

describe("safeRel", () => {
  it("accepts nested relative paths", () => expect(safeRel("parts/a.stl")).toBe("parts/a.stl"));
  it.each(["../x", "a/../../x", "/abs", "C:\\x", "a\\..\\x", ""])("rejects %j", (p) => expect(() => safeRel(p)).toThrow());
});

describe("store", () => {
  it("creates a session with state.json and brief.json and lists it", () => {
    const s = mk();
    const slug = s.create(brief);
    expect(slug).toMatch(/^20261110-080910-[0-9a-f]{6}$/);
    const rec = s.get(slug)!;
    expect(rec.brief.title).toBe("Cabin");
    expect(rec.snapshot.state).toBe("intake");
    expect(s.list().map((i) => i.slug)).toEqual([slug]);
    expect(s.list()[0]!.title).toBe("Cabin");
    // createdAt comes from the slug timestamp (UTC), not from the file birthtime
    expect(rec.createdAt).toBe("2026-11-10T08:09:10.000Z");
  });
  it("writes, reads and lists files under the session only", () => {
    const s = mk();
    const slug = s.create(brief);
    s.writeFile(slug, "model.py", "print(1)");
    s.writeFile(slug, "parts/a.stl", "x");
    expect(s.readFile(slug, "model.py")).toBe("print(1)");
    expect(s.readFile(slug, "missing.txt")).toBeNull();
    expect(s.listFiles(slug, "parts")).toEqual(["parts/a.stl"]);
    expect(() => s.writeFile(slug, "../evil", "x")).toThrow();
  });
  it("listFiles on a missing subfolder returns [] and writeFile accepts a Buffer", () => {
    const s = mk();
    const slug = s.create(brief);
    expect(s.listFiles(slug, "nope")).toEqual([]);
    s.writeFile(slug, "parts/b.bin", Buffer.from([1, 2, 3]));
    expect(fs.readFileSync(path.join(s.dir(slug), "parts", "b.bin"))).toEqual(Buffer.from([1, 2, 3]));
    expect(s.listFiles(slug, "parts")).toEqual(["parts/b.bin"]);
  });
  it("saveSnapshot is atomic-ish and survives reload; appendRound keeps raw text", () => {
    const s = mk();
    const slug = s.create(brief);
    const snap = { ...s.get(slug)!.snapshot, state: "modeling" as const, costUsd: 1.5 };
    s.saveSnapshot(slug, snap);
    expect(s.get(slug)!.snapshot.state).toBe("modeling");
    s.appendRound(slug, 2, "cad-modeler", "raw text");
    expect(fs.readFileSync(path.join(s.dir(slug), "rounds", "2", "cad-modeler.txt"), "utf8")).toBe("raw text");
  });
  it("get returns null for unknown or malformed slugs and survives a corrupt state.json", () => {
    const s = mk();
    expect(s.get("nope")).toBeNull();
    expect(s.get("../x")).toBeNull();
    const slug = s.create(brief);
    fs.writeFileSync(path.join(s.dir(slug), "state.json"), "{broken");
    expect(s.get(slug)).toBeNull();
    expect(s.list()).toEqual([]);
  });
});

describe("store.get rejects a state.json without a known state", () => {
  it.each(["{}", "[]", '{"state":"bogus"}', '{"state":5}', "null", '"intake"'])("%s -> null, not listed", (text) => {
    const s = mk();
    const slug = s.create(brief);
    fs.writeFileSync(path.join(s.dir(slug), "state.json"), text);
    expect(s.get(slug)).toBeNull();
    expect(s.list()).toEqual([]);
  });
  it("W3D_STATES lists every state of the type", () => {
    expect([...W3D_STATES].sort()).toEqual(["art", "awaiting_user", "building", "done", "failed", "hqmaterials", "hqrender", "hqreview", "intake", "materials", "modeling", "optimizing", "paused", "planning", "presenting", "rendering", "reviewing", "stopped", "waiting_quota"]);
  });
});
