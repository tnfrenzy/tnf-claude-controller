import { Fragment, useMemo, useState, type ReactNode } from "react";
import { numberLines, type DiffComment } from "../../run/diffComments.js";

export interface DiffFile {
  path: string;
  /** Header lines (diff --git, index, ---, +++). */
  header: string[];
  lines: { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string }[];
  added: number;
  deleted: number;
}

/** Split a unified `git diff` into per-file sections (tolerant: unknown lines become "meta"). */
export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  for (const raw of patch.split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      cur = { path: m?.[2] ?? raw.slice(11), header: [raw], lines: [], added: 0, deleted: 0 };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (cur.lines.length === 0 && (raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("new file") || raw.startsWith("deleted file") || raw.startsWith("similarity") || raw.startsWith("rename") || raw.startsWith("old mode") || raw.startsWith("new mode") || raw.startsWith("Binary files"))) {
      cur.header.push(raw);
      continue;
    }
    if (raw.startsWith("@@")) cur.lines.push({ kind: "hunk", text: raw });
    else if (raw.startsWith("+")) { cur.lines.push({ kind: "add", text: raw }); cur.added++; }
    else if (raw.startsWith("-")) { cur.lines.push({ kind: "del", text: raw }); cur.deleted++; }
    else if (raw.startsWith(" ") || raw === "") cur.lines.push({ kind: "ctx", text: raw });
    else cur.lines.push({ kind: "meta", text: raw });
  }
  return files;
}

export interface StatRow { path: string; added: number; deleted: number; }

/** Parse `git diff --stat` output ("path | 12 +++---"). The summary line is returned separately. */
export function parseDiffStat(text: string): { rows: StatRow[]; summary: string } {
  const rows: StatRow[] = [];
  let summary = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s+\|\s+(\d+|Bin)(?:\s+(.*))?$/.exec(line);
    if (m) {
      const marks = m[3] ?? "";
      const added = (marks.match(/\+/g) ?? []).length;
      const deleted = (marks.match(/-/g) ?? []).length;
      rows.push({ path: m[1]!.trim(), added, deleted });
    } else if (/files? changed|insertion|deletion/.test(line)) summary = line;
  }
  return { rows, summary };
}

/** Drop only the very last empty ctx element (artifact of the trailing newline); mid-hunk empty ctx lines stay. */
export function trimTrailingEmpty(lines: DiffFile["lines"]): DiffFile["lines"] {
  const last = lines[lines.length - 1];
  if (last && last.kind === "ctx" && last.text === "") return lines.slice(0, -1);
  return lines;
}

export interface DiffViewProps {
  patch: string;
  onLineClick?: (file: string, line: number, side: "new" | "old") => void;
  comments?: DiffComment[];
  /** Extra content rendered right below a clickable line (e.g. an inline comment box). Only used with onLineClick. */
  renderAfterLine?: (file: string, line: number, side: "new" | "old") => ReactNode | null;
}

export function DiffView({ patch, onLineClick, comments, renderAfterLine }: DiffViewProps) {
  const files = useMemo(() => parsePatch(patch), [patch]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (files.length === 0) return <pre className="mono diff-raw">{patch}</pre>;
  const isOpen = (p: string, i: number) => open[p] ?? i < 6;
  return (
    <div className="diff">
      {files.map((f, i) => (
        <details key={f.path} open={isOpen(f.path, i)} onToggle={(e) => setOpen((o) => ({ ...o, [f.path]: (e.target as HTMLDetailsElement).open }))} className="diff-file">
          <summary>
            <span className="mono">{f.path}</span>
            <span className="diff-counts"><span className="add">+{f.added}</span> <span className="del">−{f.deleted}</span></span>
          </summary>
          <pre className="mono diff-body">
            {onLineClick
              ? numberLines(trimTrailingEmpty(f.lines)).map((l, j) => {
                  const side: "new" | "old" = l.kind === "del" ? "old" : "new";
                  const num = l.kind === "del" ? l.oldLine : l.newLine;
                  const clickable = (l.kind === "add" || l.kind === "del" || l.kind === "ctx") && num !== null;
                  const has = clickable && (comments ?? []).some((c) => c.file === f.path && c.line === num && c.side === side);
                  const cls = `dl ${l.kind}${clickable ? " clickable" : ""}${has ? " has-comment" : ""}`;
                  const after = clickable && renderAfterLine ? renderAfterLine(f.path, num as number, side) : null;
                  return (
                    <Fragment key={j}>
                    <div
                      className={cls}
                      data-line={clickable ? num : undefined}
                      data-side={clickable ? side : undefined}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => onLineClick(f.path, num as number, side) : undefined}
                      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLineClick(f.path, num as number, side); } } : undefined}
                    >
                      <span className="ln">{clickable ? num : ""}</span>
                      <span className="lt">{l.text || " "}</span>
                    </div>
                    {after != null ? <div className="dl-inline">{after}</div> : null}
                    </Fragment>
                  );
                })
              : f.lines.map((l, j) => (
                  <div key={j} className={`dl ${l.kind}`}>{l.text || " "}</div>
                ))}
          </pre>
        </details>
      ))}
    </div>
  );
}
