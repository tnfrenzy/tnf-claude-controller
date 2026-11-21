import { roleLabel, useT } from "../../i18n";
import { useState } from "react";
import { extractSlots, itemEffect } from "../../skills/library";
import type { LibraryData } from "../../types";
import { CatalogSearch } from "./CatalogSearch";
import { TemplateForm } from "./TemplateForm";

/**
 * Library section of the Command page: tick library roles and skill/prompt items for this run, and find new roles.
 * Pure view: the parent owns the selections and the library data.
 */
export function RunLibraryPicker(props: {
  lib: LibraryData | null;
  error: string | null;
  tickedRoles: string[];
  tickedItems: string[];
  kindRoles: string[];
  warning: string | null;
  onToggleRole: (id: string, on: boolean) => void;
  onToggleItem: (id: string, on: boolean) => void;
  /** After a catalog role was copied into the library: refresh and tick it. */
  onCatalogAdded: (id: string) => void;
  /** Fill the prompt box with a filled-in template. */
  onFillPrompt?: (text: string) => void;
}) {
  const { t, lang } = useT();
  const { lib } = props;
  const [formItem, setFormItem] = useState<string | null>(null);
  const formContent = lib?.items.find((i) => i.id === formItem)?.content ?? null;
  return (
    <div>
      <p className="muted" style={{ margin: "8px 0" }}>{t.lib_run_hint} <a href="#/library">{t.lib_manage}</a></p>
      {props.error && <p className="error">{t.lib_load_error}: {props.error}</p>}
      {!lib && !props.error && <p className="muted">{t.lib_loading}</p>}
      {lib && (
        <>
          <b>{t.lib_roles}</b>
          {lib.roles.length === 0 ? (
            <p className="muted" style={{ margin: "4px 0 8px" }}>{t.lib_empty_roles}</p>
          ) : (
            <div className="pick-list">
              {lib.roles.map((r) => (
                <label className="pick" key={r.id}>
                  <input type="checkbox" checked={props.tickedRoles.includes(r.id)} onChange={(e) => props.onToggleRole(r.id, e.target.checked)} />
                  <span>
                    <b className="mono">{r.id}</b> <span className="muted">{r.description}</span>
                    <span className="chips">{(r.tools ?? []).map((tool) => <span className="chip tool" key={tool}>{tool}</span>)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <b>{t.lib_items}</b>
          {lib.items.length === 0 ? (
            <p className="muted" style={{ margin: "4px 0 8px" }}>{t.lib_empty_items}</p>
          ) : (
            <div className="pick-list">
              {lib.items.map((it) => {
                const e = itemEffect(it, props.kindRoles, lib.builtinRoles);
                const hasSlots = it.type === "prompt" && !!props.onFillPrompt && extractSlots(it.content).length > 0;
                return (
                  <label className="pick" key={it.id}>
                    {hasSlots && <button type="button" onClick={(ev) => { ev.preventDefault(); setFormItem(it.id); }}>{t.tpl_use}</button>}
                    <input type="checkbox" checked={props.tickedItems.includes(it.id)} onChange={(ev) => props.onToggleItem(it.id, ev.target.checked)} />
                    <span>
                      <b>{it.name}</b> <span className="chip">{it.type === "skill" ? t.lib_item_skill : t.lib_item_prompt}</span>
                      <span className="muted"> · {t.lib_applies_to}: {e.coordinatorOnly ? t.lib_coordinator_only : it.roleIds.map((r) => roleLabel(r, lang === "en" ? "en" : "vi")).join(", ")}</span>
                      {e.pulled.length > 0 && <span className="muted"> · {t.lib_pulls_role} {e.pulled.join(", ")}</span>}
                      {e.skipped.length > 0 && <span className="muted"> · {e.skipped.join(", ")}: {t.lib_skipped_role}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
      {formContent !== null && props.onFillPrompt && (
        <TemplateForm
          content={formContent}
          labels={{ title: t.tpl_form_title, apply: t.tpl_apply, cancel: t.tpl_cancel }}
          onApply={(text) => { props.onFillPrompt?.(text); setFormItem(null); }}
          onCancel={() => setFormItem(null)}
        />
      )}
      {props.warning && <p className="error">{props.warning}</p>}
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer" }}><b>{t.catalog_title}</b></summary>
        <div style={{ marginTop: 8 }}>
          <CatalogSearch useLabel onAdded={props.onCatalogAdded} />
        </div>
      </details>
    </div>
  );
}
