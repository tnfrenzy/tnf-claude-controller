import { spawn, type ChildProcess } from "node:child_process";
import { sanitizeEnv } from "../run/billing-guard.js";
import type { McpServer } from "./mcp-registry.js";

export interface ProbeResult { ok: boolean; tools: string[]; error?: string }

const STDERR_TAIL = 2000;

/** Kill the child; on Windows kill the whole tree (cmd /c npx ... leaves orphans otherwise). No shell. */
function killTree(child: ChildProcess): void {
  try {
    if (process.platform === "win32" && child.pid) {
      const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
      k.on("error", () => { try { child.kill(); } catch { /* gone */ } });
      return;
    }
    child.kill();
  } catch { /* already gone */ }
}

/** Start a stdio MCP server, run `initialize` + `tools/list` over newline-delimited JSON-RPC, then kill it. No shell. */
export function probeMcp(s: McpServer, timeoutMs = 90_000): Promise<ProbeResult> {
  if (s.kind !== "stdio" || !s.command) return Promise.resolve({ ok: false, tools: [], error: "Chỉ kiểm tra được máy chủ stdio." });
  return new Promise((resolve) => {
    let done = false;
    let errTail = "";
    const child = spawn(s.command!, s.args ?? [], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...sanitizeEnv(process.env, "subscription"), ...(s.env ?? {}) } });
    const withTail = (msg: string): string => {
      const t = errTail.trim();
      return t ? `${msg} Nhật ký lỗi: ${t.slice(-300)}` : msg;
    };
    const finish = (r: ProbeResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(child);
      resolve(r);
    };
    const fail = (msg: string): void => finish({ ok: false, tools: [], error: withTail(msg) });
    const timer = setTimeout(() => fail("Hết thời gian chờ máy chủ MCP phản hồi."), timeoutMs);
    let buf = "";
    const send = (o: unknown): void => {
      if (done || !child.stdin.writable) return;
      try { child.stdin.write(JSON.stringify(o) + "\n"); } catch { /* handled by exit/close */ }
    };
    child.stdin.on("error", () => { /* EPIPE when the child died early; close handler reports it */ });
    child.stderr.on("data", (c: Buffer) => { errTail = (errTail + c.toString("utf8")).slice(-STDERR_TAIL); });
    child.on("error", (e) => fail(`Không khởi động được máy chủ: ${e.message}`));
    child.on("close", () => fail("Máy chủ MCP thoát trước khi trả lời."));
    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m: { id?: number; error?: { message?: unknown }; result?: { tools?: Array<{ name?: unknown }> } };
        try { m = JSON.parse(line); } catch { continue; }
        if ((m.id === 1 || m.id === 2) && m.error) {
          fail(`Máy chủ MCP báo lỗi: ${typeof m.error.message === "string" ? m.error.message : "không rõ"}`);
          return;
        }
        if (m.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (m.id === 2) {
          const tools = (m.result?.tools ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string");
          finish({ ok: true, tools });
          return;
        }
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tnf-controller", version: "1" } } });
  });
}
