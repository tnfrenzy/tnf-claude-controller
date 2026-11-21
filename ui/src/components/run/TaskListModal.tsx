import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { activeCommands, groupByIdea, ideaActions, ideaCommitRunId, ideaHeading, ideasNewestFirst, taskStatusLabel } from "../../queue/ideaGroups";
import { IdeaHistoryModal } from "../queue/IdeaHistoryModal";
import { MergePrecheckBadge } from "./MergePrecheckBadge";
import { shouldShowQueueMergePrecheck } from "../../run/mergePrecheckVisible";
import { buttonStates, recoveryActions, runAllButtonState } from "../../queue/queue";
import { cancelQueuePause, isQueuePaused } from "../../queue/quotaPause";
import { QueuePausedNotice } from "./QueuePausedNotice";
import type { QueueStatus, QueueView } from "../../types";

export function TaskListModal(props: { project: string }) {
  const { project } = props;
  const { t } = useT();
  const [view, setView] = useState<QueueView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.queue(project));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => clearInterval(id);
  }, [load]);

  const groups = useMemo(() => ideasNewestFirst(groupByIdea(view?.commands ?? [])), [view]);
  const runAll = view?.runAll;
  const active = runAll?.active === true;
  const btn = runAllButtonState(active, groups.length);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    await load();
  };

  return (
    <div className="task-list">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        {btn.mode === "stop" ? (
          <button type="button" className="mini" onClick={() => void act(() => api.queueRunAllStop(project))}>{t.taskList_stop}</button>
        ) : (
          <button type="button" className="mini" disabled={btn.disabled} onClick={() => void act(() => api.queueRunAll(project))}>{t.taskList_runAll}</button>
        )}
        {runAll && (
          <span className="fine">
            {active ? t.taskList_active : t.taskList_idle} · {t.taskList_running}: {runAll.running.length} · {t.taskList_committed}: {runAll.committed.length} · {t.taskList_failed}: {runAll.failed.length} · {t.taskList_blocked}: {runAll.blocked.length}
          </span>
        )}
      </div>
      {runAll && isQueuePaused(runAll, Date.now()) && (
        <QueuePausedNotice
          pausedUntil={runAll.pausedUntil as number}
          pauseReason={runAll.pauseReason}
          pauseRunId={runAll.pauseRunId}
          onCancel={() => void act(() => cancelQueuePause(api, runAll, async () => {}))}
        />
      )}
      {runAll?.lastError &&<div className="fine" style={{ color: "var(--err)" }}>{runAll.lastError}</div>}
      {err && <div className="fine" style={{ color: "var(--err)" }}>{err}</div>}
      {view && groups.length === 0 && <div className="fine">{t.taskList_empty}</div>}
      {groups.map((g, i) => {
        const key = `${g.project}\u0000${g.key}`;
        const isOpen = open[key] === true;
        const summary = Object.entries(g.counts).map(([s, n]) => `${taskStatusLabel(s as QueueStatus)}: ${n}`).join(", ");
        const commitRun = ideaCommitRunId(g);
        const activeList = activeCommands(g);
        const acts = ideaActions(g, runAll);
        const stop = (e: { preventDefault: () => void; stopPropagation: () => void }) => { e.preventDefault(); e.stopPropagation(); };
        return (
          <details
            key={key}
            open={isOpen}
            style={{ marginBottom: 6 }}
            onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== isOpen) setOpen((m) => ({ ...m, [key]: o })); }}
          >
            <summary>
              {ideaHeading(g, i)} ({activeList.length}){summary ? ` · ${summary}` : ""}{" "}
              <button type="button" className="mini" disabled={acts.approveAll.disabled} onClick={(e) => { stop(e); void act(() => api.queueApproveAll(project, g.key)); }}>{t.idea_approveAll}</button>{" "}
              {acts.runAll.mode === "stop" ? (
                <button type="button" className="mini" onClick={(e) => { stop(e); void act(() => api.queueRunAllStop(project)); }}>{t.idea_stop}</button>
              ) : (
                <button type="button" className="mini" disabled={acts.runAll.disabled} onClick={(e) => { stop(e); void act(() => api.queueRunAll(project, g.key)); }}>{t.idea_runAll}</button>
              )}{" "}
              <button type="button" className="mini" disabled={!commitRun} title={t.idea_commit_tip} onClick={(e) => { stop(e); if (commitRun && window.confirm(t.idea_commit_ask)) void act(() => api.releaseRun(commitRun)); }}>{t.idea_commit}</button>{" "}
              <button type="button" className="mini" onClick={(e) => { stop(e); setHistoryKey(key); }}>{t.idea_history} ({acts.historyCount})</button>{" "}
              <button type="button" className="mini" disabled={!g.key} onClick={(e) => { stop(e); if (g.key && window.confirm(t.idea_delete_ask)) void act(() => api.queueDeleteIdea(project, g.key)); }}>{t.idea_delete}</button>
            </summary>
            {activeList.length === 0 && <div className="fine">{t.idea_noActive}</div>}
            <ol style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {activeList.map((c0) => {
                const c = view?.commands.find((x) => x.id === c0.id) ?? null;
                if (!c || !view) return <li key={c0.id} className="fine">{c0.title} <span className="muted">[{taskStatusLabel(c0.status)}]</span></li>;
                const bs = buttonStates(c, view, { selectedIds: [] });
                const recov = recoveryActions(c, c.runLive === true);
                const fns = { confirmDone: api.queueConfirmDone, confirmMerged: api.queueConfirmMerged, retry: api.queueRetry, markFailed: api.queueMarkFailed, unskip: api.queueUnskip };
                return (
                  <li key={c.id} className="fine">
                    {c.title} <span className="muted">[{taskStatusLabel(c.status)}]</span>{" "}
                    {bs && (
                      <>
                        <button type="button" className="mini" disabled={bs.approveRun.locked} onClick={() => void act(() => api.queueApproveRun(project, c.id))}>{t.queue_approveRun}</button>{" "}
                        <button type="button" className="mini" disabled={bs.skip.locked} onClick={() => void act(() => api.queueSkip(project, c.id))}>{t.queue_skip}</button>{" "}
                      </>
                    )}
                    {recov.map((a) => (
                      <span key={a}>
                        {a === "confirmMerged" && shouldShowQueueMergePrecheck(c) && <><MergePrecheckBadge compact precheck={c.mergePrecheck ?? null} />{" "}</>}
                        <button
                          type="button"
                          className="mini"
                          onClick={() => {
                            if (a === "confirmMerged" && !window.confirm(t.queue_confirmMergedAsk)) return;
                            void act(() => fns[a](project, c.id));
                          }}
                        >{t[`queue_${a}` as keyof typeof t]}</button>{" "}
                      </span>
                    ))}
                  </li>
                );
              })}
            </ol>
          </details>
        );
      })}
      {(() => {
        const hi = groups.findIndex((g) => `${g.project}\u0000${g.key}` === historyKey);
        const hg = hi >= 0 ? groups[hi] : undefined;
        return hg ? <IdeaHistoryModal group={hg} index={hi} onClose={() => setHistoryKey(null)} /> : null;
      })()}
    </div>
  );
}
