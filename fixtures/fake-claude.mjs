#!/usr/bin/env node
// Fake Claude Code CLI used by tests and offline demos. Never calls any API.
// Usage: node fake-claude.mjs auth status            -> prints auth JSON
//        node fake-claude.mjs -p ... (prompt on stdin) -> replays FAKE_CLAUDE_FIXTURE (default hello)
// Env:   FAKE_CLAUDE_FIXTURE=hello|roles|<abs path>, FAKE_CLAUDE_HANG=1 (never exit), FAKE_CLAUDE_AUTH=<authMethod>
//        FAKE_CLAUDE_DELAY_MS=<per-line delay>, FAKE_CLAUDE_WRITE_ARTIFACTS=1 (create notes/report.md in cwd)
//        FAKE_CLAUDE_GIT_COMMIT=1 (coding demo: create src/sub.js in cwd and `git commit` it, no shell, env identity)
//        FAKE_CLAUDE_ARGS_FILE=<path> (write the received argv as JSON, for permission tests)
//        FAKE_CLAUDE_BY_ROLE_DIR=<dir> (3D workshop: pick <dir>/<role>.<k>.stream.jsonl, else <dir>/<role>.stream.jsonl, by the role named in the
//        --append-system-prompt-file text; k = how many times that role was already replayed; no match -> the usual fixture)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(args, null, 2));
if (process.env.FAKE_CLAUDE_ENV_FILE && args[0] !== "auth") {
  fs.writeFileSync(process.env.FAKE_CLAUDE_ENV_FILE, JSON.stringify({ BASH_DEFAULT_TIMEOUT_MS: process.env.BASH_DEFAULT_TIMEOUT_MS ?? null, BASH_MAX_TIMEOUT_MS: process.env.BASH_MAX_TIMEOUT_MS ?? null, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS ?? null }));
}

if (args[0] === "auth" && args[1] === "status") {
  const method = process.env.FAKE_CLAUDE_AUTH ?? "claude.ai";
  process.stdout.write(
    JSON.stringify({ loggedIn: method !== "none", authMethod: method, subscriptionType: "team", email: "test@example.com" }, null, 2) + "\n",
  );
  process.exit(method === "none" ? 1 : 0);
}

if (args[0] === "--version") {
  process.stdout.write("0.0.0 (Claude Code fake)\n");
  process.exit(0);
}

if (args.includes("--bare")) {
  process.stderr.write("fake-claude: --bare must never be used in subscription mode\n");
  process.exit(2);
}

/** Pretend an implementer edited and committed inside the worktree (cwd). Uses the GIT_* identity from env. */
function fakeCommit() {
  const git = (a) => spawnSync("git", a, { cwd: process.cwd(), encoding: "utf8", windowsHide: true, shell: false });
  fs.mkdirSync("src", { recursive: true });
  // A unique marker line per run so a second run in the same worktree still has something to commit.
  fs.writeFileSync(path.join("src", "sub.js"), `export const sub = (a, b) => a - b;\n// fake run ${process.pid} ${Date.now()}\n`);
  git(["add", "-A"]);
  const r = git(["commit", "-m", "feat(math): add sub (fake)"]);
  if (r.status !== 0) process.stderr.write(`fake-claude: git commit failed: ${r.stderr}`);
}

// 3D workshop roles are told apart by the opening sentence of their system prompt (config/roles-design3d.json).
const ROLE_MARKERS = [
  ["tiep-nhan-3d", /You are the intake analyst/], ["art-director", /You are the art director/], ["detail-planner", /You are the detail planner/],
  ["cad-modeler", /You are the CAD modeler/], ["material-artist", /You are the material artist/], ["render-director", /You are the render director/],
  ["visual-reviewer", /You are the visual reviewer/], ["ar-optimizer", /You are the AR optimizer/], ["render-presenter", /You are the presenter/],
];
function byRoleFile(dir) {
  const i = args.indexOf("--append-system-prompt-file");
  if (i < 0 || !args[i + 1]) return null;
  let sys = "";
  try {
    sys = fs.readFileSync(args[i + 1], "utf8");
  } catch {
    return null;
  }
  const hit = ROLE_MARKERS.find(([, re]) => re.test(sys.slice(0, 400)));
  if (!hit) return null;
  const role = hit[0];
  // The read-then-write of the counter is not concurrency-safe on purpose: the roles of a session run one after another.
  const counter = path.join(dir, `.count-${role}`);
  let k = 0;
  try {
    k = Number(fs.readFileSync(counter, "utf8")) || 0;
  } catch {
    k = 0;
  }
  fs.writeFileSync(counter, String(k + 1));
  const indexed = path.join(dir, `${role}.${k}.stream.jsonl`);
  const plain = path.join(dir, `${role}.stream.jsonl`);
  return fs.existsSync(indexed) ? indexed : fs.existsSync(plain) ? plain : null;
}

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", async () => {
  if (process.env.FAKE_CLAUDE_HANG === "1") {
    process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "hang-session", model: "fake", claude_code_version: "0.0.0-fake" }) + "\n");
    setInterval(() => {}, 1000);
    return;
  }
  let name = process.env.FAKE_CLAUDE_FIXTURE ?? "hello";
  if (process.env.FAKE_CLAUDE_SEQUENCE && process.env.FAKE_CLAUDE_COUNTER_FILE) {
    const seq = process.env.FAKE_CLAUDE_SEQUENCE.split("|").filter(Boolean);
    const cf = process.env.FAKE_CLAUDE_COUNTER_FILE;
    let k = 0;
    try {
      k = Number(fs.readFileSync(cf, "utf8")) || 0;
    } catch {
      k = 0;
    }
    fs.writeFileSync(cf, String(k + 1));
    if (seq.length > 0) name = seq[Math.min(k, seq.length - 1)];
  }
  let file = path.isAbsolute(name) ? name : path.join(here, `${name}.stream.jsonl`);
  if (process.env.FAKE_CLAUDE_BY_ROLE_DIR) {
    const byRole = byRoleFile(process.env.FAKE_CLAUDE_BY_ROLE_DIR);
    if (byRole) file = byRole;
  }
  const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? "0");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  // Research demo artifacts only; a coding fixture runs with cwd = worktree and must not litter it.
  if (process.env.FAKE_CLAUDE_WRITE_ARTIFACTS === "1" && !/coding/.test(name)) {
    fs.mkdirSync("notes", { recursive: true });
    fs.writeFileSync(path.join("notes", "searcher-site.md"), "# Ghi chú (giả lập)\n- Prompt: " + prompt.slice(0, 80) + "\n");
    fs.writeFileSync("report.md", "# Báo cáo (giả lập)\n\n## Tóm tắt điều hành\nĐây là báo cáo giả lập từ fake-claude.\n");
  }
  const commitAt = process.env.FAKE_CLAUDE_GIT_COMMIT === "1" ? Math.floor(lines.length / 2) : -1;
  for (let i = 0; i < lines.length; i++) {
    if (i === commitAt) fakeCommit();
    process.stdout.write(lines[i] + "\n");
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  process.exit(0);
});
