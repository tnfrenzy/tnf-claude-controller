import { useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import type { Dict, Lang } from "../../i18n";
import type { ProjectSummary } from "../../types";
import type { ReleaseDryRun, ReleaseLogView } from "../../api";
import { formatCommandLine, formatTargets } from "../../settings/releaseFlow";
import { applyTemplate, canRunReal, needsCancelWarning, setStepField, toggleStep, validateForm } from "../../settings/releaseConfigForm";
import type { FormError, FormStep, ReleaseForm } from "../../settings/releaseConfigForm";
import { configToForm, formToConfig } from "../../settings/releaseConfigMap";

export interface ReleaseConfigSectionProps {
  lang: Lang;
  release?: { viaTunnel: boolean; allowed: boolean } | undefined;
}

interface FieldDef { name: string; label: keyof Dict; required: boolean }

const STEP_LABEL: Record<string, keyof Dict> = {
  bump: "relcfg_step_bump",
  build: "relcfg_step_build",
  tag: "relcfg_step_tag",
  "git-push": "relcfg_step_git_push",
  "project-script": "relcfg_step_project_script",
  healthcheck: "relcfg_step_healthcheck",
};

const STEP_FIELDS: Record<string, FieldDef[]> = {
  build: [{ name: "script", label: "relcfg_script", required: true }],
  tag: [{ name: "prefix", label: "relcfg_prefix", required: false }],
  "git-push": [
    { name: "remote", label: "relcfg_remote", required: true },
    { name: "branch", label: "relcfg_branch", required: false },
    { name: "tag", label: "relcfg_tag", required: false },
  ],
  "project-script": [
    { name: "target", label: "relcfg_target", required: true },
    { name: "keyPath", label: "relcfg_key_path", required: true },
    { name: "scriptPath", label: "relcfg_script_path", required: true },
    { name: "keyEnvName", label: "relcfg_key_env", required: true },
  ],
  healthcheck: [
    { name: "url", label: "relcfg_url", required: true },
    { name: "expectStatus", label: "relcfg_expect_status", required: false },
  ],
};

export function stepErrors(errors: FormError[], index: number, field: string): FormError[] {
  return errors.filter((e) => e.step === index && e.field === field);
}

function StepCard(props: { step: FormStep; index: number; errors: FormError[]; t: Dict; onToggle: () => void; onField: (f: string, v: string) => void }) {
  const { step, index, errors, t, onToggle, onField } = props;
  const label = t[STEP_LABEL[step.type] ?? "relcfg_step_build"] ?? step.type;
  const defs = STEP_FIELDS[step.type] ?? [];
  return (
    <div className="relcfg-step" data-step-type={step.type}>
      <label className="relcfg-toggle">
        <input type="checkbox" checked={step.enabled} onChange={onToggle} aria-label={label} />
        <b>{label}</b>
      </label>
      {step.enabled && defs.map((d) => {
        const errs = stepErrors(errors, index, d.name);
        return (
          <label key={d.name} className="relcfg-field">
            <span>{t[d.label]}{d.required ? <span className="relcfg-req" title={t.relcfg_required_mark}> *</span> : null}</span>
            <input
              type="text"
              value={step.fields[d.name] ?? ""}
              aria-invalid={errs.length > 0}
              onChange={(e) => onField(d.name, e.target.value)}
            />
            {errs.map((e) => <small key={e.key} className="relcfg-err" role="alert">{(t as Record<string, string>)[e.key] ?? e.key}</small>)}
          </label>
        );
      })}
    </div>
  );
}

export function ReleaseConfigSection(props: ReleaseConfigSectionProps) {
  const { t } = useT();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState("");
  const [templates, setTemplates] = useState<Record<string, unknown>>({});
  const [savedConfig, setSavedConfig] = useState<unknown>(null);
  const [template, setTemplate] = useState("");
  const [form, setForm] = useState<ReleaseForm>({ steps: [] });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ReleaseDryRun | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelAck, setCancelAck] = useState(false);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [log, setLog] = useState<ReleaseLogView | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.projects().then((r) => {
      if (cancelled) return;
      setProjects(r.projects);
      setProject((p) => p || r.projects[0]?.name || "");
    }).catch(() => { /* list stays empty */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setLoading(true);
    setMsg(null);
    api.getReleaseConfig(project).then((r) => {
      if (cancelled) return;
      const tpls = r.templates ?? {};
      const cfgName = (r.config as { template?: string } | null)?.template;
      const name = cfgName && cfgName in tpls ? cfgName : Object.keys(tpls)[0] ?? "";
      setTemplates(tpls);
      setSavedConfig(r.config);
      setTemplate(name);
      setForm(configToForm(r.config, tpls[name]));
    }).catch((e: unknown) => {
      if (!cancelled) setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project]);

  // REST polling every 3 s only; cleared on unmount, project change or when the log finishes.
  useEffect(() => {
    if (!releaseId) return;
    let cancelled = false;
    const tick = () => {
      api.getRelease(releaseId).then((l) => {
        if (cancelled) return;
        setLog(l);
        if (l.status !== "running" && timer !== undefined) { clearInterval(timer); timer = undefined; }
      }).catch(() => { /* log file may not exist yet */ });
    };
    let timer: ReturnType<typeof setInterval> | undefined = setInterval(tick, 3000);
    tick();
    return () => { cancelled = true; if (timer !== undefined) clearInterval(timer); };
  }, [releaseId]);

  useEffect(() => {
    setPreview(null);
    setLog(null);
    setReleaseId(null);
    setConfirmed(false);
    setCancelAck(false);
  }, [project]);

  const errors = validateForm(form);
  const realDisabled = Boolean(props.release?.viaTunnel) || !canRunReal(form, props.release, confirmed);
  const running = log?.status === "running" || (releaseId !== null && !log);
  const runningStep = log?.steps.find((s) => s.status === "running")?.type;
  const showCancelWarning = running && needsCancelWarning(runningStep, cancelAck);

  const pickTemplate = (name: string) => {
    setTemplate(name);
    const tpl = templates[name];
    if (tpl) setForm(applyTemplate(tpl as Parameters<typeof applyTemplate>[0]));
    else setForm(configToForm(savedConfig, undefined));
  };

  const save = async () => {
    if (!project || errors.length > 0) return;
    setSaving(true);
    setMsg(null);
    try {
      const extra = (savedConfig as { extraScripts?: string[] } | null)?.extraScripts ?? [];
      const r = await api.putReleaseConfig(project, { config: formToConfig(form, extra) });
      setSavedConfig(r.config);
      setMsg({ ok: true, text: t.relcfg_saved });
    } catch (e) {
      setMsg({ ok: false, text: `${t.relcfg_save_failed} ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const dryRun = async () => {
    if (!project) return;
    setPreviewing(true);
    setMsg(null);
    setPreview(null);
    try {
      // empty runId: the server treats it as "no run" (http.ts only reads a non-empty runId)
      setPreview(await api.releaseDryRun(project, ""));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPreviewing(false);
    }
  };

  const runReal = async () => {
    if (!project || realDisabled) return;
    setMsg(null);
    setLog(null);
    try {
      const r = await api.releaseExecute(project, "");
      setReleaseId(r.releaseId);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section className="relcfg-section" lang={props.lang}>
      <h3>{t.relcfg_title}</h3>
      {projects.length === 0 ? (
        <p className="muted">{t.relcfg_no_projects}</p>
      ) : (
        <>
          <label className="relcfg-field">
            <span>{t.relcfg_project}</span>
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label={t.relcfg_project}>
              {projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          <label className="relcfg-field">
            <span>{t.relcfg_template}</span>
            <select value={template} onChange={(e) => pickTemplate(e.target.value)} aria-label={t.relcfg_template}>
              {Object.keys(templates).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {loading ? <p className="muted">{t.relcfg_loading}</p> : (
            <div className="relcfg-steps">
              {form.steps.map((s, i) => (
                <StepCard
                  key={`${s.type}-${i}`}
                  step={s}
                  index={i}
                  errors={errors}
                  t={t}
                  onToggle={() => setForm((f) => toggleStep(f, i))}
                  onField={(field, v) => setForm((f) => setStepField(f, i, field, v))}
                />
              ))}
            </div>
          )}
          <div className="relcfg-actions">
            <button type="button" className="relcfg-btn" disabled={saving || loading || errors.length > 0} onClick={() => { void save(); }}>{t.relcfg_save}</button>
            <button type="button" className="relcfg-btn" disabled={previewing || loading || errors.length > 0} onClick={() => { void dryRun(); }}>{previewing ? t.rel_previewing : t.relcfg_dry_run}</button>
            {msg ? <span className={`pill ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</span> : null}
          </div>
          {preview ? (
            <div className="relcfg-preview">
              <h4>{t.rel_preview_title}</h4>
              {!preview.preconditions.ok ? <p className="relcfg-err" role="alert">{t.rel_precond_failed} {preview.preconditions.message ?? ""}</p> : null}
              {preview.error ? <p className="relcfg-err" role="alert">{preview.error}</p> : null}
              <ol className="relcfg-plan">
                {preview.plan.map((c) => (
                  <li key={c.stepIndex}>
                    <span>{c.description}</span>
                    <code className="relcfg-cmd">{formatCommandLine(c.argv)}</code>
                    <small className="muted"> {c.cwd}</small>
                  </li>
                ))}
              </ol>
              <h4>{t.rel_targets}</h4>
              <ul className="relcfg-targets">
                {formatTargets(preview.targets).map((x) => (
                  <li key={x.key}>{t[`rel_target_${x.key}` as keyof Dict]}: <code>{x.value}</code></li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="relcfg-real">
            <label className="relcfg-toggle">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{t.relcfg_confirm_push}</span>
            </label>
            <button type="button" className="relcfg-btn relcfg-real-btn" disabled={realDisabled} onClick={() => { void runReal(); }}>{t.relcfg_run_real}</button>
            {props.release?.viaTunnel ? <small className="muted" role="note">{t.relcfg_tunnel_disabled}</small> : null}
          </div>
          {showCancelWarning ? (
            <div className="relcfg-cancel-warning" role="alert">
              <p>{t.relcfg_cancel_warning}</p>
              <label className="relcfg-toggle">
                <input type="checkbox" checked={cancelAck} onChange={(e) => setCancelAck(e.target.checked)} />
                <span>{t.relcfg_cancel_ack}</span>
              </label>
            </div>
          ) : null}
          {releaseId ? (
            <div className="relcfg-progress">
              <h4>{t.relcfg_progress}</h4>
              <ul>
                {(log?.steps ?? []).map((s) => (
                  <li key={s.index} data-status={s.status}>{s.description}: {s.status === "ok" ? t.rel_step_ok : s.status === "failed" ? t.rel_step_failed : s.status === "skipped" ? t.rel_step_skipped : t.rel_running}</li>
                ))}
              </ul>
              {log?.error ? <p className="relcfg-err" role="alert">{log.error}</p> : null}
              {log && log.status !== "running" ? <p className={`pill ${log.status === "success" ? "ok" : "err"}`}>{log.status === "success" ? t.rel_done : t.rel_failed}</p> : null}
              <h4>{t.relcfg_log}</h4>
              <pre className="relcfg-log">{(log?.steps ?? []).map((s) => s.output).filter(Boolean).join("\n")}</pre>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
