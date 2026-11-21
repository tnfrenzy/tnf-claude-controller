import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../../api";
import { useT } from "../../i18n";
import { isLocalHost } from "../../settings/grantsView";
import { GymRoom } from "../office/GymRoom";
import { validateBriefDraft, validateScore } from "../../skills/skillBrief";
import type { BriefDraft } from "../../skills/skillBrief";
import { buildSeedSkillMd, canDownload, canGrade, composeBrief, roundPhase, isFinderBusy, slugFromTitle, validateMaxRounds } from "../../skills/skillGenForm";
import type { GenState, SkillSession } from "../../types";
import { DEFAULT_OUTPUT_CHOICES, OUTPUT_CHOICES, toggleOutput, type OutputFormat } from "../../skills/skillOutputs";
import { SampleFiles } from "./SampleFiles";

const FULL = { width: "100%", minWidth: 0, boxSizing: "border-box" } as const;
const WRAP = { display: "flex", flexWrap: "wrap", gap: 8, overflowWrap: "anywhere" } as const;

function errText(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

function parseOptional(s: string): number | undefined {
  const v = s.trim();
  return v === "" ? undefined : Number(v);
}

/** "Tạo mới" tab: generative skill training. Input stage and start flow. */
export function GenerativeTrainForm({ onDone, onStarted, resumeSlug }: { onDone: () => void; onStarted?: () => void; resumeSlug?: string }) {
  const { t: dict } = useT();
  const t = (k: string): string => (dict as unknown as Record<string, string>)[k] ?? k;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [cost, setCost] = useState("");
  const [minutes, setMinutes] = useState("");
  const [maxRounds, setMaxRounds] = useState("5");
  const [outputs, setOutputs] = useState<OutputFormat[]>([...DEFAULT_OUTPUT_CHOICES]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [slug, setSlug] = useState(resumeSlug ?? "");
  const [upgradeNote, setUpgradeNote] = useState("");
  const [upgrading, setUpgrading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [session, setSession] = useState<SkillSession | null>(null);
  const [gen, setGen] = useState<GenState | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [notes, setNotes] = useState<{ warnings: string[]; missing: boolean }>({ warnings: [], missing: false });
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [gradeErrors, setGradeErrors] = useState<Record<string, string>>({});
  const [gradeError, setGradeError] = useState("");
  const [grading, setGrading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  void onDone;
  const resuming = !!resumeSlug;

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // Reopened from the tower: the session lives on the server, so closing the popup never loses it.
  useEffect(() => {
    if (!resumeSlug) return;
    let alive = true;
    api.skillsGenGet(resumeSlug).then((r) => {
      if (!alive) return;
      setSlug(resumeSlug);
      setSession(r.session);
      setGen(r.gen);
    }).catch((err) => { if (alive) setLoadError(errText(err)); });
    return () => { alive = false; };
  }, [resumeSlug]);

  const phase = session ? roundPhase(session, gen) : null;
  const gradeAllowed = session ? canGrade(session, gen) : false;
  const curRound = session ? session.rounds[session.rounds.length - 1] : undefined;
  const [actError, setActError] = useState("");

  async function act(fn: () => Promise<unknown>) {
    setActError("");
    try {
      await fn();
      const r = await api.skillsGenGet(slug);
      setSession(r.session);
      setGen(r.gen);
    } catch (err) {
      setActError(`${t("skillg_err_generic")}: ${errText(err)}`);
    }
  }

  const busyFinder = isFinderBusy(gen) || phase === "generating" || phase === "finalizing" || gen?.sample?.status === "running";
  useEffect(() => {
    if (!busyFinder || !slug) return;
    const id = setInterval(() => {
      api.skillsGenGet(slug).then((r) => {
        setSession(r.session);
        setGen(r.gen);
      }).catch(() => {});
    }, 2000);
    timer.current = id;
    return () => {
      clearInterval(id);
      if (timer.current === id) timer.current = null;
    };
  }, [busyFinder, slug]);

  const derivedSlug = slugFromTitle(title);

  async function grade() {
    if (grading || !slug) return;
    const sc = score.trim() === "" ? Number.NaN : Number(score);
    const v = validateScore(sc, feedback);
    setGradeErrors(v.byKey);
    setGradeError("");
    if (v.issues.length > 0) return;
    setGrading(true);
    try {
      const next = await api.skillsGenGrade(slug, { score: sc, feedback: feedback.trim() });
      setSession(next);
      setFeedback("");
      setScore("");
    } catch (err) {
      setGradeError(`${t("skillg_err_generic")}: ${errText(err)}`);
    } finally {
      setGrading(false);
    }
  }

  async function upgrade() {
    if (upgrading || !slug) return;
    setUpgrading(true);
    await act(() => api.skillsGenUpgrade(slug, upgradeNote.trim()));
    setUpgradeNote("");
    setUpgrading(false);
  }

  async function download() {
    if (downloading || !slug) return;
    setDownloading(true);
    setDownloadError("");
    try {
      if (isLocalHost(window.location.hostname)) await api.saveSkillsGenMd(slug);
      else await api.downloadSkillsGenMd(slug);
    } catch (err) {
      // includes 400 skill_missing_md when SKILL.md is absent
      setDownloadError(`${t("skillg_err_download")}: ${errText(err)}`);
    } finally {
      setDownloading(false);
    }
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const draft: BriefDraft = {
      description,
      keywords: keywords.split(",").map((k) => k.trim()).filter((k, i, a) => k !== "" || a.length > 1),
    };
    const costVal = parseOptional(cost);
    if (costVal !== undefined) draft.costUsd = costVal;
    const minutesVal = parseOptional(minutes);
    if (minutesVal !== undefined) draft.timeMinutes = minutesVal;
    if (keywords.trim() === "") draft.keywords = [];
    const v = validateBriefDraft(draft);
    const errs: Record<string, string> = { ...v.byKey };
    if (!derivedSlug) errs.title = "Hãy nhập tên skill.";
    const mr = Number(maxRounds);
    const mrErr = validateMaxRounds(mr);
    if (mrErr) errs.maxRounds = mrErr;
    setErrors(errs);
    setError("");
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const s = derivedSlug;
    const brief = composeBrief(draft);
    try {
      try {
        await api.createSkill({ slug: s, title: title.trim().slice(0, 120), goal: brief.slice(0, 500), files: { "SKILL.md": buildSeedSkillMd(s, brief) } });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409 && err.code === "skill_exists")) {
          setError(`${t("skillg_err_create")}: ${errText(err)}`);
          return;
        }
      }
      try {
        await api.skillsGenStart({ slug: s, brief, maxRounds: mr });
      } catch (err) {
        setError(err instanceof ApiError && err.code === "session_exists" ? errText(err) : errText(err));
        return;
      }
      await api.skillsGenSetOutputs(s, outputs);
      await api.skillsGenFindRoles(s);
      const ag = await api.skillsGenCreateAgents(s, {});
      setNotes({ warnings: ag.warnings, missing: ag.missing });
      try {
        // Scan up to 10 GitHub agent repos in the background; the first sample round waits for it.
        await api.skillsGenFindGithub(s);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) setNotes({ warnings: [...ag.warnings, t("skillg_finder_failed")], missing: ag.missing });
      }
      try {
        await api.skillsGenGenerateSample(s);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
      }
      const r = await api.skillsGenGet(s);
      setSlug(s);
      setSession(r.session);
      setGen(r.gen);
      onStarted?.();
    } catch (err) {
      setError(`${t("skillg_err_generic")}: ${errText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={start} noValidate style={{ ...FULL, overflowWrap: "anywhere" }}>
      {resuming ? (loadError ? <div role="alert">{loadError}</div> : !session ? <div role="status">{t("skillg_loading_session")}</div> : null) : (<>
      <div className="field">
        <label htmlFor="skillg-title">{t("skillg_name")}</label>
        <input id="skillg-title" style={FULL} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <small>{t("skillg_slug")}: {derivedSlug || "-"}</small>
        {errors.title && <div role="alert">{errors.title}</div>}
      </div>
      <div className="field">
        <label htmlFor="skillg-description">{t("skillg_description")}</label>
        <textarea id="skillg-description" style={FULL} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
        {errors.description && <div role="alert">{errors.description}</div>}
      </div>
      <div className="field">
        <label htmlFor="skillg-keywords">{t("skillg_keywords")}</label>
        <input id="skillg-keywords" style={FULL} value={keywords} onChange={(e) => setKeywords(e.target.value)} disabled={busy} />
        {errors.keywords && <div role="alert">{errors.keywords}</div>}
      </div>
      <fieldset className="field" disabled={busy || !!session} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
        <legend>{t("skillg_outputs")}</legend>
        <div className="fine">{t("skillg_outputs_hint")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6 }}>
          {OUTPUT_CHOICES.map((c) => (
            <label key={c.id} title={c.hint} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={outputs.includes(c.id)} onChange={() => setOutputs((cur) => toggleOutput(cur, c.id))} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div style={WRAP}>
        <div className="field">
          <label htmlFor="skillg-cost">{t("skillg_cost")}</label>
          <input id="skillg-cost" inputMode="decimal" style={FULL} value={cost} onChange={(e) => setCost(e.target.value)} disabled={busy} />
          {errors.costUsd && <div role="alert">{errors.costUsd}</div>}
        </div>
        <div className="field">
          <label htmlFor="skillg-time">{t("skillg_time")}</label>
          <input id="skillg-time" inputMode="numeric" style={FULL} value={minutes} onChange={(e) => setMinutes(e.target.value)} disabled={busy} />
          {errors.timeMinutes && <div role="alert">{errors.timeMinutes}</div>}
        </div>
        <div className="field">
          <label htmlFor="skillg-max-rounds">{t("skillg_max_rounds")}</label>
          <input id="skillg-max-rounds" inputMode="numeric" style={FULL} value={maxRounds} onChange={(e) => setMaxRounds(e.target.value)} disabled={busy} />
          {errors.maxRounds && <div role="alert">{errors.maxRounds}</div>}
        </div>
      </div>
      {error && <div role="alert">{error}</div>}
      <button type="submit" disabled={busy}>{busy ? t("skillg_starting") : t("skillg_start")}</button>
      </>)}
      {gen && (
        <section>
          <h4>{t("skillg_roles_title")}</h4>
          <ul style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>
            {gen.roles.map((r) => (
              <li key={r.id}>
                <strong>{r.id}</strong> ({r.score}) {r.reasons.join("; ")}
              </li>
            ))}
          </ul>
          <h4>{t("skillg_repos_title")}</h4>
          {isFinderBusy(gen) && <div>{t("skillg_finder_running")}</div>}
          {gen.finder.status === "failed" && (
            <div role="alert">{t("skillg_finder_failed")}{gen.finder.error ? `: ${gen.finder.error}` : ""}</div>
          )}
          <details>
            <summary>{t("skillg_find_github")}</summary>
            <button type="button" disabled={isFinderBusy(gen)} onClick={() => void act(() => api.skillsGenFindGithub(slug))}>{t("skillg_find_github")}</button>
          </details>
          <ul style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>
            {gen.repos.slice(0, 10).map((r) => (
              <li key={r.url}>
                <strong>{r.name}</strong> <span style={{ overflowWrap: "anywhere" }}>{r.url}</span> {r.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      {session && (
        <GymRoom
          state={session.status}
          title={title.trim() || slug || t("gym_title")}
          round={session.rounds.length}
          maxRounds={session.maxRounds}
          best={session.rounds.reduce<number | null>((m, r) => (r.score !== undefined && (m === null || r.score > m) ? r.score : m), null)}
          generating={phase === "generating"}
        />
      )}
      {session && (
        <section>
          <h4>{t("skillg_agents_title")}</h4>
          <ul style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>
            {session.agents.map((a) => (
              <li key={a.id}>
                <strong>{a.id}</strong> [{a.source}] {a.description}
              </li>
            ))}
          </ul>
          {notes.missing && <div role="alert">{notes.warnings.join(" ")}</div>}
          {!notes.missing && notes.warnings.length > 0 && <div>{notes.warnings.join(" ")}</div>}
        </section>
      )}
      {session && (
        <section style={{ overflowWrap: "anywhere" }}>
          <h4>{t("skillg_score_title")}</h4>
          <div>{t("skillg_round")} {session.rounds.length}/{session.maxRounds}</div>
          <ul style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>
            {session.rounds.filter((r) => r.score !== undefined).map((r) => (
              <li key={r.n}>
                {t("skillg_round")} {r.n}: {r.score}{r.feedback ? ` - ${r.feedback}` : ""}
              </li>
            ))}
          </ul>
          <ul style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>
            {session.rounds.filter((r) => r.sample && r.score !== undefined).map((r) => (
              <li key={`f${r.n}`}>
                {t("skillg_round")} {r.n}:{" "}
                <SampleFiles slug={slug} n={r.n} sample={r.sample!} />
              </li>
            ))}
          </ul>
          {phase === "generating" && <div role="status">{t("skillg_generating_round").replace("{n}", String(session.rounds.length))}</div>}
          {phase === "paused" && (
            <div>
              <div role="alert">{session.rounds[session.rounds.length - 1]?.error ?? gen?.sample?.error ?? t("skillg_status_paused")}</div>
              <button type="button" onClick={() => void act(() => api.skillsGenGenerateSample(slug))}>{t("skillg_continue")}</button>
            </div>
          )}
          {phase === "ready_to_grade" && curRound?.sample && (
            <div>
              <SampleFiles slug={slug} n={curRound.n} sample={curRound.sample} />
              <div><strong>{t("skillg_round_summary")}:</strong> {curRound.sample.summary}</div>
            </div>
          )}
          {phase === "finalizing" && <div role="status">{t("skillg_finalizing")}</div>}
          {phase === "final_failed" && (
            <div>
              <div role="alert">{gen?.final?.error ?? t("skillg_err_generic")}</div>
              <button type="button" onClick={() => void act(() => api.skillsGenFinalize(slug))}>{t("skillg_retry")}</button>
            </div>
          )}
          {phase === "legacy_exhausted" && <div role="alert">{t("skillg_legacy_exhausted")}</div>}
          {actError && <div role="alert">{actError}</div>}
          {gradeAllowed && (
            <div>
              <div className="field">
                <label htmlFor="skillg-score">{t("skillg_score")}</label>
                <input id="skillg-score" inputMode="numeric" style={FULL} value={score} onChange={(e) => setScore(e.target.value)} disabled={grading} />
                {gradeErrors.score && <div role="alert">{gradeErrors.score}</div>}
              </div>
              <div className="field">
                <label htmlFor="skillg-feedback">{t("skillg_feedback")} ({feedback.length}/4000)</label>
                <textarea id="skillg-feedback" style={FULL} rows={4} maxLength={4000} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={grading} />
                {gradeErrors.feedback && <div role="alert">{gradeErrors.feedback}</div>}
              </div>
              {gradeError && <div role="alert">{gradeError}</div>}
              <button type="button" disabled={grading} onClick={() => void grade()}>{t("skillg_train_more")}</button>
            </div>
          )}
          {phase === "done" && canDownload(session) && (
            <div>
              <div>{t("skillg_completed")}</div>
              {downloadError && <div role="alert">{downloadError}</div>}
              <button type="button" disabled={downloading} onClick={() => void download()}>{t(isLocalHost(window.location.hostname) ? "open_file" : "skillg_download")}</button>
              <div className="field">
                <label htmlFor="skillg-upgrade-note">{t("skillg_upgrade_note")}</label>
                <textarea id="skillg-upgrade-note" style={FULL} rows={3} maxLength={4000} value={upgradeNote} onChange={(e) => setUpgradeNote(e.target.value)} disabled={upgrading} />
                <small>{t("skillg_upgrade_hint")}</small>
              </div>
              <button type="button" className="primary" disabled={upgrading} onClick={() => void upgrade()}>{upgrading ? t("skillg_upgrade_starting") : t("skillg_upgrade")}</button>
            </div>
          )}
        </section>
      )}
    </form>
  );
}
