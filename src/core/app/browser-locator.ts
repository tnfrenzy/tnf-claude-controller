/**
 * Find Edge or Chrome (Windows) so the UI can open in its own app window.
 * No shell, no `where`: scans PATH, then the standard install roots.
 */
import fs from "node:fs";
import path from "node:path";

export type BrowserKind = "edge" | "chrome";
export interface BrowserInfo {
  kind: BrowserKind;
  path: string;
}

const CANDIDATES: Array<{ kind: BrowserKind; exe: string; rel: string }> = [
  { kind: "edge", exe: "msedge.exe", rel: "Microsoft\\Edge\\Application\\msedge.exe" },
  { kind: "chrome", exe: "chrome.exe", rel: "Google\\Chrome\\Application\\chrome.exe" },
];

/** Case-insensitive env lookup (Windows uses "Path"). */
function getEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === lower && env[k]) return env[k];
  }
  return undefined;
}

export function locateBrowser(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): BrowserInfo | null {
  if (platform !== "win32") return null;
  const w = path.win32;
  const pathDirs = (getEnv(env, "PATH") ?? "").split(";").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
  const roots = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].map((k) => getEnv(env, k)).filter((v): v is string => !!v);
  for (const c of CANDIDATES) {
    for (const dir of pathDirs) {
      const p = w.join(dir, c.exe);
      if (exists(p)) return { kind: c.kind, path: p };
    }
    for (const root of roots) {
      const p = w.join(root, c.rel);
      if (exists(p)) return { kind: c.kind, path: p };
    }
  }
  return null;
}

/** Arguments that open `url` as a standalone app window with a private profile under dataDir. */
export function appWindowArgs(url: string, dataDir: string): string[] {
  return [`--app=${url}`, "--window-size=1280,860", `--user-data-dir=${path.resolve(dataDir, "app-profile")}`];
}
