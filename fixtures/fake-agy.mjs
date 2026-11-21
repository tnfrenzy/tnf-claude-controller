#!/usr/bin/env node
/**
 * Offline fake Antigravity CLI (`agy`) for tests and demo mode.
 * Supports: `--version`, `models`, and headless `--input-format stream-json --output-format stream-json`.
 * Env hooks:
 *   FAKE_AGY_AUTH=none          -> `models` reports authentication required (exit 1)
 *   FAKE_AGY_FIXTURE=<path>     -> replay NDJSON lines from this file
 *   FAKE_AGY_SOFT_DENY=1        -> emit permission check failed + empty response
 *   FAKE_AGY_GIT_COMMIT=1       -> write a file and git commit in cwd (for offline coding tests)
 *   FAKE_AGY_RESPONSE=<text>    -> custom final response text
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.includes("--version")) {
  console.log("1.5.13-fake");
  process.exit(0);
}

if (args[0] === "models") {
  if (process.env.FAKE_AGY_AUTH === "none") {
    console.error("Error: authentication required. Run `agy` interactively to sign in.");
    process.exit(1);
  }
  console.log("Fetching available models...");
  console.log("gemini-3.8-flash-low\tGemini 3.8 Flash (Low)");
  console.log("gemini-4-argon-medium\tGemini 4 Argon (Medium)");
  console.log("gemini-4-neon-high\tGemini 4 Neon (High)");
  console.log("claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)");
  console.log("claude-opus-5-5-high\tClaude Opus 5.5 (High)");
  process.exit(0);
}

function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const model = argVal("--model") || "gemini-3.8-flash-low";
const agent = argVal("--agent") || undefined;
const convId = argVal("--conversation") || "fake-agy-conv-001";
const settingsFile = argVal("--settings");

// Assert hard safety rule in tests: never allow useG1Credits=true or modelProvider="gemini".
if (settingsFile && fs.existsSync(settingsFile)) {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (s.useG1Credits === true || s.modelProvider === "gemini") {
      console.error("FATAL: fake-agy detected forbidden AI Credits or API provider in settings!");
      process.exit(99);
    }
  } catch {
    /* ignore */
  }
}

// Read stdin (NDJSON prompt when --input-format stream-json).
let stdinData = "";
if (!process.stdin.isTTY) {
  try {
    stdinData = fs.readFileSync(0, "utf8");
  } catch {
    stdinData = "";
  }
}

let promptText = argVal("-p") || "";
if (!promptText && stdinData.trim()) {
  const firstLine = stdinData.trim().split(/\r?\n/)[0];
  try {
    const parsed = JSON.parse(firstLine);
    const content = parsed?.message?.content;
    promptText = typeof content === "string" ? content : "";
  } catch {
    promptText = stdinData.trim();
  }
}

const fixturePath = process.env.FAKE_AGY_FIXTURE;
if (fixturePath && fs.existsSync(fixturePath)) {
  const lines = fs.readFileSync(fixturePath, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) console.log(line);
  process.exit(0);
}

const initPayload = {
  event: "init",
  conversation_id: convId,
  init: {
    model,
    ...(agent ? { agent } : {}),
    cwd: process.cwd(),
    tools: ["view_file", "write_to_file", "run_command", "grep_search", "find_by_name"],
    permission_mode: "request-review",
  },
};
console.log(JSON.stringify(initPayload));
console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: convId, step_index: 0, state: "DONE", step_type: "user_input" } }));

if (process.env.FAKE_AGY_SOFT_DENY === "1") {
  console.log(
    JSON.stringify({
      event: "step_update",
      step_update: {
        conversation_id: convId,
        step_index: 1,
        state: "ERROR",
        step_type: "tool",
        tool_name: "run_command",
        tool_info: {
          name: "run_command",
          parameters: { CommandLine: "git push origin main" },
          error: { type: "TOOL_ERROR", message: 'permission check failed for unsandboxed "git push origin main": Permission denied.' },
        },
      },
    }),
  );
  console.error('jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.');
  console.log(
    JSON.stringify({
      event: "result",
      result: {
        conversation_id: convId,
        status: "SUCCESS",
        response: "",
        duration_seconds: 0.2,
        num_turns: 1,
        usage: { input_tokens: 100, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 100 },
      },
    }),
  );
  process.exit(0);
}

if (process.env.FAKE_AGY_GIT_COMMIT === "1") {
  const target = path.join(process.cwd(), "agy-change.txt");
  fs.writeFileSync(target, `agy:${agent || "default"}:${model}\n`, "utf8");
  spawnSync("git", ["add", "-A"], { cwd: process.cwd(), windowsHide: true });
  spawnSync("git", ["-c", "user.name=dev", "-c", "user.email=dev@example.com", "commit", "-m", `feat(agy): change by ${agent || "agy"}`], { cwd: process.cwd(), windowsHide: true });
  console.log(
    JSON.stringify({
      event: "step_update",
      step_update: {
        conversation_id: convId,
        step_index: 1,
        state: "DONE",
        step_type: "tool",
        tool_name: "run_command",
        tool_info: {
          name: "run_command",
          parameters: { CommandLine: "npm test" },
          output: "Tests 1 passed (1)\n",
        },
      },
    }),
  );
}

const defaultReply =
  agent === "critic"
    ? "VERDICT: APPROVED\nKế hoạch rõ ràng và hợp lệ."
    : agent === "qa"
      ? "VERDICT: PASS\nKiểm thử đạt."
      : `Phản hồi từ Antigravity CLI (${model}${agent ? `, agent=${agent}` : ""}): ${promptText.slice(0, 60)}`;
const reply = process.env.FAKE_AGY_RESPONSE || defaultReply;

console.log(
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: convId,
      step_index: 2,
      state: "ACTIVE",
      step_type: "agent_response",
      text_delta: reply,
    },
  }),
);
console.log(
  JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: convId,
      step_index: 2,
      state: "DONE",
      step_type: "agent_response",
      text_delta: "\n",
      duration_seconds: 0.4,
      usage: { input_tokens: 420, output_tokens: 35, thinking_tokens: 10, cache_read_tokens: 100, total_tokens: 455 },
    },
  }),
);
console.log(
  JSON.stringify({
    event: "result",
    result: {
      conversation_id: convId,
      status: "SUCCESS",
      response: reply + "\n",
      duration_seconds: 0.5,
      num_turns: 1,
      usage: { input_tokens: 420, output_tokens: 35, thinking_tokens: 10, cache_read_tokens: 100, total_tokens: 455 },
    },
  }),
);
process.exit(0);
