// Poly Haven asset list and `tnf w3d fetch-assets`: sizes first, download only with --yes, md5 checked, host allowlist.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runW3DCli } from "../../src/cli-w3d.js";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { loadPolyHavenList, pickFile, polyhavenDir } from "../../src/core/workshop3d/polyhaven.js";

const REPO = path.resolve(__dirname, "..", "..");
const body = (id: string, key: string) => Buffer.from(`${id}-${key}-bytes`);
const md5 = (b: Uint8Array) => crypto.createHash("md5").update(b).digest("hex");

/** Fake /files/<id> answers shaped like api.polyhaven.com (only the keys we read). */
function filesFor(id: string, type: string): unknown {
  const entry = (map: string, ext: string, res: string) => {
    const name = `${id}_${map.toLowerCase()}_${res}.${ext}`;
    const b = body(id, map);
    return { url: `https://dl.polyhaven.org/file/ph-assets/Textures/${ext}/${res}/${id}/${name}`, md5: md5(b), size: b.length };
  };
  if (type === "hdri") return { hdri: { "1k": { hdr: entry("hdr", "hdr", "1k"), exr: {} } } };
  return Object.fromEntries(["Diffuse", "nor_gl", "Rough"].map((m) => [m, { "2k": { jpg: entry(m, "jpg", "2k"), png: {} } }]));
}

let dir: string;
let out: string[];
let errs: string[];
let downloads: string[];
const config = (): ControllerConfig => ({ dataDir: dir, repoRoot: REPO } as unknown as ControllerConfig);
const io = {
  getJson: async (url: string) => {
    const id = url.split("/").pop()!;
    const spec = loadPolyHavenList(REPO).assets.find((a) => a.id === id)!;
    return filesFor(id, spec.type);
  },
  getBytes: async (url: string) => {
    downloads.push(url);
    const name = url.split("/").pop()!;
    const id = url.split("/")[url.split("/").length - 2]!;
    const map = name.slice(id.length + 1).split("_")[0]!;
    const real = ["Diffuse", "nor_gl", "Rough", "hdr"].find((m) => m.toLowerCase().startsWith(map))!;
    return new Uint8Array(body(id, real));
  },
};
const run = (args: string[]) => runW3DCli(args, { config: config(), fake: true, getManager: () => { throw new Error("no"); }, log: (l) => out.push(l), err: (l) => errs.push(l), polyhaven: io });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-ph-"));
  out = [];
  errs = [];
  downloads = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("config/polyhaven-assets.json", () => {
  it("is a small fixed CC0 list: stone textures and a studio HDRI", () => {
    const l = loadPolyHavenList(REPO);
    expect(l.license).toMatch(/CC0/);
    expect(l.assets.map((a) => a.id)).toEqual(expect.arrayContaining(["granite_tile_03", "studio_small_09"]));
    expect(l.assets.length).toBeLessThanOrEqual(8);
    expect(l.assets.find((a) => a.type === "hdri")?.use).toBe("studio");
  });
  it("only accepts download URLs on dl.polyhaven.org", () => {
    const spec = loadPolyHavenList(REPO).assets[0]!;
    const evil = { Diffuse: { "2k": { jpg: { url: "https://example.com/x.jpg", md5: "a", size: 1 } } } };
    expect(pickFile(evil, spec, "Diffuse")).toBeNull();
  });
});

describe("tnf w3d fetch-assets", () => {
  it("without --yes shows sizes and downloads nothing", async () => {
    expect(await run(["fetch-assets"])).toBe(0);
    expect(downloads).toEqual([]);
    const text = out.join("\n");
    expect(text).toMatch(/cần tải/);
    expect(text).toMatch(/--yes/);
    expect(fs.existsSync(polyhavenDir(dir))).toBe(false);
  });
  it("--yes downloads, checks md5, writes meta.json; a second run downloads nothing", async () => {
    expect(await run(["fetch-assets", "--yes"])).toBe(0);
    const g = JSON.parse(fs.readFileSync(path.join(polyhavenDir(dir), "granite_tile_03", "meta.json"), "utf8"));
    expect(g).toMatchObject({ id: "granite_tile_03", type: "texture", use: "granite", crop: [0.01, 0.01, 0.32, 0.485] });
    expect(Object.keys(g.files).sort()).toEqual(["diff", "nor", "rough"]);
    expect(fs.existsSync(path.join(polyhavenDir(dir), "granite_tile_03", g.files.diff))).toBe(true);
    const h = JSON.parse(fs.readFileSync(path.join(polyhavenDir(dir), "studio_small_09", "meta.json"), "utf8"));
    expect(h.files).toEqual({ hdr: "studio_small_09_hdr_1k.hdr" });
    const n = downloads.length;
    expect(await run(["fetch-assets", "--yes"])).toBe(0);
    expect(downloads.length).toBe(n);
    expect(out.join("\n")).toMatch(/Đã đủ tài nguyên/);
  });
  it("a corrupted download (md5) is reported and no meta.json is written for that asset", async () => {
    const bad = { ...io, getBytes: async (url: string) => (url.includes("granite_tile_03") ? new Uint8Array([1, 2, 3]) : io.getBytes(url)) };
    const code = await runW3DCli(["fetch-assets", "--yes"], { config: config(), fake: true, getManager: () => { throw new Error("no"); }, log: (l) => out.push(l), err: (l) => errs.push(l), polyhaven: bad });
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/md5/);
    expect(fs.existsSync(path.join(polyhavenDir(dir), "granite_tile_03", "meta.json"))).toBe(false);
    expect(fs.existsSync(path.join(polyhavenDir(dir), "studio_small_09", "meta.json"))).toBe(true);
  });
});
