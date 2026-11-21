import { useEffect, useState } from "react";
import type { VsPlan } from "../../../../src/core/videostudio/plan-types";
import { api } from "../../api";
import { useT } from "../../i18n";
import { captionsFromNarration } from "../../videostudio/timeline";

/**
 * Narration settings: the text, the voice and speed for the AI voice, and the two ways to get the audio
 * (generate with AI, or upload an mp3/wav). The audio lands on the timeline as an audio clip that can be moved and adjusted.
 */
export function NarrationPanel(props: {
  plan: VsPlan;
  busy: boolean;
  uploading: boolean;
  hasNarrationClip: boolean;
  onChange: (plan: VsPlan) => void;
  onGenerate: () => void;
  onUpload: (files: File[]) => void;
}) {
  const { plan, busy } = props;
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const [voices, setVoices] = useState<{ name: string; culture: string; gender: string }[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .videoStudioVoices()
      .then((r) => {
        if (alive) setVoices(r.voices);
      })
      .catch(() => {
        if (alive) setVoices([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const voice = plan.voice ?? {};
  const setVoice = (patch: { name?: string | undefined; rate?: number | undefined }) => {
    const next = { ...voice, ...patch };
    if (next.name === "") delete next.name;
    props.onChange({ ...plan, voice: next });
  };
  const text = plan.narration ?? "";

  return (
    <div className="vs-narr" data-testid="vs-narration-panel">
      <h4>{t["vs_narr_title"]}</h4>
      <label className="vs-narr-text">
        {t["vs_narr_text"]}
        <textarea rows={4} disabled={busy} maxLength={5000} value={text} onChange={(e) => props.onChange({ ...plan, narration: e.target.value })} />
      </label>
      <div className="vs-narr-row">
        <label>
          {t["vs_narr_voice"]}
          <select disabled={busy || voices === null} value={voice.name ?? ""} onChange={(e) => setVoice({ name: e.target.value })}>
            <option value="">{t["vs_narr_voice_default"]}</option>
            {(voices ?? []).map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.culture}, {v.gender})
              </option>
            ))}
          </select>
        </label>
        <label>
          {t["vs_narr_rate"]}
          <input type="range" min={-10} max={10} step={1} disabled={busy} value={voice.rate ?? 0} onChange={(e) => setVoice({ rate: Number(e.target.value) })} />
          <span className="vs-tl-val">{voice.rate ?? 0}</span>
        </label>
      </div>
      {voices !== null && voices.length === 0 ? <p className="muted">{t["vs_narr_no_voices"]}</p> : null}
      <div className="vs-narr-row">
        <button type="button" disabled={busy || text.trim() === ""} onClick={props.onGenerate}>
          {t["vs_narr_generate"]}
        </button>
        <label className={"vs-tl-btn-addmedia" + (busy || props.uploading ? " is-disabled" : "")}>
          {props.uploading ? t["vs_tl_add_media_busy"] : t["vs_narr_upload"]}
          <input
            type="file"
            accept="audio/*"
            hidden
            disabled={busy || props.uploading}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) props.onUpload(files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="vs-narr-row">
        <button type="button" disabled={busy || !props.hasNarrationClip || text.trim() === ""} title={t["vs_narr_caps_tip"]} onClick={() => props.onChange(captionsFromNarration(plan))}>
          {t["vs_narr_caps"]}
        </button>
        <label>
          <input type="checkbox" disabled={busy} checked={plan.duck !== false} onChange={(e) => props.onChange({ ...plan, duck: e.target.checked })} />
          {t["vs_narr_duck"]}
        </label>
      </div>
      <p className="muted">{props.hasNarrationClip ? t["vs_narr_have"] : t["vs_narr_none"]}</p>
    </div>
  );
}
