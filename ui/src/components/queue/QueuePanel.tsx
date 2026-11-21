import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { activeCommands, groupByIdea, ideaActions, ideaHeading, ideasNewestFirst } from "../../queue/ideaGroups";
import { IdeaHistoryModal } from "./IdeaHistoryModal";
import { CommandContract, IdeaMetaBox, PendingInterviews } from "./IdeaQuality";
import { splitStageText } from "../../queue/ideaQuality";
import type { DescribedCommand, QueueView } from "../../types";
import { buttonStates, groupByBatch, groupEstimate, parallelGate, recoveryActions, runAllButtonState, statusVisual, type LockReason, type LockState, type RecoveryAction } from "../../queue/queue";
import { recoveryConfirmText } from "../../queue/queue-labels";

/** All visible text comes from the caller (T10 supplies it from i18n). */
export interface QueueLabels {
  title: string;
  empty: string;
  batch: string; // "Batch"
  files: string;
  dependsOn: string;
  references: string;
  warnings: string;
  estimate: string; // "Estimate"
  pushedReason: string;
  edit: string;
  save: string;
  cancel: string;
  approveRun: string;
  runParallel: string;
  skip: string;
  copy: string;
  copied: string;
  select: string;
  parallelBar: string;
  loadWarning: string;
  ackWarnings: string;
  loadError: string;
  ideaTitle: string;
  ideaPlaceholder: string;
  ideaSend: string;
  webSearch: string;
  webSearchNote: string;
  ideaConfirm: string;
  ideaConfirmYes: string;
  ideaCancel: string;
  ideaRunning: string;
  ideaDone: string; // "{n}" = number of commands
  ideaError: string;
  ideaTooLong: string; // "{max}"
  ideaNeedVi: string;
  confirmMerged: string;
  confirmDone: string;
  confirmDoneTip: string;
  retry: string;
  retryTip: string;
  markFailed: string;
  unskip: string;
  confirmMergedAsk: string;
  confirmDoneAsk: string;
  confirmDoneNoCommit: string;
  markFailedAsk: string;
  status: Record<string, string>;
  /** Lock reason text by code; `{key}` placeholders are filled from params. Unknown codes fall back to the code. */
  reasons: Record<string, string>;
}

export function reasonText(r: LockReason, labels: Pick<QueueLabels, "reasons">): string {
  if (r.code === "server") return r.text ?? "";
  const tpl = labels.reasons[r.code] ?? r.code;
  return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(r.params?.[k] ?? ""));
}

function lockTitle(s: LockState, labels: Pick<QueueLabels, "reasons">): string | undefined {
  return s.locked ? s.reasons.map((r) => reasonText(r, labels)).join("; ") : undefined;
}

export interface QueueCardProps {
  cmd: DescribedCommand;
  view: QueueView;
  labels: QueueLabels;
  selectedIds: string[];
  acknowledged: Record<string, boolean>;
  editing: boolean;
  draft: string;
  copiedUrl?: string | null;
  onSelect?: (id: string) => void;
  onAck?: (id: string, v: boolean) => void;
  onEdit?: (id: string) => void;
  onDraft?: (v: string) => void;
  onSave?: (id: string) => void;
  onCancelEdit?: () => void;
  onApproveRun?: (id: string) => void;
  onSkip?: (id: string) => void;
  onRecovery?: (action: RecoveryAction, id: string) => void;
  onCopy?: (url: string) => void;
}

/** Pure card: no state, no effects. */
export function QueueCard(p: QueueCardProps) {
  const { cmd, labels } = p;
  const vis = statusVisual(cmd.status);
  const bs = buttonStates(cmd, p.view, { selectedIds: p.selectedIds, acknowledged: p.acknowledged });
  const selected = p.selectedIds.includes(cmd.id);
  const recovery = recoveryActions(cmd, cmd.runLive === true);
  const recoveryTip = (a: RecoveryAction): string | undefined =>
    a === "retry" ? labels.retryTip : a === "confirmDone" ? labels.confirmDoneTip : undefined;
  return (
    <li className={`queue-card queue-tone-${vis.tone}`} data-id={cmd.id}>
      <div className="queue-card-head">
        <span className={`queue-status queue-tone-${vis.tone}`}>
          <span aria-hidden="true">{vis.icon}</span> {labels.status[cmd.status] ?? cmd.status}
        </span>
        <strong className="queue-title">{cmd.title}</strong>
        <span className="queue-cost" title={labels.estimate}>
          {labels.estimate} ~${cmd.estimatedCostUsd.toFixed(2)}
        </span>
      </div>
      <CommandContract cmd={cmd} />
      {cmd.files.length > 0 && (
        <div className="queue-meta">
          <span>{labels.files}:</span> {cmd.files.map((f) => <code key={f} className="queue-chip">{f}</code>)}
        </div>
      )}
      {cmd.dependsOn.length > 0 && (
        <div className="queue-meta">
          <span>{labels.dependsOn}:</span> {cmd.dependsOn.map((d) => <code key={d} className="queue-chip">{d}</code>)}
        </div>
      )}
      {cmd.waveReasons.length > 0 && (
        <div className="queue-meta queue-pushed">
          <span>{labels.pushedReason}:</span> {cmd.waveReasons.join("; ")}
        </div>
      )}
      {cmd.references.length > 0 && (
        <div className="queue-refs">
          <span>{labels.references}:</span>
          <ul>
            {cmd.references.map((r) => (
              <li key={r.url} className="queue-ref">
                <strong>{r.title}</strong>
                {r.note ? <span className="queue-ref-note"> {r.note}</span> : null}
                <div className="queue-ref-url">
                  <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a>
                  <button type="button" className="queue-copy" onClick={() => p.onCopy?.(r.url)}>
                    {p.copiedUrl === r.url ? labels.copied : labels.copy}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cmd.warnings.length > 0 && (
        <div className="queue-warn" role="alert">
          <span className="queue-warn-badge">⚠ {labels.warnings}</span>
          <ul>{cmd.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <label className="queue-ack">
            <input type="checkbox" checked={!!p.acknowledged[cmd.id]} onChange={(e) => p.onAck?.(cmd.id, e.target.checked)} />
            {labels.ackWarnings}
          </label>
        </div>
      )}
      {p.editing ? (
        <div className="queue-edit">
          <textarea value={p.draft} rows={8} onChange={(e) => p.onDraft?.(e.target.value)} />
          <div className="queue-actions">
            <button type="button" onClick={() => p.onSave?.(cmd.id)}>{labels.save}</button>
            <button type="button" onClick={() => p.onCancelEdit?.()}>{labels.cancel}</button>
          </div>
        </div>
      ) : (
        <pre className="queue-body">{cmd.body}</pre>
      )}
      <div className="queue-actions">
        <button type="button" disabled={bs.edit.locked} title={lockTitle(bs.edit, labels)} onClick={() => p.onEdit?.(cmd.id)}>{labels.edit}</button>
        <button type="button" disabled={bs.approveRun.locked} title={lockTitle(bs.approveRun, labels)} onClick={() => p.onApproveRun?.(cmd.id)}>{labels.approveRun}</button>
        <label className="queue-select" title={lockTitle(bs.runParallel, labels)}>
          <input type="checkbox" checked={selected} disabled={!selected && bs.runParallel.locked && bs.runParallel.reasons.some((r) => r.code === "notRunnable")} onChange={() => p.onSelect?.(cmd.id)} />
          {labels.select}
        </label>
        <button type="button" disabled={bs.skip.locked} title={lockTitle(bs.skip, labels)} onClick={() => p.onSkip?.(cmd.id)}>{labels.skip}</button>
      </div>
      {recovery.length > 0 && (
        <div className="queue-actions queue-recovery">
          {recovery.map((a) => (
            <button key={a} type="button" title={recoveryTip(a)} onClick={() => p.onRecovery?.(a, cmd.id)}>{labels[a]}</button>
          ))}
        </div>
      )}
      {bs.approveRun.locked && <div className="queue-lock-reason">{lockTitle(bs.approveRun, labels)}</div>}
    </li>
  );
}

export const IDEA_MAX_CHARS = 2000;
const VI_DIACRITICS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/** Pure idea check mirroring the server: returns an error text, or null when the idea can be sent. */
export function ideaProblem(idea: string, labels: Pick<QueueLabels, "ideaTooLong" | "ideaNeedVi">): string | null {
  const t = idea.trim();
  if (t.length === 0) return "";
  if (t.length > IDEA_MAX_CHARS) return labels.ideaTooLong.replace("{max}", String(IDEA_MAX_CHARS));
  if (!VI_DIACRITICS.test(t)) return labels.ideaNeedVi;
  return null;
}

/** A group is open when the user said so; otherwise open if it is the only idea or something in it is running or waiting to merge. */
export function ideaOpen(manual: boolean | undefined, g: { counts: Partial<Record<string, number>> }, groupCount: number): boolean {
  if (manual !== undefined) return manual;
  return groupCount <= 1 || (g.counts["đang chạy"] ?? 0) > 0 || (g.counts["đã commit"] ?? 0) > 0;
}

type SplitUi = { phase: "idle" | "confirm" | "running" | "done" | "error"; message?: string };

export function QueuePanel({ project, labels }: { project: string; labels: QueueLabels }) {
  const { t } = useT();
  /** Idea groups the user opened or closed by hand; the rest follow the default (see ideaOpen). */
  const [openIdeas, setOpenIdeas] = useState<Record<string, boolean>>({});
  const [idea, setIdea] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [split, setSplit] = useState<SplitUi>({ phase: "idle" });
  const [view, setView] = useState<QueueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.queue(project));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project]);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [project, load]);

  useEffect(() => {
    let alive = true;
    api.status().then((s) => { if (alive) setWebSearch(s.queue?.splitter.webSearch ?? false); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, []);

  const pollSplit = useCallback((runId: string) => {
    pollTimer.current = setTimeout(async () => {
      try {
        const st = await api.queueSplitStatus(project, runId);
        if (!mounted.current) return;
        if (st.state === "running") {
          setSplit({ phase: "running", message: splitStageText(st.stage, t, labels.ideaRunning) });
          pollSplit(runId);
          return;
        }
        if (st.state === "done") {
          setSplit({ phase: "done", message: labels.ideaDone.replace("{n}", String(st.commands ?? 0)) });
          setIdea("");
          void load();
        } else if (st.state === "questions") {
          setSplit({ phase: "done", message: t.iq_questions_ready.replace("{n}", String(st.questions?.length ?? 0)) });
          setIdea("");
          void load();
        } else {
          setSplit({ phase: "error", message: `${labels.ideaError}: ${st.error ?? ""}` });
        }
      } catch (e) {
        if (mounted.current) setSplit({ phase: "error", message: `${labels.ideaError}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }, 2000);
  }, [project, labels, load, t]);

  const answerInterview = async (id: string, body: { answers?: string[]; skip?: boolean; dismiss?: boolean }) => {
    try {
      if (body.dismiss) {
        await api.queueSplitAnswers(project, id, body);
        await load();
        return;
      }
      setSplit({ phase: "running", message: labels.ideaRunning });
      const r = await api.queueSplitAnswers(project, id, body);
      await load();
      pollSplit(r.runId);
    } catch (e) {
      setSplit({ phase: "error", message: `${labels.ideaError}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const sendIdea = async () => {
    setSplit({ phase: "running", message: labels.ideaRunning });
    try {
      const r = await api.queueSplit(project, { idea: idea.trim(), webSearch });
      pollSplit(r.runId);
    } catch (e) {
      setSplit({ phase: "error", message: `${labels.ideaError}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    await load();
  };

  if (!view) return <div className="queue-panel">{error ? <p className="queue-error">{labels.loadError}: {error}</p> : null}</div>;
  const gate = parallelGate(selected, view.commands, view, { acknowledged: acked });
  const ideaIssue = ideaProblem(idea, labels);
  const heavy = view.codingRunning + selected.length >= view.maxParallel;
  const ideaGroups = ideasNewestFirst(groupByIdea(view.commands));
  const runAllActive = view.runAll?.active === true;
  const runAllBtn = runAllButtonState(runAllActive, ideaGroups.length);
  return (
    <div className="queue-panel">
      <h3>{labels.title}</h3>
      {error && <p className="queue-error">{labels.loadError}: {error}</p>}
      <section className="queue-runall" data-testid="queue-runall">
        {runAllBtn.mode === "stop" ? (
          <button type="button" onClick={() => void act(() => api.queueRunAllStop(project))}>{t.taskList_stop}</button>
        ) : (
          <button type="button" disabled={runAllBtn.disabled} onClick={() => void act(() => api.queueRunAll(project))}>{t.taskList_runAll}</button>
        )}
        {view.runAll && (
          <span className="queue-runall-state">
            {runAllActive ? t.taskList_active : t.taskList_idle} · {t.taskList_running}: {view.runAll.running.length}
          </span>
        )}
        {view.runAll?.lastError && <p className="queue-error">{view.runAll.lastError}</p>}
      </section>
      <section className="queue-idea">
        <h4>{labels.ideaTitle}</h4>
        <textarea
          className="queue-idea-input"
          value={idea}
          rows={4}
          maxLength={IDEA_MAX_CHARS}
          placeholder={labels.ideaPlaceholder}
          disabled={split.phase === "running"}
          onChange={(e) => { setIdea(e.target.value); if (split.phase !== "running") setSplit({ phase: "idle" }); }}
        />
        <div className="queue-idea-count">{idea.length}/{IDEA_MAX_CHARS}</div>
        <label className="queue-idea-toggle">
          <input type="checkbox" checked={webSearch} disabled={split.phase === "running"} onChange={(e) => setWebSearch(e.target.checked)} />
          <span>{labels.webSearch}</span>
        </label>
        <p className="queue-idea-note">{labels.webSearchNote}</p>
        {ideaIssue ? <p className="queue-error">{ideaIssue}</p> : null}
        {split.phase === "confirm" ? (
          <div className="queue-idea-confirm" role="alert">
            <p>{labels.ideaConfirm}</p>
            <div className="queue-actions">
              <button type="button" onClick={() => void sendIdea()}>{labels.ideaConfirmYes}</button>
              <button type="button" onClick={() => setSplit({ phase: "idle" })}>{labels.ideaCancel}</button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="queue-idea-send"
            disabled={idea.trim().length === 0 || ideaIssue !== null || split.phase === "running"}
            onClick={() => setSplit({ phase: "confirm" })}
          >
            {labels.ideaSend}
          </button>
        )}
        {split.message && <p className={split.phase === "error" ? "queue-error" : "queue-idea-status"}>{split.message}</p>}
      </section>
      <PendingInterviews items={view.interviews ?? []} disabled={split.phase === "running"} onAnswer={(id, body) => void answerInterview(id, body)} />
      {view.commands.length === 0 && <p>{labels.empty}</p>}
      {ideaGroups.map((ig, gi) => {
        const key = `${ig.project} ${ig.key}`;
        const isOpen = ideaOpen(openIdeas[key], ig, ideaGroups.length);
        const summary = Object.entries(ig.counts).map(([st, n]) => `${st}: ${n}`).join(", ");
        const active = activeCommands(ig);
        const acts = ideaActions(ig, view.runAll);
        const stop = (e: { preventDefault: () => void; stopPropagation: () => void }) => { e.preventDefault(); e.stopPropagation(); };
        return (
      <details
        key={key}
        className="queue-idea-group"
        open={isOpen}
        onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== isOpen) setOpenIdeas((m) => ({ ...m, [key]: o })); }}
      >
        <summary>
          {ideaHeading(ig, gi)} ({active.length}){summary ? ` · ${summary}` : ""}
          <span className="queue-idea-actions">
            <button type="button" className="mini" disabled={acts.approveAll.disabled} onClick={(e) => { stop(e); void act(() => api.queueApproveAll(project, ig.key)); }}>{t.idea_approveAll}</button>
            {acts.runAll.mode === "stop" ? (
              <button type="button" className="mini" onClick={(e) => { stop(e); void act(() => api.queueRunAllStop(project)); }}>{t.idea_stop}</button>
            ) : (
              <button type="button" className="mini" disabled={acts.runAll.disabled} onClick={(e) => { stop(e); void act(() => api.queueRunAll(project, ig.key)); }}>{t.idea_runAll}</button>
            )}
            <button type="button" className="mini" onClick={(e) => { stop(e); setHistoryKey(key); }}>{t.idea_history} ({acts.historyCount})</button>
            <button type="button" className="mini" disabled={!ig.key} onClick={(e) => { stop(e); if (ig.key && window.confirm(t.idea_delete_ask)) void act(() => api.queueDeleteIdea(project, ig.key)); }}>{t.idea_delete}</button>
          </span>
        </summary>
      <IdeaMetaBox meta={ig.key ? view.ideas?.[ig.key] : undefined} />
      {active.length === 0 && <p className="fine">{t.idea_noActive}</p>}
      {groupByBatch(active).map((g) => (
        <section key={g.batch} className="queue-batch">
          <h4>{labels.batch} {g.batch} <span className="queue-cost">{labels.estimate} {groupEstimate(g.commands).label}</span></h4>
          <ul className="queue-list">
            {g.commands.map((c) => (
              <QueueCard
                key={c.id}
                cmd={c}
                view={view}
                labels={labels}
                selectedIds={selected}
                acknowledged={acked}
                editing={editId === c.id}
                draft={draft}
                copiedUrl={copied}
                onSelect={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                onAck={(id, v) => setAcked((a) => ({ ...a, [id]: v }))}
                onEdit={(id) => { setEditId(id); setDraft(c.body); }}
                onDraft={setDraft}
                onCancelEdit={() => setEditId(null)}
                onSave={(id) => void act(async () => { await api.queuePatch(project, id, { body: draft }); setEditId(null); })}
                onApproveRun={(id) => void act(() => api.queueApproveRun(project, id))}
                onSkip={(id) => void act(() => api.queueSkip(project, id))}
                onRecovery={(a, id) => {
                  const ask = recoveryConfirmText(a, labels, c.runCommitCount);
                  if (ask !== null && !window.confirm(ask)) return;
                  const fn = { confirmDone: api.queueConfirmDone, confirmMerged: api.queueConfirmMerged, retry: api.queueRetry, markFailed: api.queueMarkFailed, unskip: api.queueUnskip }[a];
                  void act(() => fn(project, id));
                }}
                onCopy={(url) => { void navigator.clipboard?.writeText(url)?.catch(() => undefined); setCopied(url); }}
              />
            ))}
          </ul>
        </section>
      ))}
      </details>
        );
      })}
      {(() => {
        const hi = ideaGroups.findIndex((ig) => `${ig.project} ${ig.key}` === historyKey);
        const hg = hi >= 0 ? ideaGroups[hi] : undefined;
        return hg ? <IdeaHistoryModal group={hg} index={hi} onClose={() => setHistoryKey(null)} /> : null;
      })()}
      {selected.length > 0 && (
        <div className="queue-parallel-bar">
          {heavy && <p className="queue-load">{labels.loadWarning}</p>}
          <button
            type="button"
            disabled={!gate.ok}
            title={gate.ok ? undefined : gate.reasons.map((r) => reasonText(r, labels)).join("; ")}
            onClick={() => void act(async () => { await api.queueRunParallel(project, selected); setSelected([]); })}
          >
            {labels.runParallel} ({selected.length})
          </button>
          {!gate.ok && <span className="queue-lock-reason">{gate.reasons.map((r) => reasonText(r, labels)).join("; ")}</span>}
        </div>
      )}
    </div>
  );
}
