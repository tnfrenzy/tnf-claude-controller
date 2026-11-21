/**
 * Export of a finished skill session as an Agent Skills style package (in memory, zip-ready).
 * Layout: SKILL.md, agents/<id>.md, references/<name>, sources.json.
 * Error messages are Vietnamese; code is English.
 */
import { buildZip, type ZipEntry } from "../app/zip.js";
import type { SkillSession } from "../roles/skill-session.js";
import { LIMITS, SkillError, resolveInside, validateSlug } from "./package.js";
import type { SkillStore } from "./store.js";

export interface ExportReference {
  name: string;
  content: string;
}

/** What was taken from one source repo. excerpt is empty unless the license allows copying. */
export interface SourceNote {
  url: string;
  license?: string;
  excerpt: string;
  used: string;
  agentPrompt?: string;
}

export interface ExportInput {
  slug: string;
  skillMd: string;
  session: SkillSession;
  references: ExportReference[];
  sources: string[];
  sourceNotes?: SourceNote[];
}

export const MAX_REFERENCES = 30;
const DESC_MAX = 1024;
const SOURCE_RE = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function yamlStr(s: string): string {
  return JSON.stringify(s);
}

function badPath(name: string): SkillError {
  return new SkillError(`Tên tệp trong gói không hợp lệ: ${String(name).slice(0, 80)}`, 400, "skill_bad_path");
}

function checkSegment(name: unknown): string {
  if (typeof name !== "string" || name.length === 0 || name.length > 80) throw badPath(String(name));
  if (name === "." || name === ".." || /[/\\:\0]/.test(name)) throw badPath(name);
  return name;
}

function safeRel(dir: string, name: string): string {
  const rel = `${dir}/${checkSegment(name)}`;
  resolveInside("/pack", rel);
  return rel;
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "").trim();
}

function withFrontMatter(slug: string, md: string, brief: string): string {
  const desc = firstLine(brief).slice(0, DESC_MAX);
  if (md.startsWith("---")) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
    if (m && !/^description\s*:/m.test(m[1] ?? "")) {
      return `---\n${m[1]}\ndescription: ${yamlStr(desc)}\n${md.slice(m[0].length - 3)}`;
    }
    return md;
  }
  return `---\nname: ${yamlStr(slug)}\ndescription: ${yamlStr(desc)}\n---\n\n${md}`;
}

/**
 * Zip the package of a completed session. SKILL.md comes from the store (readZipEntries already
 * drops holdout/rounds/versions); a missing skill makes readZipEntries throw skill_not_found (404).
 */
export async function buildSkillPackageZip(
  store: Pick<SkillStore, "readZipEntries">,
  slug: string,
  session: SkillSession,
  extras: { references: ExportReference[]; sources: string[]; skillMdOverride?: string; extraEntries?: ZipEntry[] }
): Promise<Buffer> {
  validateSlug(slug);
  if (session.status !== "completed") {
    throw new SkillError("Phiên chưa đạt 100 điểm nên chưa xuất được gói skill.", 409, "session_not_completed");
  }
  let skillMd = extras.skillMdOverride ?? "";
  if (!skillMd.trim()) {
    const found = (await store.readZipEntries(slug)).find((e) => e.name === "SKILL.md");
    skillMd = found ? found.data.toString("utf8") : "";
  }
  const entries = buildExportEntries({ slug, skillMd, session, references: extras.references, sources: extras.sources });
  for (const e of extras.extraEntries ?? []) {
    const [dir, ...rest] = e.name.split("/");
    if (!dir || rest.length !== 1) throw badPath(e.name);
    entries.push({ name: safeRel(dir, rest[0]!), data: e.data });
  }
  return buildZip(entries);
}

/** Hook for createSessionStore: builds the zip when a session completes; the caller decides where to save it. */
export function makeExportOnCompleted(
  store: Pick<SkillStore, "readZipEntries">,
  getExtras: (
    slug: string,
    session: SkillSession
  ) => Promise<{ references: ExportReference[]; sources: string[] }> | { references: ExportReference[]; sources: string[] },
  save: (slug: string, zip: Buffer) => Promise<void> | void
): (slug: string, session: SkillSession) => Promise<void> {
  return async (slug, session) => {
    const extras = await getExtras(slug, session);
    const zip = await buildSkillPackageZip(store, slug, session, extras);
    await save(slug, zip);
  };
}

/** One markdown file: SKILL.md body, full agents ("## Agents") and sources ("## Nguồn"). */
export function buildSingleFile(input: ExportInput): { name: string; data: Buffer } {
  const slug = validateSlug(input.slug);
  if (typeof input.skillMd !== "string" || input.skillMd.trim() === "") {
    throw new SkillError("Skill chưa có SKILL.md để xuất.", 400, "skill_missing_md");
  }
  const urls: string[] = [];
  for (const u of input.sources ?? []) {
    if (typeof u !== "string" || !SOURCE_RE.test(u)) {
      throw new SkillError(`Nguồn GitHub không hợp lệ: ${String(u).slice(0, 80)}`, 400, "skill_bad_source");
    }
    if (!urls.includes(u)) urls.push(u);
  }
  const parts: string[] = [withFrontMatter(slug, input.skillMd, input.session.brief).trimEnd()];
  if (input.session.agents.length > 0) {
    parts.push("## Agents");
    for (const a of input.session.agents) {
      checkSegment(a.id);
      const desc = (a.description ?? "").slice(0, DESC_MAX);
      const tools = a.tools.length === 0 ? "(không có)" : a.tools.join(", ");
      const body = a.prompt && a.prompt.trim() !== "" ? a.prompt : desc;
      parts.push(`### ${a.id}\n\n- Mô tả: ${desc}\n- Công cụ: ${tools}\n\n#### Prompt\n\n${body.trimEnd()}`);
    }
  }
  const notes = input.sourceNotes ?? [];
  const noteUrls = new Set(notes.map((n) => n.url));
  const items: string[] = [];
  for (const n of notes) {
    if (typeof n.url !== "string" || !SOURCE_RE.test(n.url)) {
      throw new SkillError(`Nguồn GitHub không hợp lệ: ${String(n.url).slice(0, 80)}`, 400, "skill_bad_source");
    }
    const lines = [`### ${n.url}`, "", `- Giấy phép: ${n.license && n.license.trim() !== "" ? n.license : "không rõ"}`];
    if (n.used) lines.push(`- Đã dùng: ${n.used}`);
    if (n.excerpt && n.excerpt.trim() !== "") {
      lines.push("", ...n.excerpt.trimEnd().split(/\r?\n/).map((l) => `> ${l}`));
    }
    items.push(lines.join("\n"));
  }
  for (const u of urls) if (!noteUrls.has(u)) items.push(`### ${u}`);
  if (items.length > 0) parts.push("## Nguồn", ...items);
  const data = Buffer.from(parts.join("\n\n") + "\n", "utf8");
  if (data.length > LIMITS.totalBytes) {
    throw new SkillError("Gói xuất vượt giới hạn dung lượng.", 400, "skill_too_large");
  }
  return { name: `${slug}.md`, data };
}

export function buildExportEntries(input: ExportInput): ZipEntry[] {
  const slug = validateSlug(input.slug);
  if (typeof input.skillMd !== "string" || input.skillMd.trim() === "") {
    throw new SkillError("Skill chưa có SKILL.md để xuất.", 400, "skill_missing_md");
  }
  const refs = input.references ?? [];
  if (refs.length > MAX_REFERENCES) {
    throw new SkillError(`Tối đa ${MAX_REFERENCES} tệp tham chiếu.`, 400, "skill_too_large");
  }
  const sources: string[] = [];
  for (const u of input.sources ?? []) {
    if (typeof u !== "string" || !SOURCE_RE.test(u)) {
      throw new SkillError(`Nguồn GitHub không hợp lệ: ${String(u).slice(0, 80)}`, 400, "skill_bad_source");
    }
    if (!sources.includes(u)) sources.push(u);
  }
  const entries: ZipEntry[] = [
    { name: "SKILL.md", data: Buffer.from(withFrontMatter(slug, input.skillMd, input.session.brief), "utf8") },
  ];
  for (const a of input.session.agents) {
    const rel = safeRel("agents", `${checkSegment(a.id)}.md`);
    const desc = (a.description ?? "").slice(0, DESC_MAX);
    const tools = a.tools.length === 0 ? "tools: []" : `tools:\n${a.tools.map((t) => `  - ${yamlStr(t)}`).join("\n")}`;
    const body = a.prompt && a.prompt.trim() !== "" ? a.prompt : desc;
    const text = `---\nname: ${yamlStr(a.id)}\ndescription: ${yamlStr(desc)}\n${tools}\n---\n\n${body}\n`;
    entries.push({ name: rel, data: Buffer.from(text, "utf8") });
  }
  for (const r of refs) {
    entries.push({ name: safeRel("references", r.name), data: Buffer.from(String(r.content ?? ""), "utf8") });
  }
  entries.push({ name: "sources.json", data: Buffer.from(JSON.stringify({ sources }), "utf8") });
  const total = entries.reduce((n, e) => n + e.data.length, 0);
  if (total > LIMITS.totalBytes) {
    throw new SkillError("Gói xuất vượt giới hạn dung lượng.", 400, "skill_too_large");
  }
  return entries;
}
