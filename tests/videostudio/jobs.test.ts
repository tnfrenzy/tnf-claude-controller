import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVsCore } from "../../src/core/videostudio/core.js";
import { createVsJobs } from "../../src/core/videostudio/jobs.js";
import type { VsStepManager } from "../../src/core/videostudio/agent.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-jobs-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const env: NodeJS.ProcessEnv = { PATH: "" };
const manager: VsStepManager = {
  startRun: async () => ({ id: "r1" }),
  waitFor: async () => ({ status: "done", result_text: "", cost_usd_est: 0 }),
  cancel: () => true,
  store: { getProject: () => ({}), upsertProject: () => ({}) },
};
const input = { title: "Demo", brief: "b", styleId: "news", aspect: "16:9" as const };
const card = { id: "c1", kind: "card", srcIn: 0, duration: 3, color: "#000000", cardText: "x" };

function setup(withFfmpeg: boolean) {
  const core = createVsCore({ manager, dataDir: dir, env });
  if (withFfmpeg) {
    const exe = path.join(dir, "ffmpeg.exe");
    fs.writeFileSync(exe, "");
    core.settings.update({ ffmpegPath: exe });
  }
  const p = core.store.create(input);
  core.store.savePlan(p.slug, { ...core.store.getPlan(p.slug), video: [card] } as never);
  return { core, slug: p.slug };
}

function fakeSpawn(code: number, stderr = "") {
  return ((_cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      if (code === 0) fs.writeFileSync(args[args.length - 1]!, "mp4");
      if (stderr) child.stderr.emit("data", stderr);
      child.emit("close", code);
    });
    return child;
  }) as never;
}

describe("videostudio jobs", () => {
  it("render thanh cong: done va lastRender tro toi renders/*.mp4", async () => {
    const { core, slug } = setup(true);
    const jobs = createVsJobs(core, { spawn: fakeSpawn(0), env });
    await jobs.render(slug);
    const got = core.store.get(slug);
    expect(got.state).toBe("done");
    expect(got.lastRender).toMatch(/^renders\/.+\.mp4$/);
    expect(fs.existsSync(core.store.filePath(slug, got.lastRender as string))).toBe(true);
    const rendersDir = path.dirname(core.store.filePath(slug, got.lastRender as string));
    expect(fs.readdirSync(rendersDir).filter((n) => n.startsWith("tmp-"))).toEqual([]);
    expect(core.isBusy(slug)).toBe(false);
  });

  it("render thieu ffmpeg: VsError 400 tieng Viet, state khong doi", () => {
    const { core, slug } = setup(false);
    const before = core.store.get(slug).state;
    const jobs = createVsJobs(core, { spawn: fakeSpawn(0), env });
    let err: { status?: number; message?: string } | undefined;
    try {
      void jobs.render(slug);
    } catch (e) {
      err = e as { status?: number; message?: string };
    }
    expect(err?.message).toMatch(/Không tìm thấy ffmpeg/);
    expect(err?.status).toBe(400);
    expect(core.store.get(slug).state).toBe(before);
    expect(core.isBusy(slug)).toBe(false);
  });

  it("render loi ffmpeg: failed kem error, nha khoa", async () => {
    const { core, slug } = setup(true);
    const jobs = createVsJobs(core, { spawn: fakeSpawn(1, "boom\n"), env });
    await jobs.render(slug);
    const got = core.store.get(slug);
    expect(got.state).toBe("failed");
    expect(got.error).toMatch(/Dựng video thất bại/);
    expect(core.isBusy(slug)).toBe(false);
  });

  it("narrate thay clip voice cu bang clip moi va luu plan", async () => {
    const { core, slug } = setup(false);
    core.settings.update({ voice: { provider: "windows" } });
    const old = core.store.addAsset(slug, "old.wav", Buffer.from("old"), { generated: true });
    core.store.savePlan(slug, {
      ...core.store.getPlan(slug),
      narration: "Xin chào",
      audio: [{ id: "old", asset: old.rel, start: 0, duration: 2, volume: 1, kind: "narration" }],
    } as never);
    const synth = (async (_t: string, file: string) => {
      fs.writeFileSync(file, "RIFFnew");
      return { ok: true, file };
    }) as never;
    const jobs = createVsJobs(core, { synth, probe: async () => 4.5, env });
    await jobs.narrate(slug);
    const audio = core.store.getPlan(slug).audio;
    expect(audio).toHaveLength(1);
    expect(audio[0]!.kind).toBe("narration");
    expect(audio[0]!.id).not.toBe("old");
    expect(audio[0]!.duration).toBe(4.5);
    expect(fs.existsSync(core.store.filePath(slug, audio[0]!.asset))).toBe(true);
    expect(core.isBusy(slug)).toBe(false);
  });

  it("narrate khong co probe/ffprobe: duration = planDuration sau khi bo clip narration cu", async () => {
    const { core, slug } = setup(false);
    core.settings.update({ voice: { provider: "windows" } });
    const old = core.store.addAsset(slug, "old.wav", Buffer.from("old"), { generated: true });
    core.store.savePlan(slug, {
      ...core.store.getPlan(slug),
      narration: "Xin chào",
      audio: [{ id: "old", asset: old.rel, start: 0, duration: 50, volume: 1, kind: "narration" }],
    } as never);
    const synth = (async (_t: string, file: string) => {
      fs.writeFileSync(file, "RIFFnew");
      return { ok: true, file };
    }) as never;
    const jobs = createVsJobs(core, { synth, env });
    await jobs.narrate(slug);
    const audio = core.store.getPlan(slug).audio;
    expect(audio).toHaveLength(1);
    expect(audio[0]!.id).not.toBe("old");
    expect(audio[0]!.duration).toBe(3);
  });

  it("narrate khong co narration hoac provider none: VsError 400 dong bo, state khong doi", () => {
    const { core, slug } = setup(false);
    const before = core.store.get(slug).state;
    const jobs = createVsJobs(core, { env });
    const run = (): { status?: number; message?: string } | undefined => {
      try {
        void jobs.narrate(slug);
      } catch (e) {
        return e as { status?: number; message?: string };
      }
      return undefined;
    };
    core.settings.update({ voice: { provider: "windows" } });
    const e1 = run();
    expect(e1?.status).toBe(400);
    expect(e1?.message).toMatch(/lời đọc/);
    core.store.savePlan(slug, { ...core.store.getPlan(slug), narration: "Xin chào" } as never);
    core.settings.update({ voice: { provider: "none" } });
    const e2 = run();
    expect(e2?.status).toBe(400);
    expect(e2?.message).toMatch(/giọng đọc/);
    expect(core.store.get(slug).state).toBe(before);
    expect(core.isBusy(slug)).toBe(false);
  });

  it("narrate loi synth: failed kem error, nha khoa", async () => {
    const { core, slug } = setup(false);
    core.settings.update({ voice: { provider: "windows" } });
    core.store.savePlan(slug, { ...core.store.getPlan(slug), narration: "Xin chào" } as never);
    const synth = (async () => ({ ok: false, error: "hỏng" })) as never;
    const jobs = createVsJobs(core, { synth, probe: async () => null, env });
    await jobs.narrate(slug);
    expect(core.store.get(slug).state).toBe("failed");
    expect(core.store.get(slug).error).toMatch(/Không tạo được giọng đọc/);
    expect(core.isBusy(slug)).toBe(false);
  });
});
