import { describe, expect, it } from "vitest";
import { matchAsset, normalizeDirectorPlan, normalizeNarration, normalizeSegment } from "../../src/core/videostudio/plan-normalize";
import { buildDirectorPrompt, parsePlanFromText, parseSegmentFromText } from "../../src/core/videostudio/agent";
import { emptyPlan, validatePlan } from "../../src/core/videostudio/plan";

const ASSETS = ["assets/product-front.png", "assets/Cabin_demo.mp4", "assets/Photo_Hall_1.jpg"];

/** The shape of a real director answer that was rejected: no id, no kind, `start` and `transition` invented. */
const REAL_ANSWER = {
  version: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  video: [
    { start: 0, duration: 3, transition: "fade", prompt: "Close-up of a hand gripping a wooden handrail, soft light." },
    { start: 3, duration: 3, transition: "fade", prompt: "A walking cane at the foot of a staircase, low angle." },
    { asset: "assets/product-front.png", start: 6, duration: 3, transition: "fade" },
    { asset: "assets/Cabin_demo.mp4", start: 9, duration: 3, transition: "fade" },
    { asset: "assets/photo_hall_1.JPG", start: 12, duration: 3, transition: "fade" },
  ],
  audio: [],
  texts: [
    { text: "Nhà nhiều tầng?\nĐi lại có dễ?", start: 0, duration: 3 },
    { text: "Người già, trẻ nhỏ\nkhó đi lại", start: 3, duration: 3 },
  ],
  narration: ["Câu một.", "Câu hai."],
};

describe("normalizeDirectorPlan", () => {
  it("makes the rejected real-world answer valid", () => {
    const base = emptyPlan("s", "16:9");
    const fixed = normalizeDirectorPlan(REAL_ANSWER, { assets: ASSETS });
    const v = validatePlan({ ...fixed, width: base.width, height: base.height, fps: base.fps });
    expect(v.ok, v.ok ? "" : v.errors.join(" ")).toBe(true);
  });

  it("gives every clip and text a unique valid id and a kind", () => {
    const f = normalizeDirectorPlan(REAL_ANSWER, { assets: ASSETS }) as { video: Array<Record<string, unknown>>; texts: Array<Record<string, unknown>> };
    expect(f.video.map((c) => c["id"])).toEqual(["v1", "v2", "v3", "v4", "v5"]);
    expect(f.texts.map((c) => c["id"])).toEqual(["t1", "t2"]);
    expect(f.video.map((c) => c["kind"])).toEqual(["image", "image", "image", "video", "image"]);
  });

  it("maps an asset named in another case or by its bare file name to the project's file", () => {
    expect(matchAsset("assets/photo_hall_1.JPG", ASSETS)).toBe("assets/Photo_Hall_1.jpg");
    expect(matchAsset("Cabin-demo.mp4", ASSETS)).toBe("assets/Cabin_demo.mp4");
    expect(matchAsset("assets/missing.png", ASSETS)).toBeNull();
    expect(matchAsset(undefined, ASSETS)).toBeNull();
  });

  it("turns a clip whose asset does not exist into a prompt clip or a card instead of failing", () => {
    const f = normalizeDirectorPlan(
      { video: [{ asset: "assets/missing.png", prompt: "A lift lobby", duration: 2 }, { asset: "assets/missing2.png", duration: 2, text: "Gọi ngay" }] },
      { assets: ASSETS },
    ) as { video: Array<Record<string, unknown>> };
    expect(f.video[0]).toMatchObject({ kind: "image", prompt: "A lift lobby" });
    expect(f.video[0]!["asset"]).toBeUndefined();
    expect(f.video[1]).toMatchObject({ kind: "card", cardText: "Gọi ngay" });
  });

  it("keeps valid ids, repairs duplicates and bad ids, and fills a missing duration from start/end or the default", () => {
    const f = normalizeDirectorPlan(
      { video: [{ id: "intro", kind: "card", cardText: "A", duration: 1 }, { id: "intro", kind: "card", cardText: "B", duration: 1 }, { id: "bad id!", prompt: "x", start: 4, end: 6 }, { prompt: "y" }] },
      { assets: [], defaultShotSec: 5 },
    ) as { video: Array<Record<string, unknown>> };
    expect(f.video.map((c) => c["id"])).toEqual(["intro", "intro-2", "v3", "v4"]);
    expect(f.video[2]!["duration"]).toBe(2);
    expect(f.video[3]!["duration"]).toBe(5);
  });

  it("joins a narration list, reads { text }, and drops anything else", () => {
    expect(normalizeNarration(["A.", "B."])).toBe("A. B.");
    expect(normalizeNarration({ text: "Một chuỗi" })).toBe("Một chuỗi");
    expect(normalizeNarration("ok")).toBe("ok");
    expect(normalizeNarration(42)).toBeUndefined();
    expect(normalizeNarration(null)).toBeUndefined();
    const f = normalizeDirectorPlan({ video: [], narration: 7 }, { assets: [] });
    expect("narration" in f).toBe(false);
  });

  it("accepts scenes/clips as the clip list and plain strings as texts", () => {
    const f = normalizeDirectorPlan({ scenes: [{ prompt: "p", duration: 2 }], texts: ["Chữ một", { content: "Chữ hai", start: 2 }, { text: "  " }, 5] }, { assets: [] }) as { video: unknown[]; texts: Array<Record<string, unknown>> };
    expect(f.video).toHaveLength(1);
    expect(f.texts.map((t) => t["text"])).toEqual(["Chữ một", "Chữ hai"]);
    expect(f.texts[1]!["start"]).toBe(2);
  });

  it("drops audio that points to a missing file and keeps audio that points to a real one", () => {
    const f = normalizeDirectorPlan({ video: [], audio: [{ asset: "assets/nope.mp3", duration: 3 }, { asset: "assets/Cabin_demo.mp4", start: 1, duration: 3, kind: "music" }] }, { assets: ASSETS }) as { audio: Array<Record<string, unknown>> };
    expect(f.audio).toHaveLength(1);
    expect(f.audio[0]).toMatchObject({ id: "a2", asset: "assets/Cabin_demo.mp4", start: 1, duration: 3, volume: 1, kind: "music" });
  });
});

describe("parsePlanFromText / parseSegmentFromText with such answers", () => {
  const base = emptyPlan("s", "16:9");

  it("parses the real-world answer wrapped in prose", () => {
    const text = `Tôi đã lập kế hoạch.\n\`\`\`json\n${JSON.stringify(REAL_ANSWER)}\n\`\`\``;
    const plan = parsePlanFromText(text, base, ASSETS);
    expect(plan.video).toHaveLength(5);
    expect(plan.video[4]).toMatchObject({ kind: "image", asset: "assets/Photo_Hall_1.jpg" });
    expect(plan.narration).toBe("Câu một. Câu hai.");
    expect(plan.width).toBe(base.width);
  });

  it("an already valid plan passes through unchanged in structure", () => {
    const valid = { version: 1, video: [{ id: "a", kind: "card", cardText: "X", color: "#222222", srcIn: 0, duration: 2 }], audio: [], texts: [{ id: "t", text: "Hi", start: 0, duration: 2 }], narration: "n" };
    const plan = parsePlanFromText(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, base, []);
    expect(plan.video[0]).toMatchObject({ id: "a", kind: "card", cardText: "X", duration: 2 });
    expect(plan.texts[0]).toMatchObject({ id: "t", text: "Hi" });
  });

  it("repairs a segment answer without ids and kinds", () => {
    const seg = normalizeSegment({ video: [{ prompt: "x", duration: 2 }], texts: [{ text: "Hi", start: 0, duration: 1 }] }, { assets: [] });
    expect(seg.video[0]).toMatchObject({ id: "v1", kind: "image" });
    const parsed = parseSegmentFromText(`\`\`\`json\n${JSON.stringify({ video: [{ prompt: "x", duration: 2 }], texts: [{ text: "Hi", start: 0, duration: 1 }] })}\n\`\`\``, base, []);
    expect(parsed.video).toHaveLength(1);
    expect(parsed.texts).toHaveLength(1);
  });

  it("still rejects an answer with no usable json", () => {
    expect(() => parsePlanFromText("không có json", base, [])).toThrow();
  });
});

describe("director prompt carries the exact schema", () => {
  const p = buildDirectorPrompt({ description: "d", width: 1920, height: 1080, style: { shotSec: 3, transition: "fade", visualPrompt: "x" }, assets: [{ path: "assets/a.png", kind: "image" }] });
  it("shows a full example with id, kind, srcIn, duration and texts with ids", () => {
    for (const s of ['"id": "v1"', '"kind": "video"', '"srcIn": 0', '"duration": 4', '"id": "t1"', '"narration"', "BẮT BUỘC đúng tên trường", "PHẢI có id riêng"]) expect(p, s).toContain(s);
    expect(p).toContain("assets/a.png");
  });
});
