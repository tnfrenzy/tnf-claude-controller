import { describe, it, expect } from "vitest";
import type { VsPlan } from "../../src/core/videostudio/plan-types";
import {
  newId,
  timelineDuration,
  clipStarts,
  activeAt,
  moveClip,
  splitClipAt,
  trimClip,
  deleteClip,
  addText,
  updateText,
  removeText,
  moveAudio,
  deleteAudio,
  secToPx,
  pxToSec,
} from "../../ui/src/videostudio/timeline";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

function mk(): VsPlan {
  return {
    version: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    video: [
      { id: "a", kind: "video", asset: "a.mp4", srcIn: 2, duration: 4 },
      { id: "b", kind: "card", cardText: "hi", srcIn: 0, duration: 3 },
      { id: "c", kind: "image", asset: "c.png", srcIn: 0, duration: 2 },
    ],
    audio: [
      { id: "m", asset: "m.mp3", start: 1, duration: 5, volume: 1 },
      { id: "n", asset: "n.mp3", start: 10, duration: 2, volume: 1 },
    ],
    texts: [
      { id: "t1", text: "one", start: 0, duration: 2 },
      { id: "t2", text: "two", start: 5, duration: 2 },
    ],
  };
}

function frozen(): { plan: VsPlan; json: string } {
  const plan = mk();
  const json = JSON.stringify(plan);
  return { plan: deepFreeze(plan), json };
}

describe("newId / math", () => {
  it("newId has prefix and short [a-z0-9] suffix", () => {
    const id = newId("clip-");
    expect(id).toMatch(/^clip-[a-z0-9]+$/);
    expect(newId()).toMatch(/^[a-z0-9]+$/);
    expect(newId()).not.toBe(newId());
  });
  it("duration and starts", () => {
    const { plan } = frozen();
    expect(timelineDuration(plan)).toBe(9);
    expect(clipStarts(plan)).toEqual([0, 4, 7]);
    expect(timelineDuration({ ...mk(), video: [] })).toBe(0);
    expect(clipStarts({ ...mk(), video: [] })).toEqual([]);
  });
  it("secToPx / pxToSec", () => {
    expect(secToPx(2, 50)).toBe(100);
    expect(pxToSec(100, 50)).toBe(2);
    expect(secToPx(2, 0)).toBe(0);
    expect(pxToSec(100, 0)).toBe(0);
  });
});

describe("activeAt", () => {
  it("finds clip, offset, texts and audio", () => {
    const { plan, json } = frozen();
    const r = activeAt(plan, 5.5);
    expect(r.index).toBe(1);
    expect(r.clip?.id).toBe("b");
    expect(r.offset).toBeCloseTo(1.5);
    expect(r.texts.map((x) => x.id)).toEqual(["t2"]);
    expect(r.audio.map((x) => x.id)).toEqual(["m"]);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("clip boundary belongs to next clip", () => {
    const { plan } = frozen();
    expect(activeAt(plan, 4).index).toBe(1);
    expect(activeAt(plan, 0).index).toBe(0);
  });
  it("out of range gives null clip", () => {
    const { plan } = frozen();
    for (const t of [-1, 9, 100]) {
      const r = activeAt(plan, t);
      expect(r.clip).toBeNull();
      expect(r.index).toBe(-1);
    }
    expect(activeAt(plan, 10.5).audio.map((x) => x.id)).toEqual(["n"]);
  });
});

describe("moveClip", () => {
  it("moves and is immutable", () => {
    const { plan, json } = frozen();
    const r = moveClip(plan, 0, 2);
    expect(r.video.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("out of range returns same plan", () => {
    const { plan } = frozen();
    expect(moveClip(plan, -1, 0)).toBe(plan);
    expect(moveClip(plan, 0, 3)).toBe(plan);
    expect(moveClip(plan, 5, 0)).toBe(plan);
  });
});

describe("splitClipAt", () => {
  it("splits video clip and advances srcIn", () => {
    const { plan, json } = frozen();
    const r = splitClipAt(plan, 1.5);
    expect(r.video).toHaveLength(4);
    expect(r.video[0]).toMatchObject({ id: "a", srcIn: 2, duration: 1.5 });
    expect(r.video[1]).toMatchObject({ kind: "video", srcIn: 3.5, duration: 2.5, asset: "a.mp4" });
    expect(r.video[1]!.id).not.toBe("a");
    expect(timelineDuration(r)).toBeCloseTo(9);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("card and image keep srcIn", () => {
    const { plan } = frozen();
    const c = splitClipAt(plan, 5);
    expect(c.video).toHaveLength(4);
    expect(c.video[1]).toMatchObject({ id: "b", srcIn: 0, duration: 1 });
    expect(c.video[2]).toMatchObject({ kind: "card", srcIn: 0, duration: 2, cardText: "hi" });
    const i = splitClipAt(plan, 8);
    expect(i.video[3]).toMatchObject({ kind: "image", srcIn: 0, duration: 1 });
    expect(i.video[2]).toMatchObject({ id: "c", srcIn: 0, duration: 1 });
  });
  it("does not split within 0.1 s of an edge", () => {
    const { plan } = frozen();
    expect(splitClipAt(plan, 0.05)).toBe(plan);
    expect(splitClipAt(plan, 3.95)).toBe(plan);
    expect(splitClipAt(plan, 4.05)).toBe(plan);
    expect(splitClipAt(plan, 0)).toBe(plan);
  });
  it("out of range returns same plan", () => {
    const { plan } = frozen();
    expect(splitClipAt(plan, -1)).toBe(plan);
    expect(splitClipAt(plan, 9)).toBe(plan);
    expect(splitClipAt(plan, 50)).toBe(plan);
  });
});

describe("trimClip", () => {
  it("start edge raises srcIn and lowers duration", () => {
    const { plan, json } = frozen();
    const r = trimClip(plan, 0, "start", 1);
    expect(r.video[0]).toMatchObject({ srcIn: 3, duration: 3 });
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("start edge clamps srcIn >= 0 for video", () => {
    const { plan } = frozen();
    const r = trimClip(plan, 0, "start", -10);
    expect(r.video[0]!.srcIn).toBe(0);
    expect(r.video[0]!.duration).toBeCloseTo(6);
  });
  it("start edge on card keeps srcIn", () => {
    const { plan } = frozen();
    const r = trimClip(plan, 1, "start", 1);
    expect(r.video[1]).toMatchObject({ srcIn: 0, duration: 2 });
    const g = trimClip(plan, 1, "start", -2);
    expect(g.video[1]).toMatchObject({ srcIn: 0, duration: 5 });
  });
  it("end edge changes duration", () => {
    const { plan } = frozen();
    expect(trimClip(plan, 0, "end", -1).video[0]).toMatchObject({ srcIn: 2, duration: 3 });
    expect(trimClip(plan, 0, "end", 2).video[0]!.duration).toBe(6);
  });
  it("duration never below 0.2", () => {
    const { plan } = frozen();
    expect(trimClip(plan, 0, "end", -100).video[0]!.duration).toBeCloseTo(0.2);
    const s = trimClip(plan, 0, "start", 100);
    expect(s.video[0]!.duration).toBeCloseTo(0.2);
    expect(s.video[0]!.srcIn).toBeCloseTo(5.8);
  });
  it("out of range index returns same plan", () => {
    const { plan } = frozen();
    expect(trimClip(plan, -1, "end", 1)).toBe(plan);
    expect(trimClip(plan, 3, "start", 1)).toBe(plan);
  });
});

describe("deleteClip", () => {
  it("deletes and is immutable", () => {
    const { plan, json } = frozen();
    expect(deleteClip(plan, 1).video.map((c) => c.id)).toEqual(["a", "c"]);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("out of range returns same plan", () => {
    const { plan } = frozen();
    expect(deleteClip(plan, -1)).toBe(plan);
    expect(deleteClip(plan, 3)).toBe(plan);
  });
});

describe("text functions", () => {
  it("addText defaults duration 3 and bottom position", () => {
    const { plan, json } = frozen();
    const r = addText(plan, "hello", 1);
    expect(r.texts).toHaveLength(3);
    const t = r.texts[2]!;
    expect(t).toMatchObject({ text: "hello", start: 1, duration: 3 });
    expect(t.y).toBeGreaterThan(0.5);
    expect(t.id).toMatch(/^[\w-]+$/);
    expect(addText(plan, "x", 0, 5).texts[2]!.duration).toBe(5);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("updateText patches, keeps id, immutable", () => {
    const { plan, json } = frozen();
    const r = updateText(plan, "t1", { text: "new", duration: 4 });
    expect(r.texts[0]).toMatchObject({ id: "t1", text: "new", duration: 4, start: 0 });
    expect(r.texts[1]).toEqual(plan.texts[1]);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("updateText / removeText unknown id returns same plan", () => {
    const { plan } = frozen();
    expect(updateText(plan, "zzz", { text: "x" })).toBe(plan);
    expect(removeText(plan, "zzz")).toBe(plan);
  });
  it("removeText removes and is immutable", () => {
    const { plan, json } = frozen();
    expect(removeText(plan, "t1").texts.map((x) => x.id)).toEqual(["t2"]);
    expect(JSON.stringify(plan)).toBe(json);
  });
});

describe("audio functions", () => {
  it("moveAudio moves, clamps at 0, immutable", () => {
    const { plan, json } = frozen();
    expect(moveAudio(plan, "m", 3).audio[0]).toMatchObject({ id: "m", start: 3 });
    expect(moveAudio(plan, "m", -5).audio[0]!.start).toBe(0);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("deleteAudio removes and is immutable", () => {
    const { plan, json } = frozen();
    expect(deleteAudio(plan, "m").audio.map((x) => x.id)).toEqual(["n"]);
    expect(JSON.stringify(plan)).toBe(json);
  });
  it("unknown id returns same plan", () => {
    const { plan } = frozen();
    expect(moveAudio(plan, "zzz", 1)).toBe(plan);
    expect(deleteAudio(plan, "zzz")).toBe(plan);
  });
});
