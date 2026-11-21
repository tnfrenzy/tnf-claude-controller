import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVsSettingsStore, findFfmpeg, findFfprobe } from "../../src/core/videostudio/settings.js";
import { VsError } from "../../src/core/videostudio/plan.js";

const EXE = process.platform === "win32" ? ".exe" : "";
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-vs-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mkTool(sub: string, base: string): string {
  const dir = path.join(tmp, sub);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, base + EXE);
  fs.writeFileSync(f, "");
  return f;
}

describe("findFfmpeg", () => {
  it("priority TNF_FFMPEG > configured > PATH", () => {
    const a = mkTool("a", "ffmpeg");
    const b = mkTool("b", "ffmpeg");
    const c = mkTool("c", "ffmpeg");
    const env = { TNF_FFMPEG: a, PATH: path.dirname(c) };
    expect(findFfmpeg(b, env)).toBe(a);
    expect(findFfmpeg(b, { PATH: path.dirname(c) })).toBe(b);
    expect(findFfmpeg(null, { PATH: path.dirname(c) })).toBe(c);
  });

  it("falls through nonexistent TNF_FFMPEG", () => {
    const b = mkTool("b", "ffmpeg");
    expect(findFfmpeg(b, { TNF_FFMPEG: path.join(tmp, "nope"), PATH: "" })).toBe(b);
  });

  it("returns null when nothing found", () => {
    expect(findFfmpeg(path.join(tmp, "nope"), { PATH: "" })).toBeNull();
    expect(findFfmpeg("", {})).toBeNull();
  });

  it("searches multiple PATH dirs", () => {
    const c = mkTool("c", "ffmpeg");
    const env = { PATH: [path.join(tmp, "x"), "", path.dirname(c)].join(path.delimiter) };
    expect(findFfmpeg(null, env)).toBe(c);
  });
});

describe("VsSettingsStore", () => {
  const settingsFile = () => path.join(tmp, "data", "videostudio", "settings.json");
  const mk = (env: Record<string, string | undefined> = { PATH: "" }) =>
    createVsSettingsStore(path.join(tmp, "data"), env);
  const expectProvider = process.platform === "win32" ? "windows" : "none";

  it("returns defaults when missing or corrupt", () => {
    expect(mk().read().voice.provider).toBe(expectProvider);
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), "{{{");
    const s = mk().read();
    expect(s.voice.provider).toBe(expectProvider);
    expect(s.media.provider).toBe("none");
    expect(s.ffmpegPath).toBeNull();
    expect(s.model).toBeNull();
  });

  it("hides tokens in publicView, keeps/clears them on update", () => {
    const st = mk();
    st.update({ voice: { provider: "http", token: "SECRET-TOKEN-XYZ" }, media: { token: "MEDIA-SECRET" } });
    const pub = st.publicView();
    const json = JSON.stringify(pub);
    expect(json).not.toContain("SECRET-TOKEN-XYZ");
    expect(json).not.toContain("MEDIA-SECRET");
    expect(json).not.toContain('"token"');
    expect(pub.voice.hasToken).toBe(true);
    expect(pub.media.hasToken).toBe(true);
    expect(st.update({ voice: { token: "" } }).voice.hasToken).toBe(true);
    expect(st.read().voice.token).toBe("SECRET-TOKEN-XYZ");
    expect(st.update({ voice: { token: null } }).voice.hasToken).toBe(false);
    expect(st.publicView().media.hasToken).toBe(true);
  });

  it("merges partially", () => {
    const st = mk();
    st.update({ voice: { voiceName: "Anna", rate: 3 }, model: " m1 " });
    st.update({ voice: { rate: 4 } });
    const s = st.read();
    expect(s.voice.voiceName).toBe("Anna");
    expect(s.voice.rate).toBe(4);
    expect(s.model).toBe("m1");
  });

  it("validates urls", () => {
    const st = mk();
    for (const url of ["http://u:p@h/", "file:///x", "ftp://x", "https://e.com/" + "a".repeat(300)]) {
      expect(() => st.update({ voice: { url } })).toThrow(VsError);
    }
    expect(st.update({ voice: { url: "https://example.com/v" } }).voice.url).toBe("https://example.com/v");
    expect(st.update({ media: { url: "" } }).media.url).toBe("");
  });

  it("validates token length and rate", () => {
    const st = mk();
    expect(() => st.update({ voice: { token: "x".repeat(4001) } })).toThrow(VsError);
    expect(() => st.update({ voice: { rate: 11 } })).toThrow(VsError);
    expect(() => st.update({ voice: { rate: -11 } })).toThrow(VsError);
    expect(st.update({ voice: { rate: 10 } }).voice.rate).toBe(10);
    expect(st.update({ voice: { rate: -10 } }).voice.rate).toBe(-10);
  });

  it("validates ffmpegPath", () => {
    const st = mk();
    expect(() => st.update({ ffmpegPath: "ffmpeg.exe" })).toThrow(VsError);
    expect(() => st.update({ ffmpegPath: path.join(tmp, "notffmpeg.exe") })).toThrow(VsError);
    const real = mkTool("bin", "ffmpeg");
    const pub = st.update({ ffmpegPath: real });
    expect(pub.ffmpegFound).toBe(true);
    const missing = path.join(tmp, "gone", "ffmpeg" + EXE);
    const pub2 = st.update({ ffmpegPath: missing });
    expect(pub2.ffmpegPath).toBe(missing);
    expect(pub2.ffmpegFound).toBe(false);
    expect(st.update({ ffmpegPath: null }).ffmpegPath).toBeNull();
  });

  it("does not change the file on validation error and leaves no tmp", () => {
    const st = mk();
    st.update({ voice: { rate: 2 } });
    const before = fs.readFileSync(settingsFile(), "utf8");
    try {
      st.update({ voice: { rate: 5 }, media: { url: "ftp://x" } });
    } catch (e) {
      expect(e).toBeInstanceOf(VsError);
      expect((e as VsError).status).toBe(400);
    }
    expect(fs.readFileSync(settingsFile(), "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(settingsFile())).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("findFfprobe", () => {
  it("prefers same dir as ffmpeg over PATH", () => {
    const ff = mkTool("a", "ffmpeg");
    const probeSame = mkTool("a", "ffprobe");
    mkTool("p", "ffprobe");
    expect(findFfprobe(ff, { PATH: path.join(tmp, "p") })).toBe(probeSame);
  });

  it("uses PATH when ffmpeg is null", () => {
    const p = mkTool("p", "ffprobe");
    expect(findFfprobe(null, { PATH: path.dirname(p) })).toBe(p);
  });

  it("returns null when absent", () => {
    expect(findFfprobe(null, { PATH: "" })).toBeNull();
  });
});
