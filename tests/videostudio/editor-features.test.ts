import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildFfmpegArgs } from "../../src/core/videostudio/render.js";
import { validatePlan } from "../../src/core/videostudio/plan.js";
import { parseVoiceLines } from "../../src/core/videostudio/gen.js";
import type { VsPlan, VsStyle } from "../../src/core/videostudio/plan-types.js";
import { ASPECT_SIZES, addAudioClip, addCardAt, aspectOf, duplicateClip, setAllFit, setAspect, setClipFit, setShowTexts, updateAudio } from "../../ui/src/videostudio/timeline";

const style: VsStyle = { id: "s", name: "S", builtin: false, transition: "none", transitionSec: 0, shotSec: 3, font: "Arial", textColor: "#ffffff", textBox: false, visualPrompt: "" };
const base = (): VsPlan => ({
  version: 1, width: 1280, height: 720, fps: 30,
  video: [{ id: "a", kind: "image", asset: "assets/a.jpg", srcIn: 0, duration: 3 }, { id: "b", kind: "video", asset: "assets/b.mp4", srcIn: 0, duration: 3 }],
  audio: [{ id: "n", asset: "assets/v.wav", start: 0, duration: 4, volume: 1, kind: "narration", fadeIn: 1, fadeOut: 2, speed: 1.25 }],
  texts: [{ id: "t", text: "Xin chao", start: 0, duration: 2 }],
});
const graph = (plan: VsPlan): string => {
  const b = buildFfmpegArgs(plan, style, { projectDir: path.resolve("/proj"), outFile: "/out.mp4", workDir: "/work" });
  return b.args[b.args.indexOf("-filter_complex") + 1] as string;
};

describe("frame fit", () => {
  it("defaults to a blurred background copy", () => {
    const g = graph(base());
    expect(g).toContain("boxblur");
    expect(g).toContain("overlay=(W-w)/2:(H-h)/2");
  });
  it("cover crops, contain pads, and a clip fit beats the plan fit", () => {
    expect(graph({ ...base(), fit: "cover" })).toContain("crop=1280:720");
    expect(graph({ ...base(), fit: "contain" })).toContain("pad=1280:720");
    const g = graph({ ...setClipFit({ ...base(), fit: "cover" }, "a", "contain") });
    expect(g).toContain("pad=1280:720");
    expect(g).toContain("crop=1280:720");
  });
});

describe("text switch and audio filters", () => {
  it("showTexts=false drops the captions", () => {
    expect(graph(base())).toContain("drawtext");
    expect(graph(setShowTexts(base(), false))).not.toContain("drawtext");
  });
  it("applies speed and fades to an audio clip", () => {
    const g = graph(base());
    expect(g).toContain("atempo=1.25");
    expect(g).toContain("afade=t=in:st=0:d=1");
    expect(g).toContain("afade=t=out:st=2:d=2");
  });
});

describe("plan validation of the new fields", () => {
  it("accepts and keeps them", () => {
    const r = validatePlan({ ...base(), showTexts: false, fit: "cover", voice: { name: "Anna", rate: 2 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.showTexts).toBe(false);
      expect(r.plan.fit).toBe("cover");
      expect(r.plan.voice).toEqual({ name: "Anna", rate: 2 });
      expect(r.plan.audio[0]).toMatchObject({ fadeIn: 1, fadeOut: 2, speed: 1.25 });
    }
  });
  it("rejects out of range values", () => {
    expect(validatePlan({ ...base(), fit: "stretch" }).ok).toBe(false);
    const p = base();
    p.audio[0]!.speed = 5;
    expect(validatePlan(p).ok).toBe(false);
    const q = base();
    q.video[0]!.fit = "bad" as never;
    expect(validatePlan(q).ok).toBe(false);
  });
});

describe("voice list parsing", () => {
  it("reads name|culture|gender lines", () => {
    expect(parseVoiceLines("Microsoft An|vi-VN|Male\r\nMicrosoft David|en-US|Male\r\n\r\n")).toEqual([
      { name: "Microsoft An", culture: "vi-VN", gender: "Male" },
      { name: "Microsoft David", culture: "en-US", gender: "Male" },
    ]);
  });
});

describe("editor helpers", () => {
  it("aspect switching", () => {
    expect(aspectOf(base())).toBe("16:9");
    const p = setAspect(base(), "9:16");
    expect([p.width, p.height]).toEqual([ASPECT_SIZES["9:16"].width, ASPECT_SIZES["9:16"].height]);
    expect(aspectOf(p)).toBe("9:16");
  });
  it("duplicate, card, set-all-fit", () => {
    expect(duplicateClip(base(), 0).video.map((c) => c.asset ?? c.id).slice(0, 2)).toEqual(["assets/a.jpg", "assets/a.jpg"]);
    expect(addCardAt(base(), 0, "Tieu de").video[0]).toMatchObject({ kind: "card", cardText: "Tieu de" });
    const p = setAllFit(setClipFit(base(), "a", "cover"), "blur");
    expect(p.fit).toBe("blur");
    expect(p.video.every((c) => c.fit === undefined)).toBe(true);
  });
  it("audio helpers: a new narration replaces the old one; patch updates fields", () => {
    const p = addAudioClip(base(), "assets/new.mp3", 0, 5, "narration");
    expect(p.audio.filter((a) => a.kind === "narration")).toHaveLength(1);
    expect(p.audio[0]?.asset).toBe("assets/new.mp3");
    expect(updateAudio(p, p.audio[0]!.id, { volume: 0.5 }).audio[0]?.volume).toBe(0.5);
  });
});
