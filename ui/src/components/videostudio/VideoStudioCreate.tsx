import { useMemo, useState } from "react";
import { pick } from "../../lib/lang";
import { api, ApiError } from "../../api";
import { useT } from "../../i18n";
import { VideoStyleManager } from "./VideoStyleManager";
import { VideoStudioSettings } from "./VideoStudioSettings";
import {
  BRIEF_SECONDS,
  BRIEF_TONES,
  VIDEO_TEMPLATES,
  applyTemplate,
  composeBrief,
  emptyBrief,
  hasPlaceholders,
  type BriefFields,
  type BriefLang,
  type VideoTemplate,
} from "../../videostudio/briefTemplates";
import "./create.css";
import { formatSize } from "./VideoLibraryBox";
import type { VsAspect, VsLibraryItem, VsSettingsPublic, VsStyle } from "../../../../src/core/videostudio/plan-types";

export interface CreateForm {
  title: string;
  brief: string;
  styleId: string;
  aspect: VsAspect;
}

export const ASPECTS: readonly VsAspect[] = ["16:9", "9:16", "1:1"];
export const MAX_TITLE = 80;
export const MAX_BRIEF = 4000;

/** Vietnamese message for the first problem, or null when the form can be submitted. */
export function validateCreateForm(form: CreateForm): string | null {
  const title = form.title.trim();
  if (!title) return pick("Hãy nhập tên video.", "Enter a video name.");
  if (title.length > MAX_TITLE) return pick(`Tên video tối đa ${MAX_TITLE} ký tự.`, `The video name can have at most ${MAX_TITLE} characters.`);
  if (form.brief.length > MAX_BRIEF) return pick(`Mô tả tối đa ${MAX_BRIEF} ký tự.`, `The brief can have at most ${MAX_BRIEF} characters.`);
  if (!form.styleId) return pick("Hãy chọn một phong cách.", "Choose a style.");
  return null;
}

type Tab = "new" | "styles" | "settings";

/**
 * Video Studio lobby: create a project (quick templates + a structured brief), manage styles, edit the AI settings.
 * The parent owns the data (styles and settings) and reloads it through onChanged.
 */
export function VideoStudioCreate(props: {
  styles: VsStyle[];
  settings: VsSettingsPublic | null;
  /** Shared images/videos; the ticked ones are copied into the new video. */
  library?: VsLibraryItem[];
  onCreated: (slug: string) => void;
  onChanged: () => void;
  initialTab?: Tab;
}) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "new");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<BriefFields>(emptyBrief());
  const defaultStyleId = props.settings?.defaultStyleId ?? null;
  const [styleId, setStyleId] = useState(props.styles.find((s) => s.id === defaultStyleId)?.id ?? props.styles[0]?.id ?? "");
  const [aspect, setAspect] = useState<VsAspect>("16:9");
  const [template, setTemplate] = useState<string | null>(null);
  const library = props.library ?? [];
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = everything in the library
  const [files, setFiles] = useState<File[]>([]);
  const chosen = picked ?? new Set(library.map((f) => f.name));
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof BriefFields>(k: K, v: BriefFields[K]) => setFields((f) => ({ ...f, [k]: v }));
  const brief = useMemo(() => composeBrief(fields), [fields]);

  const pickTemplate = (tpl: VideoTemplate) => {
    setTemplate(tpl.id);
    setFields(applyTemplate(tpl));
    setAspect(tpl.aspect);
    if (props.styles.some((s) => s.id === tpl.styleId)) setStyleId(tpl.styleId);
    setTitle((cur) => (cur.trim() ? cur : tpl.name));
    setError(null);
  };

  const create = async () => {
    const form: CreateForm = { title, brief, styleId, aspect };
    const problem = validateCreateForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.videoStudioCreate({ title: title.trim(), brief, styleId, aspect, libraryFiles: library.filter((f) => chosen.has(f.name)).map((f) => f.name) });
      // Files picked on this computer are uploaded into the new video; one failure does not undo the video.
      for (const f of files) {
        try {
          await api.videoStudioUpload(r.slug, f);
        } catch {
          /* the room shows the asset list; the user can upload again there */
        }
      }
      props.onCreated(r.slug);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<[Tab, string]> = [
    ["new", t["vs_create_tab_new"] ?? "New"],
    ["styles", t["vs_create_tab_styles"] ?? "Styles"],
    ["settings", t["vs_create_tab_settings"] ?? "Settings"],
  ];
  const langs: BriefLang[] = ["vi", "en"];

  return (
    <div className="vs-create">
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab active" : "tab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "new" ? (
        <div className="vs-create-form">
          <div>
            <div className="muted">{t["vs_f_templates"]}</div>
            <div className="vs-aspects vs-templates">
              {VIDEO_TEMPLATES.map((tpl) => (
                <button key={tpl.id} type="button" className={tpl.id === template ? "chip active" : "chip"} aria-pressed={tpl.id === template} onClick={() => pickTemplate(tpl)}>
                  {tpl.name}
                </button>
              ))}
            </div>
          </div>
          <label>
            {t["vs_title"]}
            <input type="text" value={title} maxLength={MAX_TITLE} placeholder={t["vs_create_title_ph"]} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            {t["vs_f_goal"]}
            <input type="text" value={fields.goal} placeholder={t["vs_f_goal_ph"]} onChange={(e) => setField("goal", e.target.value)} />
          </label>
          <label>
            {t["vs_f_audience"]}
            <input type="text" value={fields.audience} placeholder={t["vs_f_audience_ph"]} onChange={(e) => setField("audience", e.target.value)} />
          </label>
          <div className="vs-create-row">
            <div>
              <div className="muted">{t["vs_f_tone"]}</div>
              <div className="vs-aspects">
                {BRIEF_TONES.map((tone) => (
                  <button key={tone} type="button" className={tone === fields.tone ? "chip active" : "chip"} aria-pressed={tone === fields.tone} onClick={() => setField("tone", tone)}>
                    {t[`vs_tone_${tone}`]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="muted">{t["vs_f_seconds"]}</div>
              <div className="vs-aspects">
                {BRIEF_SECONDS.map((n) => (
                  <button key={n} type="button" className={n === fields.seconds ? "chip active" : "chip"} aria-pressed={n === fields.seconds} onClick={() => setField("seconds", n)}>
                    {n} {t["vs_f_seconds_unit"]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="muted">{t["vs_f_lang"]}</div>
              <div className="vs-aspects">
                {langs.map((l) => (
                  <button key={l} type="button" className={l === fields.lang ? "chip active" : "chip"} aria-pressed={l === fields.lang} onClick={() => setField("lang", l)}>
                    {t[`vs_lang_${l}`]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label>
            {t["vs_f_points"]}
            <textarea rows={5} value={fields.points} placeholder={t["vs_f_points_ph"]} onChange={(e) => setField("points", e.target.value)} />
          </label>
          <label>
            {t["vs_f_cta"]}
            <input type="text" value={fields.cta} placeholder={t["vs_f_cta_ph"]} onChange={(e) => setField("cta", e.target.value)} />
          </label>
          <label>
            {t["vs_brief"]}
            <textarea rows={3} value={fields.notes} placeholder={t["vs_create_brief_ph"]} onChange={(e) => setField("notes", e.target.value)} />
          </label>
          <div className="vs-media">
            <div className="muted">{t["vs_media_title"]}</div>
            <p className="muted">{t["vs_media_hint"]}</p>
            {library.length === 0 ? <p className="muted">{t["vs_media_none"]}</p> : null}
            {library.length > 0 ? <div className="muted">{t["vs_media_from_library"]}</div> : null}
            <ul className="vs-library-list">
              {library.map((f) => (
                <li key={f.name}>
                  <label className="vs-media-pick">
                    <input type="checkbox" checked={chosen.has(f.name)} onChange={() => toggle(f.name)} />
                    <span className="vs-library-kind">{t[`vs_lib_kind_${f.kind}`] ?? f.kind}</span>
                    <span className="vs-library-name">{f.name}</span>
                    <span className="muted">{formatSize(f.size)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="vs-library-upload">
              <span>{t["vs_media_upload"]}</span>
              <input
                type="file"
                multiple
                accept="image/*,video/*,audio/*"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (list.length) setFiles((cur) => [...cur, ...list]);
                }}
              />
            </label>
            {files.length > 0 ? (
              <ul className="vs-library-list">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span className="vs-library-name">{f.name}</span>
                    <span className="muted">{formatSize(f.size)}</span>
                    <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                      {t["vs_lib_delete"]}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <div className="muted">{t["vs_style"]}</div>
            {props.styles.length === 0 ? <p className="muted">{t["vs_create_styles_empty"]}</p> : null}
            <div className="vs-style-cards">
              {props.styles.map((s) => (
                <button key={s.id} type="button" className={s.id === styleId ? "vs-style-card selected" : "vs-style-card"} aria-pressed={s.id === styleId} onClick={() => setStyleId(s.id)}>
                  <strong>{s.id === defaultStyleId ? `★ ${s.name}` : s.name}</strong>
                  {s.description ? <span className="muted"> {s.description}</span> : null}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="muted">{t["vs_aspect"]}</div>
            <div className="vs-aspects">
              {ASPECTS.map((a) => (
                <button key={a} type="button" className={a === aspect ? "chip active" : "chip"} aria-pressed={a === aspect} onClick={() => setAspect(a)}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <p className="muted">{t["vs_f_tips"]}</p>
          {hasPlaceholders(fields) ? <p className="warning">{t["vs_f_placeholders"]}</p> : null}
          <details className="vs-brief-preview">
            <summary>{t["vs_f_preview"]}</summary>
            <pre>{brief}</pre>
          </details>
          {error ? <p className="error">{error}</p> : null}
          <button type="button" className="primary" disabled={busy} onClick={() => void create()}>
            {t["vs_btn_create"]}
          </button>
        </div>
      ) : null}

      {tab === "styles" ? <VideoStyleManager styles={props.styles} onChanged={props.onChanged} defaultStyleId={defaultStyleId} /> : null}
      {tab === "settings" ? <VideoStudioSettings settings={props.settings} onChanged={props.onChanged} library={library} /> : null}
    </div>
  );
}
