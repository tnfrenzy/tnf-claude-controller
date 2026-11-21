import { useCallback, useEffect, useRef, useState } from "react";
import { isLocalHost } from "../settings/grantsView";
import { api, ApiError, waitReleaseLog, downloadFile, openSocket, type ReleaseDryRun, type ReleaseLogView, type ReleaseResult, type RunMeta, type WsMessage } from "../api";
import { formatCommandLine, formatSize, formatTargets, nextReleasePhase, releaseElapsed, shortHash, type ReleasePhase } from "../settings/releaseFlow";
import { AgentTree, fmtTokens } from "../components/run/AgentTree";
import { fmtQuotaRange } from "../run/quotaFormat";
import { AttachBox, fmtSize } from "../components/common/AttachBox";
import { DiffView, parseDiffStat } from "../components/run/DiffView";
import { CommentEditor, CommentList } from "../components/run/DiffCommentPanel";
import { hasStaleDraft, patchFingerprint, planSubmit, removeDraft, upsertDraft, type DraftComment } from "../run/diffComments";
import { allowedFilesOf } from "../run/diffCommentSubmit";
import { Markdown } from "../components/common/Markdown";
import { MergePrecheckBadge } from "../components/run/MergePrecheckBadge";
import { shouldShowMergePrecheck } from "../run/mergePrecheckVisible";
import { Timeline } from "../components/run/Timeline";
import { VerdictBadge } from "../components/run/Verdict";
import { nextConfirmStep, type ConfirmState } from "../lib/confirm";
import { roleLabel, statusLabel, useT } from "../i18n";
import { runActionState } from "../run/runActions";
import { getRunHint } from "../run/runHints";
import { formatLimits } from "../run/runLimits";
import { buildSummary, parseTestStatus } from "../run/runSummary";
import { formatUsd } from "../run/costEstimate";
import type { ArtifactRecord, QuotaResume, RunRecord, StoredEvent } from "../types";
import { QuotaResumeCountdown } from "../components/run/QuotaResumeCountdown";

import { normalizeTab, type RunTab as Tab } from "../run/runTabs";
import { PreviewTab } from "../components/run/PreviewTab";
import { previewTabVisible } from "../run/preview";

export function RunPage({ id }: { id: string }) {
  const { t, lang } = useT();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  const [editing, setEditing] = useState<{ file: string; line: number; side: "new" | "old" } | null>(null);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [live, setLive] = useState<Record<string, string>>({});
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("timeline");
  const [fileView, setFileView] = useState<{ name: string; text: string } | null>(null);
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  const [followup, setFollowup] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState<QuotaResume | null>(null);
  const [maxAttempts, setMaxAttempts] = useState(0);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [depth, setDepth] = useState(0);
  const [cleanupStep, setCleanupStep] = useState(0);
  const [releaseStep, setReleaseStep] = useState<ConfirmState>("idle");
  const [publishStep, setPublishStep] = useState<ConfirmState>("idle");
  const [relPhase, setRelPhase] = useState<ReleasePhase>("idle");
  const [relDry, setRelDry] = useState<ReleaseDryRun | null>(null);
  /** Live release log while a real release runs (polled): current step and elapsed time, so the popup never looks frozen. */
  const [relProgress, setRelProgress] = useState<ReleaseLogView | null>(null);
  const [relResult, setRelResult] = useState<ReleaseResult | null>(null);
  /** No release config for this environment: show a persistent choice instead of silently doing a version bump only. */
  const [relTemplates, setRelTemplates] = useState<string[] | null>(null);
  const seqRef = useRef(0);

  const loadMeta = useCallback(async () => {
    try {
      const r = await api.getRun(id);
      setRun(r.run);
      setMeta(r);
      setArtifacts(r.artifacts);
      if (r.artifacts.some((a) => a.rel_path === "report.md")) setReport(await api.report(id).catch(() => null));
      // coding evidence files (small): fetch once per load
      const want = ["diff-stat.txt", "diff.patch", "uncommitted.patch", "test-result.txt", "git-log.txt"].filter((n) => r.artifacts.some((a) => a.rel_path === n));
      const loaded: Record<string, string | null> = {};
      await Promise.all(want.map(async (n) => { loaded[n] = await api.artifact(id, n).catch(() => null); }));
      setTexts(loaded);
      // follow-up depth for the context warning
      let d = 0;
      let cur: RunRecord | null = r.run;
      while (cur?.parent_run_id && d < 20) {
        d++;
        cur = (await api.getRun(cur.parent_run_id).catch(() => null))?.run ?? null;
      }
      setDepth(d);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void loadMeta();
    setEvents([]);
    setLive({});
    seqRef.current = 0;
    let ws: WebSocket | null = null;
    let closed = false;
    const applyStored = (s: StoredEvent) => {
      if (s.seq <= seqRef.current) return;
      seqRef.current = s.seq;
      const e = s.event;
      if (e.type === "text.delta") {
        setLive((l) => ({ ...l, [e.agent_id]: (l[e.agent_id] ?? "") + e.text }));
      } else if (e.type === "text.message") {
        setLive((l) => ({ ...l, [e.agent_id]: "" }));
        setEvents((ev) => [...ev, s]);
      } else {
        setEvents((ev) => [...ev, s]);
      }
    };
    const connect = () => {
      ws = openSocket(
        `/ws/runs/${encodeURIComponent(id)}?after=${seqRef.current}`,
        (m: WsMessage) => {
          if (m.type === "run") {
            setRun(m.run);
            if (m.run.status !== "running") void loadMeta();
          } else if (m.type === "event") applyStored(m.stored);
        },
        () => {
          if (!closed) setTimeout(connect, 1500);
        },
      );
    };
    connect();
    // REST fallback for browsers without WebSocket access to localhost (idempotent thanks to the seq filter).
    let lastStatus = "";
    const poll = setInterval(() => {
      api.events(id, seqRef.current).then((r) => r.events.forEach(applyStored)).catch(() => {});
      api.getRun(id).then((r) => {
        setRun(r.run);
        if (lastStatus && lastStatus !== r.run.status) void loadMeta();
        lastStatus = r.run.status;
      }).catch(() => {});
    }, 3000);
    return () => {
      closed = true;
      clearInterval(poll);
      ws?.close();
    };
  }, [id, loadMeta]);

  const recheckMerge = async () => {
    if (!run || rechecking) return;
    setRechecking(true);
    try {
      const res = await api.mergePrecheck(run.id);
      setMeta((m) => (m ? { ...m, merge_precheck: res } : m));
      setRun((r) => (r ? { ...r, merge_precheck: res } : r));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setRechecking(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancel(id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const sendFollowup = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { run: child } = await api.followup(id, { prompt: followup });
      location.hash = `/runs/${encodeURIComponent(child.id)}`;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const sendDiffComments = async () => {
    const curFp = patchFingerprint(texts["diff.patch"] ?? "");
    const plan = planSubmit({
      drafts,
      allowedFiles: allowedFilesOf(texts["diff.patch"], texts["uncommitted.patch"]),
      currentFingerprint: curFp,
    });
    if (drafts.length === 0) {
      setErr(t.dc_err_empty);
      return;
    }
    if (plan.errors.length > 0) {
      setErr(`${t.dc_err_invalid}: ${plan.errors.join(" ")}`);
      return;
    }
    if (plan.stale && !window.confirm(t.dc_confirm_diff_changed)) return;
    setBusy(true);
    setErr(null);
    try {
      const { run: child } = await api.followup(id, { prompt: plan.prompt, comments: plan.comments });
      setDrafts([]);
      setEditing(null);
      location.hash = `/runs/${encodeURIComponent(child.id)}`;
    } catch (e) {
      const m = e instanceof ApiError ? e.message : String(e);
      setErr(t.dc_err_generic.replace("{message}", () => m));
    } finally {
      setBusy(false);
    }
  };
  const openOut = async (rel?: string) => {
    setErr(null);
    try {
      const r = await api.openOutput(id, rel);
      setNotice(`${t.opened}: ${r.path}`);
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  const local = isLocalHost(window.location.hostname);
  const openFile = async (rel: string) => {
    setFileView({ name: rel, text: await api.artifact(id, rel).catch((e: Error) => `(${e.message})`) });
  };
  const download = (name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}-${name}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  /** Download straight from the API (token in a header, response as Blob): single artifact or the whole zip. */
  const fetchDownload = async (path: string, fileName: string) => {
    setErr(null);
    try {
      await downloadFile(path, fileName);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  const attach = async (f: File) => {
    const r = await api.attachToRun(id, f);
    setMeta((m) => (m ? { ...m, inbox: r.inbox } : m));
    return r.inbox;
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${t.copied}: ${text}`);
    } catch {
      setNotice(`${t.copy_failed}: ${text}`);
    }
    setTimeout(() => setNotice(null), 3000);
  };
  const openDir = async (target: "run_dir" | "worktree") => {
    setErr(null);
    try {
      const r = await api.openDir(id, target);
      setNotice(`${t.opened}: ${r.path}`);
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  const release = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.releaseRun(id);
      setNotice(`${t.release_done}: ${r.branch} → ${r.base}${r.commit ? ` @ ${r.commit.slice(0, 7)}` : ""}`);
      setReleaseStep((s) => nextConfirmStep(s, "done"));
      await loadMeta();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setReleaseStep((s) => nextConfirmStep(s, "cancel"));
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.publishRun(id);
      setNotice(`${t.publish_done}: ${r.previous} → ${r.version} @ ${r.commit.slice(0, 7)}`);
      setPublishStep((s) => nextConfirmStep(s, "done"));
      await loadMeta();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setPublishStep((s) => nextConfirmStep(s, "cancel"));
    } finally {
      setBusy(false);
    }
  };
  const startRelease = async () => {
    setErr(null);
    setRelResult(null);
    setRelDry(null);
    if (!run) return;
    setRelPhase((s) => nextReleasePhase(s, "start"));
    try {
      const d = await api.releaseDryRun(run.project, id);
      if (!d.preconditions.ok || d.error) {
        setErr(`${t.rel_precond_failed}: ${d.preconditions.message ?? d.error ?? ""}`);
        setRelPhase((s) => nextReleasePhase(s, "cancel"));
        return;
      }
      setRelDry(d);
      setRelPhase((s) => nextReleasePhase(s, "preview_ok"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_release_config") {
        setRelPhase((s) => nextReleasePhase(s, "cancel"));
        const names = await api.getReleaseConfig(run.project).then((c) => Object.keys(c.templates)).catch(() => []);
        setRelTemplates(names);
        return;
      }
      setErr(e instanceof ApiError ? e.message : String(e));
      setRelPhase((s) => nextReleasePhase(s, "cancel"));
    }
  };
  const useTemplate = async (template: string) => {
    if (!run) return;
    setErr(null);
    try {
      await api.putReleaseConfig(run.project, { template });
      setRelTemplates(null);
      await startRelease();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };
  const executeRelease = async () => {
    if (!run) return;
    setBusy(true);
    setErr(null);
    try {
      const { releaseId } = await api.releaseExecute(run.project, id);
      let log = await waitReleaseLog(releaseId, 1500, 35 * 60 * 1000, (l) => setRelProgress(l));
      setRelProgress(null);
      if (log.status === "running") log = { ...log, status: "failed" };
      setRelResult({ id: log.id, status: log.status as "success" | "failed", steps: log.steps, log: log as ReleaseResult["log"] });
      setRelDry(null);
      setRelPhase((s) => nextReleasePhase(s, "finish"));
      await loadMeta();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setRelPhase((s) => nextReleasePhase(s, "cancel"));
    } finally {
      setBusy(false);
    }
  };
  const cleanup = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.cleanupWorktree(id);
      setNotice(`${t.cleanup_done}: ${r.worktree_path} · ${r.branch}${r.messages.length ? ` · ${r.messages.join(" · ")}` : ""}`);
      setCleanupStep(0);
      await loadMeta();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (run?.status !== "error") {
      setResume(null);
      return;
    }
    api.getQuotaResume(id).then((res) => {
      if (cancelled) return;
      setResume(res.resume);
      setMaxAttempts(res.max_attempts);
    }).catch(() => {
      if (!cancelled) setResume(null);
    });
    return () => { cancelled = true; };
  }, [id, run?.status, run?.updated_at]);
  const cancelResume = async () => {
    setResumeBusy(true);
    try {
      await api.cancelQuotaResume(id);
      setResume(null);
      setNotice(t.qr_cancelled);
    } catch {
      setErr(t.qr_cancel_failed);
    } finally {
      setResumeBusy(false);
    }
  };

  if (!run) {
    return (
      <div className="card">
        {err ? <p className="error">{err}</p> : (
          <div className="skeleton" aria-busy="true">
            <div className="sk title" />
            <div className="sk tabs" />
            <div className="sk" />
            <div className="sk" style={{ width: "90%" }} />
            <div className="sk" style={{ width: "70%" }} />
            <div className="sk" style={{ width: "85%" }} />
          </div>
        )}
      </div>
    );
  }
  const running = run.status === "running";
  const coding = run.kind === "coding";
  const qaVerdicts = run.verdicts.filter((v) => v.role === "qa");
  const lastQa = qaVerdicts.at(-1) ?? null;
  const stat = texts["diff-stat.txt"] ? parseDiffStat(texts["diff-stat.txt"]) : null;

  const normTab = normalizeTab(tab);
  const curTab: Tab = !coding && (normTab === "changes" || normTab === "preview") ? "result" : normTab === "preview" && !previewTabVisible(coding, run.project) ? "timeline" : normTab;
  const acts = runActionState(run, meta?.worktree_exists === true);
  const hint = getRunHint(run);
  const tr = (k: string): string => (t as Record<string, string>)[k] ?? k;
  const summary = buildSummary(run, parseTestStatus(texts["test-result.txt"]));
  const fmtEstimate = (v: number): string => formatUsd(v);
  const actionGroup = (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {acts.showCommit && (
        <>
          {releaseStep === "idle" && <button disabled={busy || acts.commitDisabled} onClick={() => setReleaseStep((s) => nextConfirmStep(s, "ask"))}>{t.release_btn}</button>}
          {releaseStep === "confirm" && (
            <span className="row">
              <span className="warn">{t.release_confirm1}</span>
              <button onClick={() => setReleaseStep((s) => nextConfirmStep(s, "cancel"))}>{t.release_no}</button>
              <button disabled={busy} onClick={() => setReleaseStep((s) => nextConfirmStep(s, "confirm"))}>{t.release_yes1}</button>
            </span>
          )}
          {releaseStep === "execute" && (
            <span className="row">
              <span className="error">{t.release_confirm2} <span className="mono">{run.branch}</span></span>
              <button onClick={() => setReleaseStep((s) => nextConfirmStep(s, "cancel"))}>{t.release_no}</button>
              <button disabled={busy} onClick={() => void release()}>{busy ? t.running : t.release_yes2}</button>
            </span>
          )}
        </>
      )}
      {acts.showPublish && (
        <>
          {publishStep === "idle" && relPhase === "idle" && relTemplates === null && <button disabled={busy || acts.publishDisabled} title={acts.publishNeedsMerge ? t.publish_need_merge : undefined} onClick={() => void startRelease()}>{t.publish_btn}</button>}
          {publishStep === "idle" && relPhase === "idle" && acts.publishNeedsMerge && <span className="muted">{t.publish_need_merge}</span>}
          {relPhase === "dryrun" && <span className="muted">{t.rel_previewing}</span>}
          {relDry && (relPhase === "confirm1" || relPhase === "confirm2" || relPhase === "running") && (
            <div style={{ width: "100%", minWidth: 0 }}>
              <strong>{t.rel_preview_title}</strong>
              <pre className="mono" style={{ overflowX: "auto", maxWidth: "100%", margin: "4px 0", padding: 6, whiteSpace: "pre", fontSize: 12 }}>
                {relDry.plan.map((c) => `${c.stepIndex + 1}. ${formatCommandLine(c.argv)}`).join("\n")}
              </pre>
              {formatTargets(relDry.targets).length > 0 && (
                <div>
                  <strong>{t.rel_targets}</strong>
                  <ul style={{ margin: "4px 0", paddingLeft: 18, overflowWrap: "anywhere" }}>
                    {formatTargets(relDry.targets).map((x) => <li key={x.key}>{tr(`rel_target_${x.key}`)}: <span className="mono">{x.value}</span></li>)}
                  </ul>
                </div>
              )}
              {relPhase === "confirm1" && (
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="warn">{t.rel_confirm1}</span>
                  <button onClick={() => setRelPhase((s) => nextReleasePhase(s, "cancel"))}>{t.rel_cancel}</button>
                  <button onClick={() => setRelPhase((s) => nextReleasePhase(s, "confirm"))}>{t.rel_yes1}</button>
                </div>
              )}
              {relPhase === "confirm2" && (
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="error">{t.rel_confirm2}</span>
                  <button onClick={() => setRelPhase((s) => nextReleasePhase(s, "cancel"))}>{t.rel_cancel}</button>
                  <button disabled={busy} onClick={() => void executeRelease()}>{t.rel_yes2}</button>
                </div>
              )}
              {relPhase === "running" && (
                <div data-testid="rel-progress" style={{ width: "100%", minWidth: 0 }}>
                  <strong>{t.rel_running}</strong>
                  <ul style={{ margin: "4px 0", paddingLeft: 18, overflowWrap: "anywhere" }}>
                    {(relProgress?.steps ?? []).map((s) => (
                      <li key={s.index}>{s.description || s.type}: {tr(`rel_step_${s.status}`)}{s.status === "running" && relProgress ? ` · ${releaseElapsed(relProgress, s.index)}` : ""}</li>
                    ))}
                  </ul>
                  <span className="warn">{t.rel_keep_open}</span>
                </div>
              )}
            </div>
          )}
          {relTemplates !== null && (
            <div className="warn" style={{ width: "100%", minWidth: 0 }} data-testid="rel-no-config">
              <div>{t.rel_no_config}</div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {relTemplates.map((name) => (
                  <button key={name} disabled={busy} onClick={() => void useTemplate(name)}>{t.rel_use_template}: {name}</button>
                ))}
                <button onClick={() => { setRelTemplates(null); setPublishStep((s) => nextConfirmStep(s, "ask")); }}>{t.rel_bump_only}</button>
              </div>
            </div>
          )}
          {relResult && (
            <div style={{ width: "100%", minWidth: 0 }}>
              <strong className={relResult.status === "success" ? "" : "error"}>{relResult.status === "success" ? t.rel_done : t.rel_failed}</strong>
              <ul style={{ margin: "4px 0", paddingLeft: 18, overflowWrap: "anywhere" }}>
                {relResult.steps.map((s) => <li key={s.index}>{s.description || s.type}: {tr(`rel_step_${s.status}`)}</li>)}
              </ul>
              {relResult.log.artifact && (
                <div data-testid="rel-artifact" style={{ marginTop: 6, overflowWrap: "anywhere" }}>
                  <strong>{t.rel_artifact_title}</strong>
                  <div>{t.rel_artifact_path}: <span className="mono">{relResult.log.artifact.path}</span> <button onClick={() => void copy(relResult.log.artifact!.path)} title={t.rel_copy}>⧉</button></div>
                  <div className="muted">{t.rel_artifact_size}: {formatSize(relResult.log.artifact.size)} · {t.rel_artifact_sha}: <span className="mono" title={relResult.log.artifact.sha256}>{shortHash(relResult.log.artifact.sha256)}</span></div>
                </div>
              )}
            </div>
          )}
          {publishStep === "confirm" && (
            <span className="row">
              <span className="warn">{t.publish_confirm1}</span>
              <button onClick={() => setPublishStep((s) => nextConfirmStep(s, "cancel"))}>{t.release_no}</button>
              <button disabled={busy} onClick={() => setPublishStep((s) => nextConfirmStep(s, "confirm"))}>{t.release_yes1}</button>
            </span>
          )}
          {publishStep === "execute" && (
            <span className="row">
              <span className="error">{t.publish_confirm2}</span>
              <button onClick={() => setPublishStep((s) => nextConfirmStep(s, "cancel"))}>{t.release_no}</button>
              <button disabled={busy} onClick={() => void publish()}>{busy ? t.running : t.publish_yes2}</button>
            </span>
          )}
        </>
      )}
    </div>
  );

  const EnvRow = ({ label, value, dir }: { label: string; value: string | null | undefined; dir?: "run_dir" | "worktree" }) => (
    <tr>
      <th style={{ whiteSpace: "nowrap" }}>{label}</th>
      <td className="mono" style={{ wordBreak: "break-all" }}>{value ?? <span className="muted">—</span>}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        {value && <button onClick={() => void copy(value)} title={t.copy_path}>⧉</button>}{" "}
        {value && dir && (dir === "run_dir" || meta?.worktree_exists) && <button onClick={() => void openDir(dir)}>{t.open_explorer}</button>}
      </td>
    </tr>
  );

  return (
    <div>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <a href="#/runs">← {t.back}</a> <span className="mono muted">{run.id}</span>
            {run.parent_run_id && (
              <span className="muted"> · ↩ <a href={`#/runs/${encodeURIComponent(run.parent_run_id)}`}>{run.parent_run_id}</a></span>
            )}
          </div>
          <div className="row">
            <span className={`status ${run.status}`}>{statusLabel(t, run.status)}</span>
            <span className="pill-kind">{coding ? t.kind_coding : t.kind_research}{run.project !== "default" ? ` · ${run.project}` : ""}</span>
            {running && <button className="danger" disabled={busy} onClick={() => void cancel()}>{t.cancel}</button>}
          </div>
        </div>
        {run.status === "queued" && meta?.wait_reason ? <div className="pill err" role="status">{t.wait_reason_label}: {meta.wait_reason}</div> : null}
        <p style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>{run.prompt}</p>
        {coding && !running && (
          <div className="summary-box" style={{ margin: "8px 0", padding: 8, border: "1px solid var(--border, #ccc)", borderRadius: 6 }}>
            <b>{t["summary.title"]}</b>{": "}
            <span>{t[`summary.${summary.verdict}`]}. {summary.commits} {t["summary.commits"]}, {summary.files} {t["summary.files"]}, {t[`summary.test_${summary.test}`]}. {t["summary.cost"]} {fmtEstimate(summary.costUsd)}, {Math.round(summary.durationMs / 1000)}s.</span>{" "}
            {summary.primary === "commit"
              ? <button className="primary" disabled={busy} onClick={() => setReleaseStep((s) => nextConfirmStep(s, "ask"))}>{t["summary.btn_commit"]}</button>
              : <button onClick={() => setTab("changes")}>{t["summary.btn_diff"]}</button>}
          </div>
        )}
        {run.verdicts.length > 0 && (
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            {run.verdicts.map((v, i) => <span key={i} className="muted" style={{ fontSize: 12 }}>{roleLabel(v.role, lang === "en" ? "en" : "vi")} <VerdictBadge verdict={v.verdict} lang={lang} role={v.role} /></span>)}
          </div>
        )}
        <div className="kpi">
          <div><div className="k">{t.quota_5h}</div><div className="v" title={t.quota_note}>{fmtQuotaRange(run.quota_start, run.quota_end, run.quota_pct)}</div></div>
          <div><div className="k">{t.quota_week}</div><div className="v" title={t.quota_note}>{fmtQuotaRange(run.quota7_start, run.quota7_end, run.quota7_pct)}</div></div>
          <div><div className="k">{t.tokens} {t.input_tokens}/{t.output_tokens}</div><div className="v">{fmtTokens(run.usage.input ?? 0)} / {fmtTokens(run.usage.output ?? 0)}</div></div>
          <div><div className="k">{t.cache_read}/{t.cache_write}</div><div className="v">{fmtTokens(run.usage.cache_read ?? 0)} / {fmtTokens(run.usage.cache_write ?? 0)}</div></div>
          <div><div className="k">{t.turns}</div><div className="v">{run.num_turns}</div></div>
          <div><div className="k">{t.duration}</div><div className="v">{Math.round(run.duration_ms / 1000)}s</div></div>
          <div><div className="k">{t.model}</div><div className="v" style={{ fontSize: 12 }}>{run.model ?? "?"} · {run.mode}</div></div>
          {coding && <div><div className="k">{t.commits} / {t.changed_files}</div><div className="v">{run.commits.length} / {run.changed_files}</div></div>}
        </div>
        {(acts.showCommit || acts.showPublish) && <div style={{ marginTop: 10 }}>{actionGroup}</div>}
        {hint && (
          <div className="hint-box" style={{ marginTop: 10 }}>
            <p className="error" style={{ margin: 0 }}><b>{tr(hint.titleKey)}</b></p>
            <p style={{ margin: "4px 0" }}>{tr(hint.bodyKey)}</p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {hint.actions.map((a) => (a === "rerun" || a === "resume") ? (
                run.session_id && !running ? <button key={a} onClick={() => setFollowup(a === "resume" ? "Tiếp tục làm nốt phần còn lại." : "Thử lại việc trên.")}>{tr(`hint.action.${a}`)}</button> : null
              ) : a === "open_diff" ? (
                <button key={a} onClick={() => setTab("changes")}>{t["summary.btn_diff"]}</button>
              ) : <span key={a} className="muted">{tr(`hint.action.${a}`)}</span>)}
            </div>
            <details style={{ marginTop: 6 }}>
              <summary>{t["hint.technical"]}</summary>
              <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{hint.technical}</pre>
            </details>
          </div>
        )}
        {!hint && run.error && <p className="error" style={{ marginTop: 10 }}>{run.error}</p>}
        {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        {notice && <p className="warn" style={{ marginTop: 10 }}>{notice}</p>}
        {resume?.status === "pending" && (
          <div style={{ marginTop: 10 }}>
            <QuotaResumeCountdown
              resumeAt={resume.resume_at}
              label={t.qr_title}
              cancelLabel={t.qr_cancel}
              busy={resumeBusy}
              onCancel={cancelResume}
            />
            <p className="muted">{t.qr_attempt.replace("{n}", () => String(resume.attempt)).replace("{max}", () => String(maxAttempts))}</p>
            {resume.kind === "queue" && <p className="muted">{t.qr_cancel_queue_hint}</p>}
          </div>
        )}
        {depth >= 3 && <p className="warn" style={{ marginTop: 10 }}>{t.context_warning}</p>}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="tabs">
            <button className={curTab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}>{t.timeline}</button>
            <button className={curTab === "result" ? "active" : ""} onClick={() => setTab("result")}>{t.tab_result}</button>
            {coding && <button className={curTab === "changes" ? "active" : ""} onClick={() => setTab("changes")}>{t.tab_changes}{stat ? ` (${stat.rows.length})` : ""}{lastQa ? " " : ""}{lastQa && <VerdictBadge verdict={lastQa.verdict} lang={lang} role="qa" />}</button>}
            {previewTabVisible(coding, run.project) && <button className={curTab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>{t.tab_preview}</button>}
            <button className={curTab === "details" ? "active" : ""} onClick={() => setTab("details")}>{t.tab_details} ({artifacts.length})</button>
          </div>
          {curTab === "preview" && run.project && <PreviewTab key={run.id} runId={run.id} project={run.project} runStatus={run.status} />}
          <div className="tab-pane tab-pane-timeline" hidden={curTab !== "timeline"}><Timeline events={events} agents={run.agents} live={live} /></div>
          {curTab === "result" && (report ? <Markdown source={report} /> : run.result_text ? <Markdown source={run.result_text} /> : <p className="muted">{t.no_report}</p>)}
          {curTab === "changes" && (
            <div>
              {running && <p className="muted">{t.diff_pending}</p>}
              {texts["uncommitted.patch"] && <p className="warn">{t.uncommitted_warning} <button onClick={() => download("uncommitted.patch", texts["uncommitted.patch"] ?? "")}>⤓ uncommitted.patch</button></p>}
              {texts["git-log.txt"] && (
                <div style={{ marginBottom: 10 }}>
                  <b>{t.commits}</b>
                  <pre className="mono" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{texts["git-log.txt"]?.trim() || t.no_commits}</pre>
                </div>
              )}
              {shouldShowMergePrecheck({ kind: run.kind, branch: run.branch, merged: meta?.merged }) && (rechecking ? <MergePrecheckBadge precheck={meta?.merge_precheck ?? null} /> : <MergePrecheckBadge precheck={meta?.merge_precheck ?? null} onRecheck={recheckMerge} />)}
              {stat && stat.rows.length > 0 ? (
                <div className="diff-stat-wrap">
                  <table className="diff-stat">
                    <thead><tr><th>{t.file}</th><th>+</th><th>−</th></tr></thead>
                    <tbody>
                      {stat.rows.map((r) => (
                        <tr key={r.path}><td className="mono">{r.path}</td><td className="add">+{r.added}</td><td className="del">−{r.deleted}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted" style={{ margin: "4px 0 10px" }}>{stat.summary}</p>
                </div>
              ) : !running && <p className="muted">{t.no_diff}</p>}
              {texts["diff.patch"] && (
                <div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <b>diff.patch</b>
                    <button onClick={() => download("diff.patch", texts["diff.patch"] ?? "")}>⤓ {t.download}</button>
                  </div>
                  <DiffView
                    patch={texts["diff.patch"] ?? ""}
                    comments={drafts}
                    onLineClick={(file, line, side) => setEditing({ file, line, side })}
                    renderAfterLine={(file, line, side) =>
                      editing && editing.file === file && editing.line === line && editing.side === side ? (
                        <CommentEditor
                          key={`${file}:${line}:${side}`}
                          initial={drafts.find((d) => d.file === file && d.line === line && d.side === side)?.text ?? ""}
                          lang={lang}
                          onSave={(text) => {
                            setDrafts((l) => upsertDraft(l, { file, line, side, text }, patchFingerprint(texts["diff.patch"] ?? "")));
                            setEditing(null);
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      ) : null}
                  />
                  <CommentList
                    comments={drafts}
                    lang={lang}
                    onEdit={(c) => setEditing({ file: c.file, line: c.line, side: c.side })}
                    onDelete={(c) => setDrafts((l) => removeDraft(l, c.file, c.line, c.side))}
                  />
                  {drafts.length > 0 && hasStaleDraft(drafts, patchFingerprint(texts["diff.patch"] ?? "")) ? (
                    <div className="warn fine">{t.dc_diff_changed}</div>
                  ) : null}
                  {drafts.length > 0 ? (
                    <button type="button" className="primary" disabled={running || busy || !run.session_id} onClick={() => void sendDiffComments()}>{t.dc_send_fix}</button>
                  ) : null}
                </div>
              )}
            </div>
          )}
          {curTab === "changes" && (
            <div style={{ marginTop: 12 }}>
              {qaVerdicts.length > 0 ? (
                <p>{t.qa_verdict}: {qaVerdicts.map((v, i) => <span key={i}> <VerdictBadge verdict={v.verdict} lang={lang} role="qa" /></span>)}</p>
              ) : <p className="muted">{running ? t.test_pending : t.no_qa_verdict}</p>}
              {texts["test-result.txt"] ? (
                <pre className="mono test-output">{texts["test-result.txt"]}</pre>
              ) : <p className="muted">{running ? t.test_pending : t.no_test_run}</p>}
            </div>
          )}
          {curTab === "details" && (
            <div>
              <table className="env-table">
                <tbody>
                  <EnvRow label={t.project} value={run.project === "default" ? t.project_default : run.project} />
                  <EnvRow label={t.kind} value={coding ? t.kind_coding : t.kind_research} />
                  {coding && <EnvRow label={t.env_repo} value={meta?.repo_path} />}
                  {coding && <EnvRow label={t.env_base_branch} value={meta?.base_branch ? `${meta.base_branch}${run.base_sha ? ` @ ${run.base_sha.slice(0, 7)}` : ""}` : null} />}
                  {coding && <EnvRow label={t.env_worktree} value={run.worktree_path ? `${run.worktree_path}${meta?.worktree_exists === false ? ` (${t.worktree_gone})` : ""}` : null} dir="worktree" />}
                  {coding && <EnvRow label={t.env_run_branch} value={run.branch} />}
                  <EnvRow label={t.env_run_dir} value={run.run_dir} dir="run_dir" />
                  <EnvRow label={t.env_stream} value={meta?.stream_path} />
                  <EnvRow label={t.session} value={run.session_id} />
                  <EnvRow label="claude" value={run.claude_version} />
                  {formatLimits(run.limits)?.map((r) => <EnvRow key={r.key} label={`${t.limits_title}: ${t[`limit_${r.key}` as const]}`} value={r.value} />)}
                </tbody>
              </table>
              {(acts.showCommit || acts.showPublish) && (
                <div className="card" style={{ marginTop: 12, marginBottom: 0, background: "var(--bg)" }}>
                  <b>{t.release_title}</b>
                  <p className="muted" style={{ margin: "4px 0 8px" }}>{t.release_hint}</p>
                  {actionGroup}
                </div>
              )}
              {coding && run.worktree_path && meta?.worktree_exists && !running && (
                <div className="card" style={{ marginTop: 12, marginBottom: 0, background: "var(--bg)" }}>
                  <b>{t.cleanup_title}</b>
                  <p className="muted" style={{ margin: "4px 0 8px" }}>{t.cleanup_hint}</p>
                  {cleanupStep === 0 && <button className="danger" disabled={busy} onClick={() => setCleanupStep(1)}>{t.cleanup_btn}</button>}
                  {cleanupStep === 1 && (
                    <div className="row">
                      <span className="warn">{t.cleanup_confirm1}</span>
                      <button onClick={() => setCleanupStep(0)}>{t.cleanup_no}</button>
                      <button className="danger" disabled={busy} onClick={() => setCleanupStep(2)}>{t.cleanup_yes1}</button>
                    </div>
                  )}
                  {cleanupStep === 2 && (
                    <div className="row">
                      <span className="error">{t.cleanup_confirm2} <span className="mono">{run.branch}</span></span>
                      <button onClick={() => setCleanupStep(0)}>{t.cleanup_no}</button>
                      <button className="danger" disabled={busy} onClick={() => void cleanup()}>{busy ? t.running : t.cleanup_yes2}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {curTab === "details" && (
            <div style={{ marginTop: 12 }}>
              {artifacts.length > 0 && (
                <div className="row" style={{ justifyContent: "flex-end", marginBottom: 6 }}>
                  <button className="primary" onClick={() => void openOut()}>{t.open_output_dir}</button>
                  {!local && <button onClick={() => void fetchDownload(api.artifactsZipPath(id), `${id}-artifacts.zip`)}>⤓ {t.download_all}</button>}
                </div>
              )}
              {!local && <p className="muted fine">{t.out_remote_note}</p>}
              <ul className="file-list">
                {artifacts.map((a) => (
                  <li key={a.rel_path}>
                    <a href="#" onClick={(e) => { e.preventDefault(); void openFile(a.rel_path); }}>{a.rel_path}</a> <span className="muted">({fmtSize(a.size)})</span>{" "}
                    <button className="tiny" onClick={() => void openOut(a.rel_path)}>{t.open_file}</button>
                    {!local && <button className="tiny" title={t.download} onClick={() => void fetchDownload(api.artifactPath(id, a.rel_path), `${id}-${a.rel_path.replace(/[\\/]/g, "_")}`)}>⤓</button>}
                  </li>
                ))}
              </ul>
              {meta && (
                <div style={{ marginTop: 8 }}>
                  <b>{t.attachments}</b> <span className="muted">({meta.inbox.length})</span>
                  {meta.inbox.length === 0 ? <p className="muted" style={{ margin: "4px 0" }}>{t.no_attachments}</p> : (
                    <ul className="file-list">
                      {meta.inbox.map((f) => <li key={f.name}><span className="mono">inbox/{f.name}</span> <span className="muted">({fmtSize(f.size)})</span></li>)}
                    </ul>
                  )}
                </div>
              )}
              {fileView && (
                <div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b className="mono">{fileView.name}</b>
                    <span className="row">
                      <button onClick={() => void openOut(fileView.name)}>{t.open_file}</button>
                      {!local && <button onClick={() => download(fileView.name.replace(/[\\/]/g, "_"), fileView.text)}>⤓ {t.download}</button>}
                    </span>
                  </div>
                  {fileView.name.endsWith(".md") ? <Markdown source={fileView.text} /> : fileView.name.endsWith(".patch") ? <DiffView patch={fileView.text} /> : <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{fileView.text}</pre>}
                </div>
              )}
              <p className="muted">{t.view_stream}: <span className="mono">{meta?.stream_path}</span></p>
            </div>
          )}
        </div>
        <div>
          <div className="card">
            <b>{t.agents}</b>
            <div style={{ marginTop: 8 }}>
              <AgentTree agents={run.agents} />
            </div>
          </div>
          {!running && run.session_id && (
            <div className="card">
              <b>{t.followup}</b>
              <textarea value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder={t.followup_placeholder} style={{ marginTop: 8, minHeight: 70 }} />
              <div style={{ marginTop: 8 }}>
                <AttachBox files={meta?.inbox ?? []} onUpload={attach} disabled={busy} compact />
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{t.attach_remove_hint}</p>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                <button className="primary" disabled={busy || !followup.trim()} onClick={() => void sendFollowup()}>{t.send}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
