import { useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { PAGE_SHORTCUTS, defaultConfig, duplicateKeys, loadShortcuts, normalizeKey, resolveShortcuts, saveShortcuts, type ShortcutsConfig } from "../../shortcuts";

/** Settings → Phím tắt: one letter per page / environment (Alt + letter) and the palette letter (Ctrl + letter). */
export function ShortcutsSection() {
  const { t } = useT();
  const [cfg, setCfg] = useState<ShortcutsConfig>(() => loadShortcuts());
  const [envs, setEnvs] = useState<string[]>([]);
  useEffect(() => {
    api.projects().then((r) => setEnvs(r.projects.map((p) => p.name))).catch(() => {});
  }, []);
  const eff = resolveShortcuts(cfg, envs);
  const dups = duplicateKeys(eff);
  const update = (next: ShortcutsConfig) => {
    setCfg(next);
    saveShortcuts(next);
  };
  const setKey = (id: string, raw: string) => update({ ...cfg, keys: { ...cfg.keys, [id]: normalizeKey(raw) } });
  const pageLabel: Record<string, string> = { "page:cmd": t.nav_cmd, "page:history": t.nav_history, "page:library": t.nav_library, "page:settings": t.ss_settings };
  const rows: Array<[string, string]> = [
    ...PAGE_SHORTCUTS.map(([id]) => [id, pageLabel[id] ?? id] as [string, string]),
    ...envs.map((n) => [`env:${n}`, n] as [string, string]),
  ];
  return (
    <div className="card" data-testid="shortcuts">
      <h4>{t.keys_title}</h4>
      <div className="muted">{t.keys_hint}</div>
      <div className="row">
        <span style={{ minWidth: 160 }}>{t.keys_palette}</span>
        <span>Ctrl +</span>
        <input aria-label={t.keys_palette} style={{ width: 44, textAlign: "center" }} maxLength={1} value={cfg.palette} onChange={(e) => update({ ...cfg, palette: normalizeKey(e.target.value) || cfg.palette })} />
      </div>
      {rows.map(([id, label]) => (
        <div className="row" key={id}>
          <span style={{ minWidth: 160 }}>{label}</span>
          <span>Alt +</span>
          <input aria-label={label} style={{ width: 44, textAlign: "center" }} maxLength={1} value={eff[id] ?? ""} onChange={(e) => setKey(id, e.target.value)} />
        </div>
      ))}
      {dups.length > 0 ? <div className="error">{t.keys_dup.replace("{keys}", dups.join(", "))}</div> : null}
      <button type="button" onClick={() => update(defaultConfig())}>{t.keys_reset}</button>
    </div>
  );
}
