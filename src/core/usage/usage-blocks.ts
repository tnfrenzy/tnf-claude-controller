/**
 * Read-only token usage summary built from Claude Code's local session logs (jsonl).
 *
 * Idea source: ccusage (ryoppippi/ccusage, MIT). Its approach to 5-hour blocks (start floored
 * to the UTC hour, end = start + 5h, new block after a gap > 5h) and to de-duplication
 * (messageId:requestId) is followed here; no code is copied.
 *
 * Dependency review: I could only read the npm registry metadata (latest 20.0.48; older
 * versions list MIT with a `./data-loader` subpath export) and the GitHub README (CLI docs only,
 * no documented stable programmatic API). I could NOT read the source of the loader or of the
 * block logic. Because the loader API is undocumented, may change between majors, and the
 * package would add a dependency tree and CLI bundle weight, this module is written from scratch
 * with node:fs / node:path / node:os / node:readline. package.json is not changed.
 *
 * Exception to CLAUDE.md rule 8 (do not parse Claude Code transcript .jsonl): the user asked for
 * this explicitly. The module only READS jsonl for statistics, is never the primary source of a
 * run, and never writes to or modifies anything in the Claude config directory.
 *
 * All cost figures are ESTIMATES (costIsEstimate is always true), not an invoice.
 * Day keys (YYYY-MM-DD) are in UTC.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

export interface ModelPricing {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface ScanUsageOptions {
  claudeDir?: string;
  now?: Date;
  /** USD per million tokens, keyed by model id. */
  pricing?: Record<string, ModelPricing>;
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
  /** Estimate only; present when `pricing` matched at least one entry's model. */
  estimatedCostUsd?: number;
}

export interface DayUsage extends TokenTotals {
  day: string;
}

export interface SessionUsage extends TokenTotals {
  sessionId: string;
  firstAt: string;
  lastAt: string;
}

export interface UsageBlock extends TokenTotals {
  start: string;
  end: string;
  firstAt: string;
  lastAt: string;
  entries: number;
}

export interface UsageScan {
  byDay: DayUsage[];
  bySession: SessionUsage[];
  blocks: UsageBlock[];
  activeBlock: UsageBlock | null;
  remainingMs: number;
  skippedLines: number;
  skippedFiles: number;
  costIsEstimate: true;
}

interface Entry {
  ts: number;
  sessionId: string;
  model: string;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

const HOUR_MS = 3600_000;
const BLOCK_MS = 5 * HOUR_MS;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function listJsonl(dir: string, out: string[], counters: { skippedFiles: number }): void {
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // missing or unreadable directory: nothing to scan
  }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (it.name.toLowerCase().endsWith(".jsonl")) counters.skippedFiles++;
      else listJsonl(full, out, counters);
    } else if (it.name.toLowerCase().endsWith(".jsonl")) {
      out.push(full);
    }
  }
}

async function readFileEntries(
  file: string,
  sink: (key: string | null, e: Entry) => void,
  counters: { skippedLines: number },
): Promise<void> {
  const fallbackSession = path.basename(file, path.extname(file));
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let streamErr: unknown = null;
  stream.on("error", (err) => {
    streamErr = err;
    rl.close();
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        counters.skippedLines++;
        continue;
      }
      let rec: Record<string, unknown> | null;
      try {
        rec = obj(JSON.parse(line));
      } catch {
        counters.skippedLines++;
        continue;
      }
      const msg = obj(rec?.["message"]);
      const usage = obj(msg?.["usage"]);
      const ts = Date.parse(str(rec?.["timestamp"]));
      if (!rec || !msg || !usage || !Number.isFinite(ts)) {
        counters.skippedLines++;
        continue;
      }
      const messageId = str(msg["id"]);
      const requestId = str(rec["requestId"]);
      const key = messageId ? (requestId ? `${messageId}:${requestId}` : messageId) : null;
      sink(key, {
        ts,
        sessionId: str(rec["sessionId"]) || fallbackSession,
        model: str(msg["model"]),
        input: num(usage["input_tokens"]),
        output: num(usage["output_tokens"]),
        cacheCreation: num(usage["cache_creation_input_tokens"]),
        cacheRead: num(usage["cache_read_input_tokens"]),
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (streamErr) throw streamErr;
}

function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
}

function addEntry(t: TokenTotals, e: Entry, pricing: Record<string, ModelPricing> | undefined): void {
  t.input += e.input;
  t.output += e.output;
  t.cacheCreation += e.cacheCreation;
  t.cacheRead += e.cacheRead;
  t.total += e.input + e.output + e.cacheCreation + e.cacheRead;
  const p = pricing?.[e.model];
  if (p) {
    const cost =
      (e.input * p.input + e.output * p.output + e.cacheCreation * p.cacheCreation + e.cacheRead * p.cacheRead) /
      1_000_000;
    t.estimatedCostUsd = (t.estimatedCostUsd ?? 0) + cost;
  }
}

export async function scanUsage(opts: ScanUsageOptions = {}): Promise<UsageScan> {
  const root = opts.claudeDir ?? process.env["CLAUDE_CONFIG_DIR"] ?? path.join(os.homedir(), ".claude");
  const nowMs = (opts.now ?? new Date()).getTime();
  const counters = { skippedLines: 0, skippedFiles: 0 };

  const files: string[] = [];
  listJsonl(path.join(root, "projects"), files, counters);
  files.sort();

  const keyed = new Map<string, Entry>();
  const unkeyed: Entry[] = [];
  const sink = (key: string | null, e: Entry): void => {
    if (key === null) {
      unkeyed.push(e);
      return;
    }
    const prev = keyed.get(key);
    if (!prev || e.output > prev.output) keyed.set(key, e);
  };

  for (const file of files) {
    try {
      await readFileEntries(file, sink, counters);
    } catch {
      counters.skippedFiles++; // EBUSY / EPERM / ENOENT mid-scan: skip this file only
    }
  }

  const entries = [...keyed.values(), ...unkeyed].sort((a, b) => a.ts - b.ts);

  const days = new Map<string, DayUsage>();
  const sessions = new Map<string, SessionUsage>();
  const blocks: UsageBlock[] = [];
  let cur: UsageBlock | null = null;
  let curEnd = 0;
  let lastTs = 0;

  for (const e of entries) {
    const iso = new Date(e.ts).toISOString();
    const dayKey = iso.slice(0, 10);
    let d = days.get(dayKey);
    if (!d) days.set(dayKey, (d = { day: dayKey, ...emptyTotals() }));
    addEntry(d, e, opts.pricing);

    let s = sessions.get(e.sessionId);
    if (!s) sessions.set(e.sessionId, (s = { sessionId: e.sessionId, firstAt: iso, lastAt: iso, ...emptyTotals() }));
    s.lastAt = iso;
    addEntry(s, e, opts.pricing);

    if (!cur || e.ts >= curEnd || e.ts - lastTs > BLOCK_MS) {
      const startMs = Math.floor(e.ts / HOUR_MS) * HOUR_MS;
      curEnd = startMs + BLOCK_MS;
      cur = {
        start: new Date(startMs).toISOString(),
        end: new Date(curEnd).toISOString(),
        firstAt: iso,
        lastAt: iso,
        entries: 0,
        ...emptyTotals(),
      };
      blocks.push(cur);
    }
    cur.lastAt = iso;
    cur.entries++;
    addEntry(cur, e, opts.pricing);
    lastTs = e.ts;
  }

  let activeBlock: UsageBlock | null = null;
  const last = blocks[blocks.length - 1];
  if (last) {
    const endMs = Date.parse(last.end);
    const lastAtMs = Date.parse(last.lastAt);
    if (nowMs < endMs && nowMs - lastAtMs <= BLOCK_MS) activeBlock = last;
  }
  const remainingMs = activeBlock ? Math.max(0, Date.parse(activeBlock.end) - nowMs) : 0;

  return {
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    bySession: [...sessions.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt)),
    blocks,
    activeBlock,
    remainingMs,
    skippedLines: counters.skippedLines,
    skippedFiles: counters.skippedFiles,
    costIsEstimate: true,
  };
}
