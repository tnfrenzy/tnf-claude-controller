// src/server/materials-routes.ts — /api/workshop3d/materials/*: "Tạo hàng loạt" (batch library), code-only, cost 0.
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { BATCH_CATEGORIES, MAX_BATCH_DIR, MAX_BATCH_UPLOAD, MAX_IMAGE_BYTES, MaterialError, type MaterialLibrary } from "../core/workshop3d/material-library.js";

const JSON_LIMIT = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), "cache-control": "no-store" });
  res.end(data);
}

function readRaw(req: IncomingMessage, limit: number, tooBig: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        // drain the rest so the 413 can still be sent
        over = true;
        chunks.length = 0;
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => (over ? reject(new MaterialError(tooBig, 413)) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req, JSON_LIMIT, "Nội dung quá lớn.");
  if (raw.length === 0) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new MaterialError("JSON không hợp lệ.");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new MaterialError("Nội dung phải là một đối tượng JSON.");
  return v as Record<string, unknown>;
}

function fileNameHeader(req: IncomingMessage): string {
  const h = req.headers["x-file-name"];
  if (typeof h !== "string") return "";
  try {
    return decodeURIComponent(h).trim();
  } catch {
    return h.trim();
  }
}

/** Handles /api/workshop3d/materials[...]; returns false when the path is not one of these routes. */
export async function handleMaterialsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  p: string,
  method: string,
  lib: MaterialLibrary | null,
  ctx: { viaTunnel: boolean },
): Promise<boolean> {
  if (p !== "/api/workshop3d/materials" && !p.startsWith("/api/workshop3d/materials/")) return false;
  const parts = p.split("/").filter(Boolean).slice(3); // after ["api","workshop3d","materials"]
  if (!lib) {
    send(res, 503, { error: "materials_unavailable", message: "Thư viện vật liệu chưa sẵn sàng." });
    return true;
  }
  try {
    if (parts.length === 0 && method === "GET") {
      send(res, 200, {
        items: lib.list(),
        categories: BATCH_CATEGORIES,
        batches: lib.batches(),
        limits: { upload: MAX_BATCH_UPLOAD, dir: MAX_BATCH_DIR, imageBytes: MAX_IMAGE_BYTES },
        localDir: !ctx.viaTunnel,
      });
      return true;
    }
    if (parts.length === 1 && parts[0] === "upload" && method === "POST") {
      const data = await readRaw(req, MAX_IMAGE_BYTES, "Ảnh quá lớn (tối đa 10 MB).");
      send(res, 201, lib.stageUpload(fileNameHeader(req), data));
      return true;
    }
    if (parts.length === 1 && parts[0] === "batch" && method === "POST") {
      const body = await readJson(req);
      const items = body["items"];
      if (!Array.isArray(items)) throw new MaterialError("items phải là danh sách ảnh đã tải lên.");
      send(res, 202, lib.startUploadBatch(items as { upload: unknown; name?: unknown }[], body));
      return true;
    }
    if (parts.length === 1 && parts[0] === "import-dir" && method === "POST") {
      // Reads a folder of the PC running the app: never through the tunnel (phone / remote).
      if (ctx.viaTunnel) {
        send(res, 403, { error: "local_only", message: "Chỉ nhập từ thư mục được trên máy chạy app, không qua kết nối từ xa. Hãy tải ảnh lên." });
        return true;
      }
      const body = await readJson(req);
      send(res, 202, lib.startDirBatch(typeof body["dir"] === "string" ? body["dir"] : "", body));
      return true;
    }
    if (parts.length === 2 && parts[0] === "batch" && method === "GET") {
      const b = lib.batch(decodeURIComponent(parts[1]!));
      if (!b) throw new MaterialError("Không tìm thấy lô (lô cũ mất khi khởi động lại app).", 404);
      send(res, 200, b);
      return true;
    }
    if (parts.length >= 1 && parts[0] !== "batch" && parts[0] !== "upload" && parts[0] !== "import-dir") {
      let id: string;
      try {
        id = decodeURIComponent(parts[0]!);
      } catch {
        throw new MaterialError("Mã vật liệu không hợp lệ.");
      }
      if (parts.length === 1 && method === "GET") {
        const e = lib.get(id);
        if (!e) throw new MaterialError("Không tìm thấy vật liệu.", 404);
        send(res, 200, e);
        return true;
      }
      if (parts.length === 1 && method === "DELETE") {
        lib.remove(id);
        send(res, 200, { ok: true });
        return true;
      }
      if (parts.length === 1 && (method === "PUT" || method === "PATCH")) {
        const body = await readJson(req);
        send(res, 200, await lib.update(id, { name: body["name"], tile_cm: body["tile_cm"] }));
        return true;
      }
      if (parts.length === 3 && parts[1] === "file" && method === "GET") {
        const info = lib.filePath(id, decodeURIComponent(parts[2]!));
        res.writeHead(200, {
          "content-type": info.contentType,
          "content-length": info.size,
          "content-disposition": `inline; filename="${id}-${parts[2]!.replace(/[^\w.-]/g, "_")}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        fs.createReadStream(info.abs).on("error", () => res.destroy()).pipe(res);
        return true;
      }
    }
    send(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
  } catch (e) {
    if (e instanceof MaterialError) send(res, e.status, { error: "material_error", message: e.message });
    else send(res, 500, { error: "internal", message: `Lỗi nội bộ của thư viện vật liệu: ${e instanceof Error ? e.message : String(e)}` });
  }
  return true;
}
