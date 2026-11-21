import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CadRunner } from "../../src/core/design3d/cad-tools.js";
import {
  createMaterialLibrary, isSafeId, listMaterialsForPrompt, parseSize, resolveDirLoose, sniffImage, slugify, MaterialError,
} from "../../src/core/workshop3d/material-library.js";
import { handleMaterialsRoute } from "../../src/server/materials-routes.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

const roots: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-matlib-"));
  roots.push(d);
  return d;
};
afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

/** Fake make_material.py: writes the contract files into out_dir and prints one JSON line. */
function fakeRunner(calls: string[][], fail?: (args: string[]) => string | null): CadRunner {
  return async (_py, args) => {
    calls.push(args);
    const why = fail?.(args) ?? null;
    if (why) return { code: 1, stdout: JSON.stringify({ ok: false, error: why }) + "\n", stderr: "", timedOut: false };
    if (args[1] === "--slab-only") {
      const dir = args[2]!;
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
      meta.tile_cm = Number(args[4]);
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
      return { code: 0, stdout: JSON.stringify({ ok: true, tile_cm: meta.tile_cm }) + "\n", stderr: "", timedOut: false };
    }
    const [, src, dir] = args;
    const opt = (k: string): string => args[args.indexOf(k) + 1]!;
    for (const f of ["albedo.png", "normal.png", "roughness.png", "preview.png", "slab.glb"]) fs.writeFileSync(path.join(dir!, f), "x");
    const slab = args.slice(args.indexOf("--slab-mm") + 1, args.indexOf("--slab-mm") + 4).map(Number);
    fs.writeFileSync(path.join(dir!, "meta.json"), JSON.stringify({
      id: path.basename(dir!), name: opt("--name"), kind: "stone", tile_cm: Number(opt("--tile-cm")), source: opt("--source"),
      created: "2026-11-11T00:00:00Z", mapping: "tile", size_mm: { w: slab[0], d: slab[1], h: slab[2] }, session: null,
    }));
    expect(fs.existsSync(src!)).toBe(true);
    return { code: 0, stdout: "log\n" + JSON.stringify({ ok: true, seam_after: 1.1, mapping: "tile" }) + "\n", stderr: "", timedOut: false };
  };
}

describe("helpers", () => {
  it("sniffs png / jpg / webp by magic bytes only", () => {
    expect(sniffImage(PNG)).toBe("png");
    expect(sniffImage(JPG)).toBe("jpg");
    expect(sniffImage(WEBP)).toBe("webp");
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImage(Buffer.from("<svg"))).toBeNull();
  });
  it("slugs and ids are safe", () => {
    expect(slugify("Đá Sàn G01.jpg")).toBe("da-san-g01-jpg");
    expect(slugify("../..")).toBe("");
    expect(isSafeId("g01")).toBe(true);
    for (const bad of ["..", "../x", "a/b", "A", "", ".x", "a\\b"]) expect(isSafeId(bad)).toBe(false);
  });
  it("parses the shared size with limits", () => {
    expect(parseSize(undefined, { w: 600, d: 600, h: 20 })).toEqual({ w: 600, d: 600, h: 20 });
    expect(parseSize({ w: "1600", d: 1500, h: 20 }, { w: 1, d: 1, h: 1 })).toEqual({ w: 1600, d: 1500, h: 20 });
    expect(() => parseSize({ w: 0, d: 1, h: 1 }, { w: 1, d: 1, h: 1 })).toThrow(MaterialError);
    expect(() => parseSize([1, 2, 3], { w: 1, d: 1, h: 1 })).toThrow(/size_mm/);
  });
  it("resolves a folder typed in NFC when the disk name is NFD", () => {
    const root = tmp();
    const nfd = "Đá Sàn".normalize("NFD");
    fs.mkdirSync(path.join(root, nfd));
    const got = resolveDirLoose(path.join(root, "Đá Sàn".normalize("NFC")));
    expect(got).not.toBeNull();
    expect(fs.statSync(got!).isDirectory()).toBe(true);
    expect(resolveDirLoose(path.join(root, "khong-co"))).toBeNull();
  });
});

describe("material library with a fake python", () => {
  it("uploads, runs a batch sequentially, lists, renames, retiles, serves files and deletes", async () => {
    const dataDir = tmp();
    const calls: string[][] = [];
    const lib = createMaterialLibrary({ dataDir, python: () => "python.exe", run: fakeRunner(calls) });
    const a = lib.stageUpload("G01.jpg", Buffer.concat([JPG, Buffer.alloc(100)]));
    const b = lib.stageUpload("Đá trắng.png", Buffer.concat([PNG, Buffer.alloc(100)]));
    const batch = lib.startUploadBatch([{ upload: a.upload }, { upload: b.upload, name: "Trắng Ý" }], { category: "stone", size_mm: { w: 1600, d: 1500, h: 20 } });
    expect(batch.costUsd).toBe(0);
    expect(batch.items.map((i) => i.state)).toEqual(["running", "queued"]);
    await lib.idle();
    const st = lib.batch(batch.id)!;
    expect(st.done).toBe(true);
    expect(st.items.map((i) => [i.state, i.id])).toEqual([["done", "g01"], ["done", "trang-y"]]);
    expect(st.items[0]!.stats).toMatchObject({ seam_after: 1.1 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(["--slab-mm", "1600", "1500", "20", "--tile-cm", "60", "--source", "G01.jpg"]));
    // staged uploads are removed once used
    expect(fs.readdirSync(path.join(dataDir, "library", "material-uploads"))).toEqual([]);

    const items = lib.list();
    expect(items.map((i) => i.id).sort()).toEqual(["g01", "trang-y"]);
    const g = lib.get("g01")!;
    expect(g).toMatchObject({ name: "G01", category: "stone", kind: "material", materialKind: "stone", size_mm: { w: 1600, d: 1500, h: 20 }, source: "G01.jpg", session: null });
    expect(g.files).toHaveLength(5);
    expect(listMaterialsForPrompt(lib)).toEqual(expect.arrayContaining([{ id: "g01", name: "G01", kind: "stone" }]));

    expect((await lib.update("g01", { name: "  Đỏ Ruby  " })).name).toBe("Đỏ Ruby");
    expect((await lib.update("g01", { tile_cm: 45 })).tile_cm).toBe(45);
    expect(calls[2]).toEqual(expect.arrayContaining(["--slab-only", "--tile-cm", "45"]));
    await expect(lib.update("g01", { tile_cm: 2 })).rejects.toThrow(/5 đến 500/);
    await expect(lib.update("nope", { name: "x" })).rejects.toMatchObject({ status: 404 });

    expect(lib.filePath("g01", "slab.glb").contentType).toBe("model/gltf-binary");
    expect(() => lib.filePath("g01", "meta.json")).toThrow(/Chỉ tải/);
    expect(() => lib.filePath("..", "slab.glb")).toThrow(/không hợp lệ/);
    lib.remove("g01");
    expect(lib.get("g01")).toBeNull();
    expect(() => lib.remove("g01")).toThrow(/Không tìm thấy/);
  });

  it("refuses bad uploads, too many images and categories that are not ready", () => {
    const lib = createMaterialLibrary({ dataDir: tmp(), python: () => "python.exe", run: fakeRunner([]) });
    expect(() => lib.stageUpload("x.gif", PNG)).toThrow(/png/);
    expect(() => lib.stageUpload("x.png", Buffer.from("not an image at all"))).toThrow(/không phải ảnh/);
    expect(() => lib.stageUpload("x.png", Buffer.alloc(0))).toThrow(/rỗng/);
    expect(() => lib.stageUpload("x.png", Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))).toThrow(/10 MB/);
    const ups = Array.from({ length: 13 }, (_, i) => ({ upload: lib.stageUpload(`a${i}.png`, PNG).upload }));
    expect(() => lib.startUploadBatch(ups, {})).toThrow(/Tối đa 12/);
    expect(() => lib.startUploadBatch(ups.slice(0, 1), { category: "handrail" })).toThrow(/sắp có/);
    expect(() => lib.startUploadBatch([{ upload: "../../etc" }], {})).toThrow(/không hợp lệ/);
    expect(() => lib.startUploadBatch(ups.slice(0, 1), { tile_cm: 9999 })).toThrow(/tile_cm/);
  });

  it("a failed image is reported in Vietnamese and leaves no folder; the next image still runs", async () => {
    const dataDir = tmp();
    const lib = createMaterialLibrary({ dataDir, python: () => "python.exe", run: fakeRunner([], (args) => (args.includes("flat.png") ? "Ảnh gần như một màu" : null)) });
    const src = tmp();
    fs.writeFileSync(path.join(src, "flat.png"), Buffer.concat([PNG, Buffer.alloc(10)]));
    fs.writeFileSync(path.join(src, "ok.jpg"), Buffer.concat([JPG, Buffer.alloc(10)]));
    fs.writeFileSync(path.join(src, "fake.jpg"), "hello"); // wrong magic: skipped
    fs.writeFileSync(path.join(src, "notes.txt"), "x");
    fs.mkdirSync(path.join(src, "sub"));
    fs.writeFileSync(path.join(src, "sub", "deep.png"), PNG); // never read: no recursion
    const batch = lib.startDirBatch(src, { size_mm: { w: 1600, d: 1500, h: 20 } });
    expect(batch.items.map((i) => i.source)).toEqual(["flat.png", "ok.jpg"]);
    await lib.idle();
    const st = lib.batch(batch.id)!;
    expect(st.items[0]).toMatchObject({ state: "failed", error: expect.stringContaining("một màu") });
    expect(st.items[1]).toMatchObject({ state: "done", id: "ok" });
    expect(fs.existsSync(path.join(dataDir, "library", "materials", "flat"))).toBe(false);
    expect(lib.list().map((e) => e.id)).toEqual(["ok"]);
    expect(fs.readdirSync(src).sort()).toEqual(["fake.jpg", "flat.png", "notes.txt", "ok.jpg", "sub"]); // source folder untouched
  });

  it("folder import: relative path, missing folder, more than 24 images, python missing", async () => {
    const lib = createMaterialLibrary({ dataDir: tmp(), python: () => null, run: fakeRunner([]) });
    expect(() => lib.startDirBatch("relative\\dir", {})).toThrow(/đầy đủ/);
    expect(() => lib.startDirBatch(path.join(tmp(), "nope"), {})).toThrow(/Không thấy/);
    const many = tmp();
    for (let i = 0; i < 25; i++) fs.writeFileSync(path.join(many, `s${i}.png`), PNG);
    expect(() => lib.startDirBatch(many, {})).toThrow(/tối đa 24/);
    const one = tmp();
    fs.writeFileSync(path.join(one, "a.png"), PNG);
    const b = lib.startDirBatch(one, {});
    await lib.idle();
    expect(lib.batch(b.id)!.items[0]).toMatchObject({ state: "failed", error: expect.stringContaining("Python") });
  });
});

describe("routes", () => {
  it("folder import is refused through the tunnel (403); unknown ids 404", async () => {
    const lib = createMaterialLibrary({ dataDir: tmp(), python: () => "python.exe", run: fakeRunner([]) });
    const server = http.createServer((req, res) => {
      void handleMaterialsRoute(req, res, new URL(req.url!, "http://x").pathname, req.method!, lib, { viaTunnel: req.headers["x-tunnel"] === "1" });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workshop3d/materials`;
    try {
      const r = await fetch(`${base}/import-dir`, { method: "POST", headers: { "x-tunnel": "1" }, body: JSON.stringify({ dir: "C:\\" }) });
      expect(r.status).toBe(403);
      expect(((await r.json()) as { message: string }).message).toMatch(/máy chạy app/);
      const list = (await (await fetch(base, { headers: { "x-tunnel": "1" } })).json()) as { localDir: boolean; categories: { id: string; ready: boolean }[] };
      expect(list.localDir).toBe(false);
      expect(list.categories.filter((c) => c.ready).map((c) => c.id)).toEqual(["stone"]);
      expect((await fetch(`${base}/nope`)).status).toBe(404);
      expect((await fetch(`${base}/nope/file/slab.glb`)).status).toBe(404);
      expect((await fetch(`${base}/batch/zzz`)).status).toBe(404);
      const big = await fetch(`${base}/upload`, { method: "POST", headers: { "x-file-name": "a.png" }, body: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]) });
      expect(big.status).toBe(413);
    } finally {
      server.close();
    }
  });
});
