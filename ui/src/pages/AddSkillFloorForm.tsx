import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api";
import { useT } from "../i18n";
import { buildAttachmentPlan, buildSkillFiles, emptyDraft, holdoutCount, RECOMMENDED_HOLDOUT, skillCreateError, skillFieldId, validateSkillDraftFields } from "../skills/skillCreate";
import type { SkillExample } from "../skills/skillCreate";
import { stageAttachments } from "../skills/skillUpload";
import type { StageInbox } from "../skills/skillUpload";
import { AttachPicker } from "../components/common/AttachPicker";
import { GenerativeTrainForm } from "../components/skills/GenerativeTrainForm";

type Side = "input" | "expected";
type FileSlot = { input: File[]; expected: File[] };
const NO_FILES = (): FileSlot => ({ input: [], expected: [] });

/** Upload files one by one into a single inbox stage (the API takes one file per call). */
const stageInbox: StageInbox = async (files) => {
  let stage: string | null = null;
  for (const f of files) {
    const r = await api.stageInbox(f, stage);
    stage = r.stage_id;
  }
  return { stageId: stage ?? "" };
};

const FULL = { width: "100%", minWidth: 0, boxSizing: "border-box" } as const;

function Star() {
  return <span aria-hidden="true" style={{ color: "#ff5c5c", marginLeft: 4 }}>*</span>;
}

/** Popup body: tabs for the input/output pairs form and the generative "Tạo mới" form. */
export function AddSkillFloorForm({ onDone, onStarted }: { onDone: () => void; onStarted?: () => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<"pairs" | "gen">("pairs");
  const label = (k: string): string => (t as unknown as Record<string, string>)[k] ?? k;
  return (
    <div style={{ minWidth: 0 }}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "pairs"} className={tab === "pairs" ? "active" : ""} onClick={() => setTab("pairs")}>{label("skillg_tab_pairs")}</button>
        <button type="button" role="tab" aria-selected={tab === "gen"} className={tab === "gen" ? "active" : ""} onClick={() => setTab("gen")}>{label("skillg_tab_gen")}</button>
      </div>
      {tab === "pairs" ? <PairsForm onDone={onDone} /> : <GenerativeTrainForm onDone={onDone} {...(onStarted ? { onStarted } : {})} />}
    </div>
  );
}

function PairsForm({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const init = emptyDraft();
  const [title, setTitle] = useState("");
  const [inputDesc, setInputDesc] = useState("");
  const [outputDesc, setOutputDesc] = useState("");
  const [examples, setExamples] = useState<SkillExample[]>(init.examples);
  const [passScore, setPassScore] = useState(String(init.passScore));
  const [maxRounds, setMaxRounds] = useState(String(init.maxRounds));
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [scrollKey, setScrollKey] = useState<string | undefined>(undefined);
  const [attempts, setAttempts] = useState(0);

  const [fileStore, setFileStore] = useState<FileSlot[]>(() => init.examples.map(NO_FILES));

  function patchEx(i: number, p: Partial<SkillExample>) {
    setExamples((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  }

  function setSideFiles(i: number, side: Side, next: File[]) {
    setFileStore((fs) => fs.map((s, j) => (j === i ? { ...s, [side]: next } : s)));
    const meta = next.map((f) => ({ name: f.name, size: f.size }));
    patchEx(i, side === "input" ? { inputFiles: meta } : { expectedFiles: meta });
  }

  function removeExample(i: number) {
    setExamples((xs) => xs.filter((_, j) => j !== i));
    setFileStore((fs) => fs.filter((_, j) => j !== i));
  }

  function addExample() {
    setExamples((xs) => [...xs, { input: "", expected: "", holdout: false }]);
    setFileStore((fs) => [...fs, NO_FILES()]);
  }

  function currentDraft() {
    const draft = { title, inputDesc, outputDesc, examples, passScore: passScore.trim() === "" ? Number.NaN : Number(passScore), maxRounds: maxRounds.trim() === "" ? Number.NaN : Number(maxRounds) };
    return { draft, ...validateSkillDraftFields(draft) };
  }

  useEffect(() => {
    if (!scrollKey) return;
    const el = document.getElementById(skillFieldId(scrollKey));
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    }
  }, [scrollKey, attempts]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { draft, issues, firstKey } = currentDraft();
    setAttempted(true);
    if (issues.length) {
      setScrollKey(firstKey);
      setAttempts((n) => n + 1);
      setErrs([]);
      return;
    }
    setScrollKey(undefined);
    setBusy(true);
    setErrs([]);
    let slug = "";
    try {
      const { title: tt, goal, files } = buildSkillFiles(draft);
      const plan = buildAttachmentPlan(draft.examples);
      const filesMap: Record<string, File[]> = {};
      let tn = 0;
      let hn = 0;
      draft.examples.forEach((ex, i) => {
        const pair = ex.holdout ? `holdout-${++hn}` : `train-${++tn}`;
        filesMap[`${pair}/input`] = fileStore[i]?.input ?? [];
        filesMap[`${pair}/expected`] = fileStore[i]?.expected ?? [];
      });
      const attachments = plan.length ? await stageAttachments(plan, filesMap, stageInbox) : undefined;
      const created = await api.createSkill({ title: tt, goal, files, ...(attachments ? { attachments } : {}) });
      slug = created.meta.slug;
    } catch (ex) {
      const a = ex instanceof ApiError ? ex : null;
      setErrs([`${t.skillf_err_create}: ${skillCreateError(a?.status, a?.code, (ex as Error).message)}`]);
      setBusy(false);
      return;
    }
    try {
      await api.startSkill(slug, { passScore: draft.passScore, maxRounds: draft.maxRounds });
    } catch (ex) {
      setErrs([`${t.skillf_err_start}: ${(ex as Error).message}`]);
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
  }

  const fieldErr = attempted ? currentDraft().byKey : {};
  const errOf = (key: string) =>
    fieldErr[key] ? (
      <div id={`${skillFieldId(key)}-err`} role="alert" style={{ color: "#ff5c5c", fontSize: 13 }}>{fieldErr[key]}</div>
    ) : null;
  const aria = (key: string) => ({
    id: skillFieldId(key),
    "aria-required": true as const,
    ...(fieldErr[key] ? { "aria-invalid": true as const, "aria-describedby": `${skillFieldId(key)}-err` } : {})
  });

  return (
    <form onSubmit={(e) => void submit(e)} noValidate style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <div style={{ opacity: 0.8 }}>{t.skillf_required_note}</div>
      <label>
        {t.skillf_name}<Star />
        <input {...aria("title")} value={title} onChange={(e) => setTitle(e.target.value)} style={FULL} />
        {errOf("title")}
      </label>
      <label>
        {t.skillf_input}<Star />
        <textarea {...aria("inputDesc")} value={inputDesc} onChange={(e) => setInputDesc(e.target.value)} rows={2} style={FULL} />
        {errOf("inputDesc")}
      </label>
      <label>
        {t.skillf_output}<Star />
        <textarea {...aria("outputDesc")} value={outputDesc} onChange={(e) => setOutputDesc(e.target.value)} rows={2} style={FULL} />
        {errOf("outputDesc")}
      </label>
      <fieldset style={{ minWidth: 0, margin: 0 }}>
        <legend>{t.skillf_examples}<Star /></legend>
        {errOf("examples")}
        {examples.map((ex, i) => (
          <div key={i} style={{ display: "grid", gap: 6, marginBottom: 10, minWidth: 0 }}>
            <strong>{t.skillf_ex_n} {i + 1}</strong>
            <label>
              {t.skillf_ex_input}<Star />
              <textarea {...aria(`ex.${i}.input`)} value={ex.input} onChange={(e) => patchEx(i, { input: e.target.value })} rows={2} style={FULL} />
              {errOf(`ex.${i}.input`)}
            </label>
            <label>
              {t.skillf_ex_expected}<Star />
              <textarea {...aria(`ex.${i}.expected`)} value={ex.expected} onChange={(e) => patchEx(i, { expected: e.target.value })} rows={2} style={FULL} />
              {errOf(`ex.${i}.expected`)}
            </label>
            <AttachPicker label={t.skillf_files_input} files={ex.inputFiles ?? []} onAdd={(fs) => setSideFiles(i, "input", [...(fileStore[i]?.input ?? []), ...fs])} onRemove={(k) => setSideFiles(i, "input", (fileStore[i]?.input ?? []).filter((_, j) => j !== k))} />
            <AttachPicker label={t.skillf_files_expected} files={ex.expectedFiles ?? []} onAdd={(fs) => setSideFiles(i, "expected", [...(fileStore[i]?.expected ?? []), ...fs])} onRemove={(k) => setSideFiles(i, "expected", (fileStore[i]?.expected ?? []).filter((_, j) => j !== k))} />
            <label style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0 }}>
              <input type="checkbox" checked={ex.holdout} onChange={(e) => patchEx(i, { holdout: e.target.checked })} {...(i === 0 ? { id: skillFieldId("holdout") } : {})} />
              <span>{t.skillf_ex_holdout}</span>
            </label>
            {i === examples.length - 1 ? errOf("holdout") : null}
            {examples.length > 1 ? (
              <div>
                <button type="button" onClick={() => removeExample(i)}>{t.skillf_ex_remove}</button>
              </div>
            ) : null}
          </div>
        ))}
        <button type="button" onClick={addExample}>{t.skillf_ex_add}</button>
        {holdoutCount({ examples }) < RECOMMENDED_HOLDOUT ? <div style={{ opacity: 0.75, marginTop: 6 }}>{t.skillf_holdout_hint}</div> : null}
      </fieldset>
      <label>
        {t.skillf_pass}<Star />
        <input {...aria("passScore")} type="number" min={1} max={100} value={passScore} onChange={(e) => setPassScore(e.target.value)} style={FULL} />
        {errOf("passScore")}
      </label>
      <label>
        {t.skillf_rounds}<Star />
        <input {...aria("maxRounds")} type="number" min={1} max={20} value={maxRounds} onChange={(e) => setMaxRounds(e.target.value)} style={FULL} />
        {errOf("maxRounds")}
      </label>
      {errs.length ? (
        <div role="alert" style={{ color: "#ff5c5c" }}>
          {errs.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      ) : null}
      <div>
        <button type="submit" disabled={busy}>{t.skillf_submit}</button>
      </div>
    </form>
  );
}
