// src/core/workshop3d/variant-store.ts — options + configurations of a master session on disk
// (<session>/variants/, docs/DESIGN-3D.md 6c). Code only: material options reuse the library slab pipeline
// (make_material.py), configurations are GLBs merged by variants.ts. No Claude call anywhere.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bboxOfNodes, parseGlb } from "./glb.js";
import type { MaterialLibrary } from "./material-library.js";
import type { W3DBrief, W3DSlot } from "./types.js";
import {
  applyConfig, configProduct, mapSlots, MAX_CONFIGS, MAX_OPTIONS, optionNameFromCommand, pickSlotFromCommand, slabSizeForSlot, VariantError,
  type Choices, type ResolvedOption, type SlotMapping,
} from "./variants.js";

export const MAX_TOTAL_CONFIGS = 48;
export const MAX_PART_BYTES = 20 * 1024 * 1024;
export const MODEL_REL = "outputs/model.glb";

export interface VariantOption {
  id: string;
  slot: string;
  kind: "material" | "part";
  name: string;
  command: string;
  /** Library entry (kind "material") once the slab is built. */
  materialId?: string;
  /** Part GLB, relative to the variants folder (kind "part"). */
  part?: string;
  state: "building" | "ready" | "failed";
  error?: string;
  /** Library batch that builds the slab from the uploaded image. */
  batch?: string;
  created: string;
}

export interface VariantConfig {
  id: string;
  name: string;
  choices: Choices;
  state: "queued" | "running" | "done" | "failed";
  error?: string;
  bytes?: number;
  created: string;
}

export interface SlotView {
  id: string;
  name: string;
  type: "material" | "part";
  matched: string[];
  size_mm: { w: number; d: number; h: number } | null;
}

export interface VariantOverview {
  /** The master has a model.glb and slots. */
  ready: boolean;
  reason: string | null;
  slots: SlotView[];
  options: VariantOption[];
  configs: VariantConfig[];
  limits: { maxConfigs: number; maxOptions: number; maxTotalConfigs: number; maxPartBytes: number };
}

export interface VariantStoreDeps {
  lib: Pick<MaterialLibrary, "get" | "filePath" | "startUploadBatch" | "batch"> | null;
  now?: () => number;
}

const ID_RE = /^[a-z]-[a-z0-9]{4,12}-[a-z0-9]{3,8}$/;
const rid = (prefix: string, now: number): string => `${prefix}-${now.toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
const checkId = (id: string): string => {
  if (!ID_RE.test(id)) throw new VariantError("Mã không hợp lệ.", 404);
  return id;
};

export function createVariantStore(deps: VariantStoreDeps) {
  const now = deps.now ?? Date.now;
  const queue: (() => void)[] = [];
  let working: Promise<void> | null = null;
  /** `${dir}|${configId}` currently queued or running in this process (anything else marked running on disk is stale). */
  const active = new Set<string>();

  const vdir = (sessionDir: string): string => path.join(sessionDir, "variants");
  const readJson = <T>(file: string, fallback: T): T => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return fallback;
    }
  };
  const writeJson = (file: string, v: unknown): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2), "utf8");
    fs.renameSync(tmp, file);
  };
  const optionsFile = (sd: string): string => path.join(vdir(sd), "options.json");
  const readOptions = (sd: string): VariantOption[] => {
    const v = readJson<unknown>(optionsFile(sd), []);
    return Array.isArray(v) ? (v as VariantOption[]) : [];
  };
  const cfgDir = (sd: string, id: string): string => path.join(vdir(sd), "configs", checkId(id));
  const readConfig = (sd: string, id: string): VariantConfig | null => readJson<VariantConfig | null>(path.join(cfgDir(sd, id), "config.json"), null);
  const writeConfig = (sd: string, c: VariantConfig): void => writeJson(path.join(cfgDir(sd, c.id), "config.json"), c);
  const listConfigs = (sd: string): VariantConfig[] => {
    const root = path.join(vdir(sd), "configs");
    if (!fs.existsSync(root)) return [];
    const out: VariantConfig[] = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
      const c = readConfig(sd, e.name);
      if (!c) continue;
      if ((c.state === "queued" || c.state === "running") && !active.has(`${sd}|${c.id}`)) {
        c.state = "failed";
        c.error = "Bị gián đoạn (app khởi động lại). Hãy tạo lại cấu hình này.";
        writeConfig(sd, c);
      }
      out.push(c);
    }
    return out.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
  };

  const masterPath = (sd: string): string => path.join(sd, MODEL_REL);
  const loadMapping = (sd: string, brief: W3DBrief): { maps: SlotMapping[]; reason: string | null } => {
    const slots = brief.slots ?? [];
    if (slots.length === 0) return { maps: [], reason: "Mẫu chính chưa khai báo chỗ cấu hình (slot). Thêm slot ở tờ yêu cầu khi tạo phiên." };
    if (!fs.existsSync(masterPath(sd))) return { maps: [], reason: "Mẫu chính chưa có model.glb (chờ dựng xong)." };
    try {
      return { maps: mapSlots(parseGlb(fs.readFileSync(masterPath(sd))), slots), reason: null };
    } catch (e) {
      return { maps: [], reason: `Không đọc được model.glb: ${e instanceof Error ? e.message : String(e)}` };
    }
  };

  /** Pulls the result of library batches into the options still "building". */
  const refreshOptions = (sd: string): VariantOption[] => {
    const opts = readOptions(sd);
    let changed = false;
    for (const o of opts) {
      if (o.state !== "building") continue;
      const b = o.batch && deps.lib ? deps.lib.batch(o.batch) : null;
      if (!b) {
        o.state = "failed";
        o.error = "Bị gián đoạn (app khởi động lại). Hãy thêm lại phương án.";
        changed = true;
        continue;
      }
      if (!b.done) continue;
      const it = b.items[0];
      if (it?.state === "done" && it.id) {
        o.state = "ready";
        o.materialId = it.id;
        delete o.error;
      } else {
        o.state = "failed";
        o.error = it?.error ?? "Không dựng được vật liệu từ ảnh.";
      }
      changed = true;
    }
    if (changed) writeJson(optionsFile(sd), opts);
    return opts;
  };

  const addOption = (sd: string, o: Omit<VariantOption, "id" | "created">): VariantOption => {
    const opts = readOptions(sd);
    if (opts.length >= MAX_OPTIONS) throw new VariantError(`Tối đa ${MAX_OPTIONS} phương án cho một mẫu chính. Xóa bớt phương án không dùng.`);
    const full: VariantOption = { ...o, id: rid("o", now()), created: new Date(now()).toISOString() };
    opts.push(full);
    writeJson(optionsFile(sd), opts);
    return full;
  };

  const slotById = (slots: W3DSlot[], id: string): W3DSlot => {
    const s = slots.find((x) => x.id === id);
    if (!s) throw new VariantError(`Không có chỗ cấu hình "${id}".`);
    return s;
  };

  const resolver = (sd: string, opts: VariantOption[]) => (optionId: string): ResolvedOption => {
    const o = opts.find((x) => x.id === optionId);
    if (!o) throw new VariantError("Phương án đã bị xóa.", 404);
    if (o.state !== "ready") throw new VariantError(`Phương án "${o.name}" chưa sẵn sàng.`, 409);
    if (o.kind === "part") {
      const p = path.join(vdir(sd), o.part ?? "");
      if (!o.part || !fs.existsSync(p)) throw new VariantError(`Thiếu tệp bộ phận của "${o.name}".`, 404);
      return { kind: "part", glb: fs.readFileSync(p) };
    }
    const entry = o.materialId && deps.lib ? deps.lib.get(o.materialId) : null;
    if (!entry || !deps.lib) throw new VariantError(`Vật liệu của "${o.name}" không còn trong thư viện.`, 404);
    return { kind: "material", slab: fs.readFileSync(deps.lib.filePath(entry.id, "slab.glb").abs), mapping: entry.mapping, tileCm: entry.tile_cm };
  };

  const pump = (): void => {
    if (working) return;
    working = (async () => {
      while (queue.length > 0) {
        const job = queue.shift()!;
        await new Promise<void>((r) => setImmediate(r));
        job();
      }
    })().finally(() => {
      working = null;
      if (queue.length > 0) pump();
    });
  };

  const buildOne = (sd: string, brief: W3DBrief, cfg: VariantConfig): void => {
    const key = `${sd}|${cfg.id}`;
    try {
      cfg.state = "running";
      writeConfig(sd, cfg);
      const opts = readOptions(sd);
      const out = applyConfig(fs.readFileSync(masterPath(sd)), brief.slots ?? [], cfg.choices, resolver(sd, opts));
      fs.writeFileSync(path.join(cfgDir(sd, cfg.id), "model.glb"), out);
      cfg.state = "done";
      cfg.bytes = out.length;
      delete cfg.error;
    } catch (e) {
      cfg.state = "failed";
      cfg.error = e instanceof Error ? e.message : String(e);
    } finally {
      active.delete(key);
      writeConfig(sd, cfg);
    }
  };

  return {
    overview(sd: string, brief: W3DBrief): VariantOverview {
      const { maps, reason } = loadMapping(sd, brief);
      const slots: SlotView[] = (brief.slots ?? []).map((s) => {
        const m = maps.find((x) => x.slot.id === s.id);
        return { id: s.id, name: s.name, type: s.type, matched: m?.names ?? [], size_mm: m?.size_mm ?? null };
      });
      return {
        ready: reason === null,
        reason,
        slots,
        options: refreshOptions(sd),
        configs: listConfigs(sd),
        limits: { maxConfigs: MAX_CONFIGS, maxOptions: MAX_OPTIONS, maxTotalConfigs: MAX_TOTAL_CONFIGS, maxPartBytes: MAX_PART_BYTES },
      };
    },

    /** Material option from an uploaded image (library pipeline, sized to the slot) or from a library entry the user picked. */
    addMaterialOption(sd: string, brief: W3DBrief, o: { slot?: string; command: string; upload?: string; materialId?: string; tile_cm?: unknown; mapping?: unknown }): VariantOption {
      const slots = brief.slots ?? [];
      const command = (o.command ?? "").trim().slice(0, 500);
      const slotId = o.slot || pickSlotFromCommand(command, slots);
      if (!slotId) throw new VariantError("Chưa biết lệnh này dành cho chỗ cấu hình nào. Hãy chọn chỗ cấu hình, hoặc ghi tên chỗ đó trong câu lệnh.");
      slotById(slots, slotId);
      const { maps, reason } = loadMapping(sd, brief);
      if (reason) throw new VariantError(reason, 409);
      const map = maps.find((m) => m.slot.id === slotId)!;
      if (map.nodes.length === 0) throw new VariantError(`Chỗ "${map.slot.name}" chưa khớp node nào của mẫu chính.`, 409);
      if (!deps.lib) throw new VariantError("Thư viện vật liệu chưa sẵn sàng.", 503);
      if (o.materialId) {
        const entry = deps.lib.get(o.materialId);
        if (!entry) throw new VariantError("Không tìm thấy vật liệu trong thư viện.", 404);
        return addOption(sd, { slot: slotId, kind: "material", name: optionNameFromCommand(command, entry.name), command, materialId: entry.id, state: "ready" });
      }
      if (!o.upload) throw new VariantError("Hãy tải một ảnh lên hoặc chọn một vật liệu trong thư viện đá.");
      const name = optionNameFromCommand(command, "Phương án");
      // The library names the entry after the command (it only names; nothing is generated from the words).
      const b = deps.lib.startUploadBatch([{ upload: o.upload, name }], { category: "stone", size_mm: slabSizeForSlot(map.size_mm), tile_cm: o.tile_cm, mapping: o.mapping });
      return addOption(sd, { slot: slotId, kind: "material", name, command, state: "building", batch: b.id });
    },

    /** Ready-made part option: a GLB file replaces the slot's nodes (slot type "part" only). */
    addPartOption(sd: string, brief: W3DBrief, o: { slot: string; name: string; command?: string; data: Buffer }): VariantOption {
      const slot = slotById(brief.slots ?? [], o.slot);
      if (slot.type !== "part") throw new VariantError(`Chỗ "${slot.name}" chỉ nhận phương án vật liệu (loại "material").`);
      if (o.data.length === 0 || o.data.length > MAX_PART_BYTES) throw new VariantError(`Tệp bộ phận phải từ 1 byte đến ${MAX_PART_BYTES / 1024 / 1024} MB.`, 413);
      let ok = false;
      try {
        const g = parseGlb(o.data);
        const roots: number[] = g.json.scenes?.[g.json.scene ?? 0]?.nodes ?? [];
        ok = roots.length > 0 && bboxOfNodes(g, roots) !== null;
      } catch (e) {
        throw new VariantError(`Tệp bộ phận không phải GLB hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!ok) throw new VariantError("Tệp bộ phận không có hình học (cảnh trống).");
      const opt = addOption(sd, { slot: o.slot, kind: "part", name: optionNameFromCommand(o.name, "Bộ phận"), command: (o.command ?? "").slice(0, 500), part: "", state: "ready" });
      const rel = `parts/${opt.id}.glb`;
      fs.mkdirSync(path.join(vdir(sd), "parts"), { recursive: true });
      fs.writeFileSync(path.join(vdir(sd), rel), o.data);
      const opts = readOptions(sd);
      opts.find((x) => x.id === opt.id)!.part = rel;
      writeJson(optionsFile(sd), opts);
      return { ...opt, part: rel };
    },

    removeOption(sd: string, id: string): void {
      checkId(id);
      const opts = readOptions(sd);
      const o = opts.find((x) => x.id === id);
      if (!o) throw new VariantError("Không tìm thấy phương án.", 404);
      if (o.part) fs.rmSync(path.join(vdir(sd), o.part), { force: true });
      writeJson(optionsFile(sd), opts.filter((x) => x.id !== id));
    },

    /** Queues the product of the chosen options (slotId -> optionIds). Returns the new configs (state queued). */
    startBatch(sd: string, brief: W3DBrief, perSlot: Record<string, string[]>): VariantConfig[] {
      const slots = brief.slots ?? [];
      const { reason } = loadMapping(sd, brief);
      if (reason) throw new VariantError(reason, 409);
      const opts = refreshOptions(sd);
      for (const [slotId, ids] of Object.entries(perSlot)) {
        slotById(slots, slotId);
        for (const id of ids) {
          const o = opts.find((x) => x.id === id);
          if (!o || o.slot !== slotId) throw new VariantError("Phương án không thuộc chỗ cấu hình đã chọn.", 404);
          if (o.state !== "ready") throw new VariantError(`Phương án "${o.name}" chưa sẵn sàng (${o.state === "building" ? "đang dựng" : "lỗi"}).`, 409);
        }
      }
      const combos = configProduct(perSlot, slots.map((s) => s.id));
      const existing = listConfigs(sd);
      if (existing.length + combos.length > MAX_TOTAL_CONFIGS) throw new VariantError(`Đã có ${existing.length} cấu hình; thêm ${combos.length} nữa vượt trần ${MAX_TOTAL_CONFIGS}. Xóa bớt cấu hình cũ.`);
      const made: VariantConfig[] = [];
      for (const choices of combos) {
        const name = Object.entries(choices)
          .map(([slotId, optId]) => `${slots.find((s) => s.id === slotId)?.name ?? slotId}: ${opts.find((o) => o.id === optId)?.name ?? "?"}`)
          .join(" · ");
        const cfg: VariantConfig = { id: rid("c", now()), name, choices, state: "queued", created: new Date(now()).toISOString() };
        fs.mkdirSync(cfgDir(sd, cfg.id), { recursive: true });
        writeConfig(sd, cfg);
        active.add(`${sd}|${cfg.id}`);
        queue.push(() => buildOne(sd, brief, cfg));
        made.push(cfg);
      }
      pump();
      return made;
    },

    config(sd: string, id: string): VariantConfig {
      const c = readConfig(sd, id);
      if (!c) throw new VariantError("Không tìm thấy cấu hình.", 404);
      return c;
    },

    configFile(sd: string, id: string): { abs: string; size: number } {
      const c = readConfig(sd, id);
      const abs = path.join(cfgDir(sd, id), "model.glb");
      if (!c || c.state !== "done" || !fs.existsSync(abs)) throw new VariantError("Cấu hình chưa có model.glb.", 404);
      return { abs, size: fs.statSync(abs).size };
    },

    removeConfig(sd: string, id: string): void {
      const c = readConfig(sd, id);
      if (!c) throw new VariantError("Không tìm thấy cấu hình.", 404);
      if (c.state === "queued" || c.state === "running") {
        if (active.has(`${sd}|${id}`)) throw new VariantError("Cấu hình đang được ghép, chờ xong rồi xóa.", 409);
      }
      fs.rmSync(cfgDir(sd, id), { recursive: true, force: true });
    },

    /** Resolves when no config is queued or running (tests). */
    async idle(): Promise<void> {
      while (working) await working;
    },
  };
}

export type VariantStore = ReturnType<typeof createVariantStore>;
