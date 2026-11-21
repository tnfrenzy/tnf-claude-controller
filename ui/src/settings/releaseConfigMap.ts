import { applyTemplate, type FormStep, type ReleaseForm } from "./releaseConfigForm";

/** Pure mapping between the release form and the server config shape (see src/core/release/config.ts). */
const INT_FIELDS = new Set(["expectStatus", "timeoutMin", "port"]);
/** Fields that may be omitted when empty; other fields are always sent for their step type. */
const OPTIONAL_FIELDS = new Set(["branch", "tag", "timeoutMin", "expectStatus"]);

export interface ReleaseConfigOut {
  template?: string;
  extraScripts: string[];
  steps: Record<string, unknown>[];
}

type TemplateLike = { template?: string; steps: ({ type: string } & Record<string, unknown>)[] };

function isTemplate(v: unknown): v is TemplateLike {
  return !!v && typeof v === "object" && Array.isArray((v as { steps?: unknown }).steps);
}

function stepToConfig(s: FormStep): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type };
  for (const [k, raw] of Object.entries(s.fields)) {
    const v = String(raw ?? "").trim();
    if (INT_FIELDS.has(k)) {
      if (!/^-?\d+$/.test(v)) continue;
      out[k] = parseInt(v, 10);
    } else if (v === "" && OPTIONAL_FIELDS.has(k)) {
      continue;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Enabled steps only; no unknown keys are added. */
export function formToConfig(form: ReleaseForm, extraScripts: string[] = []): ReleaseConfigOut {
  const out: ReleaseConfigOut = { extraScripts: [...extraScripts], steps: form.steps.filter((s) => s.enabled).map(stepToConfig) };
  if (form.template !== undefined) out.template = form.template;
  return out;
}

/** Build a form from the saved config; steps of the template missing from the config are shown disabled. */
export function configToForm(config: unknown, template: unknown): ReleaseForm {
  const tplForm: ReleaseForm = isTemplate(template) ? applyTemplate(template) : { steps: [] };
  if (!isTemplate(config) || config.steps.length === 0) return tplForm;
  const cfgForm = applyTemplate(config);
  const used = new Set<number>();
  const steps: FormStep[] = [];
  for (const ts of tplForm.steps) {
    const idx = cfgForm.steps.findIndex((c, i) => !used.has(i) && c.type === ts.type && (ts.type !== "build" || c.fields.script === ts.fields.script));
    if (idx >= 0) {
      used.add(idx);
      steps.push(cfgForm.steps[idx]!);
    } else {
      steps.push({ ...ts, enabled: false });
    }
  }
  cfgForm.steps.forEach((c, i) => {
    if (!used.has(i)) steps.push(c);
  });
  const form: ReleaseForm = { steps };
  const name = config.template ?? tplForm.template;
  if (name !== undefined) form.template = name;
  return form;
}
