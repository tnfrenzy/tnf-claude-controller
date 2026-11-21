import { useEffect, useState, type ReactNode } from "react";
import { api, type SkillRoundRecord, type SkillRoundsResponse } from "../../api";
import { useT } from "../../i18n";
import { isLocalHost } from "../../settings/grantsView";
import { buildSkillChart } from "../../skills/skillChart";
import { skillActions, validateGrade } from "../../skills/skillActions";
import { defaultSkillTab, resultsRoundList, type SkillTab } from "../../skills/skillResults";
import { GenerativeTrainForm } from "./GenerativeTrainForm";
import { GymRoom } from "../office/GymRoom";
import { Modal } from "../common/Modal";
import { SkillFormPopup } from "./SkillFormPopup";

const W = 320;
const H = 140;
const MAX_ERRORS = 8;

export interface SkillFloorViewProps {
  slug: string;
  title?: string | undefined;
  state: string;
  paused: boolean;
  rounds: SkillRoundRecord[];
  bestScore?: number | null | undefined;
  bestRound?: number | null | undefined;
  costUsdEstimate: number;
  actions?: ReactNode;
  onAction?: (name: SkillActionName) => void;
  busy?: boolean;
  error?: string | null;
  /** Output files of the round waiting for the user's grade. */
  roundFiles?: { name: string; size: number }[];
  onGrade?: (score: number, feedback: string) => void;
  /** Output files of every round, keyed by round number. */
  resultFiles?: Record<number, { name: string; size: number }[]> | undefined;
  initialTab?: SkillTab | undefined;
}

export function SkillFloorView(p: SkillFloorViewProps) {
  const { t } = useT();
  const [scoreText, setScoreText] = useState("");
  const [feedback, setFeedback] = useState("");
  const gradeError = validateGrade(scoreText, feedback);
  const waitingRound = p.rounds.length > 0 ? p.rounds[p.rounds.length - 1]!.n : 1;
  const chart = buildSkillChart(p.rounds, { width: W, height: H });
  const last = p.rounds.length > 0 ? p.rounds[p.rounds.length - 1]! : null;
  const errors = last ? last.errors.slice(0, MAX_ERRORS) : [];
  const flags = skillActions(p.state, p.paused, p.rounds.length > 0);
  const best = p.bestScore ?? chart.bestScore;
  const bestRound = p.bestRound ?? chart.bestRound;
  const [tab, setTab] = useState<SkillTab>(p.initialTab ?? defaultSkillTab(p.state));
  const awaitingNow = p.state === "awaiting_score";
  // Jump to results only when the skill first enters awaiting_score, never on repeated polls.
  useEffect(() => {
    if (awaitingNow) setTab("results");
  }, [awaitingNow]);
  return (
    <div className="skill-floor" style={{ maxWidth: "100%", overflowX: "hidden" }}>
      <GymRoom state={p.state} paused={p.paused} title={p.title ?? p.slug} round={p.rounds.length} best={best} />
      {/* Buttons sit right under the gym so pressing "train" never scrolls the room out of view. */}
      {p.error && <p className="error">{p.error}</p>}
      <div className="skill-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {BUTTONS.map((b) => (
          <button key={b.name} type="button" className={b.name === "approve" ? "primary" : undefined} disabled={!flags[b.flag] || !!p.busy} title={b.name === "delete" && !flags.delete ? t.skill_floor_delete_locked : undefined} onClick={() => p.onAction?.(b.name)}>
            {b.name === "zip" && typeof window !== "undefined" && isLocalHost(window.location.hostname) ? t.open_file : t[b.label]}
          </button>
        ))}
      </div>
      {p.actions}
      {flags.grade && (
        <section className="skill-grade">
          <h4>{t.skill_floor_round} {waitingRound} {t.skill_grade_waiting}</h4>
          <h5>{t.skill_grade_files}</h5>
          <ul>
            {(p.roundFiles ?? []).map((f) => (
              <li key={f.name} style={{ overflowWrap: "anywhere" }}>
                {f.name}{" "}
                <a href={api.skillRoundFileUrl(p.slug, waitingRound, f.name, false)} target="_blank" rel="noreferrer"
                  onClick={(e) => { e.preventDefault(); void api.openSkillRoundFile(p.slug, waitingRound, f.name); }}>{t.skill_grade_open}</a>{" "}
                <a href={api.skillRoundFileUrl(p.slug, waitingRound, f.name, true)}
                  onClick={(e) => { e.preventDefault(); void api.downloadSkillRoundFile(p.slug, waitingRound, f.name); }}>{t.skill_grade_download}</a>
              </li>
            ))}
          </ul>
          <label>{t.skill_grade_score}{" "}
            <input type="number" min={0} max={100} step={1} value={scoreText} onChange={(e) => setScoreText(e.target.value)} />
          </label>
          <label style={{ display: "block" }}>{t.skill_grade_feedback}
            <textarea rows={4} style={{ width: "100%" }} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          </label>
          {scoreText !== "" && gradeError && <p className="error">{gradeError}</p>}
          <button type="button" className="primary" disabled={!!gradeError || !!p.busy}
            onClick={() => p.onGrade?.(Number(scoreText), feedback)}>{t.skill_grade_submit}</button>
        </section>
      )}
      <p>
        {t.skill_floor_state}: {p.state}{p.paused ? " (⏸)" : ""} · {t.skill_floor_best}: {best ?? "–"}
        {bestRound ? ` (${t.skill_floor_round} ${bestRound})` : ""}
      </p>
      <div className="skill-tabs" role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(["overview", "results"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "primary" : undefined} onClick={() => setTab(k)}>
            {k === "overview" ? t.skill_tab_overview : t.skill_tab_results}
          </button>
        ))}
      </div>
      {tab === "results" && (
        <section className="skill-results">
          {p.rounds.length === 0 ? (
            <p>{t.skill_results_empty}</p>
          ) : (
            resultsRoundList(p.rounds, bestRound).map((r) => {
              const files = p.resultFiles?.[r.n] ?? [];
              return (
                <div key={r.n} className="skill-results-round">
                  <h5>{`${t.skill_floor_round} ${r.n}${r.isBest ? ` · ${t.skill_results_best}` : ""}${r.awaiting ? ` · ${t.skill_results_awaiting}` : ""}`}</h5>
                  {files.length === 0 ? (
                    <p>{t.skill_results_empty}</p>
                  ) : (
                    <ul>
                      {files.map((f) => (
                        <li key={f.name} style={{ overflowWrap: "anywhere" }}>
                          {f.name}{" "}
                          <a href={api.skillRoundFileUrl(p.slug, r.n, f.name, false)} target="_blank" rel="noreferrer"
                            onClick={(e) => { e.preventDefault(); void api.openSkillRoundFile(p.slug, r.n, f.name); }}>{t.skill_grade_open}</a>{" "}
                          <a href={api.skillRoundFileUrl(p.slug, r.n, f.name, true)}
                            onClick={(e) => { e.preventDefault(); void api.downloadSkillRoundFile(p.slug, r.n, f.name); }}>{t.skill_grade_download}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </section>
      )}
      {tab === "overview" && (<>
      <h4>{t.skill_floor_chart}</h4>
      {p.rounds.length === 0 ? (
        <p>{t.skill_floor_empty}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: "100%", height: "auto" }} role="img" aria-label={t.skill_floor_chart}>
          <line className="skill-pass-line" x1={0} x2={W} y1={chart.passY} y2={chart.passY} stroke="#c0392b" strokeDasharray="4 3" />
          <text x={W - 4} y={chart.passY - 3} textAnchor="end" fontSize={10} fill="#c0392b">{t.skill_floor_pass_line}</text>
          {chart.polyline && <polyline points={chart.polyline} fill="none" stroke="#2f6fed" strokeWidth={2} />}
          {chart.points.map((pt) => (
            <circle key={pt.n} cx={pt.x} cy={pt.y} r={pt.n === chart.bestRound ? 5 : 3} fill={pt.n === chart.bestRound ? "#e6a700" : "#2f6fed"}>
              <title>{`${t.skill_floor_round} ${pt.n}: ${pt.score}`}</title>
            </circle>
          ))}
        </svg>
      )}
      {p.rounds.length > 0 && (
        <>
          <h4>{t.skill_floor_rounds}</h4>
          <ul className="skill-rounds">
            {p.rounds.map((r) => (
              <li key={r.n}>
                {t.skill_floor_round} {r.n}: {r.score ?? "–"} · ${r.costUsdEstimate.toFixed(2)}
                {r.feedback ? <span style={{ display: "block", overflowWrap: "anywhere" }}>{t.skill_grade_yours}: {r.feedback}</span> : null}
              </li>
            ))}
          </ul>
          <h4>{t.skill_floor_errors}</h4>
          {errors.length === 0 ? (
            <p>{t.skill_floor_no_errors}</p>
          ) : (
            <ul className="skill-errors">
              {errors.map((e, i) => <li key={i} style={{ overflowWrap: "anywhere" }}>{e}</li>)}
            </ul>
          )}
        </>
      )}
      </>)}
      <p>{t.skill_floor_cost}: ${p.costUsdEstimate.toFixed(2)}</p>
    </div>
  );
}

export type SkillActionName = "train" | "stop" | "resume" | "approve" | "zip" | "restore-best" | "delete";

const BUTTONS: { name: SkillActionName; flag: "trainMore" | "stop" | "resume" | "approve" | "zip" | "restoreBest" | "delete"; label: "skill_btn_train_more" | "skill_btn_stop" | "skill_btn_resume" | "skill_btn_approve" | "skill_btn_zip" | "skill_btn_restore_best" | "skill_floor_delete" }[] = [
  { name: "train", flag: "trainMore", label: "skill_btn_train_more" },
  { name: "stop", flag: "stop", label: "skill_btn_stop" },
  { name: "resume", flag: "resume", label: "skill_btn_resume" },
  { name: "approve", flag: "approve", label: "skill_btn_approve" },
  { name: "zip", flag: "zip", label: "skill_btn_zip" },
  { name: "restore-best", flag: "restoreBest", label: "skill_btn_restore_best" },
  { name: "delete", flag: "delete", label: "skill_floor_delete" }
];

/** Pure branch choice: the form popup replaces the view while the orchestrator waits for the user. */
export function chooseSkillBranch(state: string, paused: boolean, hasRounds: boolean): "form" | "view" {
  return skillActions(state, paused, hasRounds).openForm ? "form" : "view";
}

export function SkillFloorPopup({ slug, title, onClose, onDeleted }: { slug: string; title?: string; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useT();
  const [data, setData] = useState<SkillRoundsResponse | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // A skill trained with the generative flow ("Tạo mới") keeps its session on the server: show it, never the empty legacy view.
  const [genSession, setGenSession] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    setGenSession(null);
    api.skillsGenGet(slug).then(() => alive && setGenSession(true)).catch(() => alive && setGenSession(false));
    return () => { alive = false; };
  }, [slug]);
  const [resultFiles, setResultFiles] = useState<Record<number, { name: string; size: number }[]>>({});
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      Promise.all([api.getSkillRounds(slug), api.getSkill(slug).catch(() => null)])
        .then(([d, s]) => {
          if (!alive) return;
          setData(d);
          setPaused(s?.meta?.paused === true);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [slug, tick]);
  const rounds = data?.rounds ?? [];
  const waitingN = rounds.length > 0 ? rounds[rounds.length - 1]!.n : 1;
  const awaiting = data?.state === "awaiting_score";
  const roundsKey = rounds.map((r) => r.n).join(",");
  const dataState = data?.state;
  useEffect(() => {
    if (roundsKey === "") { setResultFiles({}); return; }
    let alive = true;
    const ns = roundsKey.split(",").map(Number);
    Promise.all(
      ns.map((n) =>
        api.listSkillRoundFiles(slug, n).then((r) => r.files).catch(() => [] as { name: string; size: number }[]),
      ),
    ).then((lists) => {
      if (!alive) return;
      const next: Record<number, { name: string; size: number }[]> = {};
      ns.forEach((n, i) => { next[n] = lists[i] ?? []; });
      setResultFiles(next);
    });
    return () => { alive = false; };
  }, [slug, roundsKey, dataState]);
  const files = awaiting ? resultFiles[waitingN] ?? [] : [];
  const onGrade = (score: number, feedback: string) => {
    setBusy(true);
    setError(null);
    api.gradeSkillRound(slug, score, feedback)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setBusy(false); setTick((n) => n + 1); });
  };
  const onAction = (name: SkillActionName) => {
    if (name === "approve" && !window.confirm(t.skill_confirm_approve)) return;
    if (name === "restore-best" && !window.confirm(t.skill_confirm_restore_best)) return;
    if (name === "delete") {
      if (!window.confirm(`${t.skill_floor_delete_confirm}${title ?? slug}`)) return;
      setBusy(true);
      setError(null);
      api.deleteSkill(slug)
        .then(() => { onDeleted?.(); onClose(); })
        .catch((e) => { setError(t.skill_floor_delete_err + (e instanceof Error ? e.message : String(e))); setBusy(false); });
      return;
    }
    setBusy(true);
    setError(null);
    const run: Promise<unknown> =
      name === "train" ? api.trainSkill(slug)
      : name === "stop" ? api.stopSkill(slug)
      : name === "resume" ? api.resumeSkill(slug)
      : name === "approve" ? api.approveSkill(slug)
      : name === "restore-best" ? api.restoreBestSkill(slug)
      : isLocalHost(window.location.hostname) ? api.saveSkillZip(slug) : api.downloadSkillZip(slug);
    run
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setBusy(false); setTick((n) => n + 1); });
  };
  if (genSession === true) {
    return (
      <Modal title={title ?? slug} size="large" onClose={onClose}>
        <GenerativeTrainForm resumeSlug={slug} onDone={onClose} />
        {error && <p className="error">{error}</p>}
        <p>
          <button type="button" disabled={busy} onClick={() => onAction("delete")}>{t.skill_floor_delete}</button>
        </p>
      </Modal>
    );
  }
  if (genSession === null) {
    return <Modal title={title ?? slug} size="large" onClose={onClose}><p>{t.skill_floor_loading}</p></Modal>;
  }
  if (data && chooseSkillBranch(data.state, paused, rounds.length > 0) === "form") {
    return <SkillFormPopup slug={slug} onClose={onClose} />;
  }
  return (
    <Modal title={title ?? slug} size="large" onClose={onClose}>
      {data ? (
        <SkillFloorView
          slug={slug}
          title={title ?? slug}
          state={data.state}
          paused={paused}
          onAction={onAction}
          onGrade={onGrade}
          roundFiles={files}
          resultFiles={resultFiles}
          initialTab={defaultSkillTab(data.state)}
          busy={busy}
          error={error}
          rounds={rounds}
          bestScore={data.bestScore}
          bestRound={data.bestRound}
          costUsdEstimate={rounds.reduce((s, r) => s + (r.costUsdEstimate || 0), 0)}
        />
      ) : (
        <p>{t.skill_floor_loading}</p>
      )}
    </Modal>
  );
}
