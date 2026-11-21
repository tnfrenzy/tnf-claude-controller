import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import type { TemplateInfo } from "../../../src/core/shared-types";

/** Popup body: create a project (= a new floor of the tower), from an existing repo or from scratch with a template. */
export function AddFloorForm({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [base, setBase] = useState("main");
  const [allowed, setAllowed] = useState("");
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState<TemplateInfo["id"]>("blank");
  const [goal, setGoal] = useState("");
  const [parent, setParent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.scaffoldInfo().then((r) => { setTemplates(r.templates); setParent(r.defaultParent); }).catch(() => { /* the existing-repo mode still works */ });
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr(t.floor_err_name);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (mode === "new") {
        await api.scaffold({ name: name.trim(), template, goal: goal.trim(), parentDir: parent.trim() });
      } else {
        const cmds = allowed.split("\n").map((s) => s.trim()).filter(Boolean);
        const body: { name: string; repo_path?: string; base_branch?: string; allowed_commands?: string[] } = { name: name.trim() };
        if (repo.trim()) {
          body.repo_path = repo.trim();
          body.base_branch = base.trim() || "main";
        }
        if (cmds.length) body.allowed_commands = cmds;
        await api.addProject(body);
      }
      onDone();
    } catch (ex) {
      setErr(`${t.floor_err_create}: ${(ex as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 10 }}>
      <div className="row" role="group">
        <button type="button" aria-pressed={mode === "existing"} onClick={() => setMode("existing")}>{t.floor_mode_existing}</button>
        <button type="button" aria-pressed={mode === "new"} onClick={() => setMode("new")}>{t.floor_mode_new}</button>
      </div>
      <label>
        {t.floor_name}
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
      </label>
      {mode === "existing" ? (
        <>
          <label>
            {t.floor_repo}
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="D:\\code\\my-repo" style={{ width: "100%" }} />
          </label>
          <label>
            {t.floor_base}
            <input value={base} onChange={(e) => setBase(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            {t.floor_allowed}
            <textarea value={allowed} onChange={(e) => setAllowed(e.target.value)} rows={3} placeholder="Bash(pytest*)" style={{ width: "100%" }} />
          </label>
        </>
      ) : (
        <>
          <div className="muted">{t.sc_note}</div>
          <div className="scaffold-templates" role="radiogroup" aria-label={t.sc_template}>
            {templates.map((tp) => (
              <label key={tp.id} className={template === tp.id ? "on" : undefined}>
                <input type="radio" name="template" checked={template === tp.id} onChange={() => setTemplate(tp.id)} /> <b>{tp.title}</b>
                <div className="fine">{tp.summary}. {tp.whenToUse}</div>
              </label>
            ))}
          </div>
          <label>
            {t.sc_goal}
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={600} style={{ width: "100%" }} />
          </label>
          <label>
            {t.sc_parent}
            <input value={parent} onChange={(e) => setParent(e.target.value)} style={{ width: "100%" }} />
          </label>
        </>
      )}
      {err ? <div role="alert" style={{ color: "#ff5c5c" }}>{err}</div> : null}
      <div>
        <button type="submit" disabled={busy}>{mode === "new" ? t.sc_create : t.floor_create}</button>
      </div>
    </form>
  );
}
