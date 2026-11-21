import { useId, useMemo, useState } from "react";
import { fmtQuota } from "./AgentTree";
import { fmtQuotaRange } from "../../run/quotaFormat";
import { roleLabel, statusLabel, useT } from "../../i18n";
import { loadRunTreeOpen, saveRunTreeOpen } from "../../lib/prefs";
import { groupRoles, metaParts, projectHue, statusVisual } from "../../run/runRow";
import { buildRunTree, threadIsOpen, type RunThread } from "../../run/runTree";
import type { RunRecord } from "../../types";

function openRun(id: string): void {
  location.hash = `/runs/${encodeURIComponent(id)}`;
}

const when = (ms: number) => new Date(ms).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

/**
 * Shared run list: one row per thread (root run + its follow-ups / continue-from-commit runs). Rows with replies get
 * a disclosure button; replies sit indented under the root, labelled "Phản hồi 1, 2…", each opening its own run.
 * Collapsed by default, a thread with a running reply opens itself, the user's choice is remembered (prefs).
 */
export function RunTree({ runs, showProject = true }: { runs: RunRecord[]; showProject?: boolean }) {
  const threads = useMemo(() => buildRunTree(runs), [runs]);
  const [saved, setSaved] = useState<Record<string, boolean>>(() => loadRunTreeOpen());
  const anyReplies = threads.some((th) => th.replies.length > 0);
  return (
    <ul className={`run-list${anyReplies ? " has-threads" : ""}`}>
      {threads.map((th) => (
        <ThreadItem
          key={th.root.id}
          th={th}
          open={threadIsOpen(th, saved)}
          onToggle={(open) => setSaved(saveRunTreeOpen(th.root.id, open))}
          showProject={showProject}
          gutter={anyReplies}
        />
      ))}
    </ul>
  );
}

function ThreadItem(props: { th: RunThread<RunRecord>; open: boolean; onToggle: (open: boolean) => void; showProject: boolean; gutter: boolean }) {
  const { th, open, onToggle, showProject, gutter } = props;
  const { t } = useT();
  const listId = useId();
  const n = th.replies.length;
  const toggleLabel = open ? t.tree_collapse : t.tree_expand;
  return (
    <li className="run-thread">
      <div className="run-thread-head">
        {n > 0 ? (
          <button
            type="button"
            className={`run-toggle${open ? " open" : ""}`}
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${toggleLabel} (${t.tree_replies.replace("{n}", String(n))})`}
            title={toggleLabel}
            onClick={() => onToggle(!open)}
          >
            <span aria-hidden="true" />
          </button>
        ) : gutter ? (
          <span className="run-toggle-gap" aria-hidden="true" />
        ) : null}
        <RunRow run={th.root} showProject={showProject} thread={n > 0 ? th : null} />
      </div>
      {n > 0 && open ? (
        <ul className="run-replies" id={listId}>
          {th.replies.map((r, i) => (
            <li key={r.id}>
              <RunRow run={r} showProject={false} replyNo={i + 1} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One run card (root or reply). Clicking or Enter opens the run popup via #/runs/<id>. */
export function RunRow(props: { run: RunRecord; showProject: boolean; replyNo?: number; thread?: RunThread<RunRecord> | null }) {
  const { run: r, showProject, replyNo, thread } = props;
  const { t, lang } = useT();
  const sv = statusVisual(r.status);
  const label = statusLabel(t, r.status);
  const roles = groupRoles(r.agents.filter((a) => a.role !== "coordinator").map((a) => a.role));
  const meta = metaParts(r, () => `${t.quota_5h}: ${fmtQuotaRange(r.quota_start, r.quota_end, r.quota_pct)}` + (r.quota7_start != null ? ` · ${t.quota_week}: ${fmtQuotaRange(r.quota7_start, r.quota7_end, r.quota7_pct)}` : ""), when);
  const isReply = replyNo != null;
  // A root whose parent is not in the list (other page / filtered out) keeps the old "↩" hint.
  const orphanHint = !isReply && (r.parent_run_id || r.forked_from_run_id) ? " · ↩" : "";
  const resumed = isReply && !r.parent_run_id && r.forked_from_run_id && r.project !== "workshop3d";
  const latest = thread ? thread.replies[thread.replies.length - 1] : undefined;
  const latestSv = latest ? statusVisual(latest.status) : null;
  const threadQuota = thread ? [thread.root, ...thread.replies].reduce((s, x) => s + (x.quota_pct ?? 0), 0) : 0;
  return (
    <div
      className={`run-card clickable${isReply ? " run-reply" : ""}`}
      tabIndex={0}
      role="link"
      onClick={() => openRun(r.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") openRun(r.id);
      }}
    >
      <span className={`run-ico ${sv.tone}${sv.pulse ? " pulse" : ""}`} role="img" aria-label={label} title={label}>{sv.icon}</span>
      <div className="run-main">
        {isReply ? <span className="run-reply-no">↳ {t.tree_reply.replace("{n}", String(replyNo))}{resumed ? ` · ${t.tree_resume}` : ""}</span> : null}
        <div className="run-prompt" title={r.prompt}>{r.prompt}</div>
        <div className="run-meta">
          {roles.items.map((g) => (
            <span key={g.role} className="run-role">{roleLabel(g.role, lang === "en" ? "en" : "vi")}{g.count > 1 ? ` ×${g.count}` : ""}</span>
          ))}
          {roles.more > 0 ? <span className="run-role">+{roles.more}</span> : null}
          <span className="run-meta-line" title={t.cost_note}>{meta.join(" · ")}{orphanHint}</span>
          {thread && latestSv ? (
            <span className={`run-count ${latestSv.tone}`} title={`${t.tree_total}: ${fmtQuota(threadQuota)} · ${t.cost_note}`}>
              {latestSv.pulse ? <span className="live-dot" /> : null}
              {t.tree_replies.replace("{n}", String(thread.replies.length))} · {t.tree_total} {fmtQuota(threadQuota)}
            </span>
          ) : null}
        </div>
      </div>
      {showProject && r.project !== "default" ? (
        <span className="run-chip" style={{ "--h": projectHue(r.project) } as React.CSSProperties} title={t.project}>{r.project}</span>
      ) : null}
      <span className="arrow" aria-hidden="true">→</span>
    </div>
  );
}
