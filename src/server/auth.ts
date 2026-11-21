import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";

export interface AuthPolicy {
  token: string;
  host: string;
  port: number;
  /** Extra origins (lower-case `scheme://host[:port]`, e.g. a Tailscale Serve URL); their Host values are accepted too. */
  extraOrigins?: string[];
}

/** Host header implied by an origin: `https://x.ts.net` → `x.ts.net`, `http://a:81` → `a:81`. */
export function hostOfOrigin(origin: string): string {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return "";
  }
}

export function createToken(): string {
  return randomBytes(24).toString("hex");
}

/** Persist the token to a file only the current user can read (best effort on Windows). */
export function writeTokenFile(dataDir: string, token: string): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "controller.token");
  fs.writeFileSync(file, token, { encoding: "utf8", mode: 0o600 });
  return file;
}

export function readTokenFile(dataDir: string): string | null {
  const file = path.join(dataDir, "controller.token");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
}

/** Keep the token stable across restarts: reuse a well-formed token from `controller.token`, else create one. */
export function loadOrCreateToken(dataDir: string): string {
  const saved = readTokenFile(dataDir);
  return saved && /^[0-9a-f]{48}$/.test(saved) ? saved : createToken();
}

export function allowedOrigins(p: AuthPolicy): Set<string> {
  return new Set([`http://${p.host}:${p.port}`, `http://localhost:${p.port}`, `http://127.0.0.1:${p.port}`, ...(p.extraOrigins ?? []).map((o) => o.toLowerCase())]);
}

export function allowedHosts(p: AuthPolicy): Set<string> {
  return new Set([`${p.host}:${p.port}`, `localhost:${p.port}`, `127.0.0.1:${p.port}`, ...(p.extraOrigins ?? []).map(hostOfOrigin).filter(Boolean)]);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type AuthFailure = "bad_host" | "bad_origin" | "bad_token";

/** Check Host header (DNS-rebinding guard). */
export function checkHost(req: IncomingMessage, p: AuthPolicy): boolean {
  const host = req.headers.host ?? "";
  return allowedHosts(p).has(host.toLowerCase());
}

/** Check Origin header if present (browser cross-site guard). `required` = must be present (WebSocket). */
export function checkOrigin(req: IncomingMessage, p: AuthPolicy, required: boolean): boolean {
  const origin = req.headers.origin;
  if (!origin) return !required;
  return allowedOrigins(p).has(origin.toLowerCase());
}

/** Token from `X-Controller-Token` header or `Sec-WebSocket-Protocol: tnf-token.<token>`. */
export function extractToken(req: IncomingMessage): string | null {
  const h = req.headers["x-controller-token"];
  if (typeof h === "string" && h) return h;
  const proto = req.headers["sec-websocket-protocol"];
  if (typeof proto === "string") {
    for (const part of proto.split(",").map((s) => s.trim())) {
      if (part.startsWith("tnf-token.")) return part.slice("tnf-token.".length);
    }
  }
  return null;
}

export function checkToken(req: IncomingMessage, p: AuthPolicy): boolean {
  const t = extractToken(req);
  return t !== null && safeEqual(t, p.token);
}

/** Full check for API/WS requests. Returns null when OK. */
export function authorize(req: IncomingMessage, p: AuthPolicy, opts: { originRequired: boolean }): AuthFailure | null {
  if (!checkHost(req, p)) return "bad_host";
  if (!checkOrigin(req, p, opts.originRequired)) return "bad_origin";
  if (!checkToken(req, p)) return "bad_token";
  return null;
}
