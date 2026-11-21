import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { api } from "../api";
import { useT } from "../i18n";
import { buildPaletteItems, filterPaletteItems, type PaletteAction, type PaletteData, type PaletteItem } from "../palette";
import { loadPaletteData } from "../paletteData";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onAction: (a: PaletteAction) => void;
  initialData?: PaletteData;
  shortcuts?: Record<string, string>;
}

const CSS = `
.cmdk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh}
.cmdk-box{width:min(560px,92vw);max-height:70vh;overflow:auto;background:var(--panel,#fff);color:inherit;border:1px solid var(--border);border-radius:10px;padding:8px;box-shadow:0 12px 40px rgba(0,0,0,.3)}
.cmdk-box input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit;margin-bottom:6px}
.cmdk-box [cmdk-group-heading]{font-size:12px;opacity:.7;padding:6px 8px 2px}
.cmdk-box [cmdk-item]{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:6px;cursor:pointer}
.cmdk-box [cmdk-item][aria-selected=true]{background:var(--accent);color:#fff}
.cmdk-hint{opacity:.7;font-size:12px}
`;

export function CommandPalette({ open, onClose, onAction, initialData, shortcuts }: CommandPaletteProps) {
  const { t } = useT();
  const [data, setData] = useState<PaletteData | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    if (initialData) {
      setData(initialData);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadPaletteData(api).then((d) => {
      if (cancelled) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const items: PaletteItem[] = data ? filterPaletteItems(buildPaletteItems({ data, t, ...(shortcuts ? { shortcuts } : {}) }), query) : [];
  const groups: Array<[PaletteItem["group"], string]> = [
    ["page", t.palette_group_pages],
    ["env", t.palette_group_envs],
  ];

  return (
    <div
      className="cmdk-overlay"
      role="dialog"
      aria-label={t.palette_title}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{CSS}</style>
      <div className="cmdk-box">
        <Command shouldFilter={false}>
          <Command.Input placeholder={t.palette_placeholder} autoFocus value={query} onValueChange={setQuery} />
          <Command.List>
            {loading ? <div className="cmdk-hint">{t.palette_loading}</div> : null}
            {groups.map(([g, heading]) => (
              <Command.Group key={g} heading={heading}>
                {items
                  .filter((it) => it.group === g)
                  .map((it) => (
                    <Command.Item
                      key={it.id}
                      value={it.id}
                      onSelect={() => {
                        onAction(it.action);
                        onClose();
                      }}
                    >
                      <span>{it.label}</span>
                      {it.hint ? <span className="cmdk-hint">{it.hint}</span> : null}
                    </Command.Item>
                  ))}
              </Command.Group>
            ))}
            <Command.Empty>{t.palette_empty}</Command.Empty>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
