import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRenderSpec, renderTimeoutMs, renderViews, resolveRenderAssets, sanitizeCameraName, RENDER_INFO_FILE,
  type RenderDeps, type RenderManifestEntry, type RenderSpec,
} from "../../src/core/workshop3d/render.js";
import { decodePng, encodePng, isBlank, pixelStats, pngStats } from "../../src/core/workshop3d/png.js";
import { parseRenderPlan } from "../../src/core/workshop3d/role-output.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";
import type { W3DBrief } from "../../src/core/workshop3d/types.js";

const brief: W3DBrief = { title: "Cabin", object: "cabin", params: {}, detail: "high", attachments: [] };
const setup = () => {
  const store = createW3DStore(fs.mkdtempSync(path.join(os.tmpdir(), "w3d-render-")));
  const slug = store.create(brief);
  store.writeFile(slug, "outputs/model.glb", Buffer.from("glb"));
  return { store, slug };
};
const plan = { environment: "studio" as const, exposure: 1, cameras: [] };

/** A 32x24 PNG: a gradient (a real picture) or one flat colour (a blank render). */
function png(kind: "picture" | "flat"): Buffer {
  const w = 32, h = 24;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = Math.floor(i / w);
    const v = kind === "flat" ? 200 : (x * 8 + y * 5) % 256;
    data.set([v, kind === "flat" ? 210 : 255 - v, 220, 255], i * 4);
  }
  return encodePng({ width: w, height: h, data });
}

type PageOpts = { shot?: (name: string) => Buffer | null; extra?: RenderManifestEntry[]; finish?: boolean; manifest?: (spec: RenderSpec) => RenderManifestEntry[] };
type Log = { args: string[][]; specs: RenderSpec[]; aborted: boolean[] };
/** Fake browser: behaves like tools/workshop3d/render/index.html (reads /views.json, posts shots, posts /finished). */
const fakePage = (log: Log, o: PageOpts = {}): RenderDeps["run"] => async (_exe, args, _t, signal) => {
  log.args.push(args);
  const base = new URL(args[args.length - 1]!).origin;
  const spec = (await (await fetch(`${base}/views.json`)).json()) as RenderSpec;
  log.specs.push(spec);
  const entries: RenderManifestEntry[] = [];
  for (const v of [...spec.views.map((x) => ({ name: x.name })), ...(o.extra ?? [])]) {
    const body = o.shot ? o.shot(v.name) : png("picture");
    if (body) await fetch(`${base}/shot?cam=${v.name}`, { method: "POST", body });
    entries.push({ name: v.name, group: "exterior", mode: "exterior", attempts: 1, blank: false, ...(o.extra?.find((e) => e.name === v.name) ?? {}) });
  }
  if (o.finish !== false) await fetch(`${base}/finished`, { method: "POST", body: JSON.stringify(o.manifest ? o.manifest(spec) : entries) });
  await new Promise((r) => setTimeout(r, 20));
  log.aborted.push(!!signal?.aborted);
  return { code: 0 };
};
const newLog = (): Log => ({ args: [], specs: [], aborted: [] });

describe("renderViews", () => {
  it("renders four default angles from ONE browser run, framed to fit", async () => {
    const { store, slug } = setup();
    const log = newLog();
    const r = await renderViews(store, slug, plan, { browser: "edge.exe", run: fakePage(log) });
    expect(r.ok).toBe(true);
    expect(r.files).toEqual(["renders/front.png", "renders/right.png", "renders/back.png", "renders/iso.png"]);
    for (const f of r.files) expect(fs.existsSync(path.join(store.dir(slug), f))).toBe(true);
    expect(log.args).toHaveLength(1);
    expect(log.args[0]![log.args[0]!.length - 1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(log.args[0]!.some((a) => a.startsWith("--user-data-dir="))).toBe(true);
    expect(log.args[0]).toContain("--window-size=1280,960");
    expect(log.args[0]!.some((a) => a.startsWith("--screenshot"))).toBe(false);
    expect(log.specs[0]!.views[3]).toMatchObject({ name: "iso", az: 35, el: 25, fit: true });
    expect(log.specs[0]!.auto).toBe(true);
    // the browser is stopped as soon as the page reported /finished
    expect(log.aborted[0]).toBe(true);
  });

  it("closes the temporary server and removes the profile when done", async () => {
    const { store, slug } = setup();
    const log = newLog();
    await renderViews(store, slug, plan, { browser: "edge.exe", run: fakePage(log) });
    const port = Number(new URL(log.args[0]![log.args[0]!.length - 1]!).port);
    await new Promise<void>((resolve, reject) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => { s.destroy(); reject(new Error("server still open")); });
      s.on("error", () => resolve());
    });
    const profile = log.args[0]!.find((a) => a.startsWith("--user-data-dir="))!.slice("--user-data-dir=".length);
    expect(fs.existsSync(profile)).toBe(false);
  });

  it("serves only the page, camera.js, views.json, three and the model; takes shots only for valid names", async () => {
    const { store, slug } = setup();
    const seen: Record<string, number> = {};
    const run: RenderDeps["run"] = async (_e, args) => {
      const base = new URL(args[args.length - 1]!).origin;
      for (const p of ["/", "/camera.js", "/views.json", "/model.glb", "/three/build/three.module.js", "/state.json", "/three/../package.json", "/brief.json", "/other"]) {
        seen[p] = (await fetch(base + p)).status;
      }
      seen["POST /shot?cam=../x"] = (await fetch(`${base}/shot?cam=..%2Fx`, { method: "POST", body: png("picture") })).status;
      seen["POST /other"] = (await fetch(`${base}/other`, { method: "POST", body: "x" })).status;
      await fetch(`${base}/shot?cam=a`, { method: "POST", body: png("picture") });
      await fetch(`${base}/finished`, { method: "POST", body: "[]" });
      return { code: 0 };
    };
    const r = await renderViews(store, slug, { ...plan, cameras: [{ name: "a", azimuth: 0, elevation: 0, distance: 3 }] }, { browser: "edge.exe", run });
    expect(r.files).toEqual(["renders/a.png"]);
    for (const p of ["/", "/camera.js", "/views.json", "/model.glb", "/three/build/three.module.js"]) expect(seen[p], p).toBe(200);
    for (const p of ["/state.json", "/brief.json", "/other", "POST /shot?cam=../x", "POST /other"]) expect(seen[p], p).toBe(404);
    expect(seen["/three/../package.json"]).not.toBe(200);
  });

  it("reports a Vietnamese error when no browser is found", async () => {
    const { store, slug } = setup();
    const r = await renderViews(store, slug, plan, { browser: null });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Không tìm thấy Edge hoặc Chrome");
    expect(r.files).toEqual([]);
  });

  it("fails when the model is missing", async () => {
    const store = createW3DStore(fs.mkdtempSync(path.join(os.tmpdir(), "w3d-render-")));
    const slug = store.create(brief);
    const r = await renderViews(store, slug, plan, { browser: "edge.exe", run: async () => ({ code: 0 }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/model\.glb/);
  });

  it("lists angles that never produced a frame but keeps the good ones (browser died or timed out)", async () => {
    const { store, slug } = setup();
    const r = await renderViews(store, slug, plan, { browser: "edge.exe", run: fakePage(newLog(), { shot: (n) => (n === "right" || n === "back" ? null : png("picture")), finish: false }) });
    expect(r.ok).toBe(false);
    expect(r.files).toEqual(["renders/front.png", "renders/iso.png"]);
    expect(r.error).toContain("right");
    expect(r.error).toContain("back");
    expect(r.error).not.toContain("front");
  });

  it("drops a blank (one-colour) frame: not in files, not in renders/, recorded in render-info.json", async () => {
    const { store, slug } = setup();
    const r = await renderViews(store, slug, plan, { browser: "edge.exe", run: fakePage(newLog(), { shot: (n) => png(n === "back" ? "flat" : "picture") }) });
    expect(r.ok).toBe(true);
    expect(r.files).toEqual(["renders/front.png", "renders/right.png", "renders/iso.png"]);
    expect(r.blank).toEqual(["back"]);
    expect(fs.existsSync(path.join(store.dir(slug), "renders/back.png"))).toBe(false);
    const info = JSON.parse(fs.readFileSync(path.join(store.dir(slug), RENDER_INFO_FILE), "utf8"));
    const back = info.views.find((v: { name: string }) => v.name === "back");
    expect(back).toMatchObject({ blank: true, file: null });
    expect(back.std).toBeLessThan(1);
  });

  it("trusts the page's blank flag (frame still blank after its retries)", async () => {
    const { store, slug } = setup();
    const r = await renderViews(store, slug, plan, {
      browser: "edge.exe",
      run: fakePage(newLog(), { manifest: (s) => s.views.map((v) => ({ name: v.name, attempts: v.name === "iso" ? 3 : 1, blank: v.name === "iso" })) }),
    });
    expect(r.files).not.toContain("renders/iso.png");
    expect(r.blank).toEqual(["iso"]);
    expect(r.views!.find((v) => v.name === "iso")!.attempts).toBe(3);
  });

  it("fails with a clear message when every frame is blank", async () => {
    const { store, slug } = setup();
    const r = await renderViews(store, slug, plan, { browser: "edge.exe", run: fakePage(newLog(), { shot: () => png("flat") }) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ảnh trống/);
  });

  it("keeps the interior views the page adds (auto_*) after the planned ones, with their group", async () => {
    const { store, slug } = setup();
    const extra = [{ name: "auto_ceiling", group: "ceiling", label: "nhìn lên trần", mode: "interior", auto: true }, { name: "auto_floor", group: "floor", auto: true }];
    const r = await renderViews(store, slug, { ...plan, cameras: [{ name: "a", azimuth: 0, elevation: 0, distance: 3 }] }, { browser: "edge.exe", run: fakePage(newLog(), { extra }) });
    expect(r.files).toEqual(["renders/a.png", "renders/auto_ceiling.png", "renders/auto_floor.png"]);
    expect(r.views!.find((v) => v.name === "auto_ceiling")).toMatchObject({ auto: true, group: "ceiling", mode: "interior" });
  });

  it("removes the PNGs of earlier rounds before rendering", async () => {
    const { store, slug } = setup();
    store.writeFile(slug, "renders/old_round.png", png("picture"));
    const r = await renderViews(store, slug, plan, { browser: "edge.exe", run: fakePage(newLog()) });
    expect(r.ok).toBe(true);
    expect(fs.readdirSync(path.join(store.dir(slug), "renders")).sort()).toEqual(["back.png", "front.png", "iso.png", "right.png"]);
  });

  it("sanitises camera names and reserves the auto_ prefix", async () => {
    const { store, slug } = setup();
    const cams = [
      { name: "../x", azimuth: 0, elevation: 0, distance: 3 },
      { name: "Góc Đẹp/1", azimuth: 10, elevation: 5, distance: 3 },
      { name: "auto_ceiling", azimuth: 10, elevation: 5, distance: 3 },
    ];
    const r = await renderViews(store, slug, { ...plan, cameras: cams }, { browser: "edge.exe", run: fakePage(newLog()) });
    expect(r.ok).toBe(true);
    for (const f of r.files) expect(f).toMatch(/^renders\/[a-z0-9_-]+\.png$/);
    expect(new Set(r.files).size).toBe(3);
    expect(r.files).toContain("renders/cam_auto_ceiling.png");
    expect(sanitizeCameraName("../x")).toBe("x");
    expect(sanitizeCameraName("///")).toBe("cam");
  });

  it("explicit cameras keep their distance (clamped) and their target part; default cameras fit", () => {
    const s = buildRenderSpec({ ...plan, cameras: [{ name: "close", azimuth: 0, elevation: 0, distance: 0.04, target: "cop_panel" }] });
    expect(s.views[0]).toEqual({ name: "close", az: 0, el: 0, dist: 0.1, fit: false, target: "cop_panel" });
    expect(buildRenderSpec(plan).views.every((v) => v.fit)).toBe(true);
    expect(buildRenderSpec(plan, false).auto).toBe(false);
  });

  it("survives a profile cleanup failure", async () => {
    const { store, slug } = setup();
    const orig = fs.rmSync;
    (fs as unknown as { rmSync: unknown }).rmSync = (p: fs.PathLike, o?: fs.RmOptions) => {
      if (String(p).includes("w3d-render-profile-")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return orig(p, o);
    };
    try {
      const r = await renderViews(store, slug, plan, { browser: "edge.exe", run: fakePage(newLog()) });
      expect(r.ok).toBe(true);
    } finally {
      (fs as unknown as { rmSync: unknown }).rmSync = orig;
    }
  });
});

describe("render plan target", () => {
  it("parseRenderPlan accepts an optional part id target and rejects a bad one", () => {
    const j = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";
    const ok = parseRenderPlan(j({ environment: "studio", exposure: 1, cameras: [{ name: "cop", azimuth: -90, elevation: 0, distance: 0.5, target: "cop_tam_nen" }] }));
    expect(ok.ok && ok.value.cameras[0]!.target).toBe("cop_tam_nen");
    expect(parseRenderPlan(j({ environment: "studio", exposure: 1, cameras: [{ name: "x", azimuth: 0, elevation: 0, distance: 1, target: "../a" }] })).ok).toBe(false);
  });
});

describe("renderTimeoutMs", () => {
  const MB = 1024 * 1024;
  it("grows with model size and view count, capped at 15 min", () => {
    expect(renderTimeoutMs(0, 1)).toBe(60_000);
    expect(renderTimeoutMs(10 * MB, 10)).toBe(40_000 + 30_000 + 200_000);
    expect(renderTimeoutMs(1000 * MB, 13)).toBe(900_000);
  });
});

describe("png.ts", () => {
  it("round-trips an RGBA image and tells a flat frame from a picture", () => {
    const p = decodePng(png("picture"))!;
    expect(p.width).toBe(32);
    expect(p.height).toBe(24);
    expect(isBlank(pixelStats(p.data, 1))).toBe(false);
    expect(isBlank(pngStats(png("flat"))!)).toBe(true);
    expect(decodePng(Buffer.from("not a png"))).toBeNull();
  });
  it("decodes the Sub/Up/Average/Paeth filters (what browsers write)", () => {
    const w = 5, h = 4;
    const rows: number[] = [];
    for (let y = 0; y < h; y++) {
      rows.push((y % 4) + 1); // filters 1..4
      for (let x = 0; x < w * 3; x++) rows.push((x * 7 + y * 3) % 50);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2; // RGB
    const chunk = (t: string, b: Buffer): Buffer => {
      const l = Buffer.alloc(4);
      l.writeUInt32BE(b.length);
      return Buffer.concat([l, Buffer.from(t), b, Buffer.alloc(4)]); // the reader does not check CRCs
    };
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const img = decodePng(Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]))!;
    expect(img.width).toBe(5);
    expect(img.data[3]).toBe(255);
    // row 0 uses Sub: pixel 1 red = pixel 0 red + raw byte
    expect(img.data[4]).toBe((img.data[0]! + rows[1 + 3]!) & 0xff);
    // row 1 uses Up: pixel 0 red = row 0 pixel 0 red + raw byte
    expect(img.data[w * 4]).toBe((img.data[0]! + rows[w * 3 + 2]!) & 0xff);
  });
});

type V = { x: number; y: number; z: number };
type Box = { min: V; max: V };
type Frame = { mode: string; position: V; lookAt: V; fov: number; near: number; far: number };
type Cam = {
  frameView: (o: { az: number; el: number; dist: number; fit?: boolean; box: Box; interior?: Box | null; target?: V | null }) => Frame;
  cutaway: (o: { box: Box; interior: Box | null }, dir: V) => Frame;
  direction: (az: number, el: number) => V;
  interiorPreset: (g: string, box: Box, interior: Box, cop: Box | null) => Frame | null;
  classify: (f: Frame) => string;
  retryFrames: (o: object, f: Frame) => Frame[];
  pixelStats: (rgba: Uint8Array, step?: number) => { std: number; dominant: number };
  isBlank: (s: { std: number; dominant: number }) => boolean;
  INTERIOR_GROUPS: string[];
  FOV: number;
  INSIDE_FOV: number;
};
const loadCamera = async (): Promise<Cam> => (await import(pathToFileURL(path.resolve("tools/workshop3d/render/camera.js")).href)) as Cam;

describe("render page camera (tools/workshop3d/render/camera.js)", () => {
  // a 1.6 x 2.42 x 1.6 m cabin (Y up, floor at 0) with 40 mm walls
  const box: Box = { min: { x: -0.8, y: 0, z: -0.8 }, max: { x: 0.8, y: 2.42, z: 0.8 } };
  const interior: Box = { min: { x: -0.76, y: 0.05, z: -0.76 }, max: { x: 0.76, y: 2.35, z: 0.76 } };
  const inBox = (p: V, b: Box) => p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z;
  const len = (a: V) => Math.hypot(a.x, a.y, a.z);

  it("an exterior camera looks at the bbox centre and stands outside the outer box, even when asked to be too close", async () => {
    const c = await loadCamera();
    for (const dist of [0.3, 1.0, 4.8]) {
      const f = c.frameView({ az: 35, el: 20, dist, box, interior: null });
      expect(f.mode).toBe("exterior");
      expect(f.lookAt).toEqual({ x: 0, y: 1.21, z: 0 });
      expect(inBox(f.position, box), `dist ${dist}`).toBe(false);
      expect(f.fov).toBe(c.FOV);
    }
    const fit = c.frameView({ az: 0, el: 10, dist: 0.1, fit: true, box, interior });
    expect(fit.mode).toBe("exterior");
    expect(len({ x: fit.position.x, y: fit.position.y - 1.21, z: fit.position.z })).toBeGreaterThan(3);
  });

  it("a hollow model: a close camera stands INSIDE the free interior (never in a wall), wide lens, small near plane", async () => {
    const c = await loadCamera();
    for (const dist of [0.1, 0.3, 0.6, 0.77]) {
      const f = c.frameView({ az: 0, el: 15, dist, box, interior });
      expect(f.mode, `dist ${dist}`).toBe("interior");
      expect(inBox(f.position, interior), `dist ${dist}`).toBe(true);
      expect(f.fov).toBe(c.INSIDE_FOV);
      expect(f.near).toBeLessThanOrEqual(0.01);
    }
    // in the outer half of the wall band it goes outside instead
    const out = c.frameView({ az: 0, el: 0, dist: 0.81, box, interior });
    expect(out.mode).toBe("exterior");
    expect(inBox(out.position, box)).toBe(false);
  });

  it("a part close-up (target) inside a hollow model stays inside, looks at the part, even if the distance reaches into a wall", async () => {
    const c = await loadCamera();
    const cop = { x: 0.74, y: 1.15, z: 0.45 }; // panel on the right wall, inside the free interior
    for (const dist of [0.5, 2]) {
      const f = c.frameView({ az: -90, el: 5, dist, box, interior, target: cop });
      expect(f.mode).toBe("interior");
      expect(f.lookAt).toEqual(cop);
      expect(inBox(f.position, interior)).toBe(true);
    }
    // a handle on the outside of the front wall is shot from outside
    const out = c.frameView({ az: 0, el: 0, dist: 0.4, box, interior, target: { x: 0.1, y: 1, z: 0.79 } });
    expect(out.mode).toBe("exterior");
    expect(inBox(out.position, box)).toBe(false);
  });

  it("cutaway: camera outside, near plane past the near wall but before the interior", async () => {
    const c = await loadCamera();
    const f = c.cutaway({ box, interior }, c.direction(0, 0));
    expect(f.mode).toBe("cutaway");
    expect(inBox(f.position, box)).toBe(false);
    const d = len({ x: f.position.x - f.lookAt.x, y: f.position.y - f.lookAt.y, z: f.position.z - f.lookAt.z });
    expect(d - f.near).toBeLessThan(0.76); // the clip plane lies inside the interior: the near wall (z 0.76..0.8) is cut
    expect(d - f.near).toBeGreaterThan(0.6);
  });

  it("interior presets cover ceiling, floor and walls from inside, and classify back to their group", async () => {
    const c = await loadCamera();
    const cop: Box = { min: { x: 0.74, y: 0.9, z: 0.3 }, max: { x: 0.76, y: 1.4, z: 0.6 } };
    for (const g of c.INTERIOR_GROUPS) {
      const f = c.interiorPreset(g, box, interior, cop)!;
      expect(f, g).not.toBeNull();
      if (g === "overview") {
        expect(f.mode).toBe("cutaway");
        continue;
      }
      expect(inBox(f.position, interior), g).toBe(true);
      if (g !== "cop") expect(c.classify(f)).toBe(g);
    }
    expect(c.interiorPreset("cop", box, interior, null)).toBeNull();
  });

  it("a blank view retries with a cutaway first (interior), then a framed exterior view", async () => {
    const c = await loadCamera();
    const o = { az: 0, el: 15, dist: 0.3, box, interior };
    const tries = c.retryFrames(o, c.frameView(o));
    expect(tries[0]!.mode).toBe("cutaway");
    expect(tries[1]!.mode).toBe("exterior");
    // an outside view that came out blank (model a speck at 100 m) retries as a framed outside view
    const far = { az: 0, el: 0, dist: 100, box, interior };
    expect(c.retryFrames(far, c.frameView(far))[0]!.mode).toBe("exterior");
  });

  it("uses the same blank rule as png.ts", async () => {
    const c = await loadCamera();
    for (const k of ["picture", "flat"] as const) {
      const img = decodePng(png(k))!;
      const a = c.pixelStats(img.data);
      const b = pixelStats(img.data);
      expect(a.std).toBeCloseTo(b.std, 6);
      expect(a.dominant).toBeCloseTo(b.dominant, 6);
      expect(c.isBlank(a)).toBe(k === "flat");
    }
  });

  it("the page imports the module, reads views.json, posts shots, builds its light in code", () => {
    const html = fs.readFileSync("tools/workshop3d/render/index.html", "utf8");
    expect(html).toMatch(/from "\/camera\.js"/);
    expect(html).toContain('fetch("/views.json")');
    expect(html).toContain('"/shot?cam="');
    expect(html).toContain('"/finished"');
    expect(html).toContain("PMREMGenerator");
    expect(html).toContain("Reflector");
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe("render assets", () => {
  it("resolves page and three under one app root", () => {
    const a = resolveRenderAssets("/app");
    expect(a.page.split(path.sep).join("/")).toMatch(/\/app\/tools\/workshop3d\/render\/index\.html$/);
    expect(a.threeRoot.split(path.sep).join("/")).toMatch(/\/app\/node_modules\/three$/);
  });
});
