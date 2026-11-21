import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoles, withSource, type MatchRole } from "../../src/core/roles/role-match.js";
import { buildSkillAgentSet, validateNewAgent } from "../../src/core/roles/skill-agent-set.js";
import { validateSlug } from "../../src/core/skill-workshop/package.js";

const ROOT = path.resolve(__dirname, "..", "..");

const base = { id: "reviewer", description: "Reviews things", prompt: "You review things." };

describe("validateNewAgent", () => {
  it("accepts a valid agent with default tools", () => {
    const r = validateNewAgent(base, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.agent).toEqual({ ...base, tools: ["Read", "Grep", "Glob"], source: "new" });
    }
  });

  it.each([["Bad"], ["has space"], ["a".repeat(41)], [""], [42], [undefined]])("rejects bad id %s", (id) => {
    const r = validateNewAgent({ ...base, id: id as string }, []);
    expect(r.ok).toBe(false);
  });

  it("rejects taken id, case-insensitive", () => {
    const r = validateNewAgent(base, ["REVIEWER"]);
    expect(r.ok).toBe(false);
  });

  it("rejects empty or too long description/prompt", () => {
    expect(validateNewAgent({ ...base, description: " " }, []).ok).toBe(false);
    expect(validateNewAgent({ ...base, prompt: "" }, []).ok).toBe(false);
    expect(validateNewAgent({ ...base, description: "x".repeat(301) }, []).ok).toBe(false);
    expect(validateNewAgent({ ...base, prompt: "x".repeat(4001) }, []).ok).toBe(false);
  });

  it.each(["Bash", "Edit", "Write", "NotebookEdit", "Agent", "Bash(rm*)"])("rejects dangerous tool %s", (t) => {
    const r = validateNewAgent({ ...base, tools: ["Read", t] }, []);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown tool", () => {
    expect(validateNewAgent({ ...base, tools: ["Foo"] }, []).ok).toBe(false);
  });

  it("dedupes tools", () => {
    const r = validateNewAgent({ ...base, tools: ["Read", "Read", "WebFetch"] }, []);
    expect(r.ok && r.agent.tools).toEqual(["Read", "WebFetch"]);
  });
});

describe("buildSkillAgentSet", () => {
  const roles = [
    { id: "analyst", description: "Analyses" },
    { id: "qa", description: "Tests" },
    { id: "critic", description: "Criticises" }
  ];
  const matches = [
    { id: "qa", score: 9, reasons: [] },
    { id: "analyst", score: 12, reasons: [] },
    { id: "critic", score: 2, reasons: [] },
    { id: "ghost", score: 10, reasons: [] }
  ];

  it("selects by threshold and score order, dropping unknown ids", () => {
    const r = buildSkillAgentSet({ matches, roles });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.selectedIds).toEqual(["analyst", "qa"]);
      expect(r.missing).toBe(false);
      expect(r.agents.every((a) => a.source === "existing" && a.tools.length === 0)).toBe(true);
      expect(r.warnings.length).toBe(1);
    }
  });

  it("carries the full prompt (<= 4000) and safe tools of existing roles", () => {
    const rich = [
      { id: "analyst", description: "Analyses", prompt: "P".repeat(5000), tools: ["Read", "Bash", "Write", "Edit", "Bash(git*)", "Grep"] },
      { id: "qa", description: "Tests" }
    ];
    const r = buildSkillAgentSet({ matches, roles: rich });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.agents.find((x) => x.id === "analyst")!;
      expect(a.prompt!.length).toBeGreaterThan(0);
      expect(a.prompt!.length).toBeLessThanOrEqual(4000);
      expect(a.tools).toEqual(["Read", "Grep"]);
      const q = r.agents.find((x) => x.id === "qa")!;
      expect(q.prompt ?? "").toBe("");
      expect(q.tools).toEqual([]);
    }
  });

  it("honours custom minScore and maxRoles", () => {
    const r = buildSkillAgentSet({ matches, roles, minScore: 1, maxRoles: 1 });
    expect(r.ok && r.selectedIds).toEqual(["analyst"]);
  });

  it("missing=true without new agents is ok with empty agents and a warning", () => {
    const r = buildSkillAgentSet({ matches: [], roles });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.missing).toBe(true);
      expect(r.agents).toEqual([]);
      expect(r.warnings.length).toBe(1);
    }
  });

  it("adds a valid new agent when missing", () => {
    const r = buildSkillAgentSet({ matches: [], roles, newAgents: [base] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.missing).toBe(true);
      expect(r.addedIds).toEqual(["reviewer"]);
      expect(r.agents[0].source).toBe("new");
    }
  });

  it("rejects new agent colliding with an existing role id", () => {
    const r = buildSkillAgentSet({ matches, roles, newAgents: [{ ...base, id: "critic" }] });
    expect(r.ok).toBe(false);
  });

  it("rejects two new agents with the same id", () => {
    const r = buildSkillAgentSet({ matches, roles, newAgents: [base, base] });
    expect(r.ok).toBe(false);
  });

  it("rejects more than 5 new agents", () => {
    const newAgents = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `agent-${i}` }));
    const r = buildSkillAgentSet({ matches, roles, newAgents });
    expect(r.ok).toBe(false);
  });

  it("allows 5 new agents independently of maxRoles", () => {
    const newAgents = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `agent-${i}` }));
    const r = buildSkillAgentSet({ matches, roles, newAgents, maxRoles: 2 });
    expect(r.ok && r.agents.length).toBe(7);
  });

  it("does not mutate inputs", () => {
    const input = { matches, roles, newAgents: [{ ...base, tools: ["Read", "Read"] }] };
    const before = structuredClone(input);
    buildSkillAgentSet(input);
    expect(input).toEqual(before);
  });

  it("collects errors from all new agents", () => {
    const r = buildSkillAgentSet({
      matches,
      roles,
      newAgents: [
        { ...base, id: "BAD" },
        { ...base, id: "ok-one", tools: ["Bash"] },
        { ...base, id: "three", prompt: "" }
      ]
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("integration with matchRoles", () => {
  const handRoles: MatchRole[] = [
    { id: "pricing-expert", description: "Computes pricing quotes", tags: ["pricing", "quote"] },
    { id: "writer", description: "Writes documents", tags: ["writing"] }
  ];

  it("feeds real matchRoles output into buildSkillAgentSet", () => {
    const matches = matchRoles("pricing quote for customer", handRoles);
    const r = buildSkillAgentSet({ matches, roles: handRoles });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.selectedIds).toEqual(["pricing-expert"]);
      expect(r.missing).toBe(false);
    }
  });

  it("treats a brief with no match as missing and adds new agents", () => {
    const matches = matchRoles("zzqq xyzzy plugh", handRoles);
    expect(matches).toEqual([]);
    const r = buildSkillAgentSet({ matches, roles: handRoles, newAgents: [base] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.missing).toBe(true);
      expect(r.addedIds).toEqual(["reviewer"]);
    }
  });

  describe("config/roles-coding.json", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "roles-coding.json"), "utf8")) as Record<
      string,
      { description: string }
    >;
    const roles = withSource(
      Object.entries(cfg).map(([id, d]) => ({ id, description: d.description })),
      "coding"
    );

    it("selects analyst for a matching brief", () => {
      const matches = matchRoles("repository risks affected files", roles);
      const r = buildSkillAgentSet({ matches, roles });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.missing).toBe(false);
        expect(r.selectedIds).toContain("analyst");
      }
    });

    it("reports missing for a completely foreign brief and accepts a new agent", () => {
      const matches = matchRoles("zzqq xyzzy plugh", roles);
      expect(matches).toEqual([]);
      const r = buildSkillAgentSet({ matches, roles, newAgents: [base] });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.missing).toBe(true);
        expect(r.agents).toHaveLength(1);
        expect(r.agents[0].tools).toEqual(["Read", "Grep", "Glob"]);
      }
    });

    it("records real role ids against validateSlug without breaking the builder", () => {
      const valid = roles.filter((r) => {
        try {
          validateSlug(r.id);
          return true;
        } catch {
          return false;
        }
      });
      expect(valid.length).toBeGreaterThan(0);
      const r = buildSkillAgentSet({ matches: [], roles });
      expect(r.ok).toBe(true);
    });
  });
});
