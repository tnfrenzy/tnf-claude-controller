import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { useT } from "../../i18n";
import { catalogState } from "../../skills/library";
import type { CatalogRole } from "../../types";

/**
 * "Tìm vai mới": search the catalog shipped with the app (/api/role-catalog) and copy a role into the library.
 * `onAdded` runs after the server accepted the add; `useLabel` switches the button to "add and use in this run".
 */
export function CatalogSearch({ onAdded, useLabel }: { onAdded: (id: string) => void; useLabel?: boolean }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [roles, setRoles] = useState<CatalogRole[]>([]);
  const [inLibrary, setInLibrary] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Debounced search; the empty query lists the whole catalog.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .roleCatalog(q)
        .then((r) => {
          if (!alive) return;
          setRoles(r.roles);
          setInLibrary(r.in_library);
          setErr(null);
        })
        .catch((e: unknown) => alive && setErr(e instanceof ApiError ? e.message : String(e)))
        .finally(() => alive && setLoading(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const add = async (id: string) => {
    setBusyId(id);
    setErr(null);
    try {
      await api.addFromCatalog(id);
      setInLibrary((l) => (l.includes(id) ? l : [...l, id]));
      onAdded(id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="catalog">
      <p className="muted" style={{ margin: "0 0 8px" }}>{t.catalog_hint}</p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.catalog_search} aria-label={t.catalog_title} style={{ width: "100%" }} />
      {err && <p className="error" style={{ marginBottom: 0 }}>{t.err_prefix}: {err}</p>}
      {loading && <p className="muted" style={{ marginBottom: 0 }}>{t.catalog_loading}</p>}
      {!loading && roles.length === 0 && !err && <p className="muted" style={{ marginBottom: 0 }}>{t.catalog_none}</p>}
      <div className="catalog-list">
        {roles.map((r) => {
          const have = catalogState(r, inLibrary) === "in_library";
          return (
            <div className="catalog-card" key={r.id}>
              <div className="catalog-head">
                <b>{r.name}</b>
                <span className="muted mono">{r.id}</span>
              </div>
              <p style={{ margin: "4px 0" }}>{r.description}</p>
              <div className="chips">
                {r.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}
                {(r.tools ?? []).map((tool) => <span className="chip tool" key={tool}>{tool}</span>)}
              </div>
              <details style={{ marginTop: 6 }}>
                <summary className="muted" style={{ cursor: "pointer" }}>{t.catalog_prompt}</summary>
                <pre className="catalog-prompt">{r.prompt}</pre>
              </details>
              <div style={{ marginTop: 6 }}>
                {have ? (
                  <span className="muted">{t.catalog_in}</span>
                ) : (
                  <button className="primary" disabled={busyId === r.id} onClick={() => void add(r.id)}>
                    {useLabel ? t.catalog_add_use : t.catalog_add}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
