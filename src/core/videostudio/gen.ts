// src/core/videostudio/gen.ts
// Ghi chú: lời đọc và mô tả cảnh được gửi tới dịch vụ người dùng tự khai (provider http).
// Provider "windows" chỉ chạy cục bộ (System.Speech), không gửi gì ra ngoài.
// Mọi hàm không ném lỗi: trả ok=false kèm thông báo tiếng Việt, không chứa URL hay token.

import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { VsSettings } from "./settings.js";
import type { VsStyle } from "./plan-types.js";

export interface VsGenDeps {
  spawn?: typeof nodeSpawn;
  fetch?: typeof fetch;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
}

export type VoiceResult = { ok: true; file: string } | { ok: false; error: string };

export const VOICE_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_MAX_BYTES = 200 * 1024 * 1024;
const VOICE_TIMEOUT_MS = 60_000;

// Script cố định: lời đọc, đường dẫn, tên giọng, tốc độ chỉ đến qua biến môi trường do mã đặt.
const WINDOWS_TTS_SCRIPT =
  "Add-Type -AssemblyName System.Speech; " +
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
  "try { " +
  "$t = [IO.File]::ReadAllText($env:TNF_VS_TEXT_FILE, [Text.Encoding]::UTF8); " +
  "if ($env:TNF_VS_VOICE) { $s.SelectVoice($env:TNF_VS_VOICE) }; " +
  "$s.Rate = [int]$env:TNF_VS_RATE; " +
  "$s.SetOutputToWaveFile($env:TNF_VS_OUT_FILE); " +
  "$s.Speak($t) " +
  "} catch { exit 1 } finally { $s.Dispose() }";

class CapError extends Error {}

/** Read a response body with a byte cap; cancels the reader when exceeded. */
export async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) throw new CapError("Dịch vụ không trả dữ liệu.");
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CapError("Dữ liệu trả về vượt quá dung lượng cho phép.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function validUrl(u: string): boolean {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

async function voiceHttp(text: string, outFile: string, s: VsSettings, deps: VsGenDeps): Promise<VoiceResult> {
  const { url, token, voiceName, rate } = s.voice;
  if (!url || !validUrl(url)) return { ok: false, error: "Địa chỉ dịch vụ giọng đọc chưa hợp lệ." };
  const doFetch = deps.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? VOICE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, voice: voiceName, rate }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `Dịch vụ giọng đọc trả lỗi (mã ${res.status}).` };
    const buf = await readCapped(res, VOICE_MAX_BYTES);
    if (buf.length === 0) return { ok: false, error: "Dịch vụ giọng đọc trả về dữ liệu rỗng." };
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, buf);
    return { ok: true, file: outFile };
  } catch (e) {
    if (e instanceof CapError) return { ok: false, error: e.message };
    if (ctrl.signal.aborted) return { ok: false, error: "Dịch vụ giọng đọc quá thời gian chờ." };
    return { ok: false, error: "Không gọi được dịch vụ giọng đọc." };
  } finally {
    clearTimeout(timer);
  }
}

type SpawnFn = typeof nodeSpawn;

function killTree(sp: SpawnFn, child: { pid?: number | undefined; kill: () => unknown }, platform: NodeJS.Platform): void {
  try {
    if (platform === "win32" && child.pid) {
      const k = sp("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      k.on("error", () => child.kill());
    } else {
      child.kill();
    }
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

async function voiceWindows(text: string, outFile: string, s: VsSettings, deps: VsGenDeps): Promise<VoiceResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return { ok: false, error: "Giọng đọc Windows chỉ hỗ trợ trên Windows." };
  const sp = deps.spawn ?? nodeSpawn;
  const timeoutMs = deps.timeoutMs ?? VOICE_TIMEOUT_MS;
  const tmpText = path.join(os.tmpdir(), `tnf-vs-${crypto.randomBytes(8).toString("hex")}.txt`);
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(tmpText, text, "utf8");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TNF_VS_TEXT_FILE: tmpText,
      TNF_VS_OUT_FILE: outFile,
      TNF_VS_VOICE: s.voice.voiceName,
      TNF_VS_RATE: String(s.voice.rate),
    };
    const code = await new Promise<number | "timeout" | "error">((resolve) => {
      let settled = false;
      const done = (v: number | "timeout" | "error"): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      let child: ReturnType<SpawnFn> | undefined;
      const timer: NodeJS.Timeout = setTimeout(() => {
        if (child) killTree(sp, child, platform);
        done("timeout");
      }, timeoutMs);
      try {
        child = sp(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_TTS_SCRIPT],
          { env, stdio: "ignore", windowsHide: true },
        );
      } catch {
        done("error");
        return;
      }
      child.on("error", () => done("error"));
      child.on("close", (c: number | null) => done(c === null ? "error" : c));
    });
    if (code === "timeout") return { ok: false, error: "Tổng hợp giọng đọc quá thời gian chờ." };
    if (code === "error") return { ok: false, error: "Không chạy được trình đọc giọng Windows." };
    if (code !== 0) return { ok: false, error: "Trình đọc giọng Windows báo lỗi (kiểm tra tên giọng)." };
    if (!fs.existsSync(outFile)) return { ok: false, error: "Không tạo được tệp âm thanh." };
    return { ok: true, file: outFile };
  } catch {
    return { ok: false, error: "Không tổng hợp được giọng đọc." };
  } finally {
    try {
      fs.rmSync(tmpText, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export type MediaExt = "png" | "jpg" | "webp" | "mp4" | "webm";
export type MediaResult = { ok: true; file: string; ext: MediaExt } | { ok: false; error: string };

const MEDIA_TIMEOUT_MS = 120_000;

const MEDIA_EXT: Record<string, MediaExt> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export async function generateMedia(
  req: { prompt: string; kind: "image" | "video"; style: VsStyle },
  outFileBase: string,
  s: VsSettings,
  deps: VsGenDeps = {},
): Promise<MediaResult> {
  if (s.media.provider !== "http") return { ok: false, error: "Chưa bật dịch vụ tạo ảnh/video AI." };
  const { url, token } = s.media;
  if (!url || !validUrl(url)) return { ok: false, error: "Địa chỉ dịch vụ tạo ảnh/video chưa hợp lệ." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? MEDIA_TIMEOUT_MS);
  try {
    const doFetch = deps.fetch ?? fetch;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const { name, visualPrompt } = req.style;
    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: `${req.prompt}\n${visualPrompt}`,
        kind: req.kind,
        style: { name, visualPrompt },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `Dịch vụ tạo ảnh/video trả lỗi (mã ${res.status}).` };
    const ct = (res.headers?.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const ext = MEDIA_EXT[ct];
    if (!ext) return { ok: false, error: "Dịch vụ trả về định dạng ảnh/video không được hỗ trợ." };
    const buf = await readCapped(res, MEDIA_MAX_BYTES);
    if (buf.length === 0) return { ok: false, error: "Dịch vụ tạo ảnh/video trả về dữ liệu rỗng." };
    const file = `${outFileBase}.${ext}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return { ok: true, file, ext };
  } catch (e) {
    if (e instanceof CapError) return { ok: false, error: e.message };
    if (ctrl.signal.aborted) return { ok: false, error: "Dịch vụ tạo ảnh/video quá thời gian chờ." };
    return { ok: false, error: "Không gọi được dịch vụ tạo ảnh/video." };
  } finally {
    clearTimeout(timer);
  }
}

export interface VsVoiceInfo {
  name: string;
  culture: string;
  gender: string;
}

// Fixed script: lists the voices installed in Windows (System.Speech); takes no input.
const WINDOWS_VOICES_SCRIPT =
  "Add-Type -AssemblyName System.Speech; " +
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
  "try { $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name + '|' + $_.VoiceInfo.Gender } } finally { $s.Dispose() }";

/** Parses the "name|culture|gender" lines printed by the listing script. */
export function parseVoiceLines(text: string): VsVoiceInfo[] {
  const out: VsVoiceInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [name, culture = "", gender = ""] = line.trim().split("|");
    if (name && name.length <= 200) out.push({ name, culture, gender });
  }
  return out;
}

/** Voices installed on this Windows machine (empty on other systems or when PowerShell fails). */
export async function listWindowsVoices(deps: VsGenDeps = {}): Promise<VsVoiceInfo[]> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return [];
  const sp = deps.spawn ?? nodeSpawn;
  return await new Promise<VsVoiceInfo[]>((resolve) => {
    let out = "";
    let settled = false;
    const done = (v: VsVoiceInfo[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    let child: ReturnType<SpawnFn> | undefined;
    const timer: NodeJS.Timeout = setTimeout(() => {
      if (child) killTree(sp, child, platform);
      done([]);
    }, deps.timeoutMs ?? 20_000);
    try {
      child = sp("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_VOICES_SCRIPT], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      done([]);
      return;
    }
    child.stdout?.on("data", (d: Buffer) => {
      if (out.length < 100_000) out += d.toString("utf8");
    });
    child.on("error", () => done([]));
    child.on("close", () => done(parseVoiceLines(out)));
  });
}

export async function synthesizeVoice(
  text: string,
  outFile: string,
  s: VsSettings,
  deps: VsGenDeps = {},
): Promise<VoiceResult> {
  try {
    if (s.voice.provider === "none") return { ok: false, error: "Chưa bật giọng đọc AI." };
    if (typeof text !== "string" || text.trim() === "") return { ok: false, error: "Lời đọc đang trống." };
    if (s.voice.provider === "windows") return await voiceWindows(text, outFile, s, deps);
    return await voiceHttp(text, outFile, s, deps);
  } catch {
    return { ok: false, error: "Không tổng hợp được giọng đọc." };
  }
}
