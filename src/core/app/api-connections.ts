/**
 * API connections of the third tower: each floor is one read-only API (docs/API-NHAN-VIEN-AO.md). The controller
 * stores name, base URL and a read-only token in `<dataDir>/connections.json` (the token never goes back to the UI),
 * calls the API with a short timeout and normalises the answer. Only GET is ever sent.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Employee, PublicConnection, StaffResult, StaffSnapshot } from "../shared-types.js";

export type { Employee, PublicConnection, StaffResult, StaffSnapshot };

export const DEFAULT_STAFF_PATH = "/api/monitor/nhan-vien-ao";
export const MAX_CONNECTIONS = 5;
export const MAX_EMPLOYEES = 40;
export const STAFF_TIMEOUT_MS = 8000;
export const STAFF_CACHE_MS = 5000;

export interface Connection {
  id: string;
  name: string;
  baseUrl: string;
  path: string;
  token: string;
  createdAt: number;
}

export function publicView(c: Connection): PublicConnection {
  return { id: c.id, name: c.name, baseUrl: c.baseUrl, path: c.path, hasToken: c.token.length > 0, createdAt: c.createdAt };
}

export type ConnectionInput = { name?: unknown; baseUrl?: unknown; token?: unknown; path?: unknown };

/** Validate user input; messages are Vietnamese because they reach the user. */
export function validateConnectionInput(input: ConnectionInput, existing: readonly Connection[]): { ok: true; value: Omit<Connection, "id" | "createdAt"> } | { ok: false; message: string } {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (!name) return { ok: false, message: "Thiếu tên kết nối." };
  if (name.length > 40) return { ok: false, message: "Tên kết nối tối đa 40 ký tự." };
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { ok: false, message: "Đã có kết nối trùng tên." };
  if (existing.length >= MAX_CONNECTIONS) return { ok: false, message: `Tối đa ${MAX_CONNECTIONS} kết nối (mỗi kết nối là một tầng).` };
  let url: URL;
  try {
    url = new URL(typeof input.baseUrl === "string" ? input.baseUrl.trim() : "");
  } catch {
    return { ok: false, message: "Địa chỉ API không hợp lệ (ví dụ https://platform.example.com)." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, message: "Địa chỉ API phải bắt đầu bằng http:// hoặc https://." };
  if (url.username || url.password) return { ok: false, message: "Không đặt tên người dùng/mật khẩu trong địa chỉ; dùng ô token." };
  const rawPath = typeof input.path === "string" && input.path.trim() ? input.path.trim() : DEFAULT_STAFF_PATH;
  if (!rawPath.startsWith("/") || rawPath.includes("..") || rawPath.includes("://") || rawPath.length > 120) return { ok: false, message: "Đường dẫn API phải bắt đầu bằng / và không chứa .. hay địa chỉ đầy đủ." };
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token.length > 2000) return { ok: false, message: "Token quá dài." };
  return { ok: true, value: { name, baseUrl: url.origin + url.pathname.replace(/\/+$/, ""), path: rawPath, token } };
}

const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const strOrNull = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Lenient parse of the API answer; never throws. Unknown keys are ignored (the contract may grow). */
export function normalizeStaff(raw: unknown): { ok: true; snapshot: StaffSnapshot } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { employees?: unknown }).employees)) {
    return { ok: false, error: "API không trả danh sách nhân viên (thiếu `employees`)." };
  }
  const r = raw as { generatedAt?: unknown; employees: unknown[] };
  const seen = new Set<string>();
  const employees: Employee[] = [];
  for (const item of r.employees) {
    if (employees.length >= MAX_EMPLOYEES) break;
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    const id = typeof e["id"] === "string" && /^[A-Za-z0-9._-]{1,60}$/.test(e["id"]) ? e["id"] : null;
    const name = strOrNull(e["name"], 60);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const queueKnown = e["queueKnown"] !== false;
    const c = (typeof e["counts"] === "object" && e["counts"] !== null ? e["counts"] : {}) as Record<string, unknown>;
    const rate = typeof e["failedRate"] === "number" && Number.isFinite(e["failedRate"]) ? Math.min(1, Math.max(0, e["failedRate"])) : null;
    employees.push({
      id,
      name,
      department: strOrNull(e["department"], 30),
      paused: e["paused"] === true,
      queueKnown,
      counts: queueKnown ? { pending: int(c["pending"]), processing: int(c["processing"]), failed: int(c["failed"]), done: int(c["done"]) } : null,
      waitingLock: e["waitingLock"] === true,
      lastFinishedAt: strOrNull(e["lastFinishedAt"], 40),
      avgSeconds: typeof e["avgSeconds"] === "number" && Number.isFinite(e["avgSeconds"]) && e["avgSeconds"] >= 0 ? e["avgSeconds"] : null,
      failedRate: rate,
    });
  }
  return { ok: true, snapshot: { generatedAt: strOrNull(r.generatedAt, 40), employees } };
}

type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One GET to the connection's API. Never throws; failure is `{ ok: false, error }`. */
export async function fetchStaff(c: Connection, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = STAFF_TIMEOUT_MS): Promise<StaffResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (c.token) headers["authorization"] = `Bearer ${c.token}`;
    const res = await fetchImpl(c.baseUrl + c.path, { method: "GET", headers, signal: ctl.signal });
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: "API từ chối token (kiểm tra token chỉ-đọc còn hiệu lực và đúng quyền)." };
    if (!res.ok) return { ok: false, status: res.status, error: `API trả mã ${res.status}.` };
    const parsed = normalizeStaff(await res.json());
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, fetchedAt: Date.now(), ...parsed.snapshot };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: aborted ? `API không phản hồi trong ${Math.round(timeoutMs / 1000)} giây.` : "Không kết nối được tới API: " + (e instanceof Error ? e.message : String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

/** File store with a short per-connection cache so several browser tabs do not multiply calls to the API. */
export class ConnectionStore {
  private readonly cache = new Map<string, { at: number; result: StaffResult }>();
  constructor(
    private readonly dataDir: string,
    private readonly fetchImpl?: FetchLike,
  ) {}

  private file(): string {
    return path.join(this.dataDir, "connections.json");
  }

  list(): Connection[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(), "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((c): c is Connection => typeof c === "object" && c !== null && typeof (c as Connection).id === "string" && typeof (c as Connection).baseUrl === "string");
    } catch {
      return [];
    }
  }

  private save(list: Connection[]): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.file(), JSON.stringify(list, null, 2), "utf8");
  }

  get(id: string): Connection | undefined {
    return this.list().find((c) => c.id === id);
  }

  add(input: ConnectionInput): Connection {
    const list = this.list();
    const v = validateConnectionInput(input, list);
    if (!v.ok) throw new Error(v.message);
    const conn: Connection = { id: "c-" + randomBytes(5).toString("hex"), createdAt: Date.now(), ...v.value };
    this.save([...list, conn]);
    return conn;
  }

  remove(id: string): boolean {
    const list = this.list();
    const next = list.filter((c) => c.id !== id);
    if (next.length === list.length) return false;
    this.save(next);
    this.cache.delete(id);
    return true;
  }

  async staff(id: string): Promise<StaffResult | null> {
    const c = this.get(id);
    if (!c) return null;
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < STAFF_CACHE_MS) return hit.result;
    const result = await fetchStaff(c, this.fetchImpl);
    this.cache.set(id, { at: Date.now(), result });
    return result;
  }
}
