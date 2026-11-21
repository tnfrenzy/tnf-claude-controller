#!/usr/bin/env node
/**
 * Offline fake OpenAI Codex CLI (`codex`) for tests and demo mode.
 * Supports: `--version`, `login status`, `exec --json [--sandbox ...] [--model ...] [resume <id>] -`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("codex-cli 0.42.0-fake");
  process.exit(0);
}

if (args[0] === "login" && args[1] === "status") {
  if (process.env.OPENAI_API_KEY) {
    console.error("Logged in using API key (should have been stripped by TNF CLI!)");
    process.exit(99);
  }
  if (process.env.FAKE_CODEX_AUTH === "none") {
    console.log("Not logged in");
    process.exit(1);
  }
  console.log("Logged in using ChatGPT");
  process.exit(0);
}

function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const model = argVal("--model") || "gpt-5.3-codex";
const resumeIdx = args.indexOf("resume");
const threadId = resumeIdx >= 0 && args[resumeIdx + 1] ? args[resumeIdx + 1] : "fake-codex-thread-001";

let promptText = "";
if (!process.stdin.isTTY) {
  try { promptText = fs.readFileSync(0, "utf8").trim(); } catch { promptText = ""; }
}

console.log(JSON.stringify({ type: "thread.started", thread_id: threadId }));
console.log(JSON.stringify({ type: "turn.started" }));

if (process.env.FAKE_CODEX_GIT_COMMIT === "1" && !args.includes("read-only")) {
  const target = path.join(process.cwd(), "codex-change.txt");
  fs.writeFileSync(target, `codex:${model}\n`, "utf8");
  spawnSync("git", ["add", "-A"], { cwd: process.cwd(), windowsHide: true });
  spawnSync("git", ["-c", "user.name=dev", "-c", "user.email=dev@example.com", "commit", "-m", "feat(codex): change by codex"], { cwd: process.cwd(), windowsHide: true });
  console.log(JSON.stringify({ type: "item.started", item: { id: "cmd-1", type: "command_execution", command: "npm test" } }));
  console.log(JSON.stringify({ type: "item.completed", item: { id: "cmd-1", type: "command_execution", command: "npm test", exit_code: 0, aggregated_output: "Tests 3 passed (3)\n" } }));
}

const isQa = /\bqa\b|VERDICT:\s*PASS/i.test(promptText);
const isCritic = /\bcritic\b|VERDICT:\s*APPROVED/i.test(promptText);
const verdictLine = isQa ? "\nVERDICT: PASS" : isCritic ? "\nVERDICT: APPROVED" : "";
const resumeTag = resumeIdx >= 0 ? ` [resumed:${threadId}]` : "";
const reply =
  process.env.FAKE_CODEX_RESPONSE ||
  `Phản hồi từ OpenAI Codex CLI (${model})${resumeTag}: ${promptText.slice(0, 60)}${verdictLine}`;
console.log(JSON.stringify({ type: "item.completed", item: { id: "msg-1", type: "agent_message", text: reply } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 510, cached_input_tokens: 120, output_tokens: 48 } }));
process.exit(0);
