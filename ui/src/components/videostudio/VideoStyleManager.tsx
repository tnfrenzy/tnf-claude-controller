import { useState } from "react";
import { api, ApiError } from "../../api";
import { useT } from "../../i18n";
import { nextConfirmStep, type ConfirmState } from "../../lib/confirm";
import {
  cloneToForm,
  emptyStyleForm,
  styleFormToInput,
  styleToForm,
  type VsStyleForm,
} from "../../videostudio/forms";
import type { VsStyle } from "../../../../src/core/videostudio/plan-types";
import { StyleFrame, StyleSample, type StyleLook } from "./StylePreview";

/** List and edit Video Studio styles. Built-in styles are view/clone only. */
export function VideoStyleManager(props: { styles: VsStyle[]; onChanged: () => void; defaultStyleId?: string | null | undefined }) {
  const { t } = useT();
  const [form, setForm] = useState<VsStyleForm | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [step, setStep] = useState<ConfirmState>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof VsStyleForm>(k: K, v: VsStyleForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const showError = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));

  const save = async () => {
    if (!form) return;
    const input = styleFormToInput(form);
    if (!input.name) {
      setError(t.vs_style_name);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Narrow cast: the server generates id and sets builtin=false for custom styles.
      await api.videoStudioSaveStyle(input as VsStyle);
      setForm(null);
      props.onChanged();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setStep(nextConfirmStep("idle", "ask"));
      return;
    }
    const next = nextConfirmStep(step, "confirm");
    if (next !== "execute") return;
    setBusy(true);
    setError(null);
    try {
      await api.videoStudioDeleteStyle(id);
      props.onChanged();
    } catch (e) {
      showError(e);
    } finally {
      setConfirmId(null);
      setStep(nextConfirmStep("execute", "done"));
      setBusy(false);
    }
  };

  const makeDefault = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.videoStudioSettingsPut({ defaultStyleId: id });
      props.onChanged();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const look = (f: VsStyleForm): StyleLook => {
    const i = styleFormToInput(f);
    return { transition: i.transition, transitionSec: i.transitionSec, shotSec: i.shotSec, font: i.font, textColor: i.textColor, textBox: i.textBox, brightness: i.brightness, contrast: i.contrast, saturation: i.saturation };
  };

  return (
    <div className="vs-style-manager">
      <p className="muted">{t.vs_st_intro}</p>
      <ul className="vs-style-gallery">
        {props.styles.map((s) => (
          <li key={s.id} className={s.id === props.defaultStyleId ? "vs-style-item is-default" : "vs-style-item"}>
            <StyleFrame style={s} />
            <span>{s.name}</span>{" "}
            <span className="badge">{s.builtin ? t.vs_style_builtin : t.vs_style_custom}</span>{" "}
            {s.id === props.defaultStyleId ? <span className="badge">{t.vs_st_default}</span> : (
              <button type="button" data-action="default-style" disabled={busy} onClick={() => void makeDefault(s.id)}>
                {t.vs_st_make_default}
              </button>
            )}{" "}
            {s.description ? <span className="muted vs-style-desc">{s.description}</span> : null}
            <StyleSample input={() => ({ id: s.id })} />
            {s.builtin ? (
              <button type="button" data-action="clone-style" disabled={busy} onClick={() => setForm(cloneToForm(s))}>
                {t.vs_style_clone}
              </button>
            ) : (
              <>
                <button type="button" data-action="edit-style" disabled={busy} onClick={() => setForm(styleToForm(s))}>
                  {t.vs_style_edit}
                </button>{" "}
                <button type="button" data-action="delete-style" disabled={busy} onClick={() => void del(s.id)}>
                  {confirmId === s.id ? t.vs_style_delete_confirm : t.vs_btn_delete}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <button type="button" data-action="add-style" disabled={busy} onClick={() => setForm(emptyStyleForm())}>
        {t.vs_style_add}
      </button>
      {error && <p className="error">{error}</p>}
      {form && (
        <div className="vs-style-form">
          <StyleFrame style={look(form)} />
          <StyleSample input={() => styleFormToInput(form)} label={t.vs_st_sample_form} />
          <label>
            {t.vs_style_name}
            <input value={form.name} maxLength={40} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            {t.vs_style_transition}
            <select value={form.transition} onChange={(e) => set("transition", e.target.value === "none" ? "none" : "fade")}>
              <option value="none">none</option>
              <option value="fade">fade</option>
            </select>
          </label>
          <label>
            {t.vs_style_transition_sec}
            <input type="number" step="0.1" min="0" max="2" value={form.transitionSec} onChange={(e) => set("transitionSec", e.target.value)} />
          </label>
          <label>
            {t.vs_style_shot_sec}
            <input type="number" step="0.5" min="0.5" max="20" value={form.shotSec} onChange={(e) => set("shotSec", e.target.value)} />
          </label>
          <label>
            {t.vs_style_font}
            <input value={form.font} maxLength={60} onChange={(e) => set("font", e.target.value)} />
          </label>
          <label>
            {t.vs_style_text_color}
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.textColor) ? form.textColor : "#ffffff"} onChange={(e) => set("textColor", e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={form.textBox} onChange={(e) => set("textBox", e.target.checked)} />
            {t.vs_style_text_box}
          </label>
          <label>
            {t.vs_style_brightness}
            <input type="number" step="0.1" min="-1" max="1" value={form.brightness} onChange={(e) => set("brightness", e.target.value)} />
          </label>
          <label>
            {t.vs_style_contrast}
            <input type="number" step="0.1" min="0" max="3" value={form.contrast} onChange={(e) => set("contrast", e.target.value)} />
          </label>
          <label>
            {t.vs_style_saturation}
            <input type="number" step="0.1" min="0" max="3" value={form.saturation} onChange={(e) => set("saturation", e.target.value)} />
          </label>
          <label>
            {t.vs_style_visual_prompt}
            <textarea maxLength={400} value={form.visualPrompt} onChange={(e) => set("visualPrompt", e.target.value)} />
          </label>
          <button type="button" data-action="save-style" disabled={busy} onClick={() => void save()}>
            {t.vs_btn_save}
          </button>{" "}
          <button type="button" data-action="cancel-style" disabled={busy} onClick={() => setForm(null)}>
            {t.vs_btn_cancel}
          </button>
        </div>
      )}
    </div>
  );
}
