// src/server/videostudio-routes.ts — /api/videostudio/*: Video Studio projects, styles, settings, jobs and files.
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { VideoStudio } from "../core/videostudio/index.js";
import { safeVsRel, VsError } from "../core/videostudio/plan.js";
import { validateStyle } from "../core/videostudio/styles.js";

const JSON_LIMIT = 1024 * 1024;
const ASSET_LIMIT = 300 * 1024 * 1024;
const GENERIC = "Lỗi nội bộ khi xử lý Video Studio.";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

function readRaw(req: IncomingMessage, limit: number, tooBig: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new VsError(tooBig, 413));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => (over ? reject(new VsError(tooBig, 413)) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req, JSON_LIMIT, "Nội dung quá lớn (tối đa 1 MB).");
  if (raw.length === 0) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new VsError("JSON không hợp lệ.", 400);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new VsError("Nội dung phải là một đối tượng JSON.", 400);
  return v as Record<string, unknown>;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new VsError("Đường dẫn không hợp lệ.", 400);
  }
}

function extOf(file: string): string {
  return path.extname(file).slice(1).toLowerCase();
}

function parseRange(h: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m) return null;
  const a = m[1] ?? "";
  const b = m[2] ?? "";
  if (a === "" && b === "") return null;
  let start: number;
  let end: number;
  if (a === "") {
    const n = Number(b);
    if (n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!(start <= end) || start >= size) return null;
  return { start, end };
}

function sendFile(req: IncomingMessage, res: ServerResponse, abs: string, extra: Record<string, string> = {}): void {
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
    if (!st.isFile()) throw new Error("not a file");
  } catch {
    send(res, 404, { error: "not_found", message: "Không tìm thấy tệp." });
    return;
  }
  const ext = extOf(abs);
  const media = ext === "mp4" || ext === "webm" || ext === "mov" || ext === "mkv" || ["mp3", "wav", "m4a", "ogg"].includes(ext);
  const headers: Record<string, string | number> = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  };
  if (media) headers["accept-ranges"] = "bytes";
  const rangeHeader = req.headers["range"];
  let start = 0;
  let end = st.size - 1;
  if (media && typeof rangeHeader === "string") {
    const r = parseRange(rangeHeader, st.size);
    if (!r) {
      res.writeHead(416, { "content-range": `bytes */${st.size}`, "cache-control": "no-store" });
      res.end();
      return;
    }
    start = r.start;
    end = r.end;
    headers["content-range"] = `bytes ${start}-${end}/${st.size}`;
    headers["content-length"] = end - start + 1;
    res.writeHead(206, headers);
  } else {
    headers["content-length"] = st.size;
    res.writeHead(200, headers);
  }
  if (st.size === 0) {
    res.end();
    return;
  }
  fs.createReadStream(abs, { start, end })
    .on("error", () => res.destroy())
    .pipe(res);
}

/** Title -> safe download name (no control chars, quotes, slashes, Windows-forbidden chars). */
function cleanTitle(title: string): string {
  const t = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"/\\<>:|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  return t === "" ? "video" : t;
}

function downloadHeaders(title: string, ext: string): Record<string, string> {
  const clean = cleanTitle(title);
  const ascii = clean.replace(/[^A-Za-z0-9._ -]/g, "_");
  const suffix = ext ? `.${ext}` : "";
  return {
    "content-disposition": `attachment; filename="${ascii}${suffix}"; filename*=UTF-8''${encodeURIComponent(clean + suffix)}`,
  };
}

const ACTIONS = new Set(["generate", "edit-segment", "narrate", "render", "preview"]);

/** Handles /api/videostudio[...]; returns false when the path is not one of these routes. */
export async function handleVideoStudioRoute(
  req: IncomingMessage,
  res: ServerResponse,
  p: string,
  method: string,
  ctx: { studio: VideoStudio | null; viaTunnel: boolean; log?: (m: string) => void },
): Promise<boolean> {
  if (p !== "/api/videostudio" && !p.startsWith("/api/videostudio/")) return false;
  const studio = ctx.studio;
  if (!studio) {
    send(res, 503, { error: "videostudio_unavailable", message: "Video Studio chưa sẵn sàng." });
    return true;
  }
  const log = ctx.log ?? (() => {});
  const parts = p.split("/").filter(Boolean).slice(2); // after ["api","videostudio"]
  try {
    if (parts.length === 0) {
      if (method === "GET") send(res, 200, { projects: studio.store.list() });
      else if (method === "POST") {
        const body = await readJson(req);
        const project = studio.store.create({
          title: body["title"] as string,
          brief: (body["brief"] ?? "") as string,
          styleId: body["styleId"] as string,
          aspect: body["aspect"] as "16:9" | "9:16" | "1:1",
        });
        // Library files the user ticked are copied into the new project's assets (missing names are skipped).
        const wanted = Array.isArray(body["libraryFiles"]) ? (body["libraryFiles"] as unknown[]).filter((n): n is string => typeof n === "string").slice(0, 50) : [];
        const attached: string[] = [];
        for (const name of wanted) {
          const data = studio.library.read(name);
          if (!data) continue;
          try {
            await studio.addAsset(project.slug, name, data);
            attached.push(name);
          } catch {
            /* one bad file does not stop the project */
          }
        }
        send(res, 201, attached.length ? { ...project, attachedFiles: attached } : project);
      } else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
      return true;
    }

    const first = parts[0]!;
    if (first === "styles" && parts[1] === "preview") {
      if (parts.length === 2 && method === "POST") {
        const body = await readJson(req);
        let style = typeof body["id"] === "string" ? studio.styles.list().find((s) => s.id === body["id"]) : undefined;
        if (!style) {
          const v = validateStyle(body);
          if (!v.ok) throw new VsError(v.message, 400);
          style = v.style;
        }
        send(res, 200, await studio.previewStyle(style));
      } else if (parts.length === 3 && method === "GET") {
        const name = decode(parts[2]!);
        if (!/^[a-z0-9-]+\.mp4$/.test(name)) throw new VsError("Không tìm thấy tệp.", 404);
        sendFile(req, res, path.join(studio.dataDir, "videostudio", "_style-preview", name));
      } else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
      return true;
    }
    if (first === "styles" && parts.length <= 2) {
      if (parts.length === 1) {
        if (method === "GET") send(res, 200, studio.styles.list());
        else if (method === "POST") send(res, 201, studio.styles.save(await readJson(req)));
        else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      if (method === "DELETE") {
        const removed = studio.styles.remove(decode(parts[1]!));
        if (!removed) throw new VsError("Không tìm thấy phong cách.", 404);
        send(res, 200, { ok: true });
      } else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
      return true;
    }
    if (first === "library" && parts.length <= 2) {
      if (parts.length === 1) {
        if (method === "GET") send(res, 200, { files: studio.library.list() });
        else if (method === "POST") {
          const q = new URL(req.url ?? "/", "http://localhost").searchParams;
          const hdr = req.headers["x-file-name"];
          const name = typeof hdr === "string" && hdr !== "" ? decode(hdr).trim() : (q.get("name") ?? "").trim();
          if (name === "") throw new VsError("Thiếu tên tệp (header x-file-name hoặc query name).", 400);
          const data = await readRaw(req, ASSET_LIMIT, "Tệp quá lớn (tối đa 300 MB).");
          send(res, 201, studio.library.add(name, data));
        } else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      if (method === "DELETE") {
        if (!studio.library.remove(decode(parts[1]!))) throw new VsError("Không tìm thấy tệp trong thư viện.", 404);
        send(res, 200, { ok: true });
      } else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
      return true;
    }
    if (first === "voices" && parts.length === 1) {
      if (method !== "GET") send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
      else send(res, 200, { voices: await studio.listVoices() });
      return true;
    }
    if (first === "settings" && parts.length === 1) {
      if (method === "GET") send(res, 200, studio.settings.publicView());
      else if (method === "PUT") {
        if (ctx.viaTunnel) {
          send(res, 403, { error: "forbidden", message: "Không đổi cài đặt Video Studio qua đường hầm." });
          return true;
        }
        send(res, 200, studio.settings.update(await readJson(req)));
      } else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
      return true;
    }

    const slug = decode(first);
    const sub = parts[1];
    if (parts.length === 1) {
      if (method === "GET") {
        const project = studio.store.get(slug);
        send(res, 200, { ...project, plan: studio.store.getPlan(slug), assets: studio.store.listAssets(slug) });
      } else if (method === "DELETE") {
        studio.remove(slug);
        send(res, 200, { ok: true });
      } else send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
      return true;
    }
    if (parts.length === 2 && sub === "style") {
      if (method !== "PUT") {
        send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      studio.store.get(slug);
      if (studio.isBusy(slug)) throw new VsError("Dự án đang bận, thử lại sau.", 409);
      const body = await readJson(req);
      const styleId = typeof body["styleId"] === "string" ? body["styleId"] : "";
      if (!studio.styles.list().some((s) => s.id === styleId)) throw new VsError("Không tìm thấy phong cách.", 404);
      const project = studio.store.update(slug, { styleId });
      studio.store.savePlan(slug, { ...studio.store.getPlan(slug), styleId });
      send(res, 200, project);
      return true;
    }
    if (parts.length === 2 && sub === "plan") {
      if (method !== "PUT") {
        send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      studio.store.get(slug);
      const body = await readJson(req);
      const inner = body["plan"];
      const plan = inner && typeof inner === "object" && !Array.isArray(inner) && !("video" in body) ? inner : body;
      send(res, 200, studio.store.savePlan(slug, plan));
      return true;
    }
    if (parts.length === 2 && sub === "assets") {
      if (method !== "POST") {
        send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      studio.store.get(slug);
      const q = new URL(req.url ?? "/", "http://localhost").searchParams;
      const hdr = req.headers["x-file-name"];
      const name = typeof hdr === "string" && hdr !== "" ? decode(hdr).trim() : (q.get("name") ?? "").trim();
      if (name === "") throw new VsError("Thiếu tên tệp (header x-file-name hoặc query name).", 400);
      const data = await readRaw(req, ASSET_LIMIT, "Tệp quá lớn (tối đa 300 MB).");
      if (data.length === 0) throw new VsError("Tệp rỗng.", 400);
      send(res, 201, await studio.addAsset(slug, name, data));
      return true;
    }
    if (parts.length === 2 && sub && ACTIONS.has(sub)) {
      if (method !== "POST") {
        send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      studio.store.get(slug);
      let input: { start: number; end: number; instruction: string } | null = null;
      let range: { start: number; end: number } | undefined;
      if (sub === "preview" && Number(req.headers["content-length"] ?? 0) > 0) {
        const body = await readJson(req);
        if (typeof body["start"] === "number" && typeof body["end"] === "number") range = { start: body["start"], end: body["end"] };
        else if (body["start"] !== undefined || body["end"] !== undefined) throw new VsError("start và end phải là số.", 400);
      }
      if (sub === "edit-segment") {
        const body = await readJson(req);
        const { start, end, instruction } = body;
        if (typeof start !== "number" || typeof end !== "number" || typeof instruction !== "string") {
          throw new VsError("Cần start, end (số) và instruction (chuỗi).", 400);
        }
        input = { start, end, instruction };
      }
      if (studio.isBusy(slug)) throw new VsError("Dự án đang bận, thử lại sau.", 409);
      let job: Promise<void>;
      if (sub === "generate") job = studio.generatePlan(slug);
      else if (sub === "edit-segment") job = studio.editSegment(slug, input!);
      else if (sub === "narrate") job = studio.narrate(slug);
      else if (sub === "preview") job = studio.preview(slug, range);
      else job = studio.render(slug);
      job.catch((e: unknown) => log(`videostudio ${slug} ${sub}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
      send(res, 202, { state: studio.store.get(slug).state });
      return true;
    }
    if (parts.length === 2 && sub === "file") {
      if (method !== "GET") {
        send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      studio.store.get(slug);
      const rel = new URL(req.url ?? "/", "http://localhost").searchParams.get("path");
      if (!rel) throw new VsError("Thiếu tham số path.", 400);
      sendFile(req, res, studio.store.filePath(slug, safeVsRel(rel)));
      return true;
    }
    if (parts.length === 2 && sub === "download") {
      if (method !== "GET") {
        send(res, 405, { error: "method_not_allowed", message: "Phương thức không được hỗ trợ." });
        return true;
      }
      const project = studio.store.get(slug);
      if (!project.lastRender) throw new VsError("Dự án chưa có video đã dựng.", 404);
      const abs = studio.store.filePath(slug, safeVsRel(project.lastRender));
      sendFile(req, res, abs, downloadHeaders(project.title, extOf(abs)));
      return true;
    }
    send(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      return true;
    }
    if (e instanceof VsError) send(res, e.status, { error: "videostudio_error", message: e.message });
    else {
      log(`videostudio route ${method} ${p}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      send(res, 500, { error: "internal", message: GENERIC });
    }
  }
  return true;
}
