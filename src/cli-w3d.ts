/**
 * `tnf w3d run "<mô tả>" [--yes] | list | show <slug> | answer <slug> "<text>" | pause|resume|stop <slug> | fetch-assets [--yes]`
 * `fetch-assets` lists the Poly Haven CC0 assets of config/polyhaven-assets.json with their size; only --yes downloads them
 * into <dataDir>/library/polyhaven/ (the Blender high-quality render uses them; nothing is ever fetched by the app itself).
 * With a running `tnf serve` the commands go through its API (the server owns the session loop).
 * Without one, `run` / `answer` / `resume` build the engine directly and wait until the session needs the user or ends.
 * Real runs spend subscription quota, so they need --yes and pass the billing guard (TNF_FAKE_CLAUDE=1 needs neither).
 */
import { parseArgs } from "node:util";
import type { ControllerConfig } from "./core/app/config.js";
import type { RunManager } from "./core/run/run-manager.js";
import { CAD_PYTHON_MISSING_MSG, findCadPython } from "./core/design3d/cad-tools.js";
import { createW3DStore } from "./core/workshop3d/store.js";
import { createWorkshop3D, type Workshop3DEngine } from "./core/workshop3d/index.js";
import { W3DError } from "./core/workshop3d/state.js";
import { readTokenFile } from "./server/auth.js";

export interface W3DCliDeps {
  config: ControllerConfig;
  /** Builds the RunManager (only called when the engine is needed directly). */
  getManager: () => RunManager;
  fake: boolean;
  log?: (line: string) => void;
  err?: (line: string) => void;
  fetch?: typeof fetch;
  /** Poly Haven access for fetch-assets (tests inject fakes). */
  polyhaven?: { getJson: (url: string) => Promise<unknown>; getBytes: (url: string) => Promise<Uint8Array> };
  /** CAD python lookup for the preflight of `run` (default: TNF_CAD_PYTHON, tools.cad.python, then the usual venvs). */
  findPython?: () => string | null;
}

const USAGE = 'Cách dùng: tnf w3d run "<mô tả>" [--yes] | list | show <slug> | answer <slug> "<câu trả lời>" | pause|resume|stop <slug> | fetch-assets [--yes]';

export async function runW3DCli(args: string[], deps: W3DCliDeps): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const doFetch = deps.fetch ?? fetch;
  const { config } = deps;
  const [sub, ...rest] = args;
  const { values, positionals } = parseArgs({ args: rest, options: { yes: { type: "boolean" } }, allowPositionals: true });
  const store = createW3DStore(config.dataDir);

  const showOne = (slug: string): number => {
    const rec = store.get(slug);
    if (!rec) {
      err("Không tìm thấy phiên dựng 3D.");
      return 1;
    }
    const s = rec.snapshot;
    log(`${rec.brief.title} (${slug})`);
    log(`Trạng thái: ${s.state} · vòng ${s.round} · chi phí ước tính $${s.costUsd.toFixed(2)} (không phải hóa đơn)`);
    if (s.note) log(`Ghi chú: ${s.note}`);
    if (s.error) log(`Lỗi: ${s.error}`);
    if (s.state === "awaiting_user") for (const q of s.questions) log(`  Câu hỏi: ${q}`);
    for (const f of [...store.listFiles(slug, "outputs"), ...store.listFiles(slug, "renders")]) log(`  tệp: ${f}`);
    return 0;
  };

  if (sub === "list") {
    const items = store.list();
    if (items.length === 0) log("Chưa có phiên dựng 3D nào.");
    for (const i of items) log(`${i.slug}  ${i.state.padEnd(14)} $${i.costUsd.toFixed(2)}  ${i.title}`);
    return 0;
  }
  if (sub === "fetch-assets") {
    const ph = await import("./core/workshop3d/polyhaven.js");
    const list = ph.loadPolyHavenList(config.repoRoot);
    const dir = ph.polyhavenDir(config.dataDir);
    const io = deps.polyhaven ?? { getJson: ph.httpGetJson, getBytes: ph.httpGetBytes };
    log(`Tài nguyên Poly Haven (${list.license}) cho render chất lượng cao, lưu vào ${dir}:`);
    const plan = await ph.planFetch(list, dir, io.getJson);
    for (const a of plan.assets) {
      if (a.error) {
        log(`  ${a.spec.id}: không lấy được danh sách tệp (${a.error})`);
        continue;
      }
      const mb = a.files.filter((f) => !f.present).reduce((n, f) => n + f.size, 0) / 1024 / 1024;
      log(`  ${a.spec.id} (${a.spec.name}, ${a.spec.res}): ${mb > 0 ? `${mb.toFixed(1)} MB cần tải` : "đã có"} · ${list.source}/a/${a.spec.id}`);
    }
    log(`Tổng cần tải: ${(plan.downloadBytes / 1024 / 1024).toFixed(1)} MB.`);
    if (plan.downloadBytes === 0 && plan.assets.every((a) => !a.error)) {
      await ph.runFetch(plan, list, dir, io.getBytes, log); // rewrites meta.json only
      log("Đã đủ tài nguyên.");
      return 0;
    }
    if (!values.yes) {
      log("Chưa tải gì. Thêm --yes để tải (chỉ tải khi bạn xác nhận).");
      return 0;
    }
    const errors = await ph.runFetch(plan, list, dir, io.getBytes, log);
    for (const e of errors) err(`Lỗi: ${e}`);
    log(errors.length === 0 ? "Đã tải xong." : `Xong, ${errors.length} lỗi (chạy lại lệnh để thử tiếp).`);
    return errors.length === 0 ? 0 : 1;
  }
  if (sub === "show") {
    if (!positionals[0]) return (err(USAGE), 1);
    return showOne(positionals[0]);
  }
  const needsSlug = sub === "answer" || sub === "pause" || sub === "resume" || sub === "stop";
  if (sub !== "run" && !needsSlug) return (err(USAGE), 1);
  const slugArg = positionals[0];
  if (needsSlug && !slugArg) return (err("Thiếu <slug> của phiên."), 1);
  const text = sub === "run" ? positionals.join(" ").trim() : positionals.slice(1).join(" ").trim();
  if ((sub === "run" || sub === "answer") && !text) return (err(sub === "run" ? "Thiếu mô tả vật thể." : "Thiếu câu trả lời."), 1);

  // A running server owns the session loop: talk to it when it answers.
  const token = readTokenFile(config.dataDir);
  if (token) {
    const base = `http://${config.server.host}:${config.server.port}`;
    const path = sub === "run" ? "/api/workshop3d" : `/api/workshop3d/${encodeURIComponent(slugArg!)}/${sub}`;
    const body = sub === "run" ? { prompt: text } : sub === "answer" ? { text } : {};
    const res = await doFetch(`${base}${path}`, { method: "POST", headers: { "x-controller-token": token, "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (res) {
      const data = (await res.json().catch(() => ({}))) as { slug?: string; message?: string };
      if (!res.ok) {
        err(data.message ?? `Server trả lỗi ${res.status}.`);
        return 1;
      }
      log(sub === "run" ? `Đã tạo phiên ${data.slug}. Theo dõi: tnf w3d show ${data.slug}` : "Đã gửi.");
      return 0;
    }
  }

  // Direct mode.
  const slugOut = slugArg ?? "";
  // Preflight (the server does the same on POST): without the CAD python a session only fails at the build step.
  if (sub === "run" && !(deps.findPython ?? (() => findCadPython(process.env, config.tools?.cad?.python ?? null)))()) {
    err(CAD_PYTHON_MISSING_MSG);
    return 1;
  }
  if (!deps.fake && (sub === "run" || sub === "answer" || sub === "resume")) {
    if (!values["yes"]) {
      err("Dựng 3D thật tốn hạn mức thuê bao. Thêm --yes để xác nhận (hoặc TNF_FAKE_CLAUDE=1 để chạy thử).");
      return 2;
    }
    try {
      await deps.getManager().authStatus();
    } catch (e) {
      err(`Billing guard chặn: ${(e as Error).message}`);
      return 2;
    }
  }
  let engine: Workshop3DEngine;
  try {
    const manager = deps.getManager();
    engine = createWorkshop3D({ manager, dataDir: config.dataDir, config });
  } catch (e) {
    err(`Không khởi tạo được xưởng 3D: ${(e as Error).message}`);
    return 2;
  }
  try {
    let slug = slugOut;
    if (sub === "run") {
      slug = engine.runner.start({ title: text.slice(0, 60), object: text, params: {}, detail: "high", attachments: [] });
      log(`Đã tạo phiên ${slug}.`);
    } else if (sub === "answer") engine.runner.answer(slug, text);
    else if (sub === "pause") engine.runner.pause(slug);
    else if (sub === "resume") engine.runner.resume(slug);
    else engine.runner.stop(slug);
    if (sub === "pause" || sub === "stop") {
      err("Không có máy chủ đang chạy: chỉ ghi trạng thái; nếu app đang chạy phiên này ở tiến trình khác, hãy dừng từ giao diện hoặc khởi động lại.");
    }
    await engine.runner.idle(slug);
    return showOne(slug);
  } catch (e) {
    err(e instanceof W3DError ? e.message : `Lỗi: ${(e as Error).message}`);
    return 1;
  }
}
