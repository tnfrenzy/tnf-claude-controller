import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVsStore } from "../../src/core/videostudio/store.js";
import { VsError, emptyPlan } from "../../src/core/videostudio/plan.js";

let dir: string;
let t: number;
const now = () => new Date(t);
const input = { title: "Demo", brief: "b", styleId: "clean", aspect: "16:9" as const };

function status(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof VsError ? e.status : -1;
  }
  return undefined;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-store-"));
  t = Date.parse("2026-11-19T07:00:00Z");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("videostudio store", () => {
  it("create writes project.json and plan.json", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    expect(p.slug).toMatch(/^20261119-070000-[0-9a-f]{6}$/);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "videostudio", p.slug, "project.json"), "utf8"));
    expect(pj.state).toBe("draft");
    expect(pj.error).toBeNull();
    expect(pj.costUsd).toBe(0);
    expect(pj.lastRender).toBeNull();
    const plan = JSON.parse(fs.readFileSync(path.join(dir, "videostudio", p.slug, "plan.json"), "utf8"));
    expect(plan).toEqual(emptyPlan("clean", "16:9"));
  });

  it("create validates input", () => {
    const s = createVsStore(dir, now);
    expect(status(() => s.create({ ...input, title: "  " }))).toBe(400);
    expect(status(() => s.create({ ...input, title: "x".repeat(81) }))).toBe(400);
    expect(status(() => s.create({ ...input, brief: "x".repeat(4001) }))).toBe(400);
    expect(status(() => s.create({ ...input, aspect: "4:3" as never }))).toBe(400);
    expect(status(() => s.create({ ...input, styleId: "" }))).toBe(400);
    expect(status(() => s.create({ ...input, title: "x".repeat(80), brief: "x".repeat(4000) }))).toBeUndefined();
  });

  it("create retries on same-second slug collision", () => {
    const s = createVsStore(dir, now);
    const a = s.create(input);
    const b = s.create(input);
    expect(a.slug).not.toBe(b.slug);
  });

  it("get rejects bad slug and missing project", () => {
    const s = createVsStore(dir, now);
    expect(status(() => s.get("../x"))).toBe(400);
    expect(status(() => s.get("20261119-070000-abcdef"))).toBe(404);
  });

  it("list is newest first and skips broken dirs", () => {
    const s = createVsStore(dir, now);
    const a = s.create({ ...input, title: "A" });
    t += 1000;
    const b = s.create({ ...input, title: "B" });
    t += 1000;
    const c = s.create({ ...input, title: "C" });
    const root = path.join(dir, "videostudio");
    fs.mkdirSync(path.join(root, "20261119-010101-aaaaaa"));
    fs.mkdirSync(path.join(root, "20261119-010101-bbbbbb"));
    fs.writeFileSync(path.join(root, "20261119-010101-bbbbbb", "project.json"), "{oops");
    expect(s.list().map((i) => i.slug)).toEqual([c.slug, b.slug, a.slug]);
  });

  it("update bumps updatedAt, keeps slug and createdAt, leaves no tmp", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    t += 5000;
    const u = s.update(p.slug, { state: "planning", slug: "x", updatedAt: "bad" } as never);
    expect(u.slug).toBe(p.slug);
    expect(u.createdAt).toBe(p.createdAt);
    expect(u.updatedAt).toBe(new Date(t).toISOString());
    expect(u.updatedAt > p.updatedAt).toBe(true);
    expect(u.state).toBe("planning");
    expect(s.get(p.slug).state).toBe("planning");
    const files = fs.readdirSync(path.join(dir, "videostudio", p.slug));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("savePlan validates, persists and bumps updatedAt", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    const good = { ...emptyPlan("clean", "16:9"), texts: [{ id: "t1", text: "Hi", start: 0, duration: 2 }] };
    t += 5000;
    const saved = s.savePlan(p.slug, good);
    expect(s.getPlan(p.slug)).toEqual(saved);
    expect(s.getPlan(p.slug).texts).toHaveLength(1);
    expect(s.get(p.slug).updatedAt > p.updatedAt).toBe(true);
    const before = fs.readFileSync(path.join(dir, "videostudio", p.slug, "plan.json"), "utf8");
    const bad = {
      ...good,
      width: 1921,
      video: [
        { id: "a", kind: "card", srcIn: 0, duration: 1, cardText: "x" },
        { id: "a", kind: "card", srcIn: 0, duration: 1, cardText: "y" },
      ],
    };
    let err: VsError | undefined;
    try {
      s.savePlan(p.slug, bad);
    } catch (e) {
      err = e as VsError;
    }
    expect(err?.status).toBe(400);
    expect(err?.message).toContain("; ");
    expect(fs.readFileSync(path.join(dir, "videostudio", p.slug, "plan.json"), "utf8")).toBe(before);
    expect(status(() => s.getPlan("20261119-070000-abcdef"))).toBe(404);
    expect(status(() => s.getPlan("bad"))).toBe(400);
  });

  it("addAsset rejects bad extensions and traversal names", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    const buf = Buffer.from("x");
    expect(status(() => s.addAsset(p.slug, "a.exe", buf))).toBe(400);
    expect(status(() => s.addAsset(p.slug, "a.txt", buf))).toBe(400);
    expect(status(() => s.addAsset(p.slug, "../evil.png", buf))).toBe(400);
    expect(status(() => s.addAsset(p.slug, "a\\..\\b.png", buf))).toBe(400);
    expect(s.addAsset(p.slug, "a..b.png", buf).rel).toBe("assets/a..b.png");
  });

  it("addAsset sanitizes names", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    const buf = Buffer.from("x");
    expect(s.addAsset(p.slug, "my clip!.mp4", buf).rel).toBe("assets/my_clip_.mp4");
    expect(s.addAsset(p.slug, "...png", buf).rel).toBe("assets/asset.png");
    expect(s.addAsset(p.slug, "!!!.png", buf).rel).toBe("assets/___.png");
    expect(s.addAsset(p.slug, ".png", buf).rel).toBe("assets/asset-2.png");
    expect(s.addAsset(p.slug, "CON.png", buf).rel).toBe("assets/_CON.png");
    expect(s.addAsset(p.slug, "nul.mp4", buf).rel).toBe("assets/_nul.mp4");
    const long = s.addAsset(p.slug, `${"x".repeat(200)}.png`, buf);
    expect(long.rel.length - "assets/".length).toBeLessThanOrEqual(80);
  });

  it("addAsset handles duplicates, kinds, content and ledger", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    const buf = Buffer.from("hello");
    expect(s.addAsset(p.slug, "a.png", buf).rel).toBe("assets/a.png");
    expect(s.addAsset(p.slug, "a.png", buf).rel).toBe("assets/a-2.png");
    expect(s.addAsset(p.slug, "A.PNG", buf).rel).toBe("assets/A-3.png");
    const full = `${"y".repeat(76)}.png`;
    expect(full.length).toBe(80);
    const f1 = s.addAsset(p.slug, full, buf);
    const f2 = s.addAsset(p.slug, full, buf);
    expect(f1.rel.length - 7).toBe(80);
    expect(f2.rel.length - 7).toBeLessThanOrEqual(80);
    expect(f2.rel).not.toBe(f1.rel);
    expect(s.addAsset(p.slug, "v.webm", buf).kind).toBe("video");
    expect(s.addAsset(p.slug, "s.ogg", buf).kind).toBe("audio");
    expect(s.addAsset(p.slug, "i.jpeg", buf).kind).toBe("image");
    const g = s.addAsset(p.slug, "gen.mp3", buf, { generated: true });
    expect(g.generated).toBe(true);
    expect(fs.readFileSync(path.join(dir, "videostudio", p.slug, "assets", "a.png"), "utf8")).toBe("hello");
    const ledger = JSON.parse(fs.readFileSync(path.join(dir, "videostudio", p.slug, "assets.json"), "utf8"));
    expect(ledger[0].path).toBe("assets/a.png");
    expect(ledger[0].duration).toBeNull();
    expect(ledger[0].size).toBe(5);
    expect(fs.readdirSync(path.join(dir, "videostudio", p.slug, "assets")).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("addAsset enforces size and count limits", () => {
    const s = createVsStore(dir, now, { maxFileBytes: 10, maxAssets: 2 });
    const p = s.create(input);
    expect(status(() => s.addAsset(p.slug, "big.png", Buffer.alloc(11)))).toBe(413);
    s.addAsset(p.slug, "a.png", Buffer.alloc(10));
    s.addAsset(p.slug, "b.png", Buffer.alloc(1));
    expect(status(() => s.addAsset(p.slug, "c.png", Buffer.alloc(1)))).toBe(400);
  });

  it("listAssets drops entries whose file vanished", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    s.addAsset(p.slug, "a.png", Buffer.from("1"));
    s.addAsset(p.slug, "b.png", Buffer.from("2"));
    fs.rmSync(path.join(dir, "videostudio", p.slug, "assets", "a.png"));
    expect(s.listAssets(p.slug).map((a) => a.rel)).toEqual(["assets/b.png"]);
  });

  it("filePath stays inside the project dir", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    const abs = s.filePath(p.slug, "assets/a.png");
    expect(path.isAbsolute(abs)).toBe(true);
    expect(abs.startsWith(path.resolve(dir, "videostudio", p.slug) + path.sep)).toBe(true);
    expect(status(() => s.filePath(p.slug, "../x"))).toBe(400);
    expect(status(() => s.filePath(p.slug, "/abs"))).toBe(400);
    expect(status(() => s.filePath(p.slug, "C:/x"))).toBe(400);
    expect(status(() => s.filePath("bad", "a.png"))).toBe(400);
    expect(s.filePath("20261119-070000-abcdef", "a.png")).toContain("20261119-070000-abcdef");
  });

  it("remove deletes dir; missing gives 404", () => {
    const s = createVsStore(dir, now);
    const p = s.create(input);
    s.remove(p.slug);
    expect(fs.existsSync(path.join(dir, "videostudio", p.slug))).toBe(false);
    expect(status(() => s.get(p.slug))).toBe(404);
    expect(status(() => s.remove(p.slug))).toBe(404);
    expect(status(() => s.remove("bad"))).toBe(400);
  });
});
