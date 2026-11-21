#!/usr/bin/env node
// Generates the fake-CLI streams of the 3D workshop offline acceptance test (one stream per role, two scenarios).
// Usage: node fixtures/workshop3d/make-streams.mjs [outDir]   (default: this folder; writes ok/ and fix/)
// The cad-modeler stream embeds fixtures/workshop3d-model.py verbatim, so the script and the stream never drift;
// tests/workshop3d-offline.test.ts compares the committed files with buildScenarios().
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MODEL_PY = path.join(here, "..", "workshop3d-model.py");
export const STEP_COST_USD = 0.01;

const SID = "33333333-4444-4555-8666-777777777777";
const fence = (o) => "```json\n" + JSON.stringify(o) + "\n```";

const MAT = (color, metallic, roughness, texture) => ({ color, metallic, roughness, ...(texture ? { texture } : {}) });

/** The final answer text of every role, for a small display box with three parts. */
export function roleTexts(modelPy) {
  return {
    "tiep-nhan-3d": "Đã đủ thông tin để dựng.\n" + fence({ done: true, questions: [], brief: { title: "Hộp trưng bày", object: "Hộp trưng bày có nắp và tay nắm, 400 x 300 x 200 mm", params: { rong_mm: 400, sau_mm: 300, cao_mm: 200 }, material: "gỗ sồi và inox", purpose: "trưng bày sản phẩm nhỏ", detail: "standard" } }),
    "art-director": "Phong cách tối giản, sang trọng.\n" + fence({ style: "Tối giản hiện đại: thân gỗ sồi ấm, nắp phủ sơn đen mờ, tay nắm inox sọc.", palette: ["#c9a46a", "#1a1a1a", "#c0c0c0"], materials: ["gỗ sồi", "sơn đen mờ", "inox sọc"] }),
    "detail-planner": "Bảng chi tiết ba bộ phận.\n" + fence({ bbox_mm: [400, 300, 200], tolerance_mm: 2, parts: [
      { id: "base", name: "Đế hộp", material: "gỗ sồi", dims: "400 x 300 x 120" },
      { id: "lid", name: "Nắp hộp", material: "sơn đen mờ", dims: "400 x 300 x 60" },
      { id: "handle", name: "Tay nắm", material: "inox sọc", dims: "100 x 40 x 20" },
    ] }),
    "cad-modeler": "Script dựng ba bộ phận.\n```python\n" + fs.readFileSync(modelPy, "utf8").replace(/\s+$/, "") + "\n```",
    "material-artist": fence({ materials: {
      base: MAT([0.76, 0.6, 0.38], 0, 0.55, { kind: "noise", scale: 8, angle: 0 }),
      lid: MAT([0.08, 0.08, 0.08], 0, 0.7),
      handle: MAT([0.75, 0.75, 0.78], 1, 0.25, { kind: "hairline", scale: 2, angle: 0 }),
    } }),
    "render-director": fence({ environment: "studio", exposure: 1, cameras: [
      { name: "mat_truoc", azimuth: 0, elevation: 10, distance: 1 },
      { name: "mat_sau", azimuth: 180, elevation: 10, distance: 1 },
      { name: "ba_phan_tu", azimuth: 35, elevation: 25, distance: 1 },
      { name: "chi_tiet_tay_nam", azimuth: 20, elevation: 35, distance: 0.5 },
    ] }),
    "visual-reviewer": "Đạt yêu cầu.\n" + fence({ scores: { beauty: 8, detail: 8, proportion: 9 }, ok: true, issues: [] }),
    "ar-optimizer": "Mô hình nhỏ, giữ mức mặc định thấp.\n" + fence({ max_triangles: 50000, texture_px: 1024, notes: "Mô hình đơn giản nên dùng lưới nhẹ cho điện thoại." }),
    "render-presenter": "# Hộp trưng bày\n\nĐã dựng xong ba bộ phận: đế, nắp và tay nắm (400 x 300 x 200 mm).\n\n- Đế: gỗ sồi\n- Nắp: sơn đen mờ\n- Tay nắm: inox sọc\n",
  };
}

/** Reviewer's first answer in the fix scenario: a material complaint that sends the session back to materials once. */
export const REVIEW_REJECT = "Chưa đạt.\n" + fence({ scores: { beauty: 6, detail: 7, proportion: 8 }, ok: false, issues: [{ target: "material", text: "Màu nắp quá tối, mất chi tiết viền; hãy dùng đen than có độ nhám thấp hơn." }] });

/** One stream-json replay (init, assistant, result) whose final answer is `text`. */
export function streamFor(text) {
  const usage = { input_tokens: 3, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const lines = [
    { type: "system", subtype: "init", cwd: String.raw`D:\tnf-claude-workspace\runs\fixture-workshop3d`, session_id: SID, tools: ["Read"], mcp_servers: [], model: "claude-sonnet-4-5", permissionMode: "dontAsk", slash_commands: [], apiKeySource: "none", claude_code_version: "2.1.301", output_style: "default", agents: [], skills: [], plugins: [], capabilities: {}, uuid: "b0000000-0000-4000-8000-000000000001" },
    { type: "assistant", message: { id: "msg_01", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage }, parent_tool_use_id: null, session_id: SID, uuid: "b0000000-0000-4000-8000-000000000002" },
    { type: "result", subtype: "success", is_error: false, duration_ms: 1200, duration_api_ms: 1000, num_turns: 1, result: text, session_id: SID, total_cost_usd: STEP_COST_USD, usage, permission_denials: [], uuid: "b0000000-0000-4000-8000-000000000003" },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

/** { "ok/<role>.stream.jsonl": text, "fix/<role>.stream.jsonl": text, "fix/visual-reviewer.0.stream.jsonl": text } */
export function buildScenarios(modelPy = MODEL_PY) {
  const out = {};
  for (const [role, text] of Object.entries(roleTexts(modelPy))) {
    out[`ok/${role}.stream.jsonl`] = streamFor(text);
    out[`fix/${role}.stream.jsonl`] = streamFor(text);
  }
  out["fix/visual-reviewer.0.stream.jsonl"] = streamFor(REVIEW_REJECT);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? here);
  for (const [rel, content] of Object.entries(buildScenarios())) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content, "utf8");
  }
  process.stdout.write(`written ${Object.keys(buildScenarios()).length} streams to ${dir}\n`);
}
