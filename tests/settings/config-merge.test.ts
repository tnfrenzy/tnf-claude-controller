import { describe, expect, it } from "vitest";
import { mergeControllerConfig } from "../../src/core/app/config-merge.js";

const merge = (e: unknown, d: unknown) => mergeControllerConfig(e, d) as Record<string, any>;

describe("mergeControllerConfig", () => {
  it("adds missing nested keys from defaults and keeps unrelated user keys", () => {
    const r = merge({ model: "mine", maxTurns: 7, a: { b: 1 } }, { model: "def", maxTurns: 40, a: { b: 2, c: { d: [1] } }, extra: 5 });
    expect(r.model).toBe("mine");
    expect(r.maxTurns).toBe(7);
    expect(r.a.b).toBe(1);
    expect(r.a.c.d).toEqual([1]);
    expect(r.extra).toBe(5);
  });

  it("keeps existing values of any type, even when defaults differ in type", () => {
    const r = merge({ arr: ["x"], s: "s", n: 0, nul: null, f: false }, { arr: ["y", "z"], s: { o: 1 }, n: 9, nul: { o: 1 }, f: true });
    expect(r).toEqual({ arr: ["x"], s: "s", n: 0, nul: null, f: false });
  });

  it("does not mutate inputs nor share references with defaults", () => {
    const e = { a: { b: 1 } };
    const d = { a: { c: { d: 1 } }, list: [{ k: 1 }] };
    const eCopy = structuredClone(e);
    const dCopy = structuredClone(d);
    const r = merge(e, d);
    expect(e).toEqual(eCopy);
    expect(d).toEqual(dCopy);
    expect(r.a.c).not.toBe(d.a.c);
    expect(r.list).not.toBe(d.list);
    expect(r.list[0]).not.toBe(d.list[0]);
    expect(r.a).not.toBe(e.a);
  });

  it("keeps server.allowedOrigins; missing becomes [] regardless of defaults", () => {
    const kept = merge({ server: { port: 1, allowedOrigins: ["https://a.example.com"] } }, { server: { host: "h", allowedOrigins: ["https://evil.example.com"] } });
    expect(kept.server.allowedOrigins).toEqual(["https://a.example.com"]);
    expect(kept.server.host).toBe("h");
    const missing = merge({ server: { port: 1 } }, { server: { allowedOrigins: ["https://evil.example.com"] } });
    expect(missing.server.allowedOrigins).toEqual([]);
    const noServer = merge({}, { server: { port: 4800, allowedOrigins: ["https://evil.example.com"] } });
    expect(noServer.server.allowedOrigins).toEqual([]);
    expect(noServer.server.port).toBe(4800);
  });

  it("keeps existing permission keys in defaults.coding/research and never adds them from defaults", () => {
    const defaults = {
      defaults: {
        coding: { allowedTools: ["Bash"], disallowedTools: ["Foo"], extraArgs: ["--x"], settingsFile: "d.json", maxTurns: 5 },
        research: { allowedTools: ["WebFetch"], extraArgs: ["--y"] },
        allowedTools: ["Read"],
      },
    };
    const existing = {
      defaults: {
        coding: { allowedTools: ["Read"], disallowedTools: [] },
        research: {},
      },
    };
    const r = merge(existing, defaults);
    expect(r.defaults.coding.allowedTools).toEqual(["Read"]);
    expect(r.defaults.coding.disallowedTools).toEqual([]);
    expect(r.defaults.coding).not.toHaveProperty("extraArgs");
    expect(r.defaults.coding).not.toHaveProperty("settingsFile");
    expect(r.defaults.coding.maxTurns).toBe(5);
    expect(r.defaults.research).not.toHaveProperty("allowedTools");
    expect(r.defaults.research).not.toHaveProperty("extraArgs");
    expect(r.defaults).not.toHaveProperty("allowedTools");
  });

  it("keeps permissions.deny as-is and never takes it from defaults", () => {
    const kept = merge({ permissions: { deny: ["A"] } }, { permissions: { deny: ["A", "B"], allow: ["C"] } });
    expect(kept.permissions).toEqual({ deny: ["A"] });
    const missing = merge({ other: 1 }, { permissions: { deny: ["B"] }, x: { deny: ["Q"], ok: 1 } });
    expect(missing).not.toHaveProperty("permissions");
    expect(missing.x).toEqual({ ok: 1 });
  });

  it("drops token/apiKey/secret keys at every level from existing and defaults", () => {
    const r = merge(
      { token: "t", a: { apiKey: "k", api_key: "k", ok: 1 } },
      { SECRET: "s", a: { authToken: "x", n: { "api-key": "z", keep: 2 } } },
    );
    expect(r).toEqual({ a: { ok: 1, n: { keep: 2 } } });
  });

  it("skips __proto__/constructor/prototype", () => {
    const e = JSON.parse('{"__proto__":{"x":1},"constructor":{"y":1},"prototype":{"z":1},"a":{"__proto__":{"w":1}}}');
    const d = JSON.parse('{"__proto__":{"x":2},"a":{"constructor":1,"b":1}}');
    const r = merge(e, d);
    expect(Object.keys(r)).toEqual(["a"]);
    expect(Object.keys(r.a)).toEqual(["b"]);
    expect(({} as any).x).toBeUndefined();
    expect(({} as any).w).toBeUndefined();
  });

  it("does not merge $comment/$allowedOrigins_hint from defaults but keeps the user's", () => {
    const r = merge({ $comment: "mine", keep: 1 }, { $comment: "d", $allowedOrigins_hint: "h", server: { $comment: "x" } });
    expect(r.$comment).toBe("mine");
    expect(r).not.toHaveProperty("$allowedOrigins_hint");
    expect(r.server).not.toHaveProperty("$comment");
    const r2 = merge({ $allowedOrigins_hint: "u" }, { $allowedOrigins_hint: "h" });
    expect(r2.$allowedOrigins_hint).toBe("u");
  });

  it("is idempotent: merging the result again with the same defaults changes nothing", () => {
    const existing = { model: "mine", a: { b: 1, list: ["x"] }, server: { port: 1, allowedOrigins: ["https://a.example.com"] } };
    const defaults = { model: "def", a: { b: 2, c: { d: [1] } }, extra: 5, server: { host: "h", allowedOrigins: ["https://evil.example.com"] } };
    const existingCopy = structuredClone(existing);
    const defaultsCopy = structuredClone(defaults);
    const once = merge(existing, defaults);
    const twice = merge(once, defaults);
    expect(twice).toEqual(once);
    expect(existing).toEqual(existingCopy);
    expect(defaults).toEqual(defaultsCopy);
  });

  it("deny-list: user entries survive and are not mixed with default entries", () => {
    const r = merge({ permissions: { deny: ["A", "C"] } }, { permissions: { deny: ["A", "B"] } });
    expect(r.permissions.deny).toEqual(["A", "C"]);
  });

  it("rejects non-object existing and treats non-object defaults as {}", () => {
    expect(() => mergeControllerConfig(null, {})).toThrow();
    expect(() => mergeControllerConfig([], {})).toThrow();
    expect(mergeControllerConfig({ a: 1 }, null)).toEqual({ a: 1 });
  });
});
