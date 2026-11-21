/**
 * Rebuild a run's record (agents, usage, result, artifacts) from its raw stream.jsonl with the CURRENT parser,
 * and salvage subagent outputs (report.md / notes/analysis.md) that the CLI refused to let subagents write.
 * Use after upgrading the parser.   npm run reparse -- <run-id> [<run-id> ...]   (or --all)
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/core/app/config.js";
import { RunStore, type RunRecord } from "../src/core/run/run-store.js";
import { StreamParser } from "../src/core/run/stream-parser.js";
import type { AgentInfo, NormalizedEvent } from "../src/core/run/events.js";

const config = loadConfig();
const store = new RunStore(path.join(config.dataDir, "controller.db"));
const args = process.argv.slice(2);
const ids = args.includes("--all") ? store.listRuns({ limit: 10_000 }).map((r) => r.id) : args;
if (ids.length === 0) {
  console.error("Cách dùng: npm run reparse -- <run-id> | --all");
  process.exit(2);
}

function salvage(runDir: string, agents: AgentInfo[]): string[] {
  const targets: Record<string, string> = { synthesizer: "report.md", analyzer: path.join("notes", "analysis.md") };
  const saved: string[] = [];
  let searcherIdx = 0;
  for (const a of agents) {
    let rel = targets[a.role];
    if (!rel && a.role === "searcher" && a.reply) {
      searcherIdx++;
      const mentioned = [...a.reply.matchAll(/notes[\\/]([\w.-]+\.md)/g)].map((m) => m[1]!);
      if (mentioned.some((f) => fs.existsSync(path.join(runDir, "notes", f)))) continue;
      rel = path.join("notes", `searcher-${searcherIdx}.md`);
    }
    if (!rel) continue;
    const dest = path.join(runDir, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    let text = "";
    if (a.output_file && fs.existsSync(a.output_file)) text = fs.readFileSync(a.output_file, "utf8").trim();
    if (!text && a.reply) text = a.reply.trim();
    if (!text) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `<!-- Lưu tự động bởi controller từ trả lời của vai ${a.role} (subagent không được phép ghi file) -->\n\n${text}\n`, "utf8");
    saved.push(rel);
  }
  return saved;
}

for (const id of ids) {
  const run = store.getRun(id);
  const streamFile = path.join(config.dataDir, "runs", id, "stream.jsonl");
  if (!run || !fs.existsSync(streamFile)) {
    console.log(`${id}: bỏ qua (không có run hoặc stream.jsonl)`);
    continue;
  }
  const parser = new StreamParser(id);
  const events: NormalizedEvent[] = [];
  for (const line of fs.readFileSync(streamFile, "utf8").split(/\r?\n/)) events.push(...parser.feedLine(line));
  events.push(...parser.finalize());
  const result = events.find((e): e is Extract<NormalizedEvent, { type: "run.result" }> => e.type === "run.result");
  const agents = [...parser.agents.values()];
  const patch: Partial<RunRecord> = { agents, usage: parser.totalUsage };
  if (parser.sessionId) patch.session_id = parser.sessionId;
  if (parser.claudeVersion) patch.claude_version = parser.claudeVersion;
  if (parser.model) patch.model = parser.model;
  if (result) {
    patch.status = result.ok ? "done" : "error";
    patch.result_text = result.text;
    patch.cost_usd_est = result.cost_usd_est;
    patch.usage = result.usage;
    patch.num_turns = result.num_turns;
    patch.duration_ms = result.duration_ms;
  }
  store.updateRun(id, patch);
  const saved = salvage(run.run_dir, agents);
  const reportPath = path.join(run.run_dir, "report.md");
  if (result && result.text.trim().length >= 1200 && !(fs.existsSync(reportPath) && fs.statSync(reportPath).size > 0)) {
    fs.writeFileSync(reportPath, `<!-- Lưu tự động bởi controller từ câu trả lời cuối của phiên chính -->\n\n${result.text.trim()}\n`, "utf8");
    saved.push("report.md (từ trả lời cuối)");
  }
  const arts = store.scanArtifacts(id, run.run_dir);
  console.log(`${id}: ${patch.status ?? run.status} · agents ${agents.map((a) => a.role).join(",")} · lưu dự phòng [${saved.join(", ")}] · tệp [${arts.map((a) => a.rel_path).join(", ")}]`);
}
store.close();
