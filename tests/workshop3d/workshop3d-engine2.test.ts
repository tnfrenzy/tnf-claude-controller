// Engine fixes after the first real cabin run: no silent brief cut, intake must ask, reference images,
// early stop when the review total does not improve (best version restored), automatic resume after interruptions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuildResult } from "../../src/core/workshop3d/build.js";
import { createW3DRunner, type W3DRunnerDeps } from "../../src/core/workshop3d/runner.js";
import { AUTO_RESUME_DELAYS_MS, W3DError } from "../../src/core/workshop3d/state.js";
import type { W3DStepResult } from "../../src/core/workshop3d/step-adapter.js";
import { createW3DStore, type W3DStore } from "../../src/core/workshop3d/store.js";
import type { W3DBrief, Workshop3DRole } from "../../src/core/workshop3d/types.js";

const json = (o: unknown): string => "```json\n" + JSON.stringify(o) + "\n```";
const MAT = { color: [0.8, 0.8, 0.8], metallic: 1, roughness: 0.2 };
const verdict = (beauty: number, ok = false) => json({ scores: { beauty, detail: 5, proportion: 5 }, ok, issues: ok ? [] : [{ target: "geometry", text: "lệch vách" }] });
const script = (tag: string) => "```python\nPARAMS = {\"w\": 1100}\nprint('" + tag + "')\n```";
const DEFAULTS: Record<Workshop3DRole, string> = {
  "tiep-nhan-3d": json({ done: true, questions: [], brief: { title: "Cabin", object: "cabin thang máy", detail: "high", params: { w: 1100 } } }),
  "art-director": json({ style: "sang trọng", palette: ["#c0c0c0"], materials: ["inox sọc"] }),
  "detail-planner": json({ bbox_mm: [1100, 1400, 2300], tolerance_mm: 2, parts: [{ id: "floor", name: "Sàn", material: "đá" }] }),
  "cad-modeler": script("model"),
  "material-artist": json({ materials: { floor: MAT } }),
  "render-director": json({ environment: "studio", exposure: 1, cameras: [] }),
  "visual-reviewer": verdict(9, true),
  "ar-optimizer": json({ max_triangles: 100000, texture_px: 1024, notes: "ổn" }),
  "render-presenter": "# Báo cáo",
};
const BRIEF: W3DBrief = { title: "Cabin", object: "cabin", params: { w: 1000 }, detail: "standard", attachments: [] };
const BUILD_OK: BuildResult = { ok: true, stage: "done", bboxMm: [1100, 1400, 2300], triangles: 5000, glbBytes: 100, warnings: [], files: [] };
// Smallest valid PNG header bytes plus a non-UTF-8 tail: a text write would corrupt them.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x81, 0xc3, 0x28]);

type Reply = Partial<W3DStepResult> | string;
let tmp: string;
let store: W3DStore;
let clock: number;
let sleeps: number[];
let calls: { role: Workshop3DRole; prompt: string }[];
let replies: Partial<Record<Workshop3DRole, Reply[]>>;
let renderN: number;

const promptsOf = (role: Workshop3DRole): string[] => calls.filter((c) => c.role === role).map((c) => c.prompt);

function deps(over: Partial<W3DRunnerDeps> = {}): W3DRunnerDeps {
  return {
    store,
    runStep: async (role, prompt) => {
      calls.push({ role, prompt });
      await new Promise((r) => setTimeout(r, 1));
      const q = replies[role];
      const reply: Reply = q && q.length > 0 ? q.shift()! : DEFAULTS[role];
      const base: W3DStepResult = { runId: "r", costUsd: 0.01, text: "", ok: true, interrupted: false, rateLimited: false, cancelled: false };
      return typeof reply === "string" ? { ...base, text: reply } : { ...base, text: DEFAULTS[role], ...reply };
    },
    build: async (slug) => {
      // Each build writes outputs/ like the real one (the best version keeps a copy of it).
      store.writeFile(slug, "outputs/model.glb", `glb of ${store.readFile(slug, "model.py")?.trim()}`);
      return BUILD_OK;
    },
    assemble: async () => BUILD_OK,
    render: async (slug) => {
      renderN++;
      store.writeFile(slug, "renders/front.png", `render ${renderN}`);
      return { ok: true, files: ["renders/front.png"] };
    },
    patchParams: async () => ({ ok: true, changed: [], ignored: [] }),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    quotaResetAt: () => null,
    ...over,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-engine2-"));
  store = createW3DStore(tmp);
  clock = 5_000_000;
  sleeps = [];
  calls = [];
  replies = {};
  renderN = 0;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("brief length: never cut silently", () => {
  it("start() refuses a description over 4000 characters with the limit in Vietnamese", () => {
    const runner = createW3DRunner(deps());
    expect(() => runner.start({ ...BRIEF, object: "x".repeat(4001) })).toThrow(W3DError);
    expect(() => runner.start({ ...BRIEF, object: "x".repeat(4001) })).toThrow(/4000 ký tự/);
  });
  it("a 560-character description reaches the intake role whole (the old 400 cap lost the door width)", async () => {
    const object = `${"Cabin inox sọc nhuyễn, vách hậu gương, trần dải đèn hộp vuông, sàn đá đỏ. ".repeat(6)}Cửa hai cánh mở từ tâm, rộng thông thủy 900 mm.`;
    expect(object.length).toBeGreaterThan(400);
    const runner = createW3DRunner(deps());
    runner.start({ ...BRIEF, object });
    await runner.idle();
    const p = promptsOf("tiep-nhan-3d")[0]!;
    expect(p).toContain("rộng thông thủy 900 mm");
    expect(p).not.toContain("(đã cắt)");
  });
  it("an old session whose brief is longer than the limit gets a loud warning and the intake must ask", async () => {
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    // Hand-edited / old brief.json beyond the limit, back at intake.
    const rec = store.get(slug)!;
    store.saveBrief(slug, { ...rec.brief, object: "y".repeat(4500) });
    store.saveSnapshot(slug, { ...rec.snapshot, state: "paused", resumeState: "intake" });
    replies["tiep-nhan-3d"] = [DEFAULTS["tiep-nhan-3d"], json({ done: false, questions: ["Cửa rộng thông thủy bao nhiêu mm?"] })];
    calls = [];
    runner.resume(slug);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("awaiting_user");
    expect(s.questions).toEqual(["Cửa rộng thông thủy bao nhiêu mm?"]);
    const prompts = promptsOf("tiep-nhan-3d");
    expect(prompts[0]).toContain("CẢNH BÁO: mô tả vật thể bị cắt (dài 4500 ký tự, chỉ giữ 4000)");
    expect(prompts[1]).toContain("Mô tả vật thể bị cắt nên chưa đủ thông tin");
  });
});

describe("intake must ask before settling for \"chưa rõ\"", () => {
  it("a first-round brief with an unknown key value is sent back; the role then asks", async () => {
    replies["tiep-nhan-3d"] = [
      json({ done: true, questions: [], brief: { title: "Cabin", object: "cabin", detail: "high", params: { rong_mm: 1600, cua_mm: "chưa rõ" } } }),
      json({ done: false, questions: ["Cửa rộng thông thủy bao nhiêu mm?"] }),
    ];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("awaiting_user");
    expect(promptsOf("tiep-nhan-3d")[1]).toContain('Còn thông số "chưa rõ"');
    expect(promptsOf("tiep-nhan-3d")[1]).toContain("cua_mm");
  });
  it("after one question round the brief may keep \"chưa rõ\" (the user chose not to say)", async () => {
    replies["tiep-nhan-3d"] = [
      json({ done: false, questions: ["Cửa rộng bao nhiêu?"] }),
      json({ done: true, questions: [], brief: { title: "Cabin", object: "cabin", detail: "high", params: { cua_mm: "chưa rõ" } } }),
    ];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    runner.answer(slug, "Chưa biết, cứ để chưa rõ.");
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(store.get(slug)!.brief.params["cua_mm"]).toBe("chưa rõ");
  });
});

describe("reference images", () => {
  it("binary images are written byte for byte to inbox/ and listed for the roles that must look at them", async () => {
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF, { "mau-cabin.png": PNG, "ghi-chu.txt": "chữ" });
    await runner.idle();
    expect(fs.readFileSync(path.join(store.dir(slug), "inbox", "mau-cabin.png")).equals(PNG)).toBe(true);
    expect(store.get(slug)!.brief.attachments).toEqual(["mau-cabin.png", "ghi-chu.txt"]);
    const want = path.join(store.dir(slug), "inbox", "mau-cabin.png").replace(/\\/g, "/");
    for (const role of ["tiep-nhan-3d", "art-director", "detail-planner", "visual-reviewer"] as const) {
      const p = promptsOf(role)[0]!;
      expect(p, role).toContain(want);
      expect(p, role).toContain("dùng công cụ Read mở TỪNG ảnh");
      expect(p, role).not.toContain("inbox/ghi-chu.txt"); // a text file is not a reference image
    }
    expect(promptsOf("tiep-nhan-3d")[0]).toContain("Đừng hỏi kích thước");
    expect(promptsOf("visual-reviewer")[0]).toContain("likeness");
    expect(promptsOf("cad-modeler")[0]).not.toContain(want);
  });
});

describe("early stop when the review total does not improve", () => {
  it("2 reviews in a row without a better total stop the loop and restore the best version", async () => {
    replies["cad-modeler"] = [script("v0"), script("v1"), script("v2"), script("v3")];
    replies["visual-reviewer"] = [verdict(6), verdict(5), verdict(6), verdict(9)];
    const runner = createW3DRunner(deps({ limits: { maxNoImprove: 2 } }));
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(promptsOf("visual-reviewer")).toHaveLength(3); // round 0 (best), rounds 1 and 2 not better
    expect(promptsOf("cad-modeler")).toHaveLength(3);
    expect(s.note).toMatch(/Dừng sửa sớm: 2 vòng liên tiếp không tăng tổng điểm \(tốt nhất 16 ở vòng 0, vòng này 16\)/);
    expect(s).toMatchObject({ bestScore: 16, bestRound: 0, noImprove: 2 });
    // The best version (round 0) is back: script, build outputs, render and review.
    expect(store.readFile(slug, "model.py")).toContain("print('v0')");
    expect(store.readFile(slug, "outputs/model.glb")).toContain("v0");
    expect(store.readFile(slug, "renders/front.png")).toBe("render 1");
    expect(JSON.parse(store.readFile(slug, "review.json")!).scores.beauty).toBe(6);
  });
  it("an improving loop is not stopped early; the last (best) version stays", async () => {
    replies["cad-modeler"] = [script("v0"), script("v1"), script("v2")];
    replies["visual-reviewer"] = [verdict(5), verdict(6), verdict(8, true)];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.note ?? "").not.toMatch(/Dừng sửa sớm/);
    expect(store.readFile(slug, "model.py")).toContain("print('v2')");
  });
  it("the limit is configurable (limits.maxNoImprove = 0 turns the early stop off)", async () => {
    replies["visual-reviewer"] = Array.from({ length: 4 }, () => verdict(5));
    const runner = createW3DRunner(deps({ limits: { maxNoImprove: 0, maxFixRounds: 3 } }));
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(promptsOf("visual-reviewer")).toHaveLength(4);
    expect(store.get(slug)!.snapshot.note).toMatch(/tối đa \(3\)/);
  });
});

describe("automatic resume after interruptions", () => {
  const cut: Reply = { ok: false, interrupted: true, error: "subagent_interrupted" };
  it("3 interruptions in a row wait 30 s, then the step runs again by itself", async () => {
    replies["art-director"] = [cut, cut, cut];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(AUTO_RESUME_DELAYS_MS[0]);
    expect(promptsOf("art-director")).toHaveLength(4);
    expect(s.note).toMatch(/tự tiếp tục sau 30 giây \(lần 1\/5\)/);
    expect(s.autoResumes).toBe(0); // cleared by the next successful step
  });
  it("gives up after 5 automatic resumes with growing delays, then failed (manual resume still works)", async () => {
    replies["art-director"] = Array.from({ length: 18 }, () => cut);
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    let s = store.get(slug)!.snapshot;
    expect(s.state).toBe("failed");
    expect(s.resumeState).toBe("art");
    expect(s.error).toMatch(/đã tự tiếp tục 5 lần/);
    expect(promptsOf("art-director")).toHaveLength(18);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(AUTO_RESUME_DELAYS_MS.reduce((a, b) => a + b, 0));
    runner.resume(slug);
    await runner.idle();
    s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
  });
  it("logic errors (invalid output) never resume by themselves", async () => {
    replies["art-director"] = ["không có json", "vẫn không", "lại không"];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("failed");
    expect(sleeps).toEqual([]);
  });
  it("a temporary infrastructure error (ECONNRESET) counts as transient", async () => {
    replies["detail-planner"] = [{ ok: false, error: "read ECONNRESET" }, { ok: false, error: "read ECONNRESET" }, { ok: false, error: "read ECONNRESET" }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(AUTO_RESUME_DELAYS_MS[0]);
  });
  it("pause during the automatic wait keeps the step; resume runs it", async () => {
    replies["art-director"] = [cut, cut, cut];
    let slug = "";
    const runner = createW3DRunner(deps({
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
        runner.pause(slug);
      },
    }));
    slug = runner.start(BRIEF);
    await runner.idle();
    let s = store.get(slug)!.snapshot;
    expect(s.state).toBe("paused");
    expect(s.resumeState).toBe("art");
    expect(s.waitReason).toBeNull();
    runner.resume(slug);
    await runner.idle();
    s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
  });
});

describe("role prompts after the real cabin run", () => {
  const roles = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "config", "roles-design3d.json"), "utf8")) as Record<string, { prompt: string }>;
  it("intake must ask on a cut request or unknown key values, and keeps clear sizes apart", () => {
    const p = roles["tiep-nhan-3d"]!.prompt;
    expect(p).toMatch(/MUST set done=false and ask/);
    expect(p).toContain("(đã cắt)");
    expect(p).toContain("cua_thong_thuy_mm");
    expect(p).toMatch(/open EACH one with the Read tool/);
  });
  it("art director, planner and reviewer open the reference images; the reviewer scores likeness", () => {
    for (const id of ["art-director", "detail-planner", "visual-reviewer"]) expect(roles[id]!.prompt, id).toMatch(/open (EACH|them)/);
    expect(roles["visual-reviewer"]!.prompt).toMatch(/scores\.likeness/);
    expect(roles["detail-planner"]!.prompt).toMatch(/add up EXACTLY to the clear inside length/);
  });
  it("cad-modeler: short, functions, split_panels, clear size vs frame and sill", () => {
    const p = roles["cad-modeler"]!.prompt;
    expect(p).toMatch(/about 300 lines or fewer, one small function per group of parts/);
    expect(p).toContain("def split_panels(length, count, gap)");
    expect(p).toMatch(/1494 instead of 1500/);
    expect(p).toMatch(/placed in FRONT of the clear depth/);
    expect(p).toMatch(/not the frame outer width/);
  });
});

describe("an approved round is never replaced by the best version", () => {
  it("ok=true with a lower total than an earlier round keeps the approved files", async () => {
    replies["cad-modeler"] = [script("v0"), script("v1")];
    replies["visual-reviewer"] = [verdict(9), verdict(7, true)];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(store.readFile(slug, "model.py")).toContain("print('v1')");
    expect(JSON.parse(store.readFile(slug, "review.json")!).ok).toBe(true);
  });
});
