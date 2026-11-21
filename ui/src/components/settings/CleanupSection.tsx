import { useState } from "react";
import { api, ApiError } from "../../api";
import { nextConfirmStep, type ConfirmState } from "../../lib/confirm";
import { parseDays, skipReasonKey, summarize } from "../../settings/cleanupSection";
import { useT } from "../../i18n";
import { formatBytes } from "../../skills/library";
import type { CleanupPreview } from "../../types";

/** Fill {name} placeholders with a replacer function (avoids the $ trap of String.replace). */
function fill(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, () => v);
  return out;
}

/** Settings block: preview and bulk cleanup of old run worktrees, with two-step confirmation. */
export function CleanupSection() {
  const { t } = useT();
  const [daysInput, setDaysInput] = useState("30");
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [previewDays, setPreviewDays] = useState(0);
  const [step, setStep] = useState<ConfirmState>("idle");
  const [second, setSecond] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const resetConfirm = () => {
    setStep((s) => nextConfirmStep(s, "cancel"));
    setSecond(false);
  };

  const onDaysChange = (v: string) => {
    setDaysInput(v);
    if (preview || done || error || step !== "idle") {
      setPreview(null);
      setDone(null);
      setError(null);
      resetConfirm();
    }
  };

  const showError = (e: unknown) => {
    setError(e instanceof ApiError ? e.message : String(e));
    resetConfirm();
  };

  const doPreview = async () => {
    const days = parseDays(daysInput);
    if (days === null) {
      setError(t.cleanup_bulk_err_days);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    resetConfirm();
    try {
      setPreview(await api.previewCleanup(days));
      setPreviewDays(days);
    } catch (e) {
      setPreview(null);
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const doRun = async () => {
    if (!preview) return;
    const sum = summarize(preview.plan);
    const next = nextConfirmStep(step, "confirm");
    if (next !== "execute") return;
    setStep(next);
    setBusy(true);
    try {
      await api.runCleanup({ confirm: true, olderThan: previewDays });
      setDone(fill(t.cleanup_bulk_done, { n: String(sum.n), size: formatBytes(sum.totalBytes) }));
      setPreview(null);
      setStep((s) => nextConfirmStep(s, "done"));
      setSecond(false);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const sum = preview ? summarize(preview.plan) : null;

  return (
    <div className="cleanup-section" data-testid="cleanup-section">
      <div className="row">
        <b>{t.cleanup_bulk_title}</b>
      </div>
      <div className="row">
        <label>
          {t.cleanup_bulk_days}{" "}
          <input type="text" inputMode="numeric" value={daysInput} disabled={busy} onChange={(e) => onDaysChange(e.target.value)} />
        </label>
        <button type="button" className="mini" disabled={busy} onClick={() => void doPreview()}>{t.cleanup_bulk_preview}</button>
      </div>
      {error && <div className="error">{error}</div>}
      {done && <div className="muted">{done}</div>}
      {preview && sum && (
        <div>
          {sum.n === 0 ? (
            <div className="muted">{t.cleanup_bulk_empty}</div>
          ) : (
            <>
              <table>
                <thead>
                  <tr><th>{t.cleanup_bulk_col_run}</th><th>{t.cleanup_bulk_col_branch}</th><th>{t.cleanup_bulk_col_size}</th></tr>
                </thead>
                <tbody>
                  {preview.plan.candidates.map((c) => (
                    <tr key={c.worktreePath}>
                      <td>{c.runIds.join(", ")}</td>
                      <td>{c.branch}</td>
                      <td>{formatBytes(c.estimatedBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>{fill(t.cleanup_bulk_total, { n: String(sum.n), size: formatBytes(sum.totalBytes) })}</div>
              {step === "idle" && (
                <button type="button" className="danger" disabled={busy} onClick={() => setStep((s) => nextConfirmStep(s, "ask"))}>{t.cleanup_bulk_btn}</button>
              )}
              {step === "confirm" && !second && (
                <div className="row">
                  <span>{fill(t.cleanup_bulk_confirm1, { n: String(sum.n) })}</span>
                  <button type="button" disabled={busy} onClick={() => setSecond(true)}>{t.cleanup_bulk_yes1}</button>
                  <button type="button" disabled={busy} onClick={resetConfirm}>{t.cleanup_bulk_no}</button>
                </div>
              )}
              {step === "confirm" && second && (
                <div className="row">
                  <span>{fill(t.cleanup_bulk_confirm2, { n: String(sum.n) })}</span>
                  <button type="button" className="danger" disabled={busy} onClick={() => void doRun()}>{t.cleanup_bulk_yes2}</button>
                  <button type="button" disabled={busy} onClick={resetConfirm}>{t.cleanup_bulk_no}</button>
                </div>
              )}
            </>
          )}
          {preview.plan.skipped.length > 0 && (
            <div>
              <b>{t.cleanup_skip_title}</b>
              <ul>
                {preview.plan.skipped.map((s) => (
                  <li key={`${s.runId}-${s.reason}`}>
                    {s.runId}: {fill(t[skipReasonKey(s.reason)], { days: String(previewDays), reason: s.reason })}
                    {s.detail ? ` (${s.detail})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
