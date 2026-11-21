import { roleLabel, useT } from "../../i18n";
import type { AgentInfo } from "../../types";
import { VerdictBadge } from "./Verdict";

export function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}
/** Share of the subscription window used by one run, e.g. "≈ 2%"; "—" when the run saw no rate-limit data. */
export function fmtQuota(pct: number | undefined | null, hasData = true): string {
  if (!hasData || pct == null) return "—";
  return pct < 0.5 ? "< 1%" : `≈ ${pct % 1 === 0 ? pct : pct.toFixed(1)}%`;
}
export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function AgentTree({ agents }: { agents: AgentInfo[] }) {
  const { t, lang } = useT();
  const roots = agents.filter((a) => a.parent_id === null);
  const children = (id: string) => agents.filter((a) => a.parent_id === id);
  const Node = ({ a, child }: { a: AgentInfo; child: boolean }) => (
    <>
      <div className={`agent ${a.role} ${child ? "child" : ""}`}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="name">{roleLabel(a.role, lang)}{a.verdict ? <> <VerdictBadge verdict={a.verdict} lang={lang} role={a.role} /></> : null}</span>
          <span className={`status ${a.status === "running" ? "running" : "done"}`}>{a.status === "running" ? t.status_running : t.status_done}</span>
        </div>
        <div className="meta">
          {a.model ? `${a.model} · ` : ""}
          {t.input_tokens} {fmtTokens(a.usage.input)} · {t.output_tokens} {fmtTokens(a.usage.output)} · {t.cache_read} {fmtTokens(a.usage.cache_read)} · {t.cache_write} {fmtTokens(a.usage.cache_write)}
        </div>
        {a.progress && (
          <div className="meta">
            Σ {fmtTokens(a.progress.total_tokens)} tok · {a.progress.tool_uses} tool · {Math.round(a.progress.duration_ms / 1000)}s{a.progress.last_tool ? ` · ${a.progress.last_tool}` : ""}
          </div>
        )}
        {a.summary && <div className="meta agent-summary">{a.summary}</div>}
      </div>
      {children(a.agent_id).map((c) => (
        <Node key={c.agent_id} a={c} child />
      ))}
    </>
  );
  return (
    <div className="agent-tree">
      {roots.map((a) => (
        <Node key={a.agent_id} a={a} child={false} />
      ))}
    </div>
  );
}
