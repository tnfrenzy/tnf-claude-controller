import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { buildExportEntries, buildSingleFile, buildSkillPackageZip } from "../../src/core/skill-workshop/export.js";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import { attachSample, createSession, gradeRound, normalizeSession } from "../../src/core/roles/skill-session.js";
import type { SkillSession } from "../../src/core/roles/skill-session.js";

const withSample = (s: SkillSession) =>
  attachSample(s, { n: 1, sample: { files: [{ format: "docx", name: "sample.docx" }], summary: "s", costUsd: 0 }, now: s.updatedAt });
import type { SkillAgent } from "../../src/core/roles/skill-agent-set.js";

const agent = (over: Partial<SkillAgent> = {}): SkillAgent => ({
  id: "helper",
  description: "Trợ lý",
  prompt: "Làm việc X",
  tools: ["Read", "Grep"],
  source: "new",
  ...over,
});
const sess = (agents: SkillAgent[] = [agent()], brief = "Brief dòng một\ndòng hai") =>
  createSession({ brief, agents, now: "2026-01-01T00:00:00.000Z" });
const base = (over: Record<string, unknown> = {}) => ({
  slug: "demo",
  skillMd: "# Demo",
  session: sess(),
  references: [{ name: "notes.md", content: "ref" }],
  sources: ["https://github.com/a/b"],
  ...over,
});
const text = (entries: { name: string; data: Buffer }[], name: string) =>
  entries.find((e) => e.name === name)!.data.toString("utf8");
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return e.code;
  }
  return null;
};

describe("buildSingleFile", () => {
  it("embeds full agent prompt, sources and excerpt in one md file", () => {
    const long = "P".repeat(500);
    const f = buildSingleFile(
      base({
        session: sess([agent({ prompt: long })]),
        sourceNotes: [{ url: "https://github.com/a/b", license: "MIT", excerpt: "dòng 1\ndòng 2", used: "lấy quy trình" }],
      }) as any
    );
    expect(f.name).toBe("demo.md");
    const t = f.data.toString("utf8");
    expect(t).toContain("## Agents");
    expect(t).toContain(long);
    expect(t).toContain("## Nguồn");
    expect(t).toContain("https://github.com/a/b");
    expect(t).toContain("> dòng 2");
    expect(t).toContain("lấy quy trình");
    expect(t).not.toContain("sources.json");
  });

  it("rejects over-limit output", () => {
    expect(code(() => buildSingleFile(base({ session: sess([agent({ prompt: "x".repeat(6_000_000) })]) }) as any))).toBe("skill_too_large");
  });
});

describe("buildExportEntries", () => {
  it("builds all expected entries", () => {
    const e = buildExportEntries(base() as any);
    expect(e.map((x) => x.name).sort()).toEqual(["SKILL.md", "agents/helper.md", "references/notes.md", "sources.json"]);
    expect(text(e, "sources.json")).toBe('{"sources":["https://github.com/a/b"]}');
    expect(text(e, "references/notes.md")).toBe("ref");
  });

  it("rejects bad reference names and agent ids", () => {
    for (const name of ["../x", "a/../b", "/abs", "C:\\x", ".."]) {
      expect(code(() => buildExportEntries(base({ references: [{ name, content: "" }] }) as any))).toBe("skill_bad_path");
    }
    expect(code(() => buildExportEntries(base({ session: sess([agent({ id: ".." })]) }) as any))).toBe("skill_bad_path");
  });

  it("rejects bad sources, accepts empty, dedupes", () => {
    for (const u of ["http://github.com/a/b", "https://evil.com/a/b", "https://github.com/a/b/tree/x", "https://github.com/a/b/"]) {
      expect(code(() => buildExportEntries(base({ sources: [u] }) as any))).toBe("skill_bad_source");
    }
    expect(text(buildExportEntries(base({ sources: [] }) as any), "sources.json")).toBe('{"sources":[]}');
    const d = buildExportEntries(base({ sources: ["https://github.com/a/b", "https://github.com/a/b"] }) as any);
    expect(text(d, "sources.json")).toBe('{"sources":["https://github.com/a/b"]}');
  });

  it("handles SKILL.md front-matter", () => {
    const keep = "---\nname: x\ndescription: y\n---\nbody";
    expect(text(buildExportEntries(base({ skillMd: keep }) as any), "SKILL.md")).toBe(keep);
    const added = text(buildExportEntries(base() as any), "SKILL.md");
    expect(added).toContain('name: "demo"');
    expect(added).toContain('description: "Brief dòng một"');
    expect(added.endsWith("# Demo")).toBe(true);
    const noDesc = text(buildExportEntries(base({ skillMd: "---\nname: x\n---\nbody" }) as any), "SKILL.md");
    expect(noDesc).toBe('---\nname: x\ndescription: "Brief dòng một"\n---\nbody');
    expect(code(() => buildExportEntries(base({ skillMd: "" }) as any))).toBe("skill_missing_md");
    expect(code(() => buildExportEntries(base({ skillMd: "  \n " }) as any))).toBe("skill_missing_md");
  });

  it("writes agent front-matter safely with prompt in the body", () => {
    const a = agent({ description: 'có "dấu"\nxuống dòng', prompt: "PROMPT_BODY" });
    const t = text(buildExportEntries(base({ session: sess([a]) }) as any), "agents/helper.md");
    const [, fm, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(t)!;
    const line = fm.split("\n").find((l) => l.startsWith("description: "))!;
    expect(JSON.parse(line.slice("description: ".length))).toBe(a.description);
    expect(fm).toContain('tools:\n  - "Read"\n  - "Grep"');
    expect(fm).not.toContain("PROMPT_BODY");
    expect(body).toContain("PROMPT_BODY");
    const empty = text(buildExportEntries(base({ session: sess([agent({ tools: [], prompt: undefined })]) }) as any), "agents/helper.md");
    expect(empty).toContain("tools: []");
  });

  it("truncates long descriptions to 1024", () => {
    const t = text(buildExportEntries(base({ session: sess([agent({ description: "d".repeat(2000) })]) }) as any), "agents/helper.md");
    const line = t.split("\n").find((l) => l.startsWith("description: "))!;
    expect(JSON.parse(line.slice(13)).length).toBeLessThanOrEqual(1024);
  });

  it("limits reference count", () => {
    const references = Array.from({ length: 31 }, (_, i) => ({ name: `r${i}.md`, content: "" }));
    expect(code(() => buildExportEntries(base({ references }) as any))).toBe("skill_too_large");
  });
});

/** Read a zip via central directory + local headers (names and inflated content). */
function readZip(buf: Buffer): Record<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const body = buf.subarray(start, start + csize);
    out[name] = (buf.readUInt16LE(p + 10) === 8 ? inflateRawSync(body) : body).toString("utf8");
    p += 46 + nlen + elen + clen;
  }
  return out;
}

describe("buildSkillPackageZip", () => {
  let dir: string;
  let store: ReturnType<typeof createSkillStore>;
  const now = "2026-01-01T00:00:00.000Z";
  const extras = { references: [{ name: "notes.md", content: "ref" }], sources: ["https://github.com/a/b"] };
  const done = (maxRounds?: number) =>
    gradeRound(withSample(createSession({ brief: "Brief", agents: [agent()], maxRounds, now })), { score: 100, feedback: "", now });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillexport-"));
    store = createSkillStore(dir, { retryDelayMs: 1 });
    await store.create({
      slug: "demo",
      title: "Demo",
      goal: "Goal",
      files: { "SKILL.md": "# Demo skill", "rules.md": "r", "examples/holdout-1.json": "{}" },
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("zips exactly SKILL.md, agents, references and sources.json", async () => {
    const session = done();
    expect(session.status).toBe("completed");
    const zip = await buildSkillPackageZip(store, "demo", session, extras);
    const files = readZip(zip);
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "agents/helper.md", "references/notes.md", "sources.json"]);
    const expected = buildExportEntries({ slug: "demo", skillMd: "# Demo skill", session, ...extras });
    expect(Object.keys(files).sort()).toEqual(expected.map((e) => e.name).sort());
    for (const e of expected) expect(files[e.name]).toBe(e.data.toString("utf8"));
    expect(files["SKILL.md"]).toContain("# Demo skill");
    expect(files["sources.json"]).toBe('{"sources":["https://github.com/a/b"]}');
    for (const n of Object.keys(files)) expect(n).not.toMatch(/rounds\.json|meta\.json|holdout/);
  });

  it("refuses sessions that are not completed", async () => {
    const awaiting = createSession({ brief: "B", agents: [], now });
    const exhausted = normalizeSession({ ...createSession({ brief: "B", agents: [], maxRounds: 1, now }), status: "exhausted" });
    expect(exhausted.status).toBe("exhausted");
    for (const s of [awaiting, exhausted]) {
      await expect(buildSkillPackageZip(store, "demo", s, extras)).rejects.toMatchObject({ code: "session_not_completed", status: 409 });
    }
  });

  it("fails clearly when SKILL.md is missing or empty, or skill does not exist", async () => {
    await store.update("demo", { files: { "SKILL.md": "  \n" } } as any);
    await expect(buildSkillPackageZip(store, "demo", done(), extras)).rejects.toMatchObject({ code: "skill_missing_md" });
    fs.rmSync(path.join(dir, "skills", "demo", "SKILL.md"));
    await expect(buildSkillPackageZip(store, "demo", done(), extras)).rejects.toMatchObject({ code: "skill_missing_md" });
    await expect(buildSkillPackageZip(store, "nope", done(), extras)).rejects.toMatchObject({ code: "skill_not_found" });
  });
});
