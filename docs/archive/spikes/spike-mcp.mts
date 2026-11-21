// Spike MCP: chạy claude -p thật (haiku) để kiểm các giả định về --mcp-config. Không dùng shell, không --bare.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { locateClaude } from "../src/core/claude-locator.ts";

const claude = locateClaude();
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-spike-mcp-"));
const mcpFile = path.join(cwd, "mcp.json");
fs.writeFileSync(
  mcpFile,
  JSON.stringify({
    mcpServers: {
      "desktop-commander": { command: "cmd", args: ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@latest"] },
    },
  }),
);
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;

const base = ["-p", "--model", "haiku", "--max-turns", "2", "--output-format", "stream-json", "--verbose"];
const prompt = "Liệt kê công cụ MCP bạn có, không gọi công cụ nào.";
const variants: Record<string, string[]> = {
  A_strict_disallow_one: [...base, "--mcp-config", mcpFile, "--strict-mcp-config", "--setting-sources", "project", "--permission-mode", "bypassPermissions", "--disallowedTools", "mcp__desktop-commander__start_process"],
  B_nostrict: [...base, "--mcp-config", mcpFile, "--setting-sources", "project", "--permission-mode", "bypassPermissions"],
  C_strict_disallow_prefix: [...base, "--mcp-config", mcpFile, "--strict-mcp-config", "--setting-sources", "project", "--permission-mode", "bypassPermissions", "--disallowedTools", "mcp__desktop-commander"],
  D_variadic_check: [...base, "--mcp-config", mcpFile, "--setting-sources", "project", "--strict-mcp-config", "--permission-mode", "bypassPermissions"],
};

function run(name: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(claude, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 240000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.end(prompt);
    child.on("close", (code) => {
      clearTimeout(timer);
      console.log(`\n===== ${name} (exit ${code}) =====`);
      for (const line of out.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "system" && ev.subtype === "init") {
            console.log("mcp_servers:", JSON.stringify(ev.mcp_servers));
            const tools: string[] = ev.tools ?? [];
            const mcp = tools.filter((t) => t.startsWith("mcp__"));
            console.log(`tools total=${tools.length}; mcp__ count=${mcp.length}`);
            const byServer: Record<string, number> = {};
            for (const t of mcp) { const s = t.split("__")[1]; byServer[s] = (byServer[s] ?? 0) + 1; }
            console.log("mcp tools per server:", JSON.stringify(byServer));
            console.log("desktop-commander tools:", mcp.filter((t) => t.startsWith("mcp__desktop-commander__")).join(", "));
            console.log("start_process present:", tools.includes("mcp__desktop-commander__start_process"));
          }
          if (ev.type === "result") console.log("result:", String(ev.result).slice(0, 300), "| cost", ev.total_cost_usd);
        } catch { /* ignore */ }
      }
      if (err.trim()) console.log("stderr:", err.slice(0, 500));
      resolve();
    });
  });
}

console.log("claude:", claude, "cwd:", cwd);
for (const [n, a] of Object.entries(variants)) await run(n, a);
