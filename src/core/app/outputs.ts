import fs from "node:fs";
import path from "node:path";

export function defaultOutputDir(workspaceDir: string): string {
  return path.join(workspaceDir, "outputs");
}

/** Absolute, ASCII (CLAUDE.md rule 10), no `..`; creates the directory and proves it is writable. Returns the resolved path. */
export function validateOutputDir(p: unknown): string {
  if (typeof p !== "string" || !p.trim()) throw new Error("Thiếu đường dẫn thư mục lưu tệp.");
  const s = p.trim();
  if (!path.isAbsolute(s)) throw new Error("Thư mục lưu tệp phải là đường dẫn tuyệt đối.");
  if (s.split(/[\\/]/).includes("..")) throw new Error('Đường dẫn không được chứa "..".');
  if (!/^[\x20-\x7E]+$/.test(s)) throw new Error("Đường dẫn chỉ nên dùng ký tự ASCII không dấu (quy ước của app).");
  const abs = path.resolve(s);
  try {
    fs.mkdirSync(abs, { recursive: true });
    const probe = path.join(abs, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe);
  } catch (e) {
    throw new Error(`Không ghi được vào thư mục này: ${e instanceof Error ? e.message : String(e)}`);
  }
  return abs;
}

export function resolveInside(base: string, rel: string): string | null {
  const abs = path.resolve(base, rel);
  const root = path.resolve(base) + path.sep;
  return abs.startsWith(root) ? abs : null;
}

/** Copy each artifact of a run to `<outDir>/<runId>/<rel>`; only newer/different files are copied. Returns the number copied; a file that fails to copy is skipped. */
/** Run bookkeeping that is never a deliverable: not mirrored into the output folder. */
const NOT_DELIVERABLE = new Set(["stream.jsonl", "system-prompt.md"]);

export function syncRunOutputs(runDir: string, outDir: string, runId: string, artifacts: Array<{ rel_path: string }>): number {
  const destRoot = path.join(outDir, runId);
  let copied = 0;
  for (const a of artifacts) {
    if (NOT_DELIVERABLE.has(path.basename(a.rel_path))) continue;
    try {
      const src = resolveInside(runDir, a.rel_path);
      const dst = resolveInside(destRoot, a.rel_path);
      if (!src || !dst || !fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
      const s = fs.statSync(src);
      if (fs.existsSync(dst)) {
        const d = fs.statSync(dst);
        if (d.size === s.size && d.mtimeMs >= s.mtimeMs) continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied++;
    } catch {
      // one locked/unreadable file must not stop the others
    }
  }
  return copied;
}

/** Explorer arguments: a folder, or `/select,"<file>"` to highlight one file (needs windowsVerbatimArguments). */
export function explorerArgs(target: string, selectFile: boolean): string[] {
  return selectFile ? [`/select,"${target}"`] : [target];
}
