import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVsCore } from "../../src/core/videostudio/core.js";
import type { VsStepManager } from "../../src/core/videostudio/agent.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-engine-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeManager(): VsStepManager {
  return {
    startRun: async () => ({ id: "r1" }),
    waitFor: async () => ({ status: "done", result_text: "", cost_usd_est: 0 }),
    cancel: () => true,
    store: { getProject: () => ({}), upsertProject: () => ({}) },
  };
}

function mk(env?: NodeJS.ProcessEnv) {
  return createVsCore({ manager: fakeManager(), dataDir: dir, ...(env ? { env } : {}) });
}
const input = { title: "Demo", brief: "b", styleId: "news", aspect: "16:9" as const };

describe("videostudio core", () => {
  it("recover dua cac du an ket ve failed", () => {
    const core = mk();
    const states = ["planning", "generating", "editing", "rendering", "ready"] as const;
    const slugs = states.map((s) => {
      const p = core.store.create(input);
      core.store.update(p.slug, { state: s });
      return p.slug;
    });
    expect(core.recover()).toBe(4);
    for (const [i, slug] of slugs.entries()) {
      const p = core.store.get(slug);
      if (i < 4) {
        expect(p.state).toBe("failed");
        expect(p.error).toBe("Bị ngắt khi server khởi động lại.");
      } else {
        expect(p.state).toBe("ready");
      }
    }
  });

  it("addAsset khong co ffprobe van luu, duration null", async () => {
    const core = mk({ PATH: "" });
    const p = core.store.create(input);
    const a = await core.addAsset(p.slug, "a.mp4", Buffer.from("x"));
    expect(a.duration).toBeNull();
    expect(core.store.listAssets(p.slug)).toHaveLength(1);
  });

  function mgr(text: string | (() => Promise<string>), opt: { ok?: boolean; cost?: number } = {}): VsStepManager {
    return {
      startRun: async () => ({ id: "r1" }),
      waitFor: async () => {
        const t = typeof text === "function" ? await text() : text;
        return {
          status: opt.ok === false ? "failed" : "done",
          result_text: t,
          cost_usd_est: opt.cost ?? 0.5,
          ...(opt.ok === false ? { error: "hỏng" } : {}),
        };
      },
      cancel: () => true,
      store: { getProject: () => ({}), upsertProject: () => ({}) },
    };
  }
  const planText = (clips: unknown[]) =>
    "```json\n" + JSON.stringify({ version: 1, width: 1, height: 1, fps: 30, video: clips, audio: [], texts: [] }) + "\n```";
  const pclip = { id: "c1", kind: "image", srcIn: 0, duration: 3, prompt: "Một cảnh biển" };

  it("generatePlan media none: clip thanh card, ready", async () => {
    const core = createVsCore({ manager: mgr(planText([pclip])), dataDir: dir });
    const p = core.store.create(input);
    await core.generatePlan(p.slug);
    const got = core.store.get(p.slug);
    expect(got.state).toBe("ready");
    expect(got.costUsd).toBe(0.5);
    const c = core.store.getPlan(p.slug).video[0]!;
    expect(c.kind).toBe("card");
    expect(c.prompt).toBeUndefined();
    expect(c.asset).toBeUndefined();
    expect(c.cardText).toBe("Một cảnh biển");
  });

  it("ban: 409 dong bo, remove 409, nha khoa sau khi xong", async () => {
    let release!: (s: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const core = createVsCore({ manager: mgr(() => gate), dataDir: dir });
    const p = core.store.create(input);
    const run = core.generatePlan(p.slug);
    expect(core.isBusy(p.slug)).toBe(true);
    expect(() => core.generatePlan(p.slug)).toThrow(/bận/);
    expect(() => core.remove(p.slug)).toThrow(/bận/);
    release(planText([pclip]));
    await run;
    expect(core.isBusy(p.slug)).toBe(false);
  });

  it("loi agent: failed, thong bao tieng Viet, cong chi phi", async () => {
    const core = createVsCore({ manager: mgr("x", { ok: false, cost: 0.3 }), dataDir: dir });
    const p = core.store.create(input);
    await core.generatePlan(p.slug);
    const got = core.store.get(p.slug);
    expect(got.state).toBe("failed");
    expect(got.error).toMatch(/Agent đạo diễn thất bại/);
    expect(got.costUsd).toBe(0.3);
    expect(core.isBusy(p.slug)).toBe(false);
    const core2 = createVsCore({ manager: mgr("khong co json"), dataDir: dir });
    await core2.generatePlan(p.slug);
    expect(core2.store.get(p.slug).state).toBe("failed");
    expect(core2.store.get(p.slug).error).toMatch(/json/);
  });

  it("media http: gan asset sinh ra; loi fetch thi thanh card", async () => {
    const buf = Buffer.from("png-bytes");
    const fetchOk = (async () => new Response(buf, { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    const core = createVsCore({ manager: mgr(planText([pclip])), dataDir: dir, gen: { fetch: fetchOk } });
    core.settings.update({ media: { provider: "http", url: "https://example.com/gen" } });
    const p = core.store.create(input);
    await core.generatePlan(p.slug);
    expect(core.store.get(p.slug).state).toBe("ready");
    const c = core.store.getPlan(p.slug).video[0]!;
    expect(c.asset).toBe("assets/gen-c1.png");
    expect(c.prompt).toBeUndefined();
    const a = core.store.listAssets(p.slug).find((x) => x.rel === "assets/gen-c1.png");
    expect(a?.generated).toBe(true);
    expect(fs.existsSync(path.join(core.store.dir(p.slug), "tmp", "c1.png"))).toBe(false);

    const fetchBad = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const core2 = createVsCore({ manager: mgr(planText([pclip])), dataDir: dir, gen: { fetch: fetchBad } });
    const q = core2.store.create(input);
    await core2.generatePlan(q.slug);
    expect(core2.store.getPlan(q.slug).video[0]!.kind).toBe("card");
  });

  it("editSegment: chi thay doan trong khoang, kiem tra dau vao dong bo", async () => {
    const core = createVsCore({
      manager: mgr('```json\n{"video":[{"id":"n1","kind":"card","srcIn":0,"duration":2,"color":"#112233","cardText":"Mới"}],"texts":[]}\n```'),
      dataDir: dir,
    });
    const p = core.store.create(input);
    const card = (id: string) => ({ id, kind: "card", srcIn: 0, duration: 2, color: "#000000", cardText: id });
    core.store.savePlan(p.slug, { ...core.store.getPlan(p.slug), video: [card("a"), card("b"), card("c")] });
    expect(() => core.editSegment(p.slug, { start: 2, end: 2, instruction: "x" })).toThrow(/Khoảng/);
    expect(() => core.editSegment(p.slug, { start: 0, end: 7, instruction: "x" })).toThrow(/Khoảng/);
    expect(() => core.editSegment(p.slug, { start: -1, end: 2, instruction: "x" })).toThrow(/Khoảng/);
    expect(() => core.editSegment(p.slug, { start: 0, end: 2, instruction: "   " })).toThrow(/Câu lệnh/);
    expect(() => core.editSegment(p.slug, { start: 0, end: 2, instruction: "x".repeat(1001) })).toThrow(/Câu lệnh/);
    const run = core.editSegment(p.slug, { start: 2, end: 4, instruction: "đổi" });
    expect(() => core.editSegment(p.slug, { start: 2, end: 4, instruction: "đổi" })).toThrow(/bận/);
    await run;
    expect(core.store.get(p.slug).state).toBe("ready");
    const ids = core.store.getPlan(p.slug).video.map((c) => c.id);
    expect(ids).toEqual(["a", "n1", "c"]);
  });

  it("editSegment loi agent: failed, nha khoa", async () => {
    const core = createVsCore({ manager: mgr("x", { ok: false }), dataDir: dir });
    const p = core.store.create(input);
    core.store.savePlan(p.slug, {
      ...core.store.getPlan(p.slug),
      video: [{ id: "a", kind: "card", srcIn: 0, duration: 2, color: "#000000", cardText: "a" }],
    });
    await core.editSegment(p.slug, { start: 0, end: 2, instruction: "đổi" });
    expect(core.store.get(p.slug).state).toBe("failed");
    expect(core.store.get(p.slug).error).toMatch(/Agent biên tập thất bại/);
    expect(core.isBusy(p.slug)).toBe(false);
  });

  it("remove du an khong ban", () => {
    const core = mk();
    const p = core.store.create(input);
    core.remove(p.slug);
    expect(core.store.list()).toHaveLength(0);
    expect(core.isBusy(p.slug)).toBe(false);
  });
});
