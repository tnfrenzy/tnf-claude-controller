/**
 * Smoke test with the REAL Claude Code CLI (spends subscription quota). Never run by `npm test`.
 *
 *   npm run smoke -- --yes                 # small "hello" run, haiku, 3 turns, $0.2 cap
 *   npm run smoke -- --yes --roles         # coordinator + 3 research roles on the standard task
 *   npm run smoke -- --yes --single        # same task, single agent (A/B baseline)
 *   npm run smoke -- --yes --prompt "..."  # custom prompt
 *   npm run smoke -- --yes --coding --project spike [--prompt "..."]
 *                                          # coding run (worktree of the project's repo, 6 coding roles), prints
 *                                          # controller-side evidence: denials, verdicts, git log/status/diff-stat,
 *                                          # bare remote branches, original repo unchanged, npm test re-run
 */
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/core/app/config.js";
import { RunManager } from "../src/core/run/run-manager.js";
import { RunStore } from "../src/core/run/run-store.js";
import { runGit } from "../src/core/git/git.js";
import type { StoredEvent, NormalizedEvent } from "../src/core/run/events.js";

const STANDARD_TASK = "Phân tích website example.com từ góc độ nội dung, SEO cơ bản và thông điệp bán hàng.";
const CODING_TASK =
  "Thêm lệnh CLI version: `node src/cli.js version` in ra version trong package.json, kèm test tests/cli.test.js, cập nhật README một dòng, chạy npm test, commit.";

const { values } = parseArgs({
  options: {
    yes: { type: "boolean" },
    roles: { type: "boolean" },
    single: { type: "boolean" },
    coding: { type: "boolean" },
    "probe-timeout": { type: "boolean" },
    project: { type: "string" },
    prompt: { type: "string" },
    budget: { type: "string" },
    "max-turns": { type: "string" },
    model: { type: "string" },
    "role-model": { type: "string", multiple: true },
  },
});

if (!values["yes"]) {
  console.error("Smoke test tốn hạn mức thuê bao. Thêm --yes để xác nhận.");
  process.exit(2);
}
if (process.env["ANTHROPIC_API_KEY"]) {
  console.error("ANTHROPIC_API_KEY đang được đặt trong môi trường — dừng để tránh tốn phí API. Gỡ biến rồi chạy lại.");
  process.exit(2);
}
if (values["coding"] && !values["project"]) {
  console.error("--coding cần --project <tên> (project đã gắn repo bằng `tnf projects add`).");
  process.exit(2);
}

const config = loadConfig();
if (values["probe-timeout"]) {
  if (!values["project"]) {
    console.error("--probe-timeout cần --project <tên> (run coding, project phải có repo).");
    process.exit(2);
  }
  const { runProbe } = await import("./probe-timeout.js");
  process.exit(await runProbe(config, values["project"]));
}
const store = new RunStore(path.join(config.dataDir, "controller.db"));
// TNF_FAKE_CLAUDE=1 replays a fixture with the fake CLI (no quota) — lets the --coding evidence block be exercised offline.
const fake = process.env["TNF_FAKE_CLAUDE"] === "1";
if (fake) console.log("⚠ TNF_FAKE_CLAUDE=1: đang dùng CLI giả (fixtures), không gọi Claude thật.");
const mgr = new RunManager(
  fake
    ? { config, store, claudePath: process.execPath, claudeArgsPrefix: [path.join(config.repoRoot, "fixtures", "fake-claude.mjs")], env: { ...process.env, FAKE_CLAUDE_FIXTURE: process.env["FAKE_CLAUDE_FIXTURE"] ?? "roles" } }
    : { config, store },
);

const auth = await mgr.authStatus();
console.log(`auth: ${auth.authMethod} (${auth.subscriptionType ?? "?"}) · claude: ${mgr.resolveClaude()}`);

const coding = Boolean(values["coding"]);
const isTask = values["roles"] || values["single"] || coding;
const prompt = values["prompt"] ?? (coding ? CODING_TASK : isTask ? STANDARD_TASK : "chào, trả lời đúng 1 câu");
const input: Parameters<RunManager["startRun"]>[0] = {
  prompt,
  roles: coding ? true : values["roles"] ? true : false,
  model: values["model"] ?? (isTask ? config.defaults.model : "haiku"),
  maxTurns: Number(values["max-turns"] ?? (isTask ? 40 : 3)),
  maxBudgetUsd: Number(values["budget"] ?? (coding ? 1 : isTask ? 3 : 0.2)),
};
if (coding) {
  input.project = values["project"]!;
  input.kind = "coding";
}
const roleModels: Record<string, string> = {};
for (const spec of values["role-model"] ?? []) {
  const [role, model] = spec.split("=");
  if (role && model) roleModels[role.trim()] = model.trim();
}
if (Object.keys(roleModels).length) input.roleModels = roleModels;
console.log(`prompt: ${prompt}\nmode: ${coding ? `coding (project ${input.project})` : input.roles ? "coordinator+roles" : "single"} · model ${input.model} · max-turns ${input.maxTurns} · budget $${input.maxBudgetUsd}`);

const t0 = Date.now();
const run = await mgr.startRun(input);
console.log(`run ${run.id} · cwd ${coding ? run.worktree_path : run.run_dir}${coding ? ` · branch ${run.branch} · base ${run.base_sha?.slice(0, 7)}` : ""}`);
const denials: Extract<NormalizedEvent, { type: "permission.denied" }>[] = [];
const roleCalls: string[] = [];
mgr.on("event", ({ run_id, stored }: { run_id: string; stored: StoredEvent }) => {
  if (run_id !== run.id) return;
  const e = stored.event;
  if (e.type === "permission.denied") denials.push(e);
  if (e.type === "agent.started") roleCalls.push(e.role);
  if (e.type === "text.delta" || e.type === "thinking.delta" || e.type === "usage.update") return;
  console.log(`  ${e.type}: ${JSON.stringify(e).slice(0, 200)}`);
});
const final = (await mgr.waitFor(run.id))!;
console.log(`\nstatus=${final.status} turns=${final.num_turns} time=${Math.round((Date.now() - t0) / 1000)}s cost_est=$${final.cost_usd_est.toFixed(4)} usage=${JSON.stringify(final.usage)}`);
if (final.error) console.log(`error: ${final.error}`);
console.log(`agents: ${final.agents.map((a) => `${a.role}(${a.status}, in=${a.usage.input}, out=${a.usage.output})`).join(", ")}`);
console.log(`artifacts: ${store.getArtifacts(run.id).map((a) => a.rel_path).join(", ") || "(none)"}`);
console.log(`stream: ${path.join(config.dataDir, "runs", run.id, "stream.jsonl")}`);

let ok = final.status === "done";
if (coding) {
  const wt = final.worktree_path!;
  const base = final.base_sha!;
  const project = store.getProject(final.project)!;
  const repo = project.repo_path!;
  const read = (f: string) => {
    try {
      return fs.readFileSync(path.join(final.run_dir, f), "utf8").trim();
    } catch {
      return "(không có)";
    }
  };
  const remoteUrl = runGit(repo, ["remote", "get-url", "origin"]).stdout.trim();
  const remoteBranches = remoteUrl ? runGit(repo, ["ls-remote", "--heads", remoteUrl]).stdout.trim() : "(repo không có remote origin)";
  const npmTest = spawnSync("npm", ["test"], { cwd: wt, encoding: "utf8", windowsHide: true, shell: true });
  const npmOut = ((npmTest.stdout ?? "") + (npmTest.stderr ?? "")).trim().split("\n").slice(-8).join("\n");

  console.log("\n=== BẰNG CHỨNG (controller thu, độc lập với báo cáo của agent) ===");
  console.log(`số lần gọi vai: ${roleCalls.length} (${roleCalls.join(" → ")})`);
  console.log(`verdicts: ${final.verdicts.map((v) => `${v.role}=${v.verdict}`).join(", ") || "(không có)"}`);
  console.log(`permission.denied: ${denials.length}`);
  for (const d of denials) console.log(`  DENIED ${d.agent_id} ${d.tool}: ${(d.reason ?? "").slice(0, 160)}`);
  console.log(`commits (${base.slice(0, 7)}..HEAD): ${final.commits.length}`);
  for (const c of final.commits) console.log(`  ${c.hash.slice(0, 7)} ${c.subject}`);
  console.log(`git status (worktree): ${read("git-status.txt") || "(sạch)"}`);
  console.log(`diff --stat:\n${read("diff-stat.txt") || "(rỗng)"}`);
  console.log(`bare remote (${remoteUrl}):\n${remoteBranches}   ← PHẢI KHÔNG có ${final.branch}`);
  console.log(`repo gốc: ${read("repo-check.txt")}`);
  console.log(`test-result.txt (từ stream): ${read("test-result.txt").split("\n")[0]}`);
  console.log(`npm test (controller chạy lại trong worktree): exit ${npmTest.status}\n${npmOut}`);
  const effMaxRoleCalls = final.limits?.maxRoleCalls ?? config.defaults.coding.maxRoleCalls;
  const qaPass = final.verdicts.some((v) => v.role === "qa" && (v.verdict === "PASS" || v.verdict === "PASS_ENV"));
  const remoteHasBranch = remoteBranches.includes(`refs/heads/${final.branch}`);
  const repoOk = read("repo-check.txt").startsWith("OK");
  ok = ok && qaPass && final.commits.length > 0 && npmTest.status === 0 && !remoteHasBranch && repoOk && roleCalls.length <= effMaxRoleCalls;
  console.log(`\nKẾT LUẬN: ${ok ? "ĐẠT" : "CHƯA ĐẠT"} (qa PASS=${qaPass}, commit=${final.commits.length > 0}, npm test=${npmTest.status === 0}, remote sạch=${!remoteHasBranch}, repo gốc=${repoOk}, gọi vai ≤ ${effMaxRoleCalls}=${roleCalls.length <= effMaxRoleCalls})`);
}
store.close();
process.exit(ok ? 0 : 1);
