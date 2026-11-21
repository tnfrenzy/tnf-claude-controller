// Vendor ui-ux-pro-max (MIT) vao config/skills/ui-ux-pro-max. Chay thu cong mot lan:
//   node scripts/vendor-ux-skill.mjs [--src <thu muc da tai>] [--no-stacks] [--dest <dir>]
// Khong dependency; git spawn khong qua shell. That bai ro rang khi thieu tep.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO_URL = "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill";
export const UPSTREAM_SKILL_DIR = ".claude/skills/ui-ux-pro-max";
export const SKILL_REL = "config/skills/ui-ux-pro-max";
export const SOFT_LIMIT_BYTES = 1.3 * 1024 * 1024;

// Tep bat buoc, duong dan tuong doi so voi UPSTREAM_SKILL_DIR (tru LICENSE o goc repo).
export const PY_FILES = ["search", "core", "design_system", "reasoning_contract"].map((n) => `scripts/${n}.py`);
export const CSV_NAMES = [
  "ui-reasoning", "styles", "colors", "typography", "ux-guidelines", "products",
  "landing", "charts", "icons", "app-interface", "motion", "react-performance",
];
export const CSV_FILES = CSV_NAMES.map((n) => `data/${n}.csv`);
export const REQUIRED_FILES = ["SKILL.md", ...PY_FILES, ...CSV_FILES];
export const ROOT_LICENSE = "LICENSE";
export const STACKS_DIR = "data/stacks";
export const REFERENCES_DIR = "references";
export const REFERENCE_FILES = ["references/pro-rules.md", "references/quick-reference.md"];

// Co cho phep py tham chieu nhung CO Y khong chep (Python phai chay duoc khi thieu).
export const REFERENCED_NOT_COPIED = ["google-fonts.csv", "google-font-licenses.json"];
export const REFERENCED_NOT_COPIED_PATTERNS = [/^phosphor.*\.json$/i];
// Khong bao gio duoc co trong ban chep.
export const FORBIDDEN_NAMES = ["google-fonts.csv", "google-font-licenses.json", "validate_data.py"];
export const FORBIDDEN_PATTERNS = [/^phosphor.*\.json$/i];

const REF_RE = /[A-Za-z0-9_.\-]+\.(?:csv|json|md)\b/g;

export function findReferencedFiles(pyText) {
  const out = new Set();
  for (const m of pyText.matchAll(REF_RE)) out.add(m[0]);
  return [...out];
}

function isSkipped(name) {
  return REFERENCED_NOT_COPIED.includes(name) || REFERENCED_NOT_COPIED_PATTERNS.some((r) => r.test(name));
}

export function patchSkillMd(text, skillRel = SKILL_REL) {
  return text
    .split("${CLAUDE_PLUGIN_ROOT}/" + UPSTREAM_SKILL_DIR).join(skillRel)
    .split("${CLAUDE_PLUGIN_ROOT}").join(skillRel)
    .split(UPSTREAM_SKILL_DIR).join(skillRel);
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function readmeText(sha, total, skippedStacks) {
  return [
    "# ui-ux-pro-max (ban vendor)",
    "",
    `Nguon: ${REPO_URL} (commit ${sha}). Giay phep MIT, xem LICENSE.`,
    "Sinh boi `node scripts/vendor-ux-skill.mjs`; dung sua tay, chay lai script de cap nhat.",
    `Tong dung luong: ${(total / 1024).toFixed(0)} KB (nguong mem 1.3 MB).${skippedStacks ? " Da bo data/stacks (--no-stacks)." : ""}`,
    "",
    "Da bo co y (khong chep): google-fonts.csv, phosphor*.json, google-font-licenses.json,",
    "validate_data.py, tests/, gallery, screenshots, cli.",
    "",
    "CANH BAO: core.py co the tham chieu google-fonts.csv (CSV_CONFIG) nhung ta khong chep no.",
    "Buoc thu cong 4 phai kiem chay search.py that (design-system --persist) khi thieu tep nay;",
    "neu core.py loi, vá nhe core.py hoac chep them tep do roi cap nhat danh sach trong script.",
    "",
  ].join("\n");
}

export function vendor({ src, dest, noStacks = false, log = console.log }) {
  const errors = [];
  let tmpClone = null;
  let sha = "unknown";
  try {
    let root = src;
    if (root) {
      root = path.resolve(root);
      const g = git(["rev-parse", "HEAD"], root);
      if (g.ok) sha = g.out;
    } else {
      tmpClone = fs.mkdtempSync(path.join(os.tmpdir(), "ux-vendor-"));
      const c = git(["clone", "--depth", "1", REPO_URL, tmpClone]);
      if (!c.ok) return { ok: false, errors: [`Khong clone duoc: ${c.err}`] };
      root = tmpClone;
      const g = git(["rev-parse", "HEAD"], root);
      if (g.ok) sha = g.out;
      if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, errors: ["Khong xac minh duoc SHA cua ban clone"] };
    }
    const up = path.join(root, ...UPSTREAM_SKILL_DIR.split("/"));
    const need = [...REQUIRED_FILES.filter((f) => !(noStacks && false))];
    const missing = [];
    for (const f of need) if (!fs.existsSync(path.join(up, f))) missing.push(f);
    if (!fs.existsSync(path.join(root, ROOT_LICENSE))) missing.push(ROOT_LICENSE);
    if (missing.length) {
      return { ok: false, errors: missing.map((f) => `Thieu tep bat buoc: ${f}`) };
    }

    // references/: chep neu SKILL.md tro toi
    const skillMd = fs.readFileSync(path.join(up, "SKILL.md"), "utf8");
    const wantRefs = skillMd.includes("references/");
    if (wantRefs) {
      for (const f of REFERENCE_FILES) {
        if (!fs.existsSync(path.join(up, f))) errors.push(`Thieu tep bat buoc: ${f} (SKILL.md tro toi references/)`);
      }
      if (!fs.existsSync(path.join(up, REFERENCES_DIR))) errors.push("Thieu thu muc references/");
    }
    const stacksSrc = path.join(up, ...STACKS_DIR.split("/"));
    if (!noStacks && !fs.existsSync(stacksSrc)) errors.push(`Thieu thu muc: ${STACKS_DIR}`);

    // Kiem tham chieu tep trong py
    const copiedNames = new Set([...REQUIRED_FILES.map((f) => path.posix.basename(f)), ROOT_LICENSE]);
    if (wantRefs && fs.existsSync(path.join(up, REFERENCES_DIR))) {
      for (const n of fs.readdirSync(path.join(up, REFERENCES_DIR))) copiedNames.add(n);
    }
    if (!noStacks && fs.existsSync(stacksSrc)) for (const n of fs.readdirSync(stacksSrc)) copiedNames.add(n);
    for (const py of PY_FILES) {
      const text = fs.readFileSync(path.join(up, py), "utf8");
      for (const name of findReferencedFiles(text)) {
        if (copiedNames.has(name) || isSkipped(name)) continue;
        // bo qua ten module/thu vien thong thuong (vd package.json trong chu thich)
        errors.push(`${py} tham chieu tep ngoai danh sach: ${name}`);
      }
    }
    if (errors.length) return { ok: false, errors };

    // Chep vao thu muc tam canh dest, roi doi ten
    const parent = path.dirname(dest);
    fs.mkdirSync(parent, { recursive: true });
    const stage = fs.mkdtempSync(path.join(parent, ".ux-staging-"));
    try {
      const put = (rel, from = path.join(up, rel)) => {
        const to = path.join(stage, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      };
      for (const f of REQUIRED_FILES) if (f !== "SKILL.md") put(f);
      put(ROOT_LICENSE, path.join(root, ROOT_LICENSE));
      fs.writeFileSync(path.join(stage, "SKILL.md"), patchSkillMd(skillMd), "utf8");
      if (wantRefs) fs.cpSync(path.join(up, REFERENCES_DIR), path.join(stage, REFERENCES_DIR), { recursive: true });
      if (!noStacks) fs.cpSync(stacksSrc, path.join(stage, ...STACKS_DIR.split("/")), { recursive: true });

      // Kiem sau chep
      const out = fs.readFileSync(path.join(stage, "SKILL.md"), "utf8");
      if (out.includes("${CLAUDE_PLUGIN_ROOT}")) errors.push("SKILL.md con ${CLAUDE_PLUGIN_ROOT}");
      if (out.includes(UPSTREAM_SKILL_DIR)) errors.push(`SKILL.md con chuoi ${UPSTREAM_SKILL_DIR}`);
      const total = dirSize(stage);
      if (errors.length) return { ok: false, errors };
      if (total > SOFT_LIMIT_BYTES) {
        log(`CANH BAO: tong dung luong ${(total / 1024).toFixed(0)} KB vuot nguong mem 1.3 MB; can nhac --no-stacks hoac bo bot CSV.`);
      }
      fs.writeFileSync(path.join(stage, "README.md"), readmeText(sha, total, noStacks), "utf8");
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(stage, dest);
      log(`Xong: ${dest} (${(total / 1024).toFixed(0)} KB), commit ${sha}`);
      return { ok: true, errors: [], sha, total };
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  } finally {
    if (tmpClone) fs.rmSync(tmpClone, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dest = arg("--dest") ? path.resolve(arg("--dest")) : path.join(repoRoot, ...SKILL_REL.split("/"));
  const r = vendor({ src: arg("--src"), dest, noStacks: argv.includes("--no-stacks") });
  if (!r.ok) {
    for (const e of r.errors) console.error(`LOI: ${e}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
