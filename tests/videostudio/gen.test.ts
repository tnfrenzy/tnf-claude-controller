import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateMedia,
  MEDIA_MAX_BYTES,
  synthesizeVoice,
  VOICE_MAX_BYTES,
  type VsGenDeps,
} from "../../src/core/videostudio/gen.js";
import type { VsSettings } from "../../src/core/videostudio/settings.js";
import type { VsStyle } from "../../src/core/videostudio/plan-types.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-vsgen-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const URL_ = "https://tts.example.com/secret-path";
const TOKEN = "tok-SECRET-123";

function settings(over: Partial<VsSettings["voice"]> = {}): VsSettings {
  return {
    ffmpegPath: null,
    voice: { provider: "http", voiceName: "vi-VN", rate: 2, url: URL_, token: TOKEN, ...over },
    media: { provider: "none", url: "", token: null },
    model: null,
  };
}

function resp(body: Uint8Array | ReadableStream<Uint8Array> | null, status = 200): Response {
  return new Response(body as BodyInit | null, { status });
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]);
      else c.close();
    },
  });
}

const MURL = "https://media.example.com/private-gen";
const STYLE = { name: "Phim cũ", visualPrompt: "film grain, sepia" } as unknown as VsStyle;

function mediaSettings(over: Partial<VsSettings["media"]> = {}): VsSettings {
  const s = settings();
  s.media = { provider: "http", url: MURL, token: TOKEN, ...over };
  return s;
}

function mresp(body: Uint8Array | ReadableStream<Uint8Array> | null, ct: string | null, status = 200): Response {
  const headers: Record<string, string> = {};
  if (ct !== null) headers["content-type"] = ct;
  return new Response(body as BodyInit | null, { status, headers });
}

describe("generateMedia", () => {
  const req = { prompt: "Một con mèo", kind: "image" as const, style: STYLE };

  it("none -> ok=false", async () => {
    const r = await generateMedia(req, path.join(tmp, "m"), mediaSettings({ provider: "none" }));
    expect(r).toEqual({ ok: false, error: "Chưa bật dịch vụ tạo ảnh/video AI." });
  });

  it("http png: body, Bearer, tep dung byte, tao thu muc cha", async () => {
    const base = path.join(tmp, "sub", "img");
    const f = vi.fn(async () => mresp(new Uint8Array([9, 8, 7]), "image/png"));
    const r = await generateMedia(req, base, mediaSettings(), { fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, file: `${base}.png`, ext: "png" });
    expect([...fs.readFileSync(`${base}.png`)]).toEqual([9, 8, 7]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MURL);
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toContain("Một con mèo");
    expect(body.prompt).toContain("film grain, sepia");
    expect(body.kind).toBe("image");
    expect(body.style).toEqual({ name: "Phim cũ", visualPrompt: "film grain, sepia" });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["video/mp4", "mp4"],
    ["video/webm", "webm"],
    ["Image/PNG; charset=binary", "png"],
  ])("content-type %s -> %s", async (ct, ext) => {
    const base = path.join(tmp, "x");
    const f = vi.fn(async () => mresp(new Uint8Array([1]), ct));
    const r = await generateMedia(req, base, mediaSettings(), { fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, file: `${base}.${ext}`, ext });
  });

  it("content-type la hoac thieu -> ok=false, khong ghi tep", async () => {
    const base = path.join(tmp, "x");
    for (const ct of ["application/json", null]) {
      const f = vi.fn(async () => mresp(new Uint8Array([1]), ct));
      const r = await generateMedia(req, base, mediaSettings(), { fetch: f as unknown as typeof fetch });
      expect(r.ok).toBe(false);
    }
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("4xx/5xx, fetch nem, than null -> ok=false, khong lo URL/token", async () => {
    const base = path.join(tmp, "x");
    const results = [
      await generateMedia(req, base, mediaSettings(), {
        fetch: (async () => mresp(new Uint8Array([1]), "image/png", 404)) as unknown as typeof fetch,
      }),
      await generateMedia(req, base, mediaSettings(), {
        fetch: (async () => mresp(new Uint8Array([1]), "image/png", 500)) as unknown as typeof fetch,
      }),
      await generateMedia(req, base, mediaSettings(), {
        fetch: (async () => {
          throw new Error(`boom ${MURL} ${TOKEN}`);
        }) as unknown as typeof fetch,
      }),
      await generateMedia(req, base, mediaSettings(), {
        fetch: (async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), body: null })) as unknown as typeof fetch,
      }),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      const msg = JSON.stringify(r);
      expect(msg).not.toContain("example.com");
      expect(msg).not.toContain(TOKEN);
    }
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("vuot 200 MB (stream lười, một khúc dùng lại) -> ok=false, không tạo tệp", async () => {
    const chunk = new Uint8Array(16 * 1024 * 1024);
    let pulls = 0;
    const lazy = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(chunk);
      },
    });
    const f = vi.fn(async () => mresp(lazy, "video/mp4"));
    const r = await generateMedia({ ...req, kind: "video" }, path.join(tmp, "v"), mediaSettings(), {
      fetch: f as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(pulls * chunk.length).toBeGreaterThan(MEDIA_MAX_BYTES);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it("abort/quá giờ -> ok=false, không lộ URL/token", async () => {
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(new Error(`aborted ${MURL} ${TOKEN}`)));
        }),
    );
    const r = await generateMedia(req, path.join(tmp, "x"), mediaSettings(), {
      fetch: f as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(r.ok).toBe(false);
    const msg = JSON.stringify(r);
    expect(msg).not.toContain("example.com");
    expect(msg).not.toContain(TOKEN);
  });
});

describe("synthesizeVoice", () => {
  it("none -> thong bao chua bat", async () => {
    const r = await synthesizeVoice("xin chao", path.join(tmp, "a.wav"), settings({ provider: "none" }));
    expect(r).toEqual({ ok: false, error: "Chưa bật giọng đọc AI." });
  });

  it("text rong -> ok=false", async () => {
    const r = await synthesizeVoice("   ", path.join(tmp, "a.wav"), settings());
    expect(r.ok).toBe(false);
  });

  it("http thanh cong: body, Bearer, ghi tep", async () => {
    const out = path.join(tmp, "sub", "a.wav");
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const f = vi.fn(async () => resp(bytes));
    const r = await synthesizeVoice("Xin chào", out, settings(), { fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, file: out });
    expect([...fs.readFileSync(out)]).toEqual([1, 2, 3, 4, 5]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Xin chào", voice: "vi-VN", rate: 2 });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("http khong token -> khong co Authorization", async () => {
    const f = vi.fn(async () => resp(new Uint8Array([1])));
    await synthesizeVoice("x", path.join(tmp, "a.wav"), settings({ token: null }), { fetch: f as unknown as typeof fetch });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(Object.keys(init.headers as object)).not.toContain("Authorization");
  });

  it("http 500 va fetch nem -> ok=false, khong lo URL/token", async () => {
    const out = path.join(tmp, "a.wav");
    const f500 = vi.fn(async () => resp(new Uint8Array([1]), 500));
    const r1 = await synthesizeVoice("x", out, settings(), { fetch: f500 as unknown as typeof fetch });
    const fThrow = vi.fn(async () => {
      throw new Error(`boom ${URL_} ${TOKEN}`);
    });
    const r2 = await synthesizeVoice("x", out, settings(), { fetch: fThrow as unknown as typeof fetch });
    for (const r of [r1, r2]) {
      expect(r.ok).toBe(false);
      const msg = JSON.stringify(r);
      expect(msg).not.toContain("example.com");
      expect(msg).not.toContain(TOKEN);
    }
    expect(fs.existsSync(out)).toBe(false);
  });

  it("http than null -> ok=false", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, body: null }) as unknown as Response);
    const r = await synthesizeVoice("x", path.join(tmp, "a.wav"), settings(), { fetch: f as unknown as typeof fetch });
    expect(r.ok).toBe(false);
  });

  it("http vuot 50 MB -> ok=false, khong tao tep", async () => {
    const out = path.join(tmp, "big.wav");
    const chunk = new Uint8Array(10 * 1024 * 1024);
    const chunks = Array.from({ length: 6 }, () => chunk);
    expect(chunk.length * chunks.length).toBeGreaterThan(VOICE_MAX_BYTES);
    const f = vi.fn(async () => resp(streamOf(chunks)));
    const r = await synthesizeVoice("x", out, settings(), { fetch: f as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("windows tren linux -> ok=false, khong spawn", async () => {
    const sp = vi.fn();
    const r = await synthesizeVoice("x", path.join(tmp, "a.wav"), settings({ provider: "windows" }), {
      spawn: sp as unknown as VsGenDeps["spawn"],
      platform: "linux",
    });
    expect(r.ok).toBe(false);
    expect(sp).not.toHaveBeenCalled();
  });

  it("windows win32: env, argv sach, tep tam dung noi dung va bi xoa", async () => {
    const out = path.join(tmp, "w.wav");
    const text = "Xin chào các bạn, đây là thử nghiệm";
    let tmpTextFile = "";
    let seenText = "";
    const sp = vi.fn((cmd: string, args: string[], opts: { env: Record<string, string> }) => {
      tmpTextFile = opts.env.TNF_VS_TEXT_FILE;
      seenText = fs.readFileSync(tmpTextFile, "utf8");
      const ev = new EventEmitter() as EventEmitter & { pid: number; kill: () => void };
      ev.pid = 1;
      ev.kill = () => undefined;
      setTimeout(() => {
        fs.writeFileSync(out, "RIFF");
        ev.emit("close", 0);
      }, 5);
      return ev;
    });
    const r = await synthesizeVoice(text, out, settings({ provider: "windows", voiceName: "Voice A", rate: -3 }), {
      spawn: sp as unknown as VsGenDeps["spawn"],
      platform: "win32",
    });
    expect(r).toEqual({ ok: true, file: out });
    const [cmd, args, opts] = sp.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; shell?: boolean }];
    expect(cmd).toBe("powershell.exe");
    expect(args).toContain("-NoProfile");
    expect(args).toContain("-NonInteractive");
    expect(args.join(" ")).not.toContain("Xin chào");
    expect(opts.shell).toBeFalsy();
    expect(opts.env.TNF_VS_OUT_FILE).toBe(out);
    expect(opts.env.TNF_VS_VOICE).toBe("Voice A");
    expect(opts.env.TNF_VS_RATE).toBe("-3");
    expect(seenText).toBe(text);
    expect(fs.existsSync(tmpTextFile)).toBe(false);
  });

  it("windows exit 1 -> ok=false va xoa tep tam", async () => {
    let tmpTextFile = "";
    const sp = vi.fn((_c: string, _a: string[], opts: { env: Record<string, string> }) => {
      tmpTextFile = opts.env.TNF_VS_TEXT_FILE;
      const ev = new EventEmitter();
      setTimeout(() => ev.emit("close", 1), 5);
      return ev;
    });
    const r = await synthesizeVoice("x", path.join(tmp, "w.wav"), settings({ provider: "windows" }), {
      spawn: sp as unknown as VsGenDeps["spawn"],
      platform: "win32",
    });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(tmpTextFile)).toBe(false);
  });

  it("windows het gio -> kill qua spawn gia, ok=false", async () => {
    const calls: string[] = [];
    const sp = vi.fn((cmd: string) => {
      calls.push(cmd);
      const ev = new EventEmitter() as EventEmitter & { pid: number; kill: () => void };
      ev.pid = 4242;
      ev.kill = () => undefined;
      return ev;
    });
    const r = await synthesizeVoice("x", path.join(tmp, "w.wav"), settings({ provider: "windows" }), {
      spawn: sp as unknown as VsGenDeps["spawn"],
      platform: "win32",
      timeoutMs: 20,
    });
    expect(r.ok).toBe(false);
    expect(calls).toEqual(["powershell.exe", "taskkill"]);
  });

  it("windows spawn nem / emit error -> ok=false", async () => {
    const r1 = await synthesizeVoice("x", path.join(tmp, "w.wav"), settings({ provider: "windows" }), {
      spawn: (() => {
        throw new Error("ENOENT");
      }) as unknown as VsGenDeps["spawn"],
      platform: "win32",
    });
    expect(r1.ok).toBe(false);
    const r2 = await synthesizeVoice("x", path.join(tmp, "w.wav"), settings({ provider: "windows" }), {
      spawn: (() => {
        const ev = new EventEmitter();
        setTimeout(() => ev.emit("error", new Error("x")), 5);
        return ev;
      }) as unknown as VsGenDeps["spawn"],
      platform: "win32",
    });
    expect(r2.ok).toBe(false);
  });
});
