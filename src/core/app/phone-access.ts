/**
 * "Điện thoại": open the app on a phone through Tailscale Serve (HTTPS inside the user's own tailnet, no port opened to
 * the Internet). The app finds the Tailscale CLI, reads this machine's tailnet name, runs `tailscale serve` for the
 * app port on the user's click, and allows that origin. The server itself still listens on 127.0.0.1 only.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { PhoneInfo, TailscaleInfo } from "../shared-types.js";

export type { PhoneInfo, TailscaleInfo };

export type Runner = (exe: string, args: string[], timeoutMs?: number) => { code: number; stdout: string; stderr: string };

export const realRunner: Runner = (exe, args, timeoutMs = 15_000) => {
  const r = spawnSync(exe, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, shell: false });
  if (r.error) return { code: -1, stdout: "", stderr: r.error.message };
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

/** Where tailscale.exe usually is, then the PATH. Never throws. */
export function findTailscale(run: Runner = realRunner, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env["ProgramFiles"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]]
    .filter((d): d is string => !!d)
    .map((d) => path.join(d, "Tailscale", "tailscale.exe"));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return run("tailscale", ["version"], 5000).code === 0 ? "tailscale" : null;
}

/** Parse `tailscale status --json`. Lenient: anything unexpected means not running. */
export function parseStatus(json: unknown): { running: boolean; dnsName: string | null } {
  if (typeof json !== "object" || json === null) return { running: false, dnsName: null };
  const j = json as { BackendState?: unknown; Self?: { DNSName?: unknown } };
  const dns = typeof j.Self?.DNSName === "string" ? j.Self.DNSName.replace(/\.$/, "").toLowerCase() : "";
  return { running: j.BackendState === "Running", dnsName: /^[a-z0-9.-]+$/.test(dns) && dns ? dns : null };
}

/** Does `tailscale serve status --json` already proxy this app port? */
export function isServing(serveJson: unknown, port: number): boolean {
  try {
    const text = JSON.stringify(serveJson ?? {});
    return text.includes(`127.0.0.1:${port}`) || text.includes(`localhost:${port}`);
  } catch {
    return false;
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function phoneInfo(o: { port: number; token: string; origins: readonly string[]; exe: string | null; run?: Runner }): PhoneInfo {
  const run = o.run ?? realRunner;
  const empty: PhoneInfo = { installed: false, running: false, dnsName: null, port: o.port, origin: null, serving: false, allowed: false, link: null };
  if (!o.exe) return empty;
  const st = parseStatus(tryJson(run(o.exe, ["status", "--json"], 8000).stdout));
  const origin = st.dnsName ? `https://${st.dnsName}` : null;
  const serving = st.running ? isServing(tryJson(run(o.exe, ["serve", "status", "--json"], 8000).stdout), o.port) : false;
  const allowed = !!origin && o.origins.includes(origin);
  return { installed: true, running: st.running, dnsName: st.dnsName, port: o.port, origin, serving, allowed, link: origin && allowed && serving ? `${origin}/#token=${o.token}` : null };
}

export interface ServeResult {
  ok: boolean;
  /** Vietnamese text for the user (includes the Tailscale hint, e.g. the page that turns on HTTPS). */
  message: string;
}

const HTTPS_HINT = /https:\/\/login\.tailscale\.com\/\S+/;

/** `tailscale serve --bg <port>`: HTTPS on this machine's tailnet name -> the local app. */
export function enableServe(exe: string, port: number, run: Runner = realRunner): ServeResult {
  let r = run(exe, ["serve", "--bg", "--yes", String(port)]);
  if (r.code !== 0 && /unknown flag|flag provided but not defined/i.test(r.stderr)) r = run(exe, ["serve", "--bg", String(port)]);
  if (r.code === 0) return { ok: true, message: "Đã bật Tailscale Serve." };
  const text = `${r.stdout}\n${r.stderr}`;
  const url = HTTPS_HINT.exec(text)?.[0];
  if (url) return { ok: false, message: `Tailscale chưa bật HTTPS cho mạng của bạn. Mở trang này, bật, rồi bấm lại: ${url}` };
  return { ok: false, message: `Không bật được Tailscale Serve: ${(r.stderr || r.stdout).trim().slice(0, 300) || "mã " + r.code}` };
}

export function disableServe(exe: string, run: Runner = realRunner): ServeResult {
  const r = run(exe, ["serve", "--https=443", "off"]);
  return r.code === 0 ? { ok: true, message: "Đã tắt Tailscale Serve." } : { ok: false, message: `Không tắt được: ${(r.stderr || r.stdout).trim().slice(0, 300) || "mã " + r.code}` };
}
