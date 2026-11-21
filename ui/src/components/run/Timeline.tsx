import { useEffect, useMemo, useRef, useState } from "react";
import { roleLabel, useT } from "../../i18n";
import type { AgentInfo, StoredEvent } from "../../types";
import { isNearBottom, liveLength } from "../../run/timelineScroll";
import { isHiddenWhenToolsOff } from "../../run/timelineFilter";
import { VerdictBadge, verdictTone } from "./Verdict";

interface Props {
  events: StoredEvent[];
  agents: AgentInfo[];
  /** Live partial text per agent (from text.delta), cleared when the full message arrives. */
  live: Record<string, string>;
}

const SYS = new Set(["run.started", "run.result", "run.error", "run.cancelled", "api.retry", "agent.started", "agent.finished"]);

export function Timeline({ events, agents, live }: Props) {
  const { t, lang } = useT();
  const [showTools, setShowTools] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [away, setAway] = useState(false);
  const roleOf = useMemo(() => {
    const m = new Map(agents.map((a) => [a.agent_id, a.role] as const));
    return (id: string) => m.get(id) ?? (id === "coordinator" ? "coordinator" : "unknown");
  }, [agents]);

  const liveLen = liveLength(live);
  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length, liveLen, showTools]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    stickRef.current = near;
    setAway((a) => (a === !near ? a : !near));
  };
  const toBottom = () => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setAway(false);
  };

  const visible = useMemo(() => events.filter((s) => {
    const e = s.event;
    if (e.type === "text.delta" || e.type === "thinking.delta" || e.type === "usage.update" || e.type === "unknown" || e.type === "run.segment") return false;
    if (!showTools && isHiddenWhenToolsOff(e)) return false;
    return true;
  }), [events, showTools]);

  return (
    <div className="timeline-wrap">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <b>{t.timeline}</b>
        <button onClick={() => setShowTools((v) => !v)}>{showTools ? t.hide_tools : t.show_tools}</button>
      </div>
      {away && <button className="to-bottom" onClick={toBottom}>{t.scroll_bottom}</button>}
      <div className="timeline" ref={boxRef} onScroll={onScroll}>
        {visible.map((s) => (
          <Row key={s.seq} s={s} roleOf={roleOf} />
        ))}
        {Object.entries(live).map(([agentId, text]) =>
          text ? (
            <div key={`live-${agentId}`} className={`ev live ${roleOf(agentId)}`}>
              <span className="role">{roleLabel(roleOf(agentId), lang)}</span>
              <span className="text">{text}</span>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Row({ s, roleOf }: { s: StoredEvent; roleOf: (id: string) => string }) {
  const { t, lang } = useT();
  const e = s.event;
  const time = new Date(s.ts).toLocaleTimeString("vi-VN", { hour12: false });
  switch (e.type) {
    case "run.started":
      return <div className="ev sys"><span className="role">{time}</span><span>▶ {e.model ?? ""} · claude {e.claude_version ?? "?"} · {t.session} {e.session_id ?? "?"}</span></div>;
    case "agent.started":
      return <div className={`ev ${e.role}`}><span className="role">{roleLabel(roleOf(e.parent_id ?? "coordinator"), lang)}</span><span>＋ {roleLabel(e.role, lang)}{e.description ? ` — ${e.description}` : ""}</span></div>;
    case "agent.finished":
      return <div className={`ev ${roleOf(e.agent_id)} ${e.status && e.status !== "completed" ? "err" : ""}`}><span className="role">{roleLabel(roleOf(e.agent_id), lang)}</span><span className="text">✓ {e.summary}</span></div>;
    case "agent.progress":
      return <div className={`ev ${roleOf(e.agent_id)}`}><span className="role">{roleLabel(roleOf(e.agent_id), lang)}</span><span className="tool">⏳ {e.description ?? ""} · {e.total_tokens} tok · {e.tool_uses} tool · {Math.round(e.duration_ms / 1000)}s{e.last_tool ? ` · ${e.last_tool}` : ""}</span></div>;
    case "text.message":
      return <div className={`ev ${roleOf(e.agent_id)}`}><span className="role">{roleLabel(roleOf(e.agent_id), lang)}</span><span className="text">{e.text}</span></div>;
    case "tool.use":
      return (
        <div className={`ev ${roleOf(e.agent_id)}`}>
          <span className="role">{roleLabel(roleOf(e.agent_id), lang)}</span>
          <details className="tool">
            <summary>🔧 {e.tool}: {e.input_summary}</summary>
            {e.input !== undefined && <pre>{JSON.stringify(e.input, null, 2)}</pre>}
          </details>
        </div>
      );
    case "tool.result":
      return <div className={`ev ${roleOf(e.agent_id)} ${e.ok ? "" : "err"}`}><span className="role">{roleLabel(roleOf(e.agent_id), lang)}</span><span className="tool">{e.ok ? "↳" : "✖"} {e.summary}</span></div>;
    case "permission.denied":
      return <div className="ev err"><span className="role">{time}</span><span>⛔ {t.denied}: {e.tool} — {e.reason}</span></div>;
    case "api.retry":
      return <div className="ev sys"><span className="role">{time}</span><span>↻ {t.retry} #{e.attempt}: {e.error}</span></div>;
    case "run.result":
      return <div className={`ev sys ${e.ok ? "" : "err"}`}><span className="role">{time}</span><span>■ {e.ok ? t.status_done : t.status_error} · {t.turns} {e.num_turns} · {Math.round(e.duration_ms / 1000)}s · {t.cost} ${e.cost_usd_est.toFixed(4)}</span></div>;
    case "run.error":
      return <div className="ev err"><span className="role">{time}</span><span>✖ {e.kind}: {e.message}</span></div>;
    case "run.cancelled":
      return <div className="ev sys"><span className="role">{time}</span><span>■ {t.status_cancelled}</span></div>;
    case "notice":
      return <div className={`ev ${/error/i.test(e.key) ? "err" : "sys"}`}><span className="role">{time}</span><span>ℹ {e.text}{e.key ? ` (${e.key})` : ""}</span></div>;
    case "agent.verdict":
      return (
        <div className={`ev verdict-row ${e.role} ${verdictTone(e.verdict)}`}>
          <span className="role">{roleLabel(e.role, lang)}</span>
          <span>{t.verdict}: <VerdictBadge verdict={e.verdict} lang={lang} role={e.role} /></span>
        </div>
      );
    case "vcs.commit":
      return (
        <div className="ev milestone">
          <span className="role">{time}</span>
          <span>⎇ {t.commit_milestone} · <span className="mono">{e.branch || "?"}</span>{e.kind && e.kind !== "commit" ? ` · ${e.kind}` : ""}</span>
        </div>
      );
    default:
      return SYS.has(e.type) ? null : null;
  }
}
