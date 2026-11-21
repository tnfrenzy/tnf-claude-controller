// /api/workshop3d/<slug>/variants/*: slots, options (image + command, ready-made part), batch product, progress, GLB per config.
// Real store + real GLB merge on the fixture cabin; the material library is a fake (no Python).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseGlb } from "../../src/core/workshop3d/glb.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";
import { createVariantStore } from "../../src/core/workshop3d/variant-store.js";
import type { W3DBrief } from "../../src/core/workshop3d/types.js";
import { handleVariantsRoute } from "../../src/server/variants-routes.js";
import { partGlb, slabGlb } from "../fixtures/workshop3d/glb-parts.js";

const MASTER = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "fixtures", "workshop3d-viewer", "model.glb"));
let root: string;
let server: http.Server;
let base: string;
let slug: string;
let store: ReturnType<typeof createW3DStore>;
let variants: ReturnType<typeof createVariantStore>;
const uploadsSeen: { name: unknown; size: unknown }[] = [];
let batchDone = false;

const brief: W3DBrief = {
  title: "Cabin", object: "cabin", params: {}, detail: "high", attachments: [],
  slots: [
    { id: "handrail", name: "Tay vịn", type: "part" },
    { id: "floor", name: "Đá sàn", type: "material" },
    { id: "wall", name: "Vách", type: "material", nodes: ["wall_left", "wall_right", "wall_back"] },
    { id: "ghost", name: "Không có", type: "material" },
  ],
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-variants-"));
  store = createW3DStore(root);
  slug = store.create(brief);
  store.writeFile(slug, "outputs/model.glb", MASTER);
  const slab = path.join(root, "slab.glb");
  fs.writeFileSync(slab, slabGlb());
  const lib = {
    get: (id: string) => (id === "m1" || id === "m2" ? { id, name: id, mapping: "tile" as const, tile_cm: 50 } : null),
    filePath: () => ({ abs: slab, size: fs.statSync(slab).size, contentType: "model/gltf-binary" }),
    startUploadBatch: (items: { upload: unknown; name?: unknown }[], o: { size_mm?: unknown }) => {
      uploadsSeen.push({ name: items[0]!.name, size: o.size_mm });
      return { id: "b1" } as never;
    },
    batch: () => ({ id: "b1", done: batchDone, items: [{ state: batchDone ? "done" : "running", id: "m1" }] }) as never,
  };
  variants = createVariantStore({ lib: lib as never });
  server = http.createServer((req, res) => {
    void handleVariantsRoute(req, res, new URL(req.url ?? "/", "http://x").pathname, req.method ?? "GET", { store, variants }).then((h) => {
      if (!h) { res.writeHead(404); res.end(); }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workshop3d/${slug}/variants`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(root, { recursive: true, force: true });
});

const j = async (url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { method, headers: body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json", ...headers } : headers, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) }) });
  const ct = r.headers.get("content-type") ?? "";
  return { status: r.status, body: ct.includes("json") ? await r.json() as Record<string, any> : Buffer.from(await r.arrayBuffer()) }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe("variants API", () => {
  it("maps the slots onto the master GLB", async () => {
    const r = await j(base);
    expect(r.status).toBe(200);
    expect(r.body["ready"]).toBe(true);
    const slots = r.body["slots"] as { id: string; matched: string[]; size_mm: unknown }[];
    expect(slots.find((s) => s.id === "handrail")!.matched).toEqual(["handrail_back", "handrail_bracket_1", "handrail_bracket_2"]);
    expect(slots.find((s) => s.id === "floor")!.matched).toEqual(["floor"]);
    expect(slots.find((s) => s.id === "ghost")!.matched).toEqual([]);
    expect((r.body["limits"] as { maxConfigs: number }).maxConfigs).toBe(24);
  });

  it("404 for an unknown session, 503-free for a session without a model", async () => {
    expect((await j(base.replace(slug, "20260101-000000-abcdef"))).status).toBe(404);
    const s2 = store.create({ ...brief, slots: [] });
    const r = await j(base.replace(slug, s2));
    expect(r.body["ready"]).toBe(false);
    expect(String(r.body["reason"])).toContain("chưa khai báo");
  });

  it("takes an image + command: slot picked from the command, slab sized to the slot, option builds then becomes ready", async () => {
    const r = await j(`${base}/options`, "POST", { command: "đá sàn màu kem vân mây\nghi chú", upload: "u-abc-def.png" });
    expect(r.status).toBe(201);
    expect(r.body["slot"]).toBe("floor");
    expect(r.body["state"]).toBe("building");
    expect(r.body["name"]).toBe("đá sàn màu kem vân mây");
    expect(uploadsSeen[0]!.name).toBe("đá sàn màu kem vân mây");
    expect((uploadsSeen[0]!.size as { h: number }).h).toBeGreaterThan(0);
    let ov = (await j(base)).body as { options: { state: string; materialId?: string }[] };
    expect(ov.options[0]!.state).toBe("building");
    batchDone = true;
    ov = (await j(base)).body as typeof ov;
    expect(ov.options[0]).toMatchObject({ state: "ready", materialId: "m1" });
  });

  it("explains an unknown slot, an unmatched slot and a missing image", async () => {
    expect((await j(`${base}/options`, "POST", { command: "làm cho đẹp", upload: "u-abc-def.png" })).body["message"]).toMatch(/chỗ cấu hình nào/);
    expect((await j(`${base}/options`, "POST", { slot: "ghost", command: "x", upload: "u-abc-def.png" })).body["message"]).toMatch(/chưa khớp/);
    expect((await j(`${base}/options`, "POST", { slot: "floor", command: "x" })).body["message"]).toMatch(/tải một ảnh/);
  });

  it("builds the product of options: 2 floors x 3 handrails = 6 configs, each a valid GLB that differs", async () => {
    // library picks for the floor (m1 already ready, add m2) and the wall; three ready-made handrails
    const f2 = await j(`${base}/options`, "POST", { slot: "floor", command: "Đá đen", materialId: "m2" });
    expect(f2.status).toBe(201);
    const floors = ((await j(base)).body["options"] as { id: string; slot: string }[]).filter((o) => o.slot === "floor").map((o) => o.id);
    expect(floors).toHaveLength(2);
    const hand: string[] = [];
    for (const name of ["Vàng", "Inox", "Đồng"]) {
      const r = await j(`${base}/parts`, "POST", partGlb(), { "x-slot": "handrail", "x-name": encodeURIComponent(name), "content-type": "application/octet-stream" });
      expect(r.status).toBe(201);
      hand.push(String(r.body["id"]));
    }
    const started = await j(`${base}/batch`, "POST", { slots: { floor: floors, handrail: hand } });
    expect(started.status).toBe(202);
    const configs = started.body["configs"] as { id: string; name: string; state: string }[];
    expect(configs).toHaveLength(6);
    expect(new Set(configs.map((c) => c.name)).size).toBe(6);
    await variants.idle();
    const sizes = new Set<number>();
    for (const c of configs) {
      const got = (await j(`${base}/configs/${c.id}`)).body;
      expect(got["state"]).toBe("done");
      const glb = await j(`${base}/configs/${c.id}/model.glb`);
      expect(glb.status).toBe(200);
      const g = parseGlb(glb.body as Buffer);
      expect(g.json.nodes.some((n: { name?: string }) => n.name === "handrail_variant")).toBe(true);
      const { validateBytes } = await import("gltf-validator");
      expect((await validateBytes(new Uint8Array(glb.body as Buffer))).issues.numErrors).toBe(0);
      sizes.add((glb.body as Buffer).length);
    }
    expect(sizes.size).toBeGreaterThan(0);
    const list = (await j(base)).body["configs"] as unknown[];
    expect(list).toHaveLength(6);
  });

  it("rejects a part for a material slot, an unready/foreign option and an over-cap product", async () => {
    expect((await j(`${base}/parts`, "POST", partGlb(), { "x-slot": "floor", "x-name": "x" })).body["message"]).toMatch(/chỉ nhận phương án vật liệu/);
    expect((await j(`${base}/parts`, "POST", Buffer.from("nope"), { "x-slot": "handrail", "x-name": "x" })).status).toBe(400);
    const opts = (await j(base)).body["options"] as { id: string; slot: string }[];
    const floor = opts.find((o) => o.slot === "floor")!.id;
    expect((await j(`${base}/batch`, "POST", { slots: { handrail: [floor] } })).status).toBe(404);
    // 5 options per slot on two slots = 25 > 24
    const wallIds: string[] = [];
    for (let i = 0; i < 5; i++) wallIds.push(String((await j(`${base}/options`, "POST", { slot: "wall", command: `Vách ${i}`, materialId: "m1" })).body["id"]));
    const floorIds = [...opts.filter((o) => o.slot === "floor").map((o) => o.id), String((await j(`${base}/options`, "POST", { slot: "floor", command: "F3", materialId: "m1" })).body["id"])];
    const handIds = opts.filter((o) => o.slot === "handrail").map((o) => o.id);
    const r = await j(`${base}/batch`, "POST", { slots: { wall: wallIds, floor: floorIds, handrail: handIds } }); // 5 x 3 x 3 = 45
    expect(r.status).toBe(400);
    expect(String(r.body["message"])).toMatch(/vượt trần 24/);
    // 5 x 3 = 15 fits under the cap of 24 per call
    const ok = await j(`${base}/batch`, "POST", { slots: { wall: wallIds, floor: floorIds } });
    expect(ok.status).toBe(202);
    await variants.idle();
    // total cap: 6 + 15 = 21 existing, 24 more would pass the per-call cap but not the total (48)
    const over = await j(`${base}/batch`, "POST", { slots: { wall: wallIds.slice(0, 4), floor: floorIds, handrail: handIds.slice(0, 2) } }); // 4 x 3 x 2 = 24
    expect(over.status).toBe(202);
    await variants.idle();
    const again = await j(`${base}/batch`, "POST", { slots: { wall: wallIds.slice(0, 4), floor: floorIds, handrail: handIds.slice(0, 2) } }); // 21 + 24 = 45, +24 = 69 > 48
    expect(again.status).toBe(400);
    expect(String(again.body["message"])).toMatch(/vượt trần 48/);
  });

  it("deletes a config and an option; declares slots for a session that had none", async () => {
    const cfgs = (await j(base)).body["configs"] as { id: string }[];
    expect((await j(`${base}/configs/${cfgs[0]!.id}`, "DELETE")).status).toBe(200);
    expect((await j(`${base}/configs/${cfgs[0]!.id}`)).status).toBe(404);
    const opts = (await j(base)).body["options"] as { id: string; part?: string }[];
    const p = opts.find((o) => o.part)!;
    expect((await j(`${base}/options/${p.id}`, "DELETE")).status).toBe(200);
    expect(fs.existsSync(path.join(store.dir(slug), "variants", p.part!))).toBe(false);
    const s2 = store.create({ ...brief, slots: [] });
    store.writeFile(s2, "outputs/model.glb", MASTER);
    const put = await j(base.replace(slug, s2) + "/slots", "PUT", { slots: [{ id: "wall", name: "Vách", type: "material", nodes: ["wall_*"] }] });
    expect(put.status).toBe(200);
    expect(put.body["ready"]).toBe(true);
    expect((await j(base.replace(slug, s2) + "/slots", "PUT", { slots: [{ id: "BAD", name: "x" }] })).status).toBe(400);
  });
});
