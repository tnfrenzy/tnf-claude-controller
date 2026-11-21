// Real run: synthetic stone photos -> POST /api/workshop3d/materials/upload + /batch -> the real make_material.py
// (CAD python) -> files, valid GLB (gltf-validator), slab size in metres, seamless measured. Skipped without the python.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findCadPython } from "../../src/core/design3d/cad-tools.js";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const python = findCadPython();
const REPO = path.resolve(__dirname, "..", "..");
const TOKEN = "m".repeat(48);
const H = { "x-controller-token": TOKEN };

let started: StartedServer;
let base: string;
let root: string;
let stones: string;

/** POSITION min/max (metres) of the first mesh of a GLB. */
export function glbBounds(buf: Buffer): { min: number[]; max: number[]; images: number; hasNormal: boolean; hasMR: boolean } {
  expect(buf.toString("latin1", 0, 4)).toBe("glTF");
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString("utf8", 20, 20 + len)) as {
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { min?: number[]; max?: number[] }[];
    images?: unknown[];
    materials: { normalTexture?: unknown; pbrMetallicRoughness?: { metallicRoughnessTexture?: unknown; baseColorTexture?: unknown } }[];
  };
  const acc = gltf.accessors[gltf.meshes[0]!.primitives[0]!.attributes["POSITION"]!]!;
  const m = gltf.materials[0]!;
  return { min: acc.min!, max: acc.max!, images: gltf.images?.length ?? 0, hasNormal: !!m.normalTexture, hasMR: !!m.pbrMetallicRoughness?.metallicRoughnessTexture };
}

beforeAll(async () => {
  if (!python) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mat-api-"));
  stones = path.join(root, "stones");
  execFileSync(python, [path.join(REPO, "tests", "fixtures", "workshop3d", "gen_stone.py"), stones], { timeout: 180_000 });
  const config = {
    repoRoot: REPO,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "ws"),
    worktreesDir: path.join(root, "ws", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: ["Agent"],
      agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [],
      research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: { allowedTools: ["Agent"], agentsFile: path.join(root, "rc.json"), systemPromptFile: path.join(root, "cc.md"), settingsFile: path.join(root, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  } as ControllerConfig;
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [path.join(REPO, "fixtures", "fake-claude.mjs")], env: { ...process.env } });
  base = `http://127.0.0.1:${started.policy.port}/api/workshop3d/materials`;
}, 240_000);

afterAll(async () => {
  if (!python) return;
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

interface Item { state: string; id?: string; error?: string; source: string; stats?: Record<string, number | string | number[]> }

async function waitBatch(id: string, maxMs: number): Promise<{ done: boolean; costUsd: number; items: Item[] }> {
  const end = Date.now() + maxMs;
  for (;;) {
    const b = (await (await fetch(`${base}/batch/${id}`, { headers: H })).json()) as { done: boolean; costUsd: number; items: Item[] };
    if (b.done || Date.now() > end) return b;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

describe.skipIf(!python)("materials API with the real python", () => {
  it("6 stone photos + 2 bad ones in one upload batch: 6 materials, 2 Vietnamese errors, GLB valid, seamless", async () => {
    expect((await fetch(base)).status).toBe(401);
    const names = ["marble-white.jpg", "marble-black.png", "granite-grey.webp", "granite-red.jpg", "travertine.png", "emperador.jpg", "tiny.png", "flat.png"];
    const items: { upload: string }[] = [];
    for (const n of names) {
      const r = await fetch(`${base}/upload`, { method: "POST", headers: { ...H, "x-file-name": encodeURIComponent(n), "content-type": "application/octet-stream" }, body: fs.readFileSync(path.join(stones, n)) });
      expect(r.status).toBe(201);
      items.push({ upload: ((await r.json()) as { upload: string }).upload });
    }
    const r = await fetch(`${base}/batch`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ category: "stone", size_mm: { w: 600, d: 600, h: 20 }, tile_cm: 60, mapping: "tile", items }) });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    const b = await waitBatch(id, 1_500_000);
    expect(b.done).toBe(true);
    expect(b.costUsd).toBe(0);
    const bad = b.items.filter((i) => i.state === "failed");
    expect(bad.map((i) => i.source).sort()).toEqual(["flat.png", "tiny.png"]);
    expect(bad.find((i) => i.source === "tiny.png")!.error).toMatch(/quá nhỏ/);
    expect(bad.find((i) => i.source === "flat.png")!.error).toMatch(/một màu/);
    const ok = b.items.filter((i) => i.state === "done");
    expect(ok).toHaveLength(6);

    const v = await import("gltf-validator");
    const report: string[] = [];
    for (const it of ok) {
      const s = it.stats!;
      // seamless measured on the wrap: about 1 = like any neighbour pixel pair; the raw crop was clearly worse
      expect(s["seam_after"] as number).toBeLessThan(1.6);
      expect(s["max_line_ratio"] as number).toBeLessThan(2.5);
      expect(s["seam_before"] as number).toBeGreaterThan(s["seam_after"] as number);
      const rough = s["roughness_range"] as number[];
      expect(rough[0]).toBeGreaterThanOrEqual(0.15);
      expect(rough[1]).toBeLessThanOrEqual(0.5);
      expect(s["normal_z_mean"] as number).toBeGreaterThan(0.95);
      report.push(`${it.source}: seam ${s["seam_before"]} -> ${s["seam_after"]}, line ${s["max_line_ratio"]}`);

      const glb = Buffer.from(await (await fetch(`${base}/${it.id}/file/slab.glb`, { headers: H })).arrayBuffer());
      const vr = await v.validateBytes(new Uint8Array(glb));
      expect(vr.issues.numErrors).toBe(0);
      const bb = glbBounds(glb);
      expect(bb.hasNormal && bb.hasMR).toBe(true);
      expect(bb.images).toBe(3);
      expect(bb.max[0]! - bb.min[0]!).toBeCloseTo(0.6, 4);
      expect(bb.max[1]! - bb.min[1]!).toBeCloseTo(0.02, 4);
      expect(bb.max[2]! - bb.min[2]!).toBeCloseTo(0.6, 4);
      expect(bb.min[1]).toBeCloseTo(0, 5); // origin at the centre of the bottom face
      expect((bb.max[0]! + bb.min[0]!) / 2).toBeCloseTo(0, 5);
      const prev = await fetch(`${base}/${it.id}/file/preview.png`, { headers: H });
      expect(prev.headers.get("content-type")).toBe("image/png");
      const meta = JSON.parse(fs.readFileSync(path.join(root, "data", "library", "materials", it.id!, "meta.json"), "utf8")) as Record<string, unknown>;
      expect(meta).toMatchObject({ id: it.id, kind: "stone", tile_cm: 60, source: it.source, category: "stone", session: null, size_mm: { w: 600, d: 600, h: 20 } });
      expect(typeof meta["created"]).toBe("string");
    }
    console.log(report.join("\n"));

    const list = (await (await fetch(base, { headers: H })).json()) as { items: { id: string }[] };
    expect(list.items).toHaveLength(6);
    // albedo is square and a power of two
    const png = Buffer.from(await (await fetch(`${base}/${ok[0]!.id}/file/albedo.png`, { headers: H })).arrayBuffer());
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);

    // change tile_cm -> slab.glb rebuilt, name kept; delete
    const put = await fetch(`${base}/${ok[0]!.id}`, { method: "PUT", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ tile_cm: 30, name: "Trắng vân mây" }) });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ tile_cm: 30, name: "Trắng vân mây" });
    expect((await fetch(`${base}/${ok[0]!.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    expect((await fetch(`${base}/${ok[0]!.id}`, { headers: H })).status).toBe(404);
  }, 1_800_000);

  it("folder import (local): a design-like symmetric image is laid once (fit) on a 1600 x 1500 x 20 slab", async () => {
    const dir = path.join(root, "import");
    fs.mkdirSync(dir);
    // a framed, symmetric "floor design" made from two stones
    execFileSync(python!, ["-c", [
      "import sys", "from PIL import Image, ImageOps",
      "a=Image.open(sys.argv[1]).convert('RGB').resize((600,560))",
      "b=Image.open(sys.argv[2]).convert('RGB').resize((400,360))",
      "b=Image.blend(b, ImageOps.mirror(b), 0.5); b=Image.blend(b, ImageOps.flip(b), 0.5)",
      "a=Image.blend(a, ImageOps.mirror(a), 0.5); a=Image.blend(a, ImageOps.flip(a), 0.5)",
      "a.paste(b,(100,100)); a.save(sys.argv[3], quality=92)",
    ].join("\n"), path.join(stones, "marble-black.png"), path.join(stones, "granite-red.jpg"), path.join(dir, "Mẫu G09.jpg")], { timeout: 180_000 });
    const r = await fetch(`${base}/import-dir`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ dir, size_mm: { w: 1600, d: 1500, h: 20 } }) });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    const b = await waitBatch(id, 600_000);
    expect(b.items[0]).toMatchObject({ state: "done", source: "Mẫu G09.jpg" });
    expect(b.items[0]!.stats!["mapping"]).toBe("fit");
    const glb = Buffer.from(await (await fetch(`${base}/${b.items[0]!.id}/file/slab.glb`, { headers: H })).arrayBuffer());
    const bb = glbBounds(glb);
    expect(bb.max[0]! - bb.min[0]!).toBeCloseTo(1.6, 4);
    expect(bb.max[1]! - bb.min[1]!).toBeCloseTo(0.02, 4);
    expect(bb.max[2]! - bb.min[2]!).toBeCloseTo(1.5, 4);
    expect(fs.readdirSync(dir)).toEqual(["Mẫu G09.jpg"]); // the folder is only read
  }, 900_000);
});
