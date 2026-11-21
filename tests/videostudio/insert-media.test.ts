import { describe, expect, it } from "vitest";
import { insertIndexAt, insertMedia, mediaKindOf } from "../../ui/src/videostudio/timeline";
import type { VsPlan } from "../../src/core/videostudio/plan-types";

const plan = (): VsPlan => ({
  version: 1, width: 1280, height: 720, fps: 30,
  video: [
    { id: "a", kind: "card", srcIn: 0, duration: 3, color: "#000000", cardText: "" },
    { id: "b", kind: "card", srcIn: 0, duration: 3, color: "#000000", cardText: "" },
  ],
  audio: [], texts: [],
});

describe("insert media into the timeline", () => {
  it("classifies files", () => {
    expect(mediaKindOf("x.JPG")).toBe("image");
    expect(mediaKindOf("x.mp4")).toBe("video");
    expect(mediaKindOf("x.pdf")).toBeNull();
  });
  it("inserts at the clip boundary at or after the playhead, or at the end", () => {
    expect(insertIndexAt(plan(), 0)).toBe(0);
    expect(insertIndexAt(plan(), 2)).toBe(1);
    expect(insertIndexAt(plan(), 5)).toBe(2);
    const out = insertMedia(plan(), 2, [{ asset: "assets/p.jpg", kind: "image", duration: 3 }]);
    expect(out.video.map((c) => c.asset ?? c.id)).toEqual(["a", "assets/p.jpg", "b"]);
    expect(out.video[1]).toMatchObject({ kind: "image", srcIn: 0, duration: 3 });
    expect(insertMedia(plan(), 9, [{ asset: "assets/v.mp4", kind: "video", duration: 0.1 }]).video[2]?.duration).toBe(0.5);
  });
});
