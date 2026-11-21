import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectionStore, fetchStaff, normalizeStaff, publicView, validateConnectionInput, type Connection } from "../../src/core/app/api-connections.js";

const conn = (over: Partial<Connection> = {}): Connection => ({ id: "c-1", name: "Platform", baseUrl: "https://p.example.com", path: "/api/monitor/nhan-vien-ao", token: "bi-mat", createdAt: 0, ...over });
const fakeFetch = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("normalizeStaff", () => {
  it("keeps good employees, drops bad ones and clamps numbers", () => {
    const r = normalizeStaff({
      generatedAt: "2026-11-05T00:00:00Z",
      employees: [
        { id: "bao-gia", name: "Báo Giá", department: "sales", counts: { pending: 2, processing: 1, failed: -3, done: 9.7 }, failedRate: 4 },
        { id: "bom", name: "BOM", queueKnown: false },
        { id: "bao-gia", name: "trùng" },
        { id: "bad id!", name: "x" },
        { name: "thiếu id" },
        7,
      ],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.snapshot.employees.map((e) => e.id)).toEqual(["bao-gia", "bom"]);
    expect(r.snapshot.employees[0]!.counts).toEqual({ pending: 2, processing: 1, failed: 0, done: 9 });
    expect(r.snapshot.employees[0]!.failedRate).toBe(1);
    expect(r.snapshot.employees[1]!.counts).toBeNull();
  });
  it("rejects an answer without employees", () => {
    expect(normalizeStaff({}).ok).toBe(false);
    expect(normalizeStaff(null).ok).toBe(false);
  });
});

describe("validateConnectionInput", () => {
  it("accepts a good input and normalises the URL", () => {
    const v = validateConnectionInput({ name: " Platform ", baseUrl: "https://p.example.com/", token: "t" }, []);
    expect(v).toMatchObject({ ok: true, value: { name: "Platform", baseUrl: "https://p.example.com", path: "/api/monitor/nhan-vien-ao" } });
  });
  it("rejects bad URL, credentials in URL, bad path and duplicate names", () => {
    expect(validateConnectionInput({ name: "a", baseUrl: "ftp://x" }, []).ok).toBe(false);
    expect(validateConnectionInput({ name: "a", baseUrl: "https://u:p@x.com" }, []).ok).toBe(false);
    expect(validateConnectionInput({ name: "a", baseUrl: "https://x.com", path: "/../etc" }, []).ok).toBe(false);
    expect(validateConnectionInput({ name: "platform", baseUrl: "https://x.com" }, [conn()]).ok).toBe(false);
  });
});

describe("fetchStaff", () => {
  it("returns employees and sends the bearer token", async () => {
    let auth = "";
    const r = await fetchStaff(conn(), async (_u, init) => {
      auth = init.headers["authorization"] ?? "";
      return { ok: true, status: 200, json: async () => ({ employees: [{ id: "a", name: "A" }] }) };
    });
    expect(r.ok).toBe(true);
    expect(auth).toBe("Bearer bi-mat");
  });
  it("explains 401, other codes and network failures without throwing", async () => {
    expect(await fetchStaff(conn(), fakeFetch(401, {}))).toMatchObject({ ok: false, status: 401 });
    expect(await fetchStaff(conn(), fakeFetch(500, {}))).toMatchObject({ ok: false, status: 500 });
    expect(await fetchStaff(conn(), async () => { throw new Error("ECONNREFUSED"); })).toMatchObject({ ok: false });
    expect(await fetchStaff(conn(), fakeFetch(200, { nope: 1 }))).toMatchObject({ ok: false });
  });
});

describe("ConnectionStore", () => {
  it("persists, hides the token, caches the staff call and removes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cn-"));
    let calls = 0;
    const store = new ConnectionStore(dir, async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ employees: [{ id: "a", name: "A" }] }) };
    });
    const c = store.add({ name: "Platform", baseUrl: "https://p.example.com", token: "bi-mat" });
    expect(JSON.stringify(publicView(c))).not.toContain("bi-mat");
    expect(new ConnectionStore(dir).list()).toHaveLength(1);
    await store.staff(c.id);
    await store.staff(c.id);
    expect(calls).toBe(1);
    expect(await store.staff("nope")).toBeNull();
    expect(store.remove(c.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });
});
