// Blender high-quality step (blender.ts) with a fake Blender: discovery, view selection, checkpoint / resume, timeout, blank retry, GLB export.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseW3DBlender, W3D_BLENDER_DEFAULTS } from "../../src/core/app/config.js";
import {
  BLENDER_GLB, exportBlenderGlb, findBlender, HQ_MANIFEST, hqRenderFiles, looksHollow, parseBlenderResult, readHqExposure, readHqProgress, renderHq, selectHqViews,
  type BlenderRun,
} from "../../src/core/workshop3d/blender.js";
import { encodePng } from "../../src/core/workshop3d/png.js";
import { initialSnapshot } from "../../src/core/workshop3d/state.js";
import { createW3DStore, type W3DStore } from "../../src/core/workshop3d/store.js";

const brief = { title: "Cabin", object: "cabin", params: {}, detail: "standard" as const, attachments: [] };

function png(blank: boolean): Buffer {
  const w = 32, h = 24;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = blank ? 128 : (i * 37) % 255;
    data.set([v, (v * 3) % 255, 255 - v, 255], i * 4);
  }
  return encodePng({ width: w, height: h, data });
}

/** Fake Blender: reads the job file (last arg), writes job.out unless told otherwise, prints the W3D_RESULT line. */
function fakeBlender(behave: (job: { view?: { name: string }; attempt?: number; out: string }) => "ok" | "blank" | "timeout" | "error" | "abort" = () => "ok") {
  const calls: { view: string; attempt: number }[] = [];
  const run: BlenderRun = async (_exe, args) => {
    const job = JSON.parse(fs.readFileSync(args[args.length - 1]!, "utf8"));
    const name = job.view?.name ?? "export";
    calls.push({ view: name, attempt: job.attempt ?? 0 });
    const b = behave(job);
    if (b === "abort") return { code: null, stdout: "", stderr: "", timedOut: false, aborted: true };
    if (b === "timeout") return { code: null, stdout: "", stderr: "", timedOut: true, aborted: false };
    if (b === "error") return { code: 1, stdout: 'W3D_RESULT {"ok": false, "error": "CUDA out of memory"}\n', stderr: "", timedOut: false, aborted: false };
    fs.writeFileSync(job.out, job.view ? png(b === "blank") : Buffer.from("glTF"));
    return { code: 0, stdout: `noise\nW3D_RESULT {"ok": true, "device": "CUDA", "mode": "interior", "seconds": 12.5, "warnings": ["Thiếu HDRI"]}\nBlender quit\n`, stderr: "", timedOut: false, aborted: false };
  };
  return { run, calls };
}

let tmp: string;
let store: W3DStore;
let slug: string;
const cfg = { ...W3D_BLENDER_DEFAULTS, perImageTimeoutSec: 60 };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-blender-"));
  store = createW3DStore(tmp);
  slug = store.create(brief, initialSnapshot({}));
  fs.mkdirSync(path.join(store.dir(slug), "outputs"), { recursive: true });
  fs.writeFileSync(path.join(store.dir(slug), "outputs", "model.glb"), "glb");
  fs.writeFileSync(path.join(store.dir(slug), "materials.json"), JSON.stringify({ materials: {} }));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("findBlender", () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);
  it("TNF_BLENDER, then configured paths, then the newest folder under D:\\tnf-cad-tools\\blender", () => {
    const scan = () => ["blender-4.2.0-windows-x64", "blender-5.2.4-windows-x64"];
    const newest = "D:\\tnf-cad-tools\\blender\\blender-5.2.4-windows-x64\\blender.exe";
    expect(findBlender({ TNF_BLENDER: "E:\\b\\blender.exe" }, ["C:\\cfg\\blender.exe"], exists(["E:\\b\\blender.exe", newest]), scan)).toBe("E:\\b\\blender.exe");
    expect(findBlender({}, [null, "C:\\cfg\\blender.exe"], exists(["C:\\cfg\\blender.exe", newest]), scan)).toBe("C:\\cfg\\blender.exe");
    expect(findBlender({}, [], exists([newest, "D:\\tnf-cad-tools\\blender\\blender-4.2.0-windows-x64\\blender.exe"]), scan)).toBe(newest);
    expect(findBlender({}, [], exists([]), scan)).toBeNull();
  });
});

describe("config workshop3d.blender", () => {
  it("defaults, clamps and drops bad view names", () => {
    expect(parseW3DBlender(undefined)).toEqual(W3D_BLENDER_DEFAULTS);
    const c = parseW3DBlender({ width: 99999, samples: -3, device: "gpu", views: ["door", "plan:mat_truoc", "../x"], finalFixRounds: 9, inLoop: true, loop: { samples: 8 } });
    expect(c.width).toBe(4096);
    expect(c.samples).toBe(1);
    expect(c.device).toBe("auto");
    expect(c.views).toEqual(["door", "plan:mat_truoc"]);
    expect(c.finalFixRounds).toBe(3);
    expect(c.inLoop).toBe(true);
    expect(c.loop).toEqual({ width: 640, height: 480, samples: 8 });
    expect(W3D_BLENDER_DEFAULTS.perImageTimeoutSec).toBeGreaterThanOrEqual(900);
  });
});

describe("view selection", () => {
  const plan = { environment: "studio" as const, exposure: 1, cameras: [{ name: "Mặt trước", azimuth: 0, elevation: 10, distance: 5 }, { name: "can_cop", azimuth: 180, elevation: 5, distance: 0.6, target: "cop_tam" }] };
  it("hollow or unknown model: the six default interior presets", () => {
    expect(selectHqViews(plan, [], true).map((v) => v.name)).toEqual(["overview", "door", "ceiling", "wall_left", "wall_right", "cop"]);
    expect(selectHqViews(null, [], null)).toHaveLength(6);
  });
  it("solid model: the render-director's cameras (orbit, glTF degrees)", () => {
    const v = selectHqViews(plan, [], false);
    expect(v.map((x) => x.name)).toEqual(["plan_m_t_tr_c", "plan_can_cop"]);
    expect(v[1]!.orbit).toEqual({ az: 180, el: 5, dist: 0.6, target: "cop_tam" });
  });
  it("configured names win; plan:<camera> picks a plan camera; unknown names are dropped", () => {
    expect(selectHqViews(plan, ["cop", "plan:can_cop", "nope"], true).map((v) => v.name)).toEqual(["cop", "plan_can_cop"]);
  });
  it("hollow detection from the three.js render-info.json", () => {
    expect(looksHollow({ views: [{ name: "front", mode: "exterior" }, { name: "auto_ceiling", auto: true }] })).toBe(true);
    expect(looksHollow({ views: [{ name: "front", mode: "exterior" }] })).toBe(false);
    expect(looksHollow(null)).toBeNull();
  });
  it("W3D_RESULT is read from the last marked line", () => {
    expect(parseBlenderResult("x\nW3D_RESULT {\"ok\": true}\nBlender quit")).toEqual({ ok: true });
    expect(parseBlenderResult("nothing")).toBeNull();
  });
});

describe("renderHq", () => {
  it("without Blender nothing runs and the reason is Vietnamese", async () => {
    const r = await renderHq(store, slug, cfg, { blender: null }, { profile: "final" });
    expect(r.ok).toBe(false);
    expect(r.skipped).toMatch(/Không tìm thấy Blender/);
  });

  it("renders every view once, checkpoints each, and a second call reuses them all", async () => {
    const f = fakeBlender();
    const r = await renderHq(store, slug, cfg, { blender: "blender.exe", run: f.run }, { profile: "final" });
    expect(r.ok).toBe(true);
    expect(r.rendered).toHaveLength(6);
    expect(r.files[0]).toBe("renders/hq/overview.png");
    expect(r.warnings).toContain("Thiếu HDRI");
    expect(hqRenderFiles(store.dir(slug))).toHaveLength(6);
    const p = readHqProgress(store.dir(slug))!;
    expect(p.running).toBe(false);
    expect(p.done).toBe(6);
    const again = fakeBlender();
    const r2 = await renderHq(store, slug, cfg, { blender: "blender.exe", run: again.run }, { profile: "final" });
    expect(again.calls).toHaveLength(0);
    expect(r2.reused).toHaveLength(6);
  });

  it("exposure boost renders only the named views again, with cfg.exposure + boost, and later redo keeps it", async () => {
    const exposures: Record<string, number> = {};
    const mk = () => {
      const f = fakeBlender((job) => {
        exposures[job.view!.name] = (job as unknown as { exposure: number }).exposure;
        return "ok";
      });
      return f;
    };
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: mk().run }, { profile: "final" });
    expect(exposures["door"]).toBe(cfg.exposure);
    const f2 = mk();
    const r = await renderHq(store, slug, cfg, { blender: "blender.exe", run: f2.run }, { profile: "final", exposureBoost: { door: 0.9, nope: 1 } });
    expect(f2.calls.map((c) => c.view)).toEqual(["door"]);
    expect(r.reused).toHaveLength(5);
    expect(exposures["door"]).toBeCloseTo(cfg.exposure + 0.9, 5);
    expect(readHqExposure(store.dir(slug))["door"]).toBe(0.9);
    const f3 = mk();
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: f3.run }, { profile: "final", redo: ["door"] });
    expect(exposures["door"]).toBeCloseTo(cfg.exposure + 0.9, 5);
    const f4 = mk();
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: f4.run }, { profile: "final" });
    expect(f4.calls).toHaveLength(0);
  });

  it("resume after an interruption renders only the missing views", async () => {
    let n = 0;
    const first = fakeBlender(() => (++n > 2 ? "abort" : "ok"));
    const r = await renderHq(store, slug, cfg, { blender: "blender.exe", run: first.run }, { profile: "final" });
    expect(r.aborted).toBe(true);
    expect(Object.keys(JSON.parse(fs.readFileSync(path.join(store.dir(slug), HQ_MANIFEST), "utf8")).views)).toEqual(["overview", "door"]);
    const second = fakeBlender();
    const r2 = await renderHq(store, slug, cfg, { blender: "blender.exe", run: second.run }, { profile: "final" });
    expect(second.calls.map((c) => c.view)).toEqual(["ceiling", "wall_left", "wall_right", "cop"]);
    expect(r2.files).toHaveLength(6);
  });

  it("stops before starting the next view when the session left the step", async () => {
    let go = true;
    const f = fakeBlender(() => {
      go = false;
      return "ok";
    });
    const r = await renderHq(store, slug, cfg, { blender: "blender.exe", run: f.run }, { profile: "final", shouldContinue: () => go });
    expect(r.aborted).toBe(true);
    expect(f.calls).toHaveLength(1);
  });

  it("redo renders only the named views again", async () => {
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: fakeBlender().run }, { profile: "final" });
    const f = fakeBlender();
    const r = await renderHq(store, slug, cfg, { blender: "blender.exe", run: f.run }, { profile: "final", redo: ["door", "cop"] });
    expect(f.calls.map((c) => c.view)).toEqual(["door", "cop"]);
    expect(r.files).toHaveLength(6);
  });

  it("redo names outside the set are dropped; none left -> the first two views, never the whole set", async () => {
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: fakeBlender().run }, { profile: "final" });
    const f = fakeBlender();
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: f.run }, { profile: "final", redo: ["floor", "cop"] });
    expect(f.calls.map((c) => c.view)).toEqual(["cop"]);
    const g = fakeBlender();
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: g.run }, { profile: "final", redo: ["floor"] });
    expect(g.calls.map((c) => c.view)).toEqual(["overview", "door"]);
  });

  it("a timeout or a Blender error drops that view only, with a Vietnamese warning", async () => {
    const f = fakeBlender((job) => (job.view?.name === "ceiling" ? "timeout" : job.view?.name === "cop" ? "error" : "ok"));
    const r = await renderHq(store, slug, cfg, { blender: "blender.exe", run: f.run }, { profile: "final" });
    expect(r.ok).toBe(true);
    expect(r.files).toHaveLength(4);
    expect(r.failed.map((x) => x.name)).toEqual(["ceiling", "cop"]);
    expect(r.warnings.join(" ")).toMatch(/quá 60 giây/);
    expect(r.warnings.join(" ")).toMatch(/CUDA out of memory/);
  });

  it("a blank image is rendered once more with the wider camera, then dropped if still blank", async () => {
    const f = fakeBlender((job) => (job.view?.name === "door" && job.attempt === 0 ? "blank" : job.view?.name === "cop" ? "blank" : "ok"));
    const r = await renderHq(store, slug, cfg, { blender: "blender.exe", run: f.run }, { profile: "final" });
    expect(f.calls.filter((c) => c.view === "door").map((c) => c.attempt)).toEqual([0, 1]);
    expect(r.files).toContain("renders/hq/door.png");
    expect(r.blank).toEqual(["cop"]);
    expect(fs.existsSync(path.join(store.dir(slug), "renders/hq/cop.png"))).toBe(false);
  });

  it("changed settings render again; loop profile always renders every view", async () => {
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: fakeBlender().run }, { profile: "final" });
    const f = fakeBlender();
    await renderHq(store, slug, { ...cfg, samples: 128 }, { blender: "blender.exe", run: f.run }, { profile: "final" });
    expect(f.calls).toHaveLength(6);
    const g = fakeBlender();
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: g.run }, { profile: "loop" });
    await renderHq(store, slug, cfg, { blender: "blender.exe", run: g.run }, { profile: "loop" });
    expect(g.calls).toHaveLength(12);
  });
});

describe("exportBlenderGlb", () => {
  it("keeps the GLB only with 0 validator errors and skips an unchanged export", async () => {
    const f = fakeBlender();
    const ok = await exportBlenderGlb(store, slug, cfg, { blender: "b.exe", run: f.run, validateGlb: async () => ({ errors: 0, warnings: 1, messages: [] }) });
    expect(ok.ok).toBe(true);
    expect(fs.existsSync(path.join(store.dir(slug), BLENDER_GLB))).toBe(true);
    await exportBlenderGlb(store, slug, cfg, { blender: "b.exe", run: f.run, validateGlb: async () => ({ errors: 0, warnings: 0, messages: [] }) });
    expect(f.calls).toHaveLength(1);
  });
  it("a GLB with validator errors is removed and the old GLB stays for the viewer", async () => {
    const r = await exportBlenderGlb(store, slug, cfg, { blender: "b.exe", run: fakeBlender().run, validateGlb: async () => ({ errors: 2, warnings: 0, messages: ["bad accessor"] }) });
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/gltf-validator/);
    expect(fs.existsSync(path.join(store.dir(slug), BLENDER_GLB))).toBe(false);
  });
  it("exportGlb false or no Blender: skipped", async () => {
    expect((await exportBlenderGlb(store, slug, { ...cfg, exportGlb: false }, { blender: "b.exe" })).skipped).toBe(true);
    expect((await exportBlenderGlb(store, slug, cfg, { blender: null })).skipped).toBe(true);
  });
});
