import type { VsFit, VsMotion, VsPlan, VsTransition } from "../../../../src/core/videostudio/plan-types";
import { useT } from "../../i18n";
import { fitOf, setAllFit, setAllTransitions, setClipDuration, setClipFit, updateAudio, updateClip, updateText } from "../../videostudio/timeline";

export type InspectorSel = { kind: "clip" | "audio" | "text"; id: string } | null;

const FITS: VsFit[] = ["blur", "cover", "contain"];
const TRANSITIONS: VsTransition[] = ["none", "fade", "dissolve", "wipeleft", "slideleft", "zoomin", "circleopen"];
const MOTIONS: VsMotion[] = ["none", "zoomin", "zoomout", "panleft", "panright"];

/** Controls of the selected clip (length, fit, transition, motion, speed), audio clip (volume, fades, speed) or caption (size, colour). */
export function TimelineInspector(props: { plan: VsPlan; selected: InspectorSel; busy: boolean; onChange: (plan: VsPlan) => void }) {
  const { plan, selected, busy } = props;
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  if (!selected) return null;

  if (selected.kind === "clip") {
    const clip = plan.video.find((c) => c.id === selected.id);
    if (!clip) return null;
    const isImage = clip.kind === "image";
    const isVideo = clip.kind === "video";
    const isMedia = isImage || isVideo;
    const fit = fitOf(plan, clip);
    const idx = plan.video.findIndex((c) => c.id === clip.id);
    const hasNext = idx >= 0 && idx < plan.video.length - 1;
    const transition = clip.transition ?? "";
    return (
      <div className="vs-tl-inspector" data-testid="vs-tl-inspector-clip">
        <label>
          {t["vs_tl_len"]}
          <input
            type="number"
            min={0.2}
            max={600}
            step={0.1}
            disabled={busy}
            value={Math.round(clip.duration * 10) / 10}
            onChange={(e) => props.onChange(setClipDuration(plan, clip.id, Number(e.target.value)))}
          />
          s
        </label>
        {isMedia ? (
          <>
            <label>
              {t["vs_tl_fit"]}
              <select disabled={busy} value={fit} onChange={(e) => props.onChange(setClipFit(plan, clip.id, e.target.value as VsFit))}>
                {FITS.map((f) => (
                  <option key={f} value={f}>
                    {t[`vs_fit_${f}`]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={busy} onClick={() => props.onChange(setAllFit(plan, fit))}>
              {t["vs_tl_fit_all"]}
            </button>
          </>
        ) : null}
        {hasNext ? (
          <>
            <label>
              {t["vs_tl_transition"]}
              <select
                disabled={busy}
                value={transition}
                data-testid="vs-tl-transition"
                onChange={(e) => props.onChange(updateClip(plan, clip.id, { transition: (e.target.value || undefined) as VsTransition | undefined }))}
              >
                <option value="">{t["vs_tr_style"]}</option>
                {TRANSITIONS.map((x) => (
                  <option key={x} value={x}>
                    {t[`vs_tr_${x}`]}
                  </option>
                ))}
              </select>
            </label>
            {transition !== "" && transition !== "none" ? (
              <>
                <label>
                  {t["vs_tr_sec"]}
                  <input
                    type="number"
                    min={0.1}
                    max={3}
                    step={0.1}
                    disabled={busy}
                    value={clip.transitionSec ?? 0.5}
                    onChange={(e) => props.onChange(updateClip(plan, clip.id, { transitionSec: Math.min(3, Math.max(0.1, Number(e.target.value) || 0.5)) }))}
                  />
                </label>
                <button type="button" disabled={busy} onClick={() => props.onChange(setAllTransitions(plan, transition as VsTransition, clip.transitionSec))}>
                  {t["vs_tr_all"]}
                </button>
              </>
            ) : null}
          </>
        ) : null}
        {isImage ? (
          <label>
            {t["vs_tl_motion"]}
            <select
              disabled={busy}
              value={clip.motion ?? "none"}
              data-testid="vs-tl-motion"
              onChange={(e) => props.onChange(updateClip(plan, clip.id, { motion: e.target.value as VsMotion }))}
            >
              {MOTIONS.map((m) => (
                <option key={m} value={m}>
                  {t[`vs_mo_${m}`]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isVideo ? (
          <>
            <label>
              {t["vs_tl_speed"]}
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                disabled={busy}
                value={clip.speed ?? 1}
                onChange={(e) => props.onChange(updateClip(plan, clip.id, { speed: Number(e.target.value) }))}
              />
              <span className="vs-tl-val">{Math.round((clip.speed ?? 1) * 100) / 100}x</span>
            </label>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={clip.keepAudio === true}
                onChange={(e) => props.onChange(updateClip(plan, clip.id, { keepAudio: e.target.checked }))}
              />
              {t["vs_tl_keep_audio"]}
            </label>
          </>
        ) : null}
      </div>
    );
  }

  if (selected.kind === "audio") {
    const a = plan.audio.find((x) => x.id === selected.id);
    if (!a) return null;
    const slider = (label: string, key: "volume" | "fadeIn" | "fadeOut" | "speed", min: number, max: number, step: number, def: number) => (
      <label>
        {label}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={busy}
          value={a[key] ?? def}
          onChange={(e) => props.onChange(updateAudio(plan, a.id, { [key]: Number(e.target.value) }))}
        />
        <span className="vs-tl-val">{Math.round((a[key] ?? def) * 100) / 100}</span>
      </label>
    );
    return (
      <div className="vs-tl-inspector" data-testid="vs-tl-inspector-audio">
        {slider(t["vs_tl_volume"] ?? "", "volume", 0, 2, 0.05, 1)}
        {slider(t["vs_tl_fade_in"] ?? "", "fadeIn", 0, 10, 0.5, 0)}
        {slider(t["vs_tl_fade_out"] ?? "", "fadeOut", 0, 10, 0.5, 0)}
        {slider(t["vs_tl_speed"] ?? "", "speed", 0.5, 2, 0.05, 1)}
      </div>
    );
  }

  if (selected.kind === "text") {
    const x = plan.texts.find((q) => q.id === selected.id);
    if (!x) return null;
    return (
      <div className="vs-tl-inspector" data-testid="vs-tl-inspector-text">
        <label>
          {t["vs_tx_size"]}
          <input
            type="range"
            min={0.02}
            max={0.15}
            step={0.005}
            disabled={busy}
            value={x.size ?? 0.05}
            onChange={(e) => props.onChange(updateText(plan, x.id, { size: Number(e.target.value) }))}
          />
        </label>
        <label>
          {t["vs_tx_color"]}
          <input type="color" disabled={busy} value={x.color ?? "#ffffff"} onChange={(e) => props.onChange(updateText(plan, x.id, { color: e.target.value }))} />
        </label>
        <button type="button" disabled={busy} onClick={() => props.onChange(updateText(plan, x.id, { x: 0.5, y: 0.85 }))}>
          {t["vs_tx_reset_pos"]}
        </button>
        <span className="muted">{t["vs_tx_drag_hint"]}</span>
      </div>
    );
  }
  return null;
}
