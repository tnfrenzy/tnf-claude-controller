import type { PreviewConfigView, PreviewShotView, PreviewStateView } from "../api";

export function groupShots(shots: PreviewShotView[]): Array<{ label: string; items: PreviewShotView[] }> {
  const groups: Array<{ label: string; items: PreviewShotView[] }> = [];
  for (const s of shots) {
    let g = groups.find((x) => x.label === s.label);
    if (!g) { g = { label: s.label, items: [] }; groups.push(g); }
    g.items.push(s);
  }
  for (const g of groups) g.items.sort((a, b) => a.width - b.width);
  return groups;
}

/** Cache key for one screenshot: file names repeat across captures, so the capture time is part of the key. */
export function shotCacheKey(runId: string, file: string, finishedAt: number | null | undefined): string {
  return `${runId}:${file}:${finishedAt ?? 0}`;
}

export function previewTabVisible(coding: boolean, project: string | null): boolean {
  return coding && !!project;
}

/** A web capture needs the run to be finished (the server refuses while it is running/queued); desktop captures are exempt. */
export function runBlocksPreview(runStatus: string | null | undefined, kind: "none" | "web" | "desktop"): boolean {
  return kind === "web" && (runStatus === "running" || runStatus === "queued");
}

export function canStart(state: PreviewStateView, grantOn: boolean, runBlocked = false): boolean {
  return state.status !== "running" && grantOn && !runBlocked;
}

export interface PreviewForm {
  kind: "none" | "web" | "desktop";
  startCommand: string; url: string; pagesText: string; readyTimeoutSec: string;
  exePath: string; argsText: string; windowTitle: string; settleSec: string;
}

export function configToForm(c: PreviewConfigView): PreviewForm {
  const base: PreviewForm = { kind: "none", startCommand: "", url: "", pagesText: "", readyTimeoutSec: "", exePath: "", argsText: "", windowTitle: "", settleSec: "" };
  if (c.kind === "web") return { ...base, kind: "web", startCommand: c.startCommand, url: c.url, pagesText: c.pages.join("\n"), readyTimeoutSec: c.readyTimeoutSec === undefined ? "" : String(c.readyTimeoutSec) };
  if (c.kind === "desktop") return { ...base, kind: "desktop", exePath: c.exePath, argsText: c.args.join("\n"), windowTitle: c.windowTitle, settleSec: c.settleSec === undefined ? "" : String(c.settleSec) };
  return base;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

function num(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function formToConfig(f: PreviewForm): PreviewConfigView {
  if (f.kind === "web") {
    const out: PreviewConfigView = { kind: "web", startCommand: f.startCommand.trim(), url: f.url.trim(), pages: lines(f.pagesText) };
    const n = num(f.readyTimeoutSec);
    if (n !== undefined) out.readyTimeoutSec = n;
    return out;
  }
  if (f.kind === "desktop") {
    const out: PreviewConfigView = { kind: "desktop", exePath: f.exePath.trim(), args: lines(f.argsText), windowTitle: f.windowTitle.trim() };
    const n = num(f.settleSec);
    if (n !== undefined) out.settleSec = n;
    return out;
  }
  return { kind: "none" };
}

/** Same tokenizing as the server's splitCommand: "double quoted" parts may contain spaces; no escapes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]!);
  return out;
}

/** True when a web start command would be rejected by the server: only npm/npx/pnpm/yarn (cmd shims) are checked for shell metacharacters. */
export function hasShellMeta(cmd: string): boolean {
  const tokens = splitCommand(cmd);
  if (tokens.length === 0 || !/^(npm|npx|pnpm|yarn)(\.cmd)?$/i.test(tokens[0]!)) return false;
  return tokens.some((t) => /[&|<>^%!"()\r\n]/.test(t));
}
