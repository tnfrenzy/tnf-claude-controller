import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildFfmpegArgs } from "../../src/core/videostudio/render.js";
import { validatePlan } from "../../src/core/videostudio/plan.js";
import { slicePlan } from "../../src/core/videostudio/plan-slice.js";
import type { VsPlan, VsStyle } from "../../src/core/videostudio/plan-types.js";
import { captionsFromNarration, setAllTransitions, splitAudioAt, splitCaptionLines, trimAudio, updateClip } from "../../ui/src/videostudio/timeline";

const style: VsStyle = { id: "s", name: "S", builtin: false, transition: "none", transitionSec: 0.5, shotSec: 3, font: "Arial", textColor: "#ffffff", textBox: false, visualPrompt: "" };
const plan = (): VsPlan => ({
  version: 1, width: 1280, height: 720, fps: 30,
  video: [
    { id: "a", kind: "image", asset: "assets/a.jpg", srcIn: 0, duration: 3, motion: "zoomin", transition: "wipeleft" },
    { id: "b", kind: "video", asset: "assets/b.mp4", srcIn: 2, duration: 4, speed: 2, keepAudio: true },
    { id: "c", kind: "card", srcIn: 0, duration: 2, color: "#000000", cardText: "Het" },
  ],
  audio: [
    { id: "n", asset: "assets/v.wav", start: 0, duration: 6, volume: 1, kind: "narration", srcIn: 1.5 },
    { id: "m", asset: "assets/m.wav", start: 0, duration: 9, volume: 0.6, kind: "music" },
  ],
  texts: [{ id: "t", text: "Xin chao", start: 1, duration: 4, size: 0.1, color: "#ff0000" }],
});
const graph = (p: VsPlan, has = false): string => {
  const b = buildFfmpegArgs(p, style, { projectDir: path.resolve("/proj"), outFile: "/o.mp4", workDir: "/w", assetHasAudio: () => has });
  return b.args[b.args.indexOf("-filter_complex") + 1] as string;
};

describe("render of the new features", () => {
  it("uses each clip's own transition and a 1-frame cut elsewhere", () => {
    const g = graph(plan());
    expect(g).toContain("xfade=transition=wipeleft:duration=0.5:offset=3");
    expect(g).toContain("xfade=transition=fade:duration=0.04:offset=7");
  });
  it("keeps plain concat when no clip has a transition", () => {
    const p = plan();
    p.video[0]!.transition = undefined;
    expect(graph(p)).toContain("concat=n=3");
  });
  it("Ken Burns, speed and text size/colour", () => {
    const g = graph(plan());
    expect(g).toContain("zoompan=z='1+0.25*on/");
    expect(g).toContain("setpts=(PTS-STARTPTS)/2");
    expect(g).toContain("fontsize=72");
    expect(g).toContain("fontcolor=#ff0000");
  });
  it("audio window, ducking and kept sound", () => {
    const g = graph(plan(), true);
    expect(g).toContain("atrim=start=1.5:end=7.5");
    expect(g).toContain("sidechaincompress");
    expect(g).toContain("[k0]");
    expect(graph(plan(), false)).not.toContain("[k0]");
    expect(graph({ ...plan(), duck: false })).not.toContain("sidechaincompress");
  });
});

describe("validation", () => {
  it("accepts the new fields and rejects bad ones", () => {
    expect(validatePlan(plan()).ok).toBe(true);
    const bad = plan();
    bad.video[0]!.transition = "spin" as never;
    expect(validatePlan(bad).ok).toBe(false);
    const bad2 = plan();
    bad2.video[1]!.speed = 9;
    expect(validatePlan(bad2).ok).toBe(false);
    const bad3 = plan();
    bad3.texts[0]!.color = "red";
    expect(validatePlan(bad3).ok).toBe(false);
  });
});

describe("range slice", () => {
  it("cuts clips, texts and audio to the range", () => {
    const s = slicePlan(plan(), 2, 6)!;
    expect(s.video.map((c) => [c.kind, Math.round(c.duration * 100) / 100])).toEqual([["image", 1], ["video", 3]]);
    expect(s.video[1]!.srcIn).toBe(2);
    expect(s.texts[0]).toMatchObject({ start: 0, duration: 3 });
    expect(s.audio[0]).toMatchObject({ start: 0, duration: 4, srcIn: 3.5 });
    expect(slicePlan(plan(), 5, 5.1)).toBeNull();
  });
  it("starts a video clip later when the range begins inside it", () => {
    const s = slicePlan(plan(), 4, 8)!;
    expect(s.video[0]).toMatchObject({ kind: "video", srcIn: 2 + 1 * 2 });
  });
});

describe("editor helpers", () => {
  it("split and trim audio keep the sound in place", () => {
    const p = splitAudioAt(plan(), "n", 2);
    expect(p.audio.filter((a) => a.kind === "narration")).toHaveLength(2);
    const second = p.audio.find((a) => a.kind === "narration" && a.start === 2)!;
    expect(second).toMatchObject({ duration: 4, srcIn: 3.5 });
    const t = trimAudio(plan(), "n", "start", 1);
    expect(t.audio[0]).toMatchObject({ start: 1, duration: 5, srcIn: 2.5 });
    expect(trimAudio(plan(), "n", "end", -2).audio[0]?.duration).toBe(4);
  });
  it("captions follow the narration clip", () => {
    const p = { ...plan(), narration: "Xin chào quý khách. Đây là thang máy gia đình, êm ái và an toàn! Liên hệ ngay." };
    const out = captionsFromNarration(p);
    const caps = out.texts.filter((x) => x.caption);
    expect(caps).toHaveLength(3);
    expect(caps[0]!.start).toBe(0);
    const end = caps[2]!.start + caps[2]!.duration;
    expect(Math.abs(end - 6)).toBeLessThan(0.1);
    expect(out.texts.some((x) => x.id === "t")).toBe(true);
    expect(captionsFromNarration(out).texts.filter((x) => x.caption)).toHaveLength(3);
    expect(captionsFromNarration({ ...plan(), narration: "" }).texts).toEqual(plan().texts);
  });
  it("splits long sentences at commas", () => {
    const lines = splitCaptionLines("Một, hai, ba, bốn, năm, sáu, bảy, tám, chín, mười, mười một, mười hai, mười ba, mười bốn.", 30);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= 40)).toBe(true);
  });
  it("clip patch and set-all-transitions", () => {
    expect(updateClip(plan(), "a", { motion: "panleft" }).video[0]?.motion).toBe("panleft");
    expect(setAllTransitions(plan(), "dissolve", 0.8).video.every((c) => c.transition === "dissolve" && c.transitionSec === 0.8)).toBe(true);
  });
});
