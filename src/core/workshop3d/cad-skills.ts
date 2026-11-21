import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../app/config.js";

/**
 * "Thư viện kỹ năng dựng" (idea from SceneCraft's reusable skill library): short, verified CadQuery patterns in
 * config/cad-skills/*.md (first line `keywords: a, b, c`, then a title, prose and one ```python block). The cad-modeler
 * gets the few that match the brief and plan as reference material to rewrite around its PARAMS, never as code to paste.
 * tests/workshop3d-cad-skills.test.ts runs every block with the real CAD python when it is installed.
 */

export const CAD_SKILLS_DIR = path.join(REPO_ROOT, "config", "cad-skills");
export const MAX_SKILLS = 3;
export const MAX_SKILLS_CHARS = 7000;

export interface CadSkill {
  id: string;
  keywords: string[];
  text: string;
}

function strip(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
}

export function loadCadSkills(dir: string = CAD_SKILLS_DIR): CadSkill[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: CadSkill[] = [];
  for (const n of names) {
    try {
      const raw = fs.readFileSync(path.join(dir, n), "utf8").replace(/\r\n/g, "\n");
      const m = /^keywords:\s*(.+)\n([\s\S]*)$/.exec(raw);
      if (!m) continue;
      const keywords = m[1]!.split(",").map((k) => strip(k.trim())).filter(Boolean);
      out.push({ id: n.replace(/\.md$/, ""), keywords, text: m[2]!.trim() });
    } catch {
      // an unreadable skill never stops a session
    }
  }
  return out;
}

/** Skills whose keywords occur in `haystack` (accent-insensitive), best match first, within the prompt budget. */
export function pickCadSkills(haystack: string, skills: CadSkill[] = loadCadSkills()): CadSkill[] {
  const hay = strip(haystack);
  const scored = skills
    .map((s) => ({ s, score: s.keywords.filter((k) => hay.includes(k)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id));
  const out: CadSkill[] = [];
  let used = 0;
  for (const { s } of scored) {
    if (out.length >= MAX_SKILLS || used + s.text.length > MAX_SKILLS_CHARS) continue;
    out.push(s);
    used += s.text.length;
  }
  return out;
}

export function cadSkillsText(haystack: string, skills?: CadSkill[]): string {
  return pickCadSkills(haystack, skills).map((s) => `### ${s.id}\n${s.text}`).join("\n\n");
}
