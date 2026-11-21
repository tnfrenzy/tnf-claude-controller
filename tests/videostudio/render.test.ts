import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { buildFfmpegArgs, probeDuration, runFfmpeg } from "../../src/core/videostudio/render.js";
import { VsError } from "../../src/core/videostudio/plan.js";
import type { VsPlan, VsStyle, VsVideoClip } from "../../src/core/videostudio/plan-types.js";

const OPTS = { projectDir: "C:\\proj", outFile: "C:\\proj\\out.mp4", workDir: "C:\\work" };

function style(over: Partial<VsStyle> = {}): VsStyle {
  return {
    id: "s", name: "S", builtin: false, transition: "none", transitionSec: 1,
    shotSec: 4, font: "", textColor: "#ffffff", textBox: false, visualPrompt: "",
    ...over,
  };
}
function plan(over: Partial<VsPlan> = {}): VsPlan {
  return {
    version: 1, width: 1280, height: 720, fps: 30,
    video: [
      { id: "a", kind: "video", asset: "assets/a.mp4", srcIn: 2, duration: 4 },
      { id: "b", kind: "image", asset: "assets/b.png", srcIn: 0, duration: 4 },
      { id: "c", kind: "card", srcIn: 0, duration: 4, cardText: "Xin chào ABC" },
    ],
    audio: [], texts: [],
    ...over,
  };
}
const fc = (args: string[]): string => args[args.indexOf("-filter_complex") + 1]!;
const count = (args: string[], v: string): number => args.filter((a) => a === v).length;
const tValues = (args: string[]): string[] =>
  args.map((a, i) => (a === "-t" ? args[i + 1]! : "")).filter((x) => x !== "");

describe("buildFfmpegArgs", () => {
  it("3 clips -> 4 inputs and one concat", () => {
    const { args } = buildFfmpegArgs(plan(), style(), OPTS);
    expect(count(args, "-i")).toBe(4);
    expect(count(args, "-filter_complex")).toBe(1);
    expect(fc(args)).toContain("concat=n=3");
    expect(args.join(" ")).toContain("anullsrc");
    expect(args[0]).toBe("-nostdin");
  });

  it("user text only in textFiles", () => {
    const p = plan({ texts: [{ id: "t", text: "Xin chào ABC", start: 1, duration: 2 }] });
    const { args, textFiles } = buildFfmpegArgs(p, style(), OPTS);
    expect(args.join(" ")).not.toContain("Xin chào");
    expect(textFiles.length).toBe(2);
    expect(textFiles.every((f) => f.content === "Xin chào ABC")).toBe(true);
    expect(textFiles.every((f) => f.path.startsWith("C:\\work") || f.path.startsWith("C:/work"))).toBe(true);
  });

  it("fade uses xfade with offsets and stretched inputs", () => {
    const { args } = buildFfmpegArgs(plan(), style({ transition: "fade", transitionSec: 1 }), OPTS);
    const f = fc(args);
    expect(f).toContain("xfade=transition=fade");
    expect(f).not.toContain("concat=");
    expect(f).toContain("offset=4");
    expect(f).toContain("offset=8");
    // video and image inputs get d+T; the last (card, lavfi) keeps d=4
    expect(tValues(args)).toEqual(["5", "5", "12", "12"]);
    expect(args.join(" ")).toContain(":d=4");
    expect(tValues(args).at(-1)).toBe("12");
  });

  it("none keeps durations", () => {
    const { args } = buildFfmpegArgs(plan(), style(), OPTS);
    expect(fc(args)).not.toContain("xfade");
    expect(tValues(args)).toEqual(["4", "4", "12", "12"]);
  });

  it("transitionSec <= 0 behaves as none", () => {
    const { args } = buildFfmpegArgs(plan(), style({ transition: "fade", transitionSec: 0 }), OPTS);
    expect(fc(args)).toContain("concat=n=3");
  });

  it("clamps T to half the shortest clip", () => {
    const p = plan({
      video: [
        { id: "a", kind: "card", srcIn: 0, duration: 2 },
        { id: "b", kind: "card", srcIn: 0, duration: 6 },
      ],
    });
    const { args } = buildFfmpegArgs(p, style({ transition: "fade", transitionSec: 5 }), OPTS);
    expect(fc(args)).toContain("duration=1:");
  });

  it("prompt without asset becomes black card with text", () => {
    const clip: VsVideoClip = { id: "a", kind: "video", srcIn: 0, duration: 3, prompt: "Cảnh biển" };
    const { args, textFiles } = buildFfmpegArgs(plan({ video: [clip] }), style(), OPTS);
    const joined = args.join(" ");
    expect(joined).toContain("color=c=black");
    expect(joined).toContain(":d=3");
    expect(textFiles[0]!.content).toBe("Cảnh biển");
  });

  it("eq only when set", () => {
    expect(fc(buildFfmpegArgs(plan(), style({ brightness: 0.1 }), OPTS).args)).toContain("eq=brightness=0.1");
    expect(fc(buildFfmpegArgs(plan(), style(), OPTS).args)).not.toContain("eq=");
  });

  it("video clip -ss/-t before -i; '..' throws", () => {
    const { args } = buildFfmpegArgs(plan(), style(), OPTS);
    const i = args.indexOf("-ss");
    expect(args[i + 1]).toBe("2");
    expect(args[i + 2]).toBe("-t");
    expect(args[i + 4]).toBe("-i");
    const bad = plan({ video: [{ id: "a", kind: "video", asset: "../x.mp4", srcIn: 0, duration: 2 }] });
    expect(() => buildFfmpegArgs(bad, style(), OPTS)).toThrow();
  });

  it("empty video throws VsError", () => {
    expect(() => buildFfmpegArgs(plan({ video: [] }), style(), OPTS)).toThrow(VsError);
  });

  it("audio: adelay/volume/amix; '..' throws; silent otherwise", () => {
    const p = plan({
      audio: [
        { id: "m", asset: "assets/m.mp3", start: 1.5, duration: 5, volume: 0.5 },
        { id: "n", asset: "assets/n.mp3", start: 0, duration: 5, volume: 1 },
      ],
    });
    const { args } = buildFfmpegArgs(p, style(), OPTS);
    const f = fc(args);
    expect(f).toContain("adelay=1500|1500");
    expect(f).toContain("volume=0.5");
    expect(f).toContain("amix");
    expect(args.join(" ")).not.toContain("anullsrc");
    expect(args).toContain("[aout]");
    expect(args).not.toContain("0:a");
    for (const k of ["libx264", "yuv420p", "aac", "-y", "-progress", "pipe:1"]) expect(args).toContain(k);
    expect(args.at(-1)).toBe(OPTS.outFile);
    const bad = plan({ audio: [{ id: "m", asset: "../m.mp3", start: 0, duration: 1, volume: 1 }] });
    expect(() => buildFfmpegArgs(bad, style(), OPTS)).toThrow();
    const silent = buildFfmpegArgs(plan(), style(), OPTS).args;
    expect(silent).toContain("3:a");
  });

  it("drawtext syntax, escaping, box, colour", () => {
    const p = plan({ texts: [{ id: "t", text: "Hi", start: 1, duration: 2 }] });
    const { args } = buildFfmpegArgs(p, style({ textBox: true, textColor: "#ff0000" }), OPTS);
    const f = fc(args);
    expect(f).toContain("enable='between(t,1,3)'");
    expect(f).toContain("textfile='C\\:/work/text-0.txt'");
    expect(f).toContain("box=1");
    expect(f).toContain("fontcolor=#ff0000");
    expect(fc(buildFfmpegArgs(p, style(), OPTS).args)).not.toContain("box=1");
  });

  it("text y position: top, center, default bottom", () => {
    const yOf = (y?: number): string => {
      const t = { id: "t", text: "Hi", start: 0, duration: 1, ...(y === undefined ? {} : { y }) };
      const f = fc(buildFfmpegArgs(plan({ video: [{ id: "a", kind: "card", srcIn: 0, duration: 2 }], texts: [t] }), style(), OPTS).args);
      return /y=([^:]+):enable/.exec(f)![1]!;
    };
    const ys = [yOf(0.1), yOf(0.5), yOf()];
    expect(new Set(ys).size).toBe(3);
    expect(ys[0]).toContain("0.1");
    expect(ys[1]).toContain("0.5");
    expect(ys[2]).toContain("0.92");
  });
});

function fakeSpawn() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  const spawn: any = vi.fn(() => child);
  return { child, spawn };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("runFfmpeg", () => {
  it("reports progress from out_time_us and returns ok", async () => {
    const { child, spawn } = fakeSpawn();
    const seen: Array<[number, number | undefined]> = [];
    const p = runFfmpeg("ffmpeg", ["-x"], { totalSec: 5, onProgress: (s, r) => seen.push([s, r]) }, { spawn });
    child.stdout.emit("data", "out_time_us=2500000\nout_time=00:00:02.50\nprogress=continue\n");
    child.emit("close", 0);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(seen[0]![0]).toBeCloseTo(2.5);
    expect(seen[0]![1]).toBeCloseTo(0.5);
  });

  it("prefers out_time_us over out_time and parses HH:MM:SS alone", async () => {
    const { child, spawn } = fakeSpawn();
    const seen: number[] = [];
    const p = runFfmpeg("ffmpeg", [], { onProgress: (s) => seen.push(s) }, { spawn });
    child.stdout.emit("data", "out_time_us=3000000\nout_time=00:00:09.00\nprogress=continue\n");
    child.stdout.emit("data", "out_time=00:01:02.50\nprogress=end\n");
    child.emit("close", 0);
    await p;
    expect(seen[0]).toBeCloseTo(3);
    expect(seen[1]).toBeCloseTo(62.5);
  });

  it("returns ok=false with last stderr lines on non-zero exit", async () => {
    const { child, spawn } = fakeSpawn();
    const p = runFfmpeg("ffmpeg", [], {}, { spawn });
    const lines = Array.from({ length: 30 }, (_, i) => `dong-${i}`).join("\n") + "\n";
    child.stderr.emit("data", lines);
    child.emit("close", 1);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error).toContain("thất bại");
    expect(r.error).toContain("dong-29");
    expect(r.error).not.toContain("dong-3\n");
    expect(r.error).not.toContain("dong-0");
  });

  it("kills the process on timeout", async () => {
    const { child, spawn } = fakeSpawn();
    const r = await runFfmpeg("ffmpeg", [], {}, { spawn, timeoutMs: 20 });
    expect(child.kill).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("hết giờ");
  });

  it("spawns without shell, hidden window, stdio ignore/pipe/pipe", async () => {
    const { child, spawn } = fakeSpawn();
    const p = runFfmpeg("ffmpeg", ["-a"], {}, { spawn });
    child.emit("close", 0);
    await p;
    const o = spawn.mock.calls[0][2];
    expect(o.shell).not.toBe(true);
    expect(o.windowsHide).toBe(true);
    expect(o.stdio).toEqual(["ignore", "pipe", "pipe"]);
  });
});

describe("probeDuration", () => {
  const run = async (fn: (c: any) => void): Promise<number | null> => {
    const { child, spawn } = fakeSpawn();
    const p = probeDuration("ffprobe", "f.mp4", { spawn });
    await tick();
    fn(child);
    return p;
  };
  it("parses duration", async () => {
    expect(await run((c) => { c.stdout.emit("data", "12.5\n"); c.emit("close", 0); })).toBe(12.5);
  });
  it("returns null on exit code 1, garbage, or error", async () => {
    expect(await run((c) => { c.emit("close", 1); })).toBeNull();
    expect(await run((c) => { c.stdout.emit("data", "N/A"); c.emit("close", 0); })).toBeNull();
    expect(await run((c) => { c.emit("error", new Error("x")); })).toBeNull();
  });
});
