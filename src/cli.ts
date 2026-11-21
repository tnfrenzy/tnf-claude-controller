#!/usr/bin/env node
/**
 * tnf — command line for the TNF CLI.
 *   tnf run "<prompt>" [--project name] [--kind (không còn dùng, bị bỏ qua)] [--single] [--model sonnet] [--max-turns N] [--budget X]
 *       [--skill name]... [--agent-file agents.json]   (extra agents/skills for this run only; TNF_CONFIG=<controller.json> overrides the config)
 *   tnf resume <run-id> "<prompt>"
 *   tnf cad status | tnf cad inspect <tệp.dxf|.step|.stp>   (công cụ CAD, xem docs/CAD-TOOLS.md)
 *   tnf projects add <name> --repo <abs path> [--base main] [--allow "Bash(pytest*)"]...
 *   tnf projects list
 *   tnf list [--q text] [--status done|error|cancelled|running]
 *   tnf show <run-id>
 *   tnf cancel <run-id>          (needs a running `tnf serve`)
 *   tnf cleanup [--older-than N] [--dry-run]   (dọn worktree của run cũ; mặc định 14 ngày; nhánh tnf/<run-id> được giữ)
 *   tnf status                   (claude auth status + billing guard)
 *   tnf version                  (controller version + `claude --version`)
 *   tnf serve [--port 4800] [--open]
 *   tnf open [--port 4800] [--print]   (open the UI in an Edge/Chrome app window; server must be running)
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { loadConfig } from "./core/app/config.js";
import { queryAuthStatus, sanitizeEnv } from "./core/run/billing-guard.js";
import { locateClaude } from "./core/run/claude-locator.js";
import { appWindowArgs, locateBrowser } from "./core/app/browser-locator.js";
import { readClaudeVersion, readControllerVersion } from "./core/app/version.js";
import { cadStatus, inspectCad } from "./core/design3d/cad-tools.js";
import type { AgentInfo, NormalizedEvent, StoredEvent } from "./core/run/events.js";
import { readAgentFile, type ExtraAgentDef } from "./core/run/extras.js";
import { RunManager } from "./core/run/run-manager.js";
import { RunStore } from "./core/run/run-store.js";
import { runCleanupCommand } from "./cli-cleanup.js";
import { readTokenFile } from "./server/auth.js";
import { startServer } from "./server/index.js";

const ROLE_ICON: Record<string, string> = {
  coordinator: "◎", searcher: "⌕", analyzer: "≋", synthesizer: "✎", unknown: "?",
  analyst: "⌕", planner: "☰", critic: "⚖", implementer: "⚒", qa: "✔", debug: "⚙",
};

/** Demo/offline mode (TNF_FAKE_CLAUDE=1): replay fixtures with the fake CLI instead of spending quota. */
function fakeClaudeOptions(repoRoot: string): {
  claudePath: string;
  claudeArgsPrefix: string[];
  agyPath: string;
  agyArgsPrefix: string[];
  codexPath: string;
  codexArgsPrefix: string[];
  env: NodeJS.ProcessEnv;
} | null {
  if (process.env["TNF_FAKE_CLAUDE"] !== "1") return null;
  console.log("⚠ TNF_FAKE_CLAUDE=1: đang dùng CLI giả (fixtures), không gọi CLI thật.");
  return {
    claudePath: process.execPath,
    claudeArgsPrefix: [path.join(repoRoot, "fixtures", "fake-claude.mjs")],
    agyPath: process.execPath,
    agyArgsPrefix: [path.join(repoRoot, "fixtures", "fake-agy.mjs")],
    codexPath: process.execPath,
    codexArgsPrefix: [path.join(repoRoot, "fixtures", "fake-codex.mjs")],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: process.env["FAKE_CLAUDE_FIXTURE"] ?? "roles", FAKE_CLAUDE_WRITE_ARTIFACTS: process.env["FAKE_CLAUDE_WRITE_ARTIFACTS"] ?? "1", FAKE_CLAUDE_DELAY_MS: process.env["FAKE_CLAUDE_DELAY_MS"] ?? "0" },
  };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function printTree(agents: AgentInfo[]): void {
  const byParent = new Map<string | null, AgentInfo[]>();
  for (const a of agents) {
    const list = byParent.get(a.parent_id) ?? [];
    list.push(a);
    byParent.set(a.parent_id, list);
  }
  const walk = (parent: string | null, depth: number) => {
    for (const a of byParent.get(parent) ?? []) {
      const u = a.usage;
      console.log(`${"  ".repeat(depth)}${ROLE_ICON[a.role] ?? "•"} ${a.role} [${a.status}] ${a.model ?? ""} in=${u.input} out=${u.output} cache_r=${u.cache_read} cache_w=${u.cache_write}`);
      walk(a.agent_id, depth + 1);
    }
  };
  walk(null, 0);
}

function liveLog(ev: NormalizedEvent, agents: Map<string, AgentInfo>): void {
  const role = (id: string) => agents.get(id)?.role ?? id;
  switch (ev.type) {
    case "run.started":
      console.log(`▶ bắt đầu · session ${ev.session_id ?? "?"} · model ${ev.model ?? "?"} · claude ${ev.claude_version ?? "?"}`);
      break;
    case "agent.started":
      console.log(`  ＋ agent ${ev.role} (${ev.description ?? ""})`);
      break;
    case "agent.finished":
      console.log(`  ✓ agent ${role(ev.agent_id)} xong: ${ev.summary.slice(0, 120)}`);
      break;
    case "tool.use":
      console.log(`  [${role(ev.agent_id)}] ${ev.tool}: ${ev.input_summary}`);
      break;
    case "text.message":
      console.log(`  [${role(ev.agent_id)}] ${ev.text.replace(/\n/g, "\n      ").slice(0, 400)}`);
      break;
    case "permission.denied":
      console.log(`  ⛔ [${role(ev.agent_id)}] từ chối quyền ${ev.tool}: ${ev.reason.slice(0, 160)}`);
      break;
    case "agent.verdict":
      console.log(`  ⚑ ${ev.role}: VERDICT ${ev.verdict}`);
      break;
    case "vcs.commit":
      console.log(`  ⎇ commit trên ${ev.branch}`);
      break;
    case "api.retry":
      console.log(`  ↻ API thử lại lần ${ev.attempt}: ${ev.error}`);
      break;
    case "run.error":
      console.log(`✖ lỗi (${ev.kind}): ${ev.message}`);
      break;
    case "run.cancelled":
      console.log("■ đã hủy");
      break;
    case "run.result":
      console.log(`■ kết thúc · ok=${ev.ok} · lượt=${ev.num_turns} · ${Math.round(ev.duration_ms / 1000)}s · chi phí ước tính ${fmtUsd(ev.cost_usd_est)} (không phải hóa đơn)`);
      break;
    default:
      break;
  }
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const config = loadConfig(process.env["TNF_CONFIG"] || undefined);
  const dbPath = path.join(config.dataDir, "controller.db");

  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(
      `tnf run "<lệnh>" [--project tên] [--kind (không còn dùng, bị bỏ qua)] [--single] [--model m] [--role-model implementer=opus ...] [--max-turns N] [--budget X]\ntnf resume <run-id> "<lệnh>"\ntnf projects add <tên> --repo <đường dẫn tuyệt đối> [--base main] [--allow "Bash(pytest*)"]...\ntnf projects list\ntnf list [--q từ-khóa] [--status trạng-thái] [--project tên]\ntnf show <run-id>\ntnf cancel <run-id>\ntnf cleanup [--older-than N] [--dry-run]   (dọn worktree của run cũ; mặc định 14 ngày; nhánh tnf/<run-id> được giữ)\ntnf status\ntnf version\ntnf skill train <slug> [--yes] [--max-rounds N] [--pass-score N] [--cost-cap X]   (huấn luyện skill; chạy thật cần --yes)\ntnf serve [--port 4800] [--open]\ntnf open [--port 4800] [--print]   (mở app trong cửa sổ riêng Edge/Chrome; cần server đang chạy)\n\nTNF_FAKE_CLAUDE=1: dùng CLI giả (không tốn hạn mức). Chi phí hiển thị là ước tính, không phải hóa đơn.`,
    );
    return 0;
  }

  if (cmd === "projects") {
    const [sub, ...rest2] = rest;
    const store = new RunStore(dbPath);
    try {
      if (sub === "list" || sub === undefined) {
        for (const p of store.listProjects()) {
          console.log(`${p.name.padEnd(20)} ${p.repo_path ? `${p.repo_path} [${p.base_branch}]` : "(nhãn, không có repo)"}  runs=${p.runs}  ${fmtUsd(p.cost_usd_est)}${p.allowed_commands.length ? `  allow: ${p.allowed_commands.join(" ")}` : ""}`);
        }
        return 0;
      }
      if (sub === "add") {
        const { values, positionals } = parseArgs({ args: rest2, options: { repo: { type: "string" }, base: { type: "string" }, allow: { type: "string", multiple: true } }, allowPositionals: true });
        const name = positionals[0];
        if (!name) return usage();
        const mgr = new RunManager({ config, store });
        const input: Parameters<RunManager["addProject"]>[0] = { name, repo_path: values["repo"] ?? null };
        if (values["base"]) input.base_branch = values["base"];
        if (values["allow"]?.length) input.allowed_commands = values["allow"];
        try {
          const p = mgr.addProject(input);
          if (p.repo_path) {
            const v = mgr.validateProject(p.repo_path, p.base_branch ?? "main");
            console.log(`Đã lưu project ${p.name}: ${p.repo_path} [${p.base_branch}] · HEAD ${v.head_sha?.slice(0, 7) ?? "?"}${v.dirty ? " · cây làm việc có thay đổi chưa commit (worktree tách từ commit nên không ảnh hưởng)" : ""}`);
          } else console.log(`Đã lưu nhãn project ${p.name} (không có repo; chỉ dùng cho run research).`);
          return 0;
        } catch (e) {
          console.error(`Không thêm được project: ${(e as Error).message}`);
          return 2;
        }
      }
      return usage();
    } finally {
      store.close();
    }
  }

  if (cmd === "cleanup") {
    const store = new RunStore(dbPath);
    try {
      return await runCleanupCommand(rest, { config, store });
    } finally {
      store.close();
    }
  }

  if (cmd === "version") {
    console.log(`tnf: ${readControllerVersion(config.repoRoot)}`);
    let claudePath: string;
    try {
      claudePath = locateClaude(config.claudePath);
    } catch {
      console.log("claude: không tìm thấy");
      return 0;
    }
    const env = sanitizeEnv(process.env, "subscription");
    try {
      await queryAuthStatus(claudePath, env);
    } catch (e) {
      console.error(`Cảnh báo billing guard: ${(e as Error).message}`);
    }
    const v = readClaudeVersion(claudePath, env);
    console.log(`claude: ${v ?? "không xác định được phiên bản"}`);
    return 0;
  }

  if (cmd === "status") {
    const store = new RunStore(":memory:");
    const mgr = new RunManager({ config, store });
    try {
      const s = await mgr.authStatus();
      console.log(`Đăng nhập: ${s.loggedIn ? "có" : "không"} · phương thức: ${s.authMethod} · gói: ${s.subscriptionType ?? "?"} · claude: ${mgr.resolveClaude()}`);
      return 0;
    } catch (e) {
      console.error(`Billing guard chặn: ${(e as Error).message}`);
      return 2;
    } finally {
      store.close();
    }
  }

  if (cmd === "list") {
    const { values } = parseArgs({ args: rest, options: { q: { type: "string" }, status: { type: "string" }, project: { type: "string" } }, strict: false });
    const store = new RunStore(dbPath);
    const filter: Parameters<RunStore["listRuns"]>[0] = {};
    if (typeof values["q"] === "string") filter.q = values["q"];
    if (typeof values["status"] === "string") filter.status = values["status"] as never;
    if (typeof values["project"] === "string") filter.project = values["project"];
    for (const r of store.listRuns(filter)) {
      console.log(`${r.id}  ${new Date(r.created_at).toLocaleString("vi-VN")}  ${r.status.padEnd(9)}  ${fmtUsd(r.cost_usd_est)}  ${r.prompt.slice(0, 60)}`);
    }
    store.close();
    return 0;
  }

  if (cmd === "show") {
    const id = rest[0];
    if (!id) return usage();
    const store = new RunStore(dbPath);
    const r = store.getRun(id);
    if (!r) {
      console.error("Không tìm thấy lần chạy.");
      return 1;
    }
    console.log(JSON.stringify({ ...r, agents: undefined }, null, 2));
    printTree(r.agents);
    if (r.kind === "coding") {
      console.log(`  worktree: ${r.worktree_path} · nhánh ${r.branch} · gốc ${r.base_sha?.slice(0, 7)} · ${r.changed_files} file đổi`);
      for (const c of r.commits) console.log(`  commit ${c.hash.slice(0, 7)} ${c.subject}`);
      for (const v of r.verdicts) console.log(`  verdict ${v.role}: ${v.verdict}`);
    }
    for (const a of store.getArtifacts(id)) console.log(`  tệp: ${a.rel_path} (${a.size} B)`);
    store.close();
    return 0;
  }

  if (cmd === "run" || cmd === "resume") {
    let extraAgents: Record<string, ExtraAgentDef> | undefined;
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        single: { type: "boolean" },
        model: { type: "string" },
        "max-turns": { type: "string" },
        budget: { type: "string" },
        mode: { type: "string" },
        "role-model": { type: "string", multiple: true },
        project: { type: "string" },
        kind: { type: "string" },
        skill: { type: "string", multiple: true },
        lib: { type: "string", multiple: true },
        "agent-file": { type: "string" },
        account: { type: "string" },
        provider: { type: "string" },
      },
      allowPositionals: true,
    });
    if (values["agent-file"]) {
      try {
        extraAgents = readAgentFile(values["agent-file"]) as Record<string, ExtraAgentDef>;
      } catch (e) {
        console.error((e as Error).message);
        return 2;
      }
    }
    const store = new RunStore(dbPath);
    const fake = fakeClaudeOptions(config.repoRoot);
    const mgr = new RunManager(fake ? { config, store, ...fake } : { config, store });
    const over: Parameters<RunManager["startRun"]>[0] = { prompt: "" };
    if (values["single"]) over.roles = false;
    if (typeof values["project"] === "string") over.project = values["project"];
    // --kind is deprecated and ignored: a project with a repo always runs coding.
    if (values["kind"] && values["kind"] !== "coding" && values["kind"] !== "research") {
      console.error("--kind không còn dùng (bị bỏ qua); nếu có thì phải là coding hoặc research.");
      store.close();
      return 2;
    }
    if (values["model"]) over.model = values["model"];
    if (typeof values["account"] === "string" && values["account"]) over.accountId = values["account"];
    if (values["provider"] === "claude" || values["provider"] === "antigravity" || values["provider"] === "codex") over.provider = values["provider"];
    if (values["max-turns"]) over.maxTurns = Number(values["max-turns"]);
    if (values["budget"]) over.maxBudgetUsd = Number(values["budget"]);
    if (values["mode"] === "api" || values["mode"] === "subscription") over.mode = values["mode"];
    const roleModels: Record<string, string> = {};
    for (const spec of values["role-model"] ?? []) {
      const [role, model] = spec.split("=");
      if (role && model) roleModels[role.trim()] = model.trim();
    }
    if (Object.keys(roleModels).length) over.roleModels = roleModels;
    if (extraAgents) over.extraAgents = extraAgents;
    if (values["skill"]?.length) over.skills = values["skill"];
    if (values["lib"]?.length) over.libraryItemIds = values["lib"];

    let runId: string;
    try {
      if (cmd === "run") {
        over.prompt = positionals.join(" ");
        runId = (await mgr.startRun(over)).id;
      } else {
        const [parent, ...p] = positionals;
        if (!parent) return usage();
        const { prompt: _p, ...rest2 } = over;
        runId = (await mgr.followup(parent, p.join(" "), rest2)).id;
      }
    } catch (e) {
      console.error(`Không chạy được: ${(e as Error).message}`);
      store.close();
      return 2;
    }
    const started0 = store.getRun(runId)!;
    console.log(`run ${runId} · ${started0.kind} · thư mục run ${started0.run_dir}${started0.worktree_path ? `\nworktree ${started0.worktree_path} · nhánh ${started0.branch} · gốc ${started0.base_sha?.slice(0, 7)}` : ""}`);
    const agents = new Map<string, AgentInfo>();
    mgr.on("event", ({ run_id, stored }: { run_id: string; stored: StoredEvent }) => {
      if (run_id !== runId) return;
      const ev = stored.event;
      if (ev.type === "agent.started") agents.set(ev.agent_id, { agent_id: ev.agent_id, role: ev.role, parent_id: ev.parent_id, tool_use_id: ev.tool_use_id, status: "running", usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 } });
      liveLog(ev, agents);
    });
    const onSig = () => {
      console.log("\nĐang hủy...");
      mgr.cancel(runId);
    };
    process.on("SIGINT", onSig);
    const final = await mgr.waitFor(runId);
    process.off("SIGINT", onSig);
    if (final) {
      console.log(`\nTrạng thái: ${final.status}${final.error ? ` · ${final.error}` : ""}`);
      printTree(final.agents);
      if (final.kind === "coding") {
        console.log(`  nhánh ${final.branch} · ${final.commits.length} commit · ${final.changed_files} file đổi${final.verdicts.length ? ` · verdict: ${final.verdicts.map((v) => `${v.role}=${v.verdict}`).join(", ")}` : ""}`);
        for (const c of final.commits) console.log(`  commit ${c.hash.slice(0, 7)} ${c.subject}`);
      }
      for (const a of store.getArtifacts(runId)) console.log(`  tệp: ${a.rel_path}`);
      console.log(`Tổng token: in=${final.usage.input} out=${final.usage.output} cache_r=${final.usage.cache_read} cache_w=${final.usage.cache_write} · chi phí ước tính ${fmtUsd(final.cost_usd_est)}`);
    }
    store.close();
    return final?.status === "done" ? 0 : 1;
  }

  if (cmd === "cancel") {
    const id = rest[0];
    if (!id) return usage();
    const token = readTokenFile(config.dataDir);
    if (!token) {
      console.error("Không thấy token: server `tnf serve` chưa chạy?");
      return 2;
    }
    const base = `http://${config.server.host}:${config.server.port}`;
    const res = await fetch(`${base}/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "x-controller-token": token } }).catch((e: Error) => e);
    if (res instanceof Error) {
      console.error(`Không kết nối được server: ${res.message}`);
      return 2;
    }
    console.log(res.ok ? "Đã gửi lệnh hủy." : `Không hủy được: ${await res.text()}`);
    return res.ok ? 0 : 1;
  }

  if (cmd === "cad") {
    const sub = rest[0];
    const deps = { configuredPython: config.tools.cad.python };
    if (sub === "status") {
      const st = await cadStatus(deps);
      console.log(`Công cụ CAD: ${st.available ? "sẵn sàng" : "chưa sẵn sàng"}`);
      console.log(`  Python:   ${st.python ?? "(không thấy)"}`);
      console.log(`  ezdxf:    ${st.ezdxf ?? "(chưa có)"}`);
      console.log(`  cadquery: ${st.cadquery ?? "(chưa có)"}`);
      console.log(`  ${st.message}`);
      return st.available ? 0 : 1;
    }
    if (sub === "inspect" && rest[1]) {
      const r = await inspectCad(path.resolve(rest[1]), deps);
      if (!r.ok) {
        console.error(r.error);
        return 1;
      }
      console.log(JSON.stringify(r.summary, null, 2));
      return 0;
    }
    console.error("Cách dùng: tnf cad status | tnf cad inspect <tệp.dxf|.step|.stp>");
    return 1;
  }

  if (cmd === "open") {
    const { values } = parseArgs({ args: rest, options: { port: { type: "string" }, print: { type: "boolean" } } });
    const token = readTokenFile(config.dataDir);
    if (!token) {
      console.error("Chưa có token, hãy chạy server trước (tnf serve hoặc scripts\\start.ps1).");
      return 2;
    }
    const port = values["port"] ? Number(values["port"]) : config.server.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error("Cổng không hợp lệ.");
      return 2;
    }
    const url = `http://127.0.0.1:${port}/#token=${token}`;
    const browser = locateBrowser();
    if (browser) {
      console.log(`Mở app trong cửa sổ riêng bằng ${browser.kind === "edge" ? "Edge" : "Chrome"} (${browser.path}).`);
      if (!values["print"]) {
        spawn(browser.path, appWindowArgs(url, config.dataDir), { detached: true, stdio: "ignore", windowsHide: false }).unref();
      }
      return 0;
    }
    console.log("Không tìm thấy Edge/Chrome, mở bằng trình duyệt mặc định.");
    if (!values["print"] && process.platform === "win32") {
      spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
    return 0;
  }

  if (cmd === "serve") {
    const { values } = parseArgs({ args: rest, options: { port: { type: "string" }, open: { type: "boolean" } } });
    const opts: Parameters<typeof startServer>[0] = {};
    if (values["port"]) opts.port = Number(values["port"]);
    const fake = fakeClaudeOptions(config.repoRoot);
    if (fake) {
      opts.claudePath = fake.claudePath;
      opts.claudeArgsPrefix = fake.claudeArgsPrefix;
      opts.agyPath = fake.agyPath;
      opts.agyArgsPrefix = fake.agyArgsPrefix;
      opts.codexPath = fake.codexPath;
      opts.codexArgsPrefix = fake.codexArgsPrefix;
      opts.env = { ...fake.env, FAKE_CLAUDE_DELAY_MS: process.env["FAKE_CLAUDE_DELAY_MS"] ?? "400" };
    }
    const started = await startServer(opts);
    console.log(`TNF CLI đang chạy tại ${started.url}`);
    console.log("(Mở đúng địa chỉ trên — phần #token=... là mã truy cập, chỉ in một lần. Ctrl+C để dừng.)");
    if (values["open"] && process.platform === "win32") {
      spawn("rundll32", ["url.dll,FileProtocolHandler", started.url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        console.log("\nĐang dừng server...");
        started.close().then(resolve);
      });
    });
    return 0;
  }

  if (cmd === "accounts") {
    const store = new RunStore(dbPath);
    const fake = fakeClaudeOptions(config.repoRoot);
    const mgr = new RunManager(fake ? { config, store, ...fake } : { config, store });
    const [sub, ...subArgs] = rest;
    try {
      if (!sub || sub === "list") {
        for (const a of mgr.cliAccounts.list()) {
          console.log(`${a.isDefault ? "*" : " "} ${a.id}\t${a.provider}\t${a.enabled ? "bật" : "tắt"}\t${a.label}${a.configDir ? `\t(${a.configDir})` : ""}`);
        }
        return 0;
      }
      if (sub === "add") {
        const { values, positionals } = parseArgs({
          args: subArgs,
          options: { provider: { type: "string" }, id: { type: "string" }, model: { type: "string" }, default: { type: "boolean" }, shared: { type: "boolean" } },
          allowPositionals: true,
        });
        const label = positionals.join(" ").trim();
        const provider = (
          values["provider"] === "antigravity" ? "antigravity" : values["provider"] === "codex" ? "codex" : "claude"
        ) as "claude" | "antigravity" | "codex";
        const acc = mgr.cliAccounts.add({
          label,
          provider,
          ...(values["id"] ? { id: values["id"] } : {}),
          ...(values["model"] ? { defaultModel: values["model"] } : {}),
          ...(values["default"] ? { isDefault: true } : {}),
          isolated: !values["shared"],
        });
        console.log(`Đã thêm tài khoản CLI: ${acc.id} (${acc.provider})${acc.configDir ? ` · profile ${acc.configDir}` : ""}`);
        return 0;
      }
      if (sub === "default") {
        const id = subArgs[0];
        if (!id) { console.error("Thiếu mã tài khoản."); return 2; }
        const acc = mgr.cliAccounts.setDefault(id);
        console.log(`Đã đặt mặc định: ${acc.id} (${acc.label})`);
        return 0;
      }
      if (sub === "remove") {
        const id = subArgs[0];
        if (!id) { console.error("Thiếu mã tài khoản."); return 2; }
        const ok = mgr.cliAccounts.remove(id);
        console.log(ok ? `Đã xóa tài khoản ${id}.` : `Không tìm thấy tài khoản ${id}.`);
        return ok ? 0 : 1;
      }
      if (sub === "check") {
        const id = subArgs[0] ?? mgr.cliAccounts.getDefault().id;
        const st = await mgr.checkAccountStatus(id, true);
        console.log(JSON.stringify(st, null, 2));
        return st.loggedIn ? 0 : 1;
      }
      console.error("Dùng: tnf accounts list | add <tên> --provider claude|antigravity|codex | default <id> | check [id] | remove <id>");
      return 2;
    } catch (e) {
      console.error((e as Error).message);
      return 1;
    } finally {
      store.close();
    }
  }

  if (cmd === "skill") {
    const { runSkillCli } = await import("./cli-skill.js");
    const store = new RunStore(dbPath);
    const fake = fakeClaudeOptions(config.repoRoot);
    const mgr = new RunManager(fake ? { config, store, ...fake } : { config, store });
    try {
      return await runSkillCli(rest, { manager: mgr, fake: fake !== null });
    } finally {
      store.close();
    }
  }

  if (cmd === "w3d") {
    const { runW3DCli } = await import("./cli-w3d.js");
    const fake = fakeClaudeOptions(config.repoRoot);
    let store: RunStore | null = null;
    try {
      return await runW3DCli(rest, {
        config,
        fake: fake !== null,
        getManager: () => {
          store ??= new RunStore(dbPath);
          return new RunManager(fake ? { config, store, ...fake } : { config, store });
        },
      });
    } finally {
      (store as RunStore | null)?.close();
    }
  }

  return usage();
}

function usage(): number {
  console.error("Cách dùng: tnf help");
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
