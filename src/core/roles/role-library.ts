import fs from "node:fs";
import path from "node:path";
import { validateExtraAgents, type ExtraAgentDef } from "../run/extras.js";

/** Global library of custom roles and skill/prompt text items (`data/library/library.json`). */
export const MAX_LIBRARY_ROLES = 30;
export const MAX_LIBRARY_ITEMS = 100;
export const MAX_ITEM_BYTES = 64 * 1024;
export const MAX_ITEM_NAME = 80;
/** Cap on the total library text appended to prompts in one run (all roles + coordinator). */
export const MAX_LIBRARY_APPEND_BYTES = 64 * 1024;

export type LibraryItemType = "skill" | "prompt";

export interface LibraryRole extends ExtraAgentDef {
  id: string;
}

export interface LibraryItem {
  id: string;
  name: string;
  type: LibraryItemType;
  content: string;
  /** Ids of roles (built-in or custom) whose prompt gets this item appended. Empty = coordinator context only. */
  roleIds: string[];
  createdAt: number;
}

export interface LibraryData {
  roles: LibraryRole[];
  items: LibraryItem[];
  /** Ids of built-in templates already seeded (never recreated once edited or deleted). */
  seeded?: string[];
}

/** Error carrying an HTTP status; messages are Vietnamese. */
export class LibraryError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const ID_RE = /^[a-z0-9-]{1,40}$/;

/** Strip accents (đ → d), lowercase, non-alphanumerics → "-", max 40 chars. May return "" when nothing is left. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(new RegExp("\\u0111", "g"), "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export class RoleLibrary {
  private readonly file: string;

  /** `builtinNames` = names of the built-in roles (coding + research), read lazily. */
  constructor(dir: string, private readonly builtinNames: () => string[]) {
    this.file = path.join(dir, "library.json");
  }

  private read(): LibraryData {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<LibraryData>;
      const out: LibraryData = { roles: Array.isArray(j.roles) ? j.roles : [], items: Array.isArray(j.items) ? j.items : [] };
      if (Array.isArray(j.seeded)) out.seeded = j.seeded.filter((x) => typeof x === "string");
      return out;
    } catch {
      return { roles: [], items: [] };
    }
  }

  /** Add built-in prompt templates once (by fixed id). Skips ids already seeded; writes only on change. */
  seedTemplates(templates: { id: string; name: string; content: string }[]): void {
    const d = this.read();
    const seeded = new Set(d.seeded ?? []);
    let changed = false;
    for (const t of templates) {
      if (seeded.has(t.id)) continue;
      if (d.items.some((i) => i.id === t.id)) {
        seeded.add(t.id);
        changed = true;
        continue;
      }
      if (d.items.length >= MAX_LIBRARY_ITEMS) continue;
      d.items.push({ id: t.id, name: t.name, type: "prompt", content: t.content, roleIds: [], createdAt: Date.now() });
      seeded.add(t.id);
      changed = true;
    }
    if (changed) this.write({ ...d, seeded: [...seeded] });
  }

  private write(d: LibraryData): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  list(): LibraryData & { builtinRoles: string[] } {
    return { ...this.read(), builtinRoles: this.builtinNames() };
  }

  // ---- roles -------------------------------------------------------------------------------------------------

  private cleanRole(id: string, body: Record<string, unknown>): LibraryRole {
    if (!ID_RE.test(id)) throw new LibraryError("Mã vai không hợp lệ (chỉ a-z, 0-9, dấu gạch ngang; tối đa 40 ký tự).");
    if (this.builtinNames().includes(id)) throw new LibraryError(`Mã vai "${id}" trùng với vai có sẵn.`);
    const def: Record<string, unknown> = {};
    for (const k of ["description", "prompt", "tools", "model"]) if (body[k] !== undefined) def[k] = body[k];
    try {
      const out = validateExtraAgents({ [id]: def }, this.builtinNames());
      return { id, ...out[id]! };
    } catch (e) {
      throw new LibraryError(e instanceof Error ? e.message : String(e));
    }
  }

  createRole(body: Record<string, unknown>): LibraryRole {
    const rawId = typeof body["id"] === "string" ? body["id"] : "";
    const id = normalizeName(rawId);
    if (!id) throw new LibraryError("Thiếu mã vai.");
    const d = this.read();
    if (d.roles.length >= MAX_LIBRARY_ROLES) throw new LibraryError(`Thư viện tối đa ${MAX_LIBRARY_ROLES} vai.`);
    if (d.roles.some((r) => r.id === id)) throw new LibraryError(`Vai "${id}" đã có trong thư viện.`, 409);
    const role = this.cleanRole(id, body);
    d.roles.push(role);
    this.write(d);
    return role;
  }

  updateRole(id: string, body: Record<string, unknown>): LibraryRole {
    const d = this.read();
    const i = d.roles.findIndex((r) => r.id === id);
    if (i < 0) throw new LibraryError("Không tìm thấy vai trong thư viện.", 404);
    const role = this.cleanRole(id, { ...d.roles[i], ...body });
    d.roles[i] = role;
    this.write(d);
    return role;
  }

  deleteRole(id: string): void {
    const d = this.read();
    if (!d.roles.some((r) => r.id === id)) throw new LibraryError("Không tìm thấy vai trong thư viện.", 404);
    d.roles = d.roles.filter((r) => r.id !== id);
    for (const it of d.items) it.roleIds = it.roleIds.filter((r) => r !== id);
    this.write(d);
  }

  // ---- items -------------------------------------------------------------------------------------------------

  private cleanItem(body: Record<string, unknown>, d: LibraryData, prev?: LibraryItem): Omit<LibraryItem, "id" | "createdAt"> {
    const name = typeof body["name"] === "string" ? body["name"].replace(/\s+/g, " ").trim() : "";
    if (!name || name.length > MAX_ITEM_NAME) throw new LibraryError(`Tên mục phải có 1-${MAX_ITEM_NAME} ký tự.`);
    const type = body["type"];
    if (type !== "skill" && type !== "prompt") throw new LibraryError('Loại mục phải là "skill" hoặc "prompt".');
    const content = typeof body["content"] === "string" ? body["content"] : "";
    if (!content.trim()) throw new LibraryError("Nội dung mục trống.");
    if (Buffer.byteLength(content, "utf8") > MAX_ITEM_BYTES) throw new LibraryError(`Nội dung mục vượt ${MAX_ITEM_BYTES / 1024} KB.`);
    const rawIds = body["roleIds"] ?? prev?.roleIds ?? [];
    if (!Array.isArray(rawIds) || rawIds.some((r) => typeof r !== "string")) throw new LibraryError("roleIds phải là mảng chuỗi.");
    const roleIds = [...new Set(rawIds as string[])];
    const known = new Set([...this.builtinNames(), ...d.roles.map((r) => r.id)]);
    for (const r of roleIds) if (!known.has(r)) throw new LibraryError(`Vai "${r}" không tồn tại (không phải vai có sẵn hay vai trong thư viện).`);
    return { name, type, content, roleIds };
  }

  createItem(body: Record<string, unknown>): LibraryItem {
    const d = this.read();
    if (d.items.length >= MAX_LIBRARY_ITEMS) throw new LibraryError(`Thư viện tối đa ${MAX_LIBRARY_ITEMS} mục.`);
    const clean = this.cleanItem(body, d);
    const base = normalizeName(clean.name) || "item";
    let id = base;
    for (let n = 2; d.items.some((x) => x.id === id); n++) id = `${base.slice(0, 40 - String(n).length - 1)}-${n}`;
    const item: LibraryItem = { id, ...clean, createdAt: Date.now() };
    d.items.push(item);
    this.write(d);
    return item;
  }

  updateItem(id: string, body: Record<string, unknown>): LibraryItem {
    const d = this.read();
    const i = d.items.findIndex((x) => x.id === id);
    if (i < 0) throw new LibraryError("Không tìm thấy mục trong thư viện.", 404);
    const prev = d.items[i]!;
    const clean = this.cleanItem({ name: prev.name, type: prev.type, content: prev.content, ...body }, d, prev);
    const item: LibraryItem = { id, ...clean, createdAt: prev.createdAt };
    d.items[i] = item;
    this.write(d);
    return item;
  }

  deleteItem(id: string): void {
    const d = this.read();
    if (!d.items.some((x) => x.id === id)) throw new LibraryError("Không tìm thấy mục trong thư viện.", 404);
    d.items = d.items.filter((x) => x.id !== id);
    this.write(d);
  }

  /** Items by id for a run; unknown ids → 400 in Vietnamese. */
  getItems(ids: string[]): LibraryItem[] {
    const d = this.read();
    return [...new Set(ids)].map((id) => {
      const it = d.items.find((x) => x.id === id);
      if (!it) throw new LibraryError(`Không tìm thấy mục thư viện "${id}".`);
      return it;
    });
  }

  getRole(id: string): LibraryRole | undefined {
    return this.read().roles.find((r) => r.id === id);
  }
}
