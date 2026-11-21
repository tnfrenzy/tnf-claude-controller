// src/server/variants-routes.ts — /api/workshop3d/<slug>/variants/*: configuration variants of a master session (docs/DESIGN-3D.md 6c).
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { W3DStore } from "../core/workshop3d/store.js";
import { MAX_PART_BYTES, type VariantStore } from "../core/workshop3d/variant-store.js";
import { normalizeSlots, VariantError } from "../core/workshop3d/variants.js";

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
        over = true;
        chunks.length = 0;
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => (over ? reject(new VariantError(tooBig, 413)) : resolve(Buffer.concat(chunks))));
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
    throw new VariantError("JSON không hợp lệ.");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new VariantError("Nội dung phải là một đối tượng JSON.");
  return v as Record<string, unknown>;
}

const header = (req: IncomingMessage, name: string): string => {
  const h = req.headers[name];
  if (typeof h !== "string") return "";
  try {
    return decodeURIComponent(h).trim();
  } catch {
    return h.trim();
  }
};

/** Handles /api/workshop3d/<slug>/variants[...]; returns false when the path is not one of these routes. */
export async function handleVariantsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  p: string,
  method: string,
  ctx: { store: W3DStore | null; variants: VariantStore },
): Promise<boolean> {
  const parts = p.split("/").filter(Boolean); // ["api","workshop3d",slug,"variants",...]
  if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "workshop3d" || parts[3] !== "variants") return false;
  if (!ctx.store) {
    send(res, 503, { error: "w3d_unavailable", message: "Xưởng dựng 3D chưa sẵn sàng." });
    return true;
  }
  let slug: string;
  try {
    slug = decodeURIComponent(parts[2]!);
  } catch {
    send(res, 404, { error: "not_found", message: "Không tìm thấy phiên dựng 3D." });
    return true;
  }
  const rec = ctx.store.get(slug);
  if (!rec) {
    send(res, 404, { error: "not_found", message: "Không tìm thấy phiên dựng 3D." });
    return true;
  }
  const sd = ctx.store.dir(slug);
  const v = ctx.variants;
  const sub = parts.slice(4);
  try {
    if (sub.length === 0 && method === "GET") {
      send(res, 200, v.overview(sd, rec.brief));
      return true;
    }
    // Declares / edits the slots of a session made before slots existed (or whose intake left them out).
    if (sub.length === 1 && sub[0] === "slots" && method === "PUT") {
      const body = await readJson(req);
      const checked = normalizeSlots(body["slots"]);
      if (!checked.ok) throw new VariantError(checked.error);
      const brief = { ...rec.brief };
      if (checked.value.length > 0) brief.slots = checked.value;
      else delete brief.slots;
      ctx.store.saveBrief(slug, brief);
      send(res, 200, v.overview(sd, brief));
      return true;
    }
    if (sub.length === 1 && sub[0] === "options" && method === "POST") {
      const body = await readJson(req);
      const o = v.addMaterialOption(sd, rec.brief, {
        ...(typeof body["slot"] === "string" && body["slot"] ? { slot: body["slot"] } : {}),
        command: typeof body["command"] === "string" ? body["command"] : "",
        ...(typeof body["upload"] === "string" ? { upload: body["upload"] } : {}),
        ...(typeof body["materialId"] === "string" ? { materialId: body["materialId"] } : {}),
        tile_cm: body["tile_cm"],
        mapping: body["mapping"],
      });
      send(res, 201, o);
      return true;
    }
    if (sub.length === 1 && sub[0] === "parts" && method === "POST") {
      const data = await readRaw(req, MAX_PART_BYTES, "Tệp bộ phận quá lớn (tối đa 20 MB).");
      send(res, 201, v.addPartOption(sd, rec.brief, { slot: header(req, "x-slot"), name: header(req, "x-name"), data }));
      return true;
    }
    if (sub.length === 2 && sub[0] === "options" && method === "DELETE") {
      v.removeOption(sd, decodeURIComponent(sub[1]!));
      send(res, 200, { ok: true });
      return true;
    }
    if (sub.length === 1 && sub[0] === "batch" && method === "POST") {
      const body = await readJson(req);
      const raw = body["slots"];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new VariantError("slots phải là {slotId: [optionId, ...]}.");
      const perSlot: Record<string, string[]> = {};
      for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
        if (!Array.isArray(val) || val.some((x) => typeof x !== "string")) throw new VariantError(`slots.${k} phải là mảng mã phương án.`);
        perSlot[k] = val as string[];
      }
      send(res, 202, { configs: v.startBatch(sd, rec.brief, perSlot) });
      return true;
    }
    if (sub.length >= 2 && sub[0] === "configs") {
      const id = decodeURIComponent(sub[1]!);
      if (sub.length === 2 && method === "GET") {
        send(res, 200, v.config(sd, id));
        return true;
      }
      if (sub.length === 2 && method === "DELETE") {
        v.removeConfig(sd, id);
        send(res, 200, { ok: true });
        return true;
      }
      if (sub.length === 3 && sub[2] === "model.glb" && method === "GET") {
        const f = v.configFile(sd, id);
        res.writeHead(200, {
          "content-type": "model/gltf-binary",
          "content-length": f.size,
          "content-disposition": `inline; filename="${id}.glb"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        fs.createReadStream(f.abs).on("error", () => res.destroy()).pipe(res);
        return true;
      }
    }
    send(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
  } catch (e) {
    if (e instanceof VariantError) send(res, e.status, { error: "variant_error", message: e.message });
    else if (e && typeof e === "object" && "status" in e && "message" in e && typeof (e as { status: unknown }).status === "number") {
      // MaterialError from the library (bad upload id, image too small...)
      send(res, (e as { status: number }).status, { error: "material_error", message: String((e as { message: string }).message) });
    } else send(res, 500, { error: "internal", message: `Lỗi nội bộ khi tạo biến thể: ${e instanceof Error ? e.message : String(e)}` });
  }
  return true;
}
