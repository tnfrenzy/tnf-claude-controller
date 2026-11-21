import { useState } from "react";
import { useT } from "../../i18n";
import { commandBadges, criticSummary, hasIdeaMeta, issueKindText } from "../../queue/ideaQuality";
import type { IdeaMeta, PendingInterview, QueueCommand } from "../../types";

/** Badges (added by the controller, read-only) plus the command's contract: uses / provides / acceptance. */
export function CommandContract({ cmd }: { cmd: Pick<QueueCommand, "auto" | "kind" | "consumes" | "produces" | "acceptance"> }) {
  const { t } = useT();
  const badges = commandBadges(cmd, t);
  if (!badges.length && !cmd.consumes?.length && !cmd.produces?.length && !cmd.acceptance?.length) return null;
  return (
    <div className="iq-contract">
      {badges.length ? <div>{badges.map((b) => <span key={b} className="iq-badge">{b}</span>)}</div> : null}
      {cmd.consumes?.length ? <div className="queue-meta"><span>{t.iq_consumes}:</span> {cmd.consumes.map((x) => <code key={x} className="queue-chip">{x}</code>)}</div> : null}
      {cmd.produces?.length ? <div className="queue-meta"><span>{t.iq_produces}:</span> {cmd.produces.map((x) => <code key={x} className="queue-chip">{x}</code>)}</div> : null}
      {cmd.acceptance?.length ? (
        <div className="queue-meta">
          <span>{t.iq_acceptance}:</span>
          <ul className="iq-list">{cmd.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

/** Blueprint, critic issues, interview answers and notes of one idea (collapsed by default). */
export function IdeaMetaBox({ meta }: { meta: IdeaMeta | undefined }) {
  const { t } = useT();
  if (!meta || !hasIdeaMeta(meta)) return null;
  const critic = criticSummary(meta, t);
  const bp = meta.blueprint;
  return (
    <div className="iq-meta">
      {critic && (
        <details className="iq-critic">
          <summary>⚑ {critic}</summary>
          <ul className="iq-list">
            {meta.criticIssues!.map((i, k) => (
              <li key={k}><strong>{issueKindText(i.kind, t)}</strong>{i.commandId ? <> · <code className="queue-chip">{i.commandId}</code></> : null}: {i.note}</li>
            ))}
          </ul>
          {meta.resplitError ? <p className="queue-error">{meta.resplitError}</p> : null}
        </details>
      )}
      {bp && (
        <details className="iq-blueprint">
          <summary>{t.iq_blueprint}: {bp.goal}</summary>
          {bp.architecture ? <p><strong>{t.iq_architecture}:</strong> {bp.architecture}</p> : null}
          {bp.constraints.length ? <div><strong>{t.iq_constraints}:</strong><ul className="iq-list">{bp.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul></div> : null}
          {bp.interfaces.length ? (
            <div>
              <strong>{t.iq_interfaces}:</strong>
              <ul className="iq-list">{bp.interfaces.map((x, i) => <li key={i}><code>{x.name}</code> ({x.owner}){x.description ? ` · ${x.description}` : ""}</li>)}</ul>
            </div>
          ) : null}
        </details>
      )}
      {meta.interview && meta.interview.questions.length > 0 && (
        <details className="iq-interview">
          <summary>{t.iq_interview_answers}{meta.interview.skipped ? ` · ${t.iq_skipped}` : ""}</summary>
          <ol className="iq-list">
            {meta.interview.questions.map((q, i) => <li key={i}>{q}{meta.interview!.answers[i] ? <> → <em>{meta.interview!.answers[i]}</em></> : null}</li>)}
          </ol>
        </details>
      )}
      {meta.warnings?.length ? (
        <details className="iq-notes">
          <summary>{t.iq_notes} ({meta.warnings.length})</summary>
          <ul className="iq-list">{meta.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

/** Ideas waiting for interview answers: one small form each (answer, skip, or drop). */
export function PendingInterviews(p: {
  items: PendingInterview[];
  disabled: boolean;
  onAnswer: (id: string, body: { answers?: string[]; skip?: boolean; dismiss?: boolean }) => void;
}) {
  const { t } = useT();
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  if (p.items.length === 0) return null;
  return (
    <section className="iq-pending" data-testid="iq-pending">
      <h4>{t.iq_interview_title} ({p.items.length})</h4>
      {p.items.map((it) => {
        const d = drafts[it.id] ?? it.questions.map(() => "");
        const setAt = (i: number, v: string) => setDrafts((m) => ({ ...m, [it.id]: d.map((x, k) => (k === i ? v : x)) }));
        return (
          <div key={it.id} className="card iq-pending-item">
            <p className="iq-idea">{it.idea.length > 300 ? `${it.idea.slice(0, 300)}…` : it.idea}</p>
            {it.lastError ? <p className="queue-error">{t.iq_interview_lastError}: {it.lastError}</p> : null}
            <ol className="iq-list">
              {it.questions.map((q, i) => (
                <li key={i}>
                  <div>{q}</div>
                  <textarea rows={2} aria-label={`${t.iq_interview_answer} ${i + 1}`} placeholder={t.iq_interview_answer} maxLength={1000} value={d[i] ?? ""} onChange={(e) => setAt(i, e.target.value)} />
                </li>
              ))}
            </ol>
            <div className="queue-actions">
              <button type="button" disabled={p.disabled} onClick={() => p.onAnswer(it.id, { answers: d })}>{t.iq_interview_send}</button>
              <button type="button" disabled={p.disabled} onClick={() => p.onAnswer(it.id, { skip: true })}>{t.iq_interview_skip}</button>
              <button type="button" disabled={p.disabled} onClick={() => { if (window.confirm(t.iq_interview_dismiss_ask)) p.onAnswer(it.id, { dismiss: true }); }}>{t.iq_interview_dismiss}</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
