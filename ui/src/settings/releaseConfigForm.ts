/** Pure logic for the release-config form (no React, no network). Mirrors server rules in src/core/release/config.ts. */
export interface FormStep {
  type: string;
  enabled: boolean;
  fields: Record<string, string>;
}

export interface ReleaseForm {
  template?: string;
  steps: FormStep[];
}

export interface ReleaseFlagInfo { viaTunnel: boolean; allowed: boolean }

export interface FormError { step: number; field: string; key: string }

type RawStep = { type: string } & Record<string, unknown>;

/** Convert a config-like template ({steps:[{type,...}]}) into a form; all steps enabled. */
export function applyTemplate(template: { template?: string; steps: RawStep[] }): ReleaseForm {
  const form: ReleaseForm = {
    steps: template.steps.map((s) => {
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(s)) if (k !== "type" && v !== undefined) fields[k] = String(v);
      return { type: s.type, enabled: true, fields };
    }),
  };
  if (template.template !== undefined) form.template = template.template;
  return form;
}

export function toggleStep(form: ReleaseForm, index: number, enabled?: boolean): ReleaseForm {
  if (index < 0 || index >= form.steps.length) return form;
  return {
    ...form,
    steps: form.steps.map((s, i) => (i === index ? { ...s, enabled: enabled ?? !s.enabled } : s)),
  };
}

export function setStepField(form: ReleaseForm, index: number, field: string, value: string): ReleaseForm {
  if (index < 0 || index >= form.steps.length) return form;
  return {
    ...form,
    steps: form.steps.map((s, i) => (i === index ? { ...s, fields: { ...s.fields, [field]: value } } : s)),
  };
}

const TARGET_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const REMOTE_RE = /^[A-Za-z0-9._-]+$/;

function validateStep(s: FormStep, i: number): FormError[] {
  const errs: FormError[] = [];
  const f = s.fields;
  const bad = (field: string, key: string) => errs.push({ step: i, field, key });
  if (s.type === "git-push") {
    const remote = (f.remote ?? "").trim();
    if (!remote) bad("remote", "relcfg_err_required");
    else if (!REMOTE_RE.test(remote) || remote.startsWith("-") || remote.includes("..")) bad("remote", "relcfg_err_remote");
    for (const k of ["branch", "tag"]) {
      const v = (f[k] ?? "").trim();
      if (v && (v.startsWith("-") || v.startsWith("+") || v.includes(":") || /\s/.test(v) || v.includes(".."))) bad(k, "relcfg_err_ref");
    }
  } else if (s.type === "project-script") {
    const p = (f.scriptPath ?? "").trim();
    if (!p) bad("scriptPath", "relcfg_err_required");
    else if (p.includes("..") || p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) bad("scriptPath", "relcfg_err_script_path");
    else if (!p.endsWith(".sh")) bad("scriptPath", "relcfg_err_script_ext");
    const t = (f.target ?? "").trim();
    if (!t) bad("target", "relcfg_err_required");
    else if (!TARGET_RE.test(t)) bad("target", "relcfg_err_target");
    const k = (f.keyPath ?? "").trim();
    if (!k) bad("keyPath", "relcfg_err_required");
    else if (k.startsWith("-") || k.includes("..") || /[\r\n\0]/.test(k)) bad("keyPath", "relcfg_err_key_path");
    const e = (f.keyEnvName ?? "").trim();
    if (!e) bad("keyEnvName", "relcfg_err_required");
    else if (!ENV_NAME_RE.test(e)) bad("keyEnvName", "relcfg_err_env_name");
  } else if (s.type === "healthcheck") {
    const u = (f.url ?? "").trim();
    if (!u) bad("url", "relcfg_err_required");
    else if (!/^https?:\/\/[^\s]+$/i.test(u)) bad("url", "relcfg_err_url");
  }
  return errs;
}

/** Validate enabled steps only; returns i18n error keys (empty = valid). */
export function validateForm(form: ReleaseForm): FormError[] {
  const errs: FormError[] = [];
  form.steps.forEach((s, i) => {
    if (s.enabled) errs.push(...validateStep(s, i));
  });
  return errs;
}

/** Real release needs the confirmation tick, and must not run via tunnel unless allowed. */
export function canRunReal(form: ReleaseForm, flag: ReleaseFlagInfo | undefined, confirmed: boolean): boolean {
  if (!confirmed) return false;
  if (flag && flag.viaTunnel && !flag.allowed) return false;
  if (!form.steps.some((s) => s.enabled)) return false;
  return validateForm(form).length === 0;
}

/** Cancel button for a running project-script appears only after the user acknowledged the lock warning. */
export function needsCancelWarning(runningStepType: string | undefined, warningAcknowledged: boolean): boolean {
  return runningStepType === "project-script" && !warningAcknowledged;
}
