import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { useT } from "../../i18n";

/** The fields of a style that decide how a frame looks. */
export interface StyleLook {
  transition: "none" | "fade";
  transitionSec: number;
  shotSec: number;
  font: string;
  textColor: string;
  textBox: boolean;
  brightness?: number | undefined;
  contrast?: number | undefined;
  saturation?: number | undefined;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * CSS for the sample frame of a style: the colour grade as a CSS filter (same meaning as ffmpeg's eq: brightness
 * is an offset, contrast and saturation are factors), and the caption's font, colour and box.
 */
export function styleFrameCss(s: StyleLook): { filter: string; caption: { fontFamily: string; color: string; background: string; padding: string } } {
  const b = Math.min(1, Math.max(-1, num(s.brightness, 0)));
  const c = Math.min(3, Math.max(0, num(s.contrast, 1)));
  const sat = Math.min(3, Math.max(0, num(s.saturation, 1)));
  const font = String(s.font ?? "").replace(/[^A-Za-z0-9 _-]/g, "").trim();
  return {
    filter: `brightness(${(1 + b).toFixed(2)}) contrast(${c.toFixed(2)}) saturate(${sat.toFixed(2)})`,
    caption: {
      fontFamily: font ? `"${font}", Arial, sans-serif` : "Arial, sans-serif",
      color: COLOR_RE.test(s.textColor) ? s.textColor : "#ffffff",
      background: s.textBox ? "rgba(0,0,0,0.6)" : "transparent",
      padding: s.textBox ? "3px 8px" : "0",
    },
  };
}

/** A small frame that shows the style at a glance: graded scene, caption look, shot length and transition. */
export function StyleFrame(props: { style: StyleLook }) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const css = styleFrameCss(props.style);
  const sec = num(props.style.shotSec, 3);
  const tsec = num(props.style.transitionSec, 0);
  return (
    <div className="vs-frame">
      <div className="vs-frame-scene" style={{ filter: css.filter }} />
      <div className="vs-frame-caption" style={css.caption}>
        <div>{t["vs_st_sample_l1"]}</div>
        <div>{t["vs_st_sample_l2"]}</div>
      </div>
      <div className="vs-frame-meta">
        <span>{(t["vs_st_shot"] ?? "").replace("{n}", String(sec))}</span>
        <span>{props.style.transition === "fade" && tsec > 0 ? (t["vs_st_fade"] ?? "").replace("{n}", String(tsec)) : t["vs_st_cut"]}</span>
      </div>
    </div>
  );
}

/** Renders a few seconds with the real ffmpeg pipeline so the user sees exactly what the style produces. */
export function StyleSample(props: { input: () => unknown; label?: string | undefined }) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  const run = async () => {
    setState("busy");
    setError(null);
    try {
      const { file } = await api.videoStudioStylePreview(props.input());
      const blob = await api.videoStudioStylePreviewFile(file);
      const next = URL.createObjectURL(blob);
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = next;
      setUrl(next);
      setState("idle");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setState("error");
    }
  };

  return (
    <div className="vs-sample">
      <button type="button" disabled={state === "busy"} onClick={() => void run()}>
        {state === "busy" ? t["vs_st_sampling"] : (props.label ?? t["vs_st_sample"])}
      </button>
      {error ? <p className="error">{error}</p> : null}
      {url ? <video className="vs-pv-player" src={url} controls autoPlay loop muted /> : null}
    </div>
  );
}
