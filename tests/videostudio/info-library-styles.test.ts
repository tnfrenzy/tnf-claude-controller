/** AI information profile, shared media library, and styles that actually do something (sample render, default, per-video switch). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import type { AuthPolicy } from "../../src/server/auth.js";
import { createServer } from "../../src/server/http.js";
import { createVsCore } from "../../src/core/videostudio/core.js";
import { createVsJobs } from "../../src/core/videostudio/jobs.js";
import { createVsLibrary, safeLibraryName } from "../../src/core/videostudio/library.js";
import { createVsSettingsStore, findFfmpeg } from "../../src/core/videostudio/settings.js";
import { buildDirectorPrompt, profilePromptLines } from "../../src/core/videostudio/agent.js";
import { styleSamplePlan } from "../../src/core/videostudio/render.js";
import type { VsStyle } from "../../src/core/videostudio/plan-types.js";
import { ApiError, api, setToken } from "../../ui/src/api";
import { VideoStudioSettings } from "../../ui/src/components/videostudio/VideoStudioSettings";
import { VideoStudioCreate } from "../../ui/src/components/videostudio/VideoStudioCreate";
import { VideoStyleManager } from "../../ui/src/components/videostudio/VideoStyleManager";
import { StyleFrame, styleFrameCss } from "../../ui/src/components/videostudio/StylePreview";
import { settingsFormToInput, settingsToForm } from "../../ui/src/videostudio/forms";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-info-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const style: VsStyle = { id: "demo", name: "Demo", builtin: true, transition: "fade", transitionSec: 0.5, shotSec: 4, font: "Arial", textColor: "#ffee00", textBox: true, brightness: 0.1, contrast: 1.2, saturation: 1.4, visualPrompt: "x" };

describe("AI information profile in the settings", () => {
  it("is saved, trimmed, line-endings normalised and returned in the public view", () => {
    const s = createVsSettingsStore(dir, { PATH: "" });
    expect(s.publicView().profile.brand).toBe("");
    const v = s.update({ profile: { brand: "  Acme Lift  ", facts: "Bảo hành 24 tháng\r\nGiao trong 7 ngày", avoid: "Không nói giá rẻ nhất" } });
    expect(v.profile).toMatchObject({ brand: "Acme Lift", facts: "Bảo hành 24 tháng\nGiao trong 7 ngày", avoid: "Không nói giá rẻ nhất", about: "" });
    expect(createVsSettingsStore(dir, { PATH: "" }).publicView().profile.brand).toBe("Acme Lift");
    // a partial update keeps the other fields
    expect(s.update({ profile: { slogan: "Chất lượng" } }).profile).toMatchObject({ brand: "Acme Lift", slogan: "Chất lượng" });
  });

  it("rejects a non-string or a too long field with a Vietnamese message", () => {
    const s = createVsSettingsStore(dir, { PATH: "" });
    expect(() => s.update({ profile: { brand: 5 as never } })).toThrow(/chuỗi/);
    expect(() => s.update({ profile: { brand: "x".repeat(81) } })).toThrow(/tối đa 80/);
    expect(() => s.update({ profile: "x" as never })).toThrow();
  });

  it("default style: saved, cleared and validated", () => {
    const s = createVsSettingsStore(dir, { PATH: "" });
    expect(s.publicView().defaultStyleId).toBeNull();
    expect(s.update({ defaultStyleId: "news" }).defaultStyleId).toBe("news");
    expect(s.update({ defaultStyleId: null }).defaultStyleId).toBeNull();
    expect(() => s.update({ defaultStyleId: "Bad Id!" })).toThrow(/phong cách/);
  });

  it("the settings form keeps the profile through the form helpers and never touches the default style", () => {
    const form = settingsToForm({ ffmpegPath: null, ffmpegFound: true, voice: { provider: "none", voiceName: "", rate: 0, url: "", hasToken: false }, media: { provider: "none", url: "", hasToken: false }, model: null, profile: { brand: "A", slogan: "", about: "", products: "P1\nP2", facts: "F", contact: "C", avoid: "" }, defaultStyleId: "news" });
    expect(form.profile.products).toBe("P1\nP2");
    const input = settingsFormToInput({ ...form, profile: { ...form.profile, brand: "  B  " } });
    expect(input.profile).toMatchObject({ brand: "B", products: "P1\nP2", facts: "F" });
    expect("defaultStyleId" in input).toBe(false);
  });
});

describe("the director gets the profile", () => {
  const base = { description: "d", width: 1920, height: 1080, style: { shotSec: 3, transition: "fade" as const, visualPrompt: "x" }, assets: [] };

  it("adds the facts block and the never-say block, and nothing when the profile is empty", () => {
    expect(profilePromptLines(undefined)).toEqual([]);
    expect(profilePromptLines({ brand: "", avoid: "  " })).toEqual([]);
    const p = buildDirectorPrompt({ ...base, profile: { brand: "Acme Lift", facts: "Bảo hành 24 tháng", contact: "0900 000 000", avoid: "Không nhắc đối thủ" } });
    for (const s of ["Công ty / thương hiệu: Acme Lift", "Bảo hành 24 tháng", "Liên hệ: 0900 000 000", "không bịa", "Tuyệt đối KHÔNG nói", "Không nhắc đối thủ"]) expect(p, s).toContain(s);
    expect(buildDirectorPrompt(base)).not.toContain("Thông tin người dùng đã cung cấp");
  });
});

describe("shared media library", () => {
  it("stores files under safe names, lists them by kind and removes them", () => {
    const lib = createVsLibrary(dir);
    const a = lib.add("Ảnh Sản Phẩm 1.JPG", Buffer.from([1, 2, 3]));
    expect(a).toMatchObject({ name: "Anh_San_Pham_1.jpg", kind: "image", size: 3 });
    lib.add("giới thiệu.mp4", Buffer.from([1]));
    lib.add("nhac.mp3", Buffer.from([1]));
    expect(lib.list().map((i) => [i.name, i.kind])).toEqual([["Anh_San_Pham_1.jpg", "image"], ["gioi_thieu.mp4", "video"], ["nhac.mp3", "audio"]]);
    expect(lib.read("Anh_San_Pham_1.jpg")?.length).toBe(3);
    expect(lib.remove("Anh_San_Pham_1.jpg")).toBe(true);
    expect(lib.remove("Anh_San_Pham_1.jpg")).toBe(false);
  });

  it("refuses other file types, empty files, and any path or unsafe name when reading", () => {
    const lib = createVsLibrary(dir);
    expect(() => lib.add("virus.exe", Buffer.from([1]))).toThrow(/ảnh/i);
    expect(() => lib.add("a.png", Buffer.alloc(0))).toThrow(/rỗng/);
    lib.add("ok.png", Buffer.from([1]));
    expect(lib.filePath("../ok.png")).toBeNull();
    expect(lib.read("..\\..\\x")).toBeNull();
    expect(safeLibraryName("C:\\evil\\..\\Đẹp lắm!.PNG")).toBe("Dep_lam_.png");
  });
});

describe("styleSamplePlan and the sample job", () => {
  it("is a small plan of two colour cards of the style's shot length with captions", () => {
    const p = styleSamplePlan(style);
    expect([p.width, p.height, p.fps]).toEqual([640, 360, 15]);
    expect(p.video.map((c) => c.kind)).toEqual(["card", "card"]);
    expect(p.video[0]!.duration).toBe(3); // shot length is capped at 3 s
    expect(p.texts).toHaveLength(2);
    expect(styleSamplePlan({ ...style, shotSec: 0.5 }).video[0]!.duration).toBe(1.5);
  });

  const manager = { startRun: async () => ({ id: "r" }), waitFor: async () => ({ status: "done", result_text: "", cost_usd_est: 0 }), cancel: () => true, store: { getProject: () => ({}), upsertProject: () => ({}) } };
  const fakeSpawn = (code: number, calls: string[][]) =>
    ((_c: string, args: string[]) => {
      calls.push(args);
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => undefined;
      setImmediate(() => {
        if (code === 0) fs.writeFileSync(args[args.length - 1]!, "mp4");
        child.emit("close", code);
      });
      return child;
    }) as never;

  it("renders into the style-preview folder with the draft preset, and fails clearly without ffmpeg", async () => {
    const exe = path.join(dir, "ffmpeg.exe");
    fs.writeFileSync(exe, "");
    const core = createVsCore({ manager: manager as never, dataDir: dir, env: { PATH: "" } });
    core.settings.update({ ffmpegPath: exe });
    const calls: string[][] = [];
    const jobs = createVsJobs(core, { spawn: fakeSpawn(0, calls), env: { PATH: "" } });
    const { file } = await jobs.previewStyle(style);
    expect(file).toMatch(/^[a-z0-9-]+\.mp4$/);
    expect(fs.existsSync(path.join(dir, "videostudio", "_style-preview", file))).toBe(true);
    expect(calls[0]).toContain("ultrafast");
    expect(calls[0]!.join(" ")).toContain("eq=brightness=0.1"); // the style's colour grade is really applied
    expect(fs.readdirSync(path.join(dir, "videostudio", "_style-preview")).filter((n) => n.startsWith("tmp-"))).toEqual([]);

    const core2 = createVsCore({ manager: manager as never, dataDir: path.join(dir, "other"), env: { PATH: "" } });
    await expect(createVsJobs(core2, { env: { PATH: "" } }).previewStyle(style)).rejects.toThrow(/ffmpeg/);
  });
});

describe("through the real server routes", () => {
  const TOKEN = "i".repeat(32);
  const realFetch = globalThis.fetch;
  let close: Array<() => Promise<void> | void> = [];

  beforeEach(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-info-srv-"));
    const config = { ...loadConfig(), dataDir };
    const store = new RunStore(":memory:");
    const manager = new RunManager({ config, store });
    const policy: AuthPolicy = { token: TOKEN, host: "127.0.0.1", port: 0 };
    const server = createServer({ manager, policy, staticDir: path.join(dataDir, "no-ui"), materialLibrary: null, workshop3d: null } as Parameters<typeof createServer>[0]);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    policy.port = port;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => realFetch(`http://127.0.0.1:${port}${url}`, init));
    setToken(TOKEN);
    close.push(async () => {
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    while (close.length) await close.pop()!();
    close = [];
  });

  it("library: upload, list, delete, and a refused type", async () => {
    const up = await api.videoStudioLibraryUpload(new File([new Uint8Array([1, 2, 3])], "Ảnh logo.png", { type: "image/png" }));
    expect(up).toMatchObject({ name: "Anh_logo.png", kind: "image" });
    expect((await api.videoStudioLibrary()).files.map((f) => f.name)).toEqual(["Anh_logo.png"]);
    const bad = await api.videoStudioLibraryUpload(new File([new Uint8Array([1])], "x.exe")).then(() => null, (e: unknown) => e);
    expect(bad).toBeInstanceOf(ApiError);
    expect((bad as ApiError).status).toBe(400);
    await api.videoStudioLibraryDelete("Anh_logo.png");
    expect((await api.videoStudioLibrary()).files).toEqual([]);
    const gone = await api.videoStudioLibraryDelete("Anh_logo.png").then(() => null, (e: unknown) => e);
    expect((gone as ApiError).status).toBe(404);
  });

  it("create copies the ticked library files into the new video's assets", async () => {
    await api.videoStudioLibraryUpload(new File([new Uint8Array([1, 2, 3])], "logo.png"));
    await api.videoStudioLibraryUpload(new File([new Uint8Array([4, 5, 6])], "ngoai.jpg"));
    const { styles } = await api.videoStudioStyles();
    const { slug } = await api.videoStudioCreate({ title: "Có tư liệu", brief: "", styleId: styles[0]!.id, aspect: "16:9", libraryFiles: ["logo.png", "khong-co.png"] });
    expect((await api.videoStudioGet(slug)).assets.map((a) => a.rel)).toEqual(["assets/logo.png"]);
  });

  it("the profile and default style travel through the settings routes", async () => {
    const { settings } = await api.videoStudioSettingsPut({ profile: { brand: "Acme Lift", facts: "Bảo hành 24 tháng" }, defaultStyleId: "news" });
    expect(settings.profile.brand).toBe("Acme Lift");
    expect(settings.defaultStyleId).toBe("news");
    expect((await api.videoStudioSettings()).settings.profile.facts).toBe("Bảo hành 24 tháng");
  });

  it("a video can switch to another style, and an unknown style is refused", async () => {
    const { styles } = await api.videoStudioStyles();
    const { slug } = await api.videoStudioCreate({ title: "Đổi phong cách", brief: "", styleId: styles[0]!.id, aspect: "16:9" });
    await api.videoStudioSetStyle(slug, styles[1]!.id);
    const d = await api.videoStudioGet(slug);
    expect(d.project.styleId).toBe(styles[1]!.id);
    expect(d.plan?.styleId).toBe(styles[1]!.id);
    const err = await api.videoStudioSetStyle(slug, "khong-co").then(() => null, (e: unknown) => e);
    expect((err as ApiError).status).toBe(404);
  });

  it("the style sample route answers (a real sample when ffmpeg exists, a clear 400 when it does not)", async () => {
    const { styles } = await api.videoStudioStyles();
    const hasFfmpeg = findFfmpeg(null, process.env) !== null;
    // the server in this test uses the real process env, so the answer depends on the machine
    const r = await api.videoStudioStylePreview({ id: styles[0]!.id }).then((x) => ({ ok: true as const, x }), (e: unknown) => ({ ok: false as const, e }));
    if (hasFfmpeg) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        const blob = await api.videoStudioStylePreviewFile(r.x.file);
        expect(blob.size).toBeGreaterThan(1000);
      }
    } else {
      expect(r.ok).toBe(false);
      if (!r.ok) expect((r.e as ApiError).status).toBe(400);
    }
    const bad = await api.videoStudioStylePreview({ name: "x", transition: "wipe" }).then(() => null, (e: unknown) => e);
    expect((bad as ApiError).status).toBe(400);
  }, 120_000);
});

describe("the screens", () => {
  const settings = { ffmpegPath: null, ffmpegFound: true, voice: { provider: "none" as const, voiceName: "", rate: 0, url: "", hasToken: false }, media: { provider: "none" as const, url: "", hasToken: false }, model: null, profile: { brand: "", slogan: "", about: "", products: "", facts: "", contact: "", avoid: "" }, defaultStyleId: "demo" };
  const lib = [{ name: "logo.png", kind: "image" as const, size: 2048 }, { name: "intro.mp4", kind: "video" as const, size: 5 * 1024 * 1024 }];

  it("AI settings shows every information field and the library", () => {
    const html = renderToStaticMarkup(createElement(VideoStudioSettings, { settings, onChanged() {}, library: lib }));
    for (const s of ["Thông tin cung cấp cho AI", "Tên công ty / thương hiệu", "Khẩu hiệu", "Giới thiệu công ty", "Sản phẩm / dịch vụ", "Thông tin chắc chắn dùng được", "Liên hệ (điện thoại", "Điều KHÔNG được nói", "Thư viện hình ảnh / video", "logo.png", "intro.mp4", "5.0 MB", "Tải tệp lên thư viện"]) expect(html, s).toContain(s);
  });

  it("the create form lists library files to tick and lets the user add files from this computer", () => {
    const html = renderToStaticMarkup(createElement(VideoStudioCreate, { styles: [style], settings, library: lib, onCreated() {}, onChanged() {} }));
    for (const s of ["Hình ảnh / video cho video này", "Chọn từ thư viện", "logo.png", "Tải thêm tệp từ máy", "★ Demo"]) expect(html, s).toContain(s);
    expect(html.match(/type="checkbox"[^>]*checked/g)?.length).toBe(2); // everything is ticked by default
    expect(renderToStaticMarkup(createElement(VideoStudioCreate, { styles: [style], settings, library: [], onCreated() {}, onChanged() {} }))).toContain("Thư viện chưa có tệp");
  });

  it("the styles tab shows a frame per style, the default badge and the sample button", () => {
    const other = { ...style, id: "other", name: "Khác" };
    const html = renderToStaticMarkup(createElement(VideoStyleManager, { styles: [style, other], onChanged() {}, defaultStyleId: "demo" }));
    expect(html.match(/class="vs-frame"/g)).toHaveLength(2);
    expect(html).toContain("Mặc định");
    expect(html).toContain("Đặt làm mặc định"); // only for the style that is not the default yet
    expect(html.match(/Dựng thử vài giây/g)).toHaveLength(2);
    expect(html).toContain("~4 giây mỗi cảnh");
    expect(html).toContain("Chuyển cảnh mờ dần 0.5 giây");
  });

  it("the frame's CSS follows the style: grade, font, colour and box", () => {
    const css = styleFrameCss(style);
    expect(css.filter).toBe("brightness(1.10) contrast(1.20) saturate(1.40)");
    expect(css.caption).toMatchObject({ color: "#ffee00", background: "rgba(0,0,0,0.6)" });
    expect(css.caption.fontFamily).toContain("Arial");
    const plain = styleFrameCss({ ...style, textBox: false, brightness: undefined, textColor: "bad" });
    expect(plain.caption).toMatchObject({ color: "#ffffff", background: "transparent" });
    expect(plain.filter).toContain("brightness(1.00)");
    expect(renderToStaticMarkup(createElement(StyleFrame, { style: { ...style, transition: "none" } }))).toContain("Chuyển cảnh cắt thẳng");
  });
});
