import { describe, expect, it } from "vitest";
import { createSessionStore } from "../../src/core/roles/skill-session.js";
import type { SkillAgent } from "../../src/core/roles/skill-agent-set.js";

function setup() {
  const mem = new Map<string, Record<string, unknown>>();
  let tick = 0;
  const backend = {
    async readSession(slug: string) {
      const v = mem.get(slug);
      return v ? (JSON.parse(JSON.stringify(v)) as Record<string, unknown>) : null;
    },
    async writeSession(slug: string, data: object) {
      mem.set(slug, JSON.parse(JSON.stringify(data)));
    },
  };
  const store = createSessionStore(backend, { now: () => `2026-01-01T00:00:${String(tick++).padStart(2, "0")}.000Z` });
  return { store };
}

const agent = { id: "researcher", source: "existing" } as unknown as SkillAgent;

describe("session store setAgents", () => {
  it("replaces agents and bumps updatedAt", async () => {
    const { store } = setup();
    const started = await store.start("demo", { brief: "b", agents: [] });
    const next = await store.setAgents("demo", [agent]);
    expect(next.agents).toEqual([agent]);
    expect(next.agents[0]).not.toBe(agent);
    expect(next.updatedAt).not.toBe(started.updatedAt);
    expect((await store.get("demo"))?.agents).toEqual([agent]);
  });

  it("404 session_missing without a session", async () => {
    const { store } = setup();
    await expect(store.setAgents("demo", [])).rejects.toMatchObject({ status: 404, code: "session_missing" });
  });

  it("400 session_closed when completed", async () => {
    const { store } = setup();
    await store.start("demo", { brief: "b", agents: [] });
    await store.attachSample("demo", { n: 1, sample: { files: [], summary: "s", costUsd: 0 } });
    await store.grade("demo", { score: 100, feedback: "" });
    await expect(store.setAgents("demo", [agent])).rejects.toMatchObject({ status: 400, code: "session_closed" });
  });
});
