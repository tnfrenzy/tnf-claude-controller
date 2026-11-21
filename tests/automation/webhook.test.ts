import { describe, expect, it, vi } from "vitest";
import { WebhookNotifier } from "../../src/core/queue/webhook.js";

const U = "https://hooks.example.com/x";
const run = { id: "r1", status: "done" as const, prompt: "hello", project: "p", duration_ms: 5 };

function mk(urls: string[], fetchImpl: any, timeoutMs?: number) {
  return new WebhookNotifier({ urls, fetchImpl, timeoutMs });
}

describe("WebhookNotifier", () => {
  it("posts JSON to every configured url", async () => {
    const f = vi.fn(async () => ({}) as any);
    await mk([U, "https://b.example.com/y"], f).runFinished(run);
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe(U);
    expect(init.method).toBe("POST");
    const b = JSON.parse(init.body);
    expect(b).toMatchObject({ event: "run.done", run_id: "r1", status: "done", project: "p", title: "hello", duration_ms: 5 });
    expect(typeof b.at).toBe("string");
  });

  it("skips http, user:pass and unparsable urls", async () => {
    const f = vi.fn(async () => ({}) as any);
    await mk(["http://a.example.com", "https://u:p@a.example.com", "not a url"], f).runFinished(run);
    expect(f).not.toHaveBeenCalled();
  });

  it("redacts secrets then truncates title to 80 chars", async () => {
    const f = vi.fn(async () => ({}) as any);
    const prompt = "a".repeat(150) + " token=abc123456 sk-AAAAAAAAAAAA at C:\\secret\\path";
    await mk([U], f).runFinished({ ...run, prompt });
    const body = (f.mock.calls[0] as any)[1].body as string;
    expect(body).not.toContain("abc123456");
    expect(body).not.toContain("sk-AAAA");
    expect(JSON.parse(body).title.length).toBeLessThanOrEqual(80);
    expect(body).not.toContain("result_text");
    expect(body).not.toContain("secret");
  });

  it("redacts a secret placed at the tail of a 200 char prompt", async () => {
    const f = vi.fn(async () => ({}) as any);
    const prompt = "x".repeat(70) + " sk-AAAAAAAAAAAAAAAA " + "y".repeat(110);
    await mk([U], f).runFinished({ ...run, prompt });
    const body = (f.mock.calls[0] as any)[1].body as string;
    expect(body).not.toContain("sk-AAAA");
    expect(JSON.parse(body).title.length).toBeLessThanOrEqual(80);
  });

  it("sends only error_kind for errors, never the message", async () => {
    const f = vi.fn(async () => ({}) as any);
    await mk([U], f).runFinished({ ...run, status: "error", error: "spawn_failed: C:\\x\\secret boom" });
    const body = (f.mock.calls[0] as any)[1].body as string;
    expect(JSON.parse(body)).toMatchObject({ event: "run.error", error_kind: "spawn_failed" });
    expect(body).not.toContain("boom");
  });

  it("resolves when fetch rejects or throws synchronously", async () => {
    await expect(mk([U], vi.fn(async () => { throw new Error("x"); })).runFinished(run)).resolves.toBeUndefined();
    await expect(mk([U], vi.fn(() => { throw new Error("y"); })).runFinished(run)).resolves.toBeUndefined();
  });

  it("uses timeout signal and redirect error; hanging fetch resolves", async () => {
    let seen: any;
    const f = vi.fn((_u: string, init: any) => {
      seen = init;
      return new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    });
    await mk([U], f, 20).runFinished(run);
    expect(seen.signal).toBeDefined();
    expect(seen.redirect).toBe("error");
  });

  it("dedupes runFinished by id", async () => {
    const f = vi.fn(async () => ({}) as any);
    const n = mk([U], f);
    await n.runFinished(run);
    await n.runFinished(run);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("sends queue.completed with counts", async () => {
    const f = vi.fn(async () => ({}) as any);
    await mk([U], f).queueCompleted("p", { committed: ["a", "b"], failed: ["c"], blocked: [] });
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toMatchObject({ event: "queue.completed", project: "p", committed: 2, failed: 1, blocked: 0 });
  });

  it("one failing url does not block the others", async () => {
    const f = vi.fn(async (u: string) => { if (u === U) throw new Error("x"); return {} as any; });
    await mk([U, "https://b.example.com/y"], f).runFinished(run);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does nothing with an empty list", async () => {
    const f = vi.fn(async () => ({}) as any);
    await mk([], f).runFinished(run);
    expect(f).not.toHaveBeenCalled();
  });
});
