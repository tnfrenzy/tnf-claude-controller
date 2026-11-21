/**
 * File builders that need another program: PDF (headless Edge/Chrome prints the HTML) and STEP (CadQuery from the CAD
 * Python venv, fixed script, validated solids JSON). Both fail softly with a Vietnamese reason.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { locateBrowser } from "../app/browser-locator.js";
import { CAD_PYTHON_MISSING_MSG, defaultCadRunner, findCadPython, type CadRunner } from "../design3d/cad-tools.js";
import { STEP_SCRIPT, type Solid } from "./output-formats.js";
import { spawn } from "node:child_process";

export type RenderResult = { ok: true } | { ok: false; error: string };

export type BrowserRunner = (exe: string, args: string[], timeoutMs: number) => Promise<{ code: number | null; timedOut: boolean }>;

export const defaultBrowserRunner: BrowserRunner = (exe, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: "ignore" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut });
    });
  });

/** HTML -> PDF with the installed Edge/Chrome in headless mode. */
export async function renderPdf(html: string, outFile: string, deps: { browser?: { path: string } | null; run?: BrowserRunner; timeoutMs?: number } = {}): Promise<RenderResult> {
  const browser = deps.browser === undefined ? locateBrowser() : deps.browser;
  if (!browser) return { ok: false, error: "Không tìm thấy Edge hoặc Chrome để dựng PDF." };
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tnf-pdf-"));
  try {
    const htmlFile = path.join(tmp, "sample.html");
    await fs.promises.writeFile(htmlFile, html, "utf8");
    const args = ["--headless", "--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf-no-header", `--user-data-dir=${path.join(tmp, "profile")}`, `--print-to-pdf=${outFile}`, pathToFileURL(htmlFile).href];
    const r = await (deps.run ?? defaultBrowserRunner)(browser.path, args, deps.timeoutMs ?? 40_000);
    if (r.timedOut) return { ok: false, error: "Dựng PDF quá thời gian." };
    const st = await fs.promises.stat(outFile).catch(() => null);
    if (!st || st.size === 0) return { ok: false, error: "Trình duyệt không tạo được tệp PDF." };
    return { ok: true };
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Solids -> STEP through CadQuery. Needs the CAD Python venv (Settings > CAD tools). */
export async function renderStep(solids: Solid[], outFile: string, deps: { python?: string | null; configured?: string | null; run?: CadRunner; timeoutMs?: number } = {}): Promise<RenderResult> {
  const python = deps.python === undefined ? findCadPython(process.env, deps.configured ?? null) : deps.python;
  if (!python) return { ok: false, error: CAD_PYTHON_MISSING_MSG };
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tnf-step-"));
  try {
    const script = path.join(tmp, "make_step.py");
    const spec = path.join(tmp, "solids.json");
    await fs.promises.writeFile(script, STEP_SCRIPT, "utf8");
    await fs.promises.writeFile(spec, JSON.stringify({ solids }), "utf8");
    const r = await (deps.run ?? defaultCadRunner)(python, ["-I", script, spec, outFile], deps.timeoutMs ?? 120_000);
    if (r.timedOut) return { ok: false, error: "Dựng STEP quá thời gian." };
    const st = await fs.promises.stat(outFile).catch(() => null);
    if (r.code !== 0 || !st || st.size === 0) return { ok: false, error: `Không dựng được STEP: ${r.stderr.trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300) || "lỗi không rõ"}` };
    return { ok: true };
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
