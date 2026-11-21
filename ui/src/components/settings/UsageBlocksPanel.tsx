import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import type { UsageBlocks } from "../../types";
import { elapsedRatio, formatCost, formatRemaining, recentBlocks, tokenRatio } from "../../run/usageBlocks";

function Bar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  return (
    <div className="usage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Shows the running 5-hour window and the most recent ones. Cost is always labelled as an estimate. */
export function UsageBlocksPanel() {
  const { t, lang } = useT();
  const [data, setData] = useState<UsageBlocks | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    api
      .getUsageBlocks()
      .then(setData)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const blocks = data?.blocks ?? [];
  const maxTotal = blocks.reduce((m, b) => Math.max(m, b.total), 0);
  const active = data?.activeBlock ?? null;
  const rem = formatRemaining(data?.remainingMs ?? 0);
  const locale = lang === "en" ? "en-US" : "vi-VN";
  const est = t.usage_blocks_estimate;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{t.usage_blocks_title}</strong>
        <button className="mini" onClick={load} disabled={loading}>
          {t.usage_blocks_refresh}
        </button>
        {loading && <span className="muted">{t.usage_blocks_loading}</span>}
      </div>
      {err && <p className="error">{err}</p>}
      {data && (
        <>
          {active ? (
            <div style={{ margin: "8px 0" }}>
              <Bar ratio={elapsedRatio(active, Date.now())} />
              <div className="muted">
                {t.usage_blocks_time_left.replace("{h}", () => String(rem.h)).replace("{m}", () => String(rem.m))}
              </div>
              <div style={{ marginTop: 6 }}>
                {t.usage_blocks_tokens}: {active.total.toLocaleString(locale)}
              </div>
              <Bar ratio={tokenRatio(active.total, maxTotal)} />
              <div>
                {t.usage_blocks_cost}: {formatCost(active.estimatedCostUsd)} ({est})
              </div>
            </div>
          ) : (
            <p className="muted">{t.usage_blocks_no_active}</p>
          )}
          <strong>{t.usage_blocks_recent}</strong>
          {blocks.length === 0 ? (
            <p className="muted">{t.usage_blocks_empty}</p>
          ) : (
            // Note: the first recent row can be the running window itself; that is intentional.
            <ul style={{ listStyle: "none", padding: 0, margin: "6px 0" }}>
              {recentBlocks(blocks, 5).map((b) => (
                <li key={b.start} style={{ marginBottom: 6 }}>
                  <div>{new Date(b.start).toLocaleString(locale)}</div>
                  <Bar ratio={tokenRatio(b.total, maxTotal)} />
                  <div className="muted">
                    {b.total.toLocaleString(locale)} · {formatCost(b.estimatedCostUsd)} ({est})
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
