/**
 * Contract test: the UI client (ui/src/api.ts) against the REAL Video Studio routes of the server.
 * It exists because the client once expected other URLs and response shapes than the server serves,
 * which crashed the lobby (blank screen) when the Video tower was opened.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import type { AuthPolicy } from "../../src/server/auth.js";
import { createServer } from "../../src/server/http.js";
import { ApiError, api, setToken } from "../../ui/src/api";

const TOKEN = "c".repeat(32);
const realFetch = globalThis.fetch;
let cleanup: Array<() => void | Promise<void>> = [];

beforeEach(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-contract-"));
  const config = { ...loadConfig(), dataDir };
  const store = new RunStore(":memory:");
  const manager = new RunManager({ config, store });
  const policy: AuthPolicy = { token: TOKEN, host: "127.0.0.1", port: 0 };
  const server = createServer({ manager, policy, staticDir: path.join(dataDir, "no-ui"), materialLibrary: null, workshop3d: null } as Parameters<typeof createServer>[0]);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  policy.port = port;
  // The UI client uses relative URLs; send them to the real server.
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => realFetch(`http://127.0.0.1:${port}${url}`, init));
  setToken(TOKEN);
  cleanup.push(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (cleanup.length) await cleanup.pop()!();
  cleanup = [];
});

describe("UI client vs the real Video Studio server", () => {
  it("styles come back as a list the lobby can use, and the form is valid with the first style", async () => {
    const { styles } = await api.videoStudioStyles();
    expect(Array.isArray(styles)).toBe(true);
    expect(styles.length).toBeGreaterThan(0);
    expect(typeof styles[0]!.id).toBe("string");
    expect(typeof styles[0]!.name).toBe("string");
  });

  it("settings come back as the public view", async () => {
    const { settings } = await api.videoStudioSettings();
    expect(typeof settings.ffmpegFound).toBe("boolean");
    expect(settings.voice).toBeTruthy();
    expect(settings.media).toBeTruthy();
  });

  it("create, list, get (as VsProjectDetail) and delete a project", async () => {
    const { styles } = await api.videoStudioStyles();
    const { slug } = await api.videoStudioCreate({ title: "Video thử", brief: "Mô tả ngắn", styleId: styles[0]!.id, aspect: "16:9" });
    expect(typeof slug).toBe("string");
    expect(slug.length).toBeGreaterThan(0);

    const list = await api.videoStudioList();
    expect(list.projects.map((p) => p.slug)).toContain(slug);

    const detail = await api.videoStudioGet(slug);
    expect(detail.project.slug).toBe(slug);
    expect(detail.project.title).toBe("Video thử");
    expect(detail.project.state).toBe("draft");
    expect(Array.isArray(detail.assets)).toBe(true);
    expect(detail.plan === null || typeof detail.plan === "object").toBe(true);
    expect("plan" in detail.project).toBe(false);

    await api.videoStudioDelete(slug);
    expect((await api.videoStudioList()).projects.map((p) => p.slug)).not.toContain(slug);
  });

  it("upload goes to the assets route and returns the stored asset", async () => {
    const { styles } = await api.videoStudioStyles();
    const { slug } = await api.videoStudioCreate({ title: "Có tệp", brief: "", styleId: styles[0]!.id, aspect: "9:16" });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "anh.png", { type: "image/png" });
    const asset = await api.videoStudioUpload(slug, file);
    expect(typeof asset.rel).toBe("string");
    expect((await api.videoStudioGet(slug)).assets.map((a) => a.rel)).toContain(asset.rel);
  });

  it("job routes exist under the names the client uses (a bad request is a 4xx from the handler, never a 404 not_found)", async () => {
    const { styles } = await api.videoStudioStyles();
    const { slug } = await api.videoStudioCreate({ title: "Việc dài", brief: "", styleId: styles[0]!.id, aspect: "1:1" });
    // edit-segment validates its body before doing anything: wrong body = 400, proving the route and field names are served.
    const err = await api.videoStudioEditSegment(slug, { start: "x" as unknown as number, end: 1, instruction: "đổi" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });

  it("styles can be saved and deleted with the server's bare response shapes", async () => {
    const { styles } = await api.videoStudioStyles();
    // A new style is sent without an id (the manager form omits it); the server generates one.
    const { id: _id, ...base } = styles[0]!;
    const { style } = await api.videoStudioSaveStyle({ ...base, name: "Phong cách thử", builtin: false } as never);
    expect(style.name).toBe("Phong cách thử");
    expect((await api.videoStudioStyles()).styles.map((s) => s.id)).toContain(style.id);
    await api.videoStudioDeleteStyle(style.id);
    expect((await api.videoStudioStyles()).styles.map((s) => s.id)).not.toContain(style.id);
  });
});
