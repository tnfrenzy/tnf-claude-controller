import readline from "node:readline";
// FAKE_MCP_MODE: "" (normal) | "error" (JSON-RPC error on tools/list) | "exit" (exit at once) | "hang" (never answer) | "envecho" (tool names report whether ANTHROPIC_API_KEY / OWN_VAR are visible)
const mode = process.env.FAKE_MCP_MODE || "";
if (mode === "exit") {
  process.stderr.write("boom from fake server\n");
  process.exit(1);
}
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
rl.on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (mode === "hang") return;
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } } });
  else if (m.method === "tools/list") {
    if (mode === "envecho") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: `api_key_${process.env.ANTHROPIC_API_KEY ? "visible" : "hidden"}` }, { name: `own_${process.env.OWN_VAR ?? "none"}` }] } });
    else if (mode === "error") send({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "nope" } });
    else send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "read_file" }, { name: "write_file" }, { desc: "no name" }] } });
  }
});
