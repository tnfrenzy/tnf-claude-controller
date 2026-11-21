import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { VsPlan, VsStyle } from "../../../../src/core/videostudio/plan-types";
import { api } from "../../api";
import { activeAt, timelineDuration } from "../../videostudio/timeline";
import { previewFilterCss } from "./previewFilter";
import "./videostudio.css";

export { previewFilterCss };

export interface VideoPreviewProps {
  slug: string;
  plan: VsPlan;
  style: VsStyle | null;
  time: number;
  playing: boolean;
  onTime(t: number): void;
  onEnded(): void;
  /** Called while a caption is dragged inside the frame; x and y are fractions of the frame (0 to 1). */
  onTextMove?: ((id: string, x: number, y: number) => void) | undefined;
}

const DRIFT = 0.3;

/** Lazy object-URL cache keyed by asset path. Returns the map path -> url. */
function useAssetUrls(slug: string, wanted: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useRef(new Map<string, string>());
  const loading = useRef(new Set<string>());
  const alive = useRef(true);
  const slugRef = useRef(slug);

  const revokeAll = () => {
    for (const u of cache.current.values()) URL.revokeObjectURL(u);
    cache.current.clear();
    loading.current.clear();
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      revokeAll();
    };
  }, []);

  useEffect(() => {
    if (slugRef.current !== slug) {
      slugRef.current = slug;
      revokeAll();
      setUrls({});
    }
  }, [slug]);

  const key = wanted.join("\n");
  useEffect(() => {
    for (const path of wanted) {
      if (cache.current.has(path) || loading.current.has(path)) continue;
      loading.current.add(path);
      const forSlug = slug;
      api
        .videoStudioFile(slug, path)
        .then((blob) => {
          loading.current.delete(path);
          if (!alive.current || slugRef.current !== forSlug) return;
          const u = URL.createObjectURL(blob);
          cache.current.set(path, u);
          setUrls((prev) => ({ ...prev, [path]: u }));
        })
        .catch(() => {
          loading.current.delete(path);
        });
    }
  }, [slug, key]);

  return urls;
}

function AudioTrack({ src, offset, volume, playing, rate = 1 }: { src: string | undefined; offset: number; volume: number; playing: boolean; rate?: number }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    el.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    el.playbackRate = rate;
    if (Math.abs(el.currentTime - offset) > DRIFT) el.currentTime = Math.max(0, offset);
    if (playing) el.play().catch(() => {});
    else el.pause();
  }, [src, offset, volume, playing]);
  if (!src) return null;
  return <audio ref={ref} src={src} />;
}

/** CSS transform that approximates the Ken Burns move at progress p (0 to 1) of the clip. */
export function motionStyle(motion: string | undefined, p: number): CSSProperties | undefined {
  const q = Math.min(1, Math.max(0, p));
  if (motion === "zoomin") return { transform: `scale(${1 + 0.25 * q})` };
  if (motion === "zoomout") return { transform: `scale(${1.25 - 0.25 * q})` };
  if (motion === "panright") return { transform: `scale(1.2) translateX(${(0.5 - q) * 16.6}%)` };
  if (motion === "panleft") return { transform: `scale(1.2) translateX(${(q - 0.5) * 16.6}%)` };
  return undefined;
}

export function VideoPreview({ slug, plan, style, time, playing, onTime, onEnded, onTextMove }: VideoPreviewProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragText = useRef<string | null>(null);
  const act = activeAt(plan, time);
  const clip = act.clip;
  const needsAsset = clip && (clip.kind === "video" || clip.kind === "image") && clip.asset ? clip.asset : null;
  const wanted: string[] = [];
  if (needsAsset) wanted.push(needsAsset);
  for (const a of act.audio) if (!wanted.includes(a.asset)) wanted.push(a.asset);
  const urls = useAssetUrls(slug, wanted);

  // Video sync.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastClipId = useRef<string | null>(null);
  const videoSrc = clip && clip.kind === "video" && clip.asset ? urls[clip.asset] : undefined;
  const clipSpeed = clip && clip.kind === "video" && typeof clip.speed === "number" && clip.speed > 0 ? clip.speed : 1;
  const target = clip ? clip.srcIn + act.offset * clipSpeed : 0;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !clip || !videoSrc) return;
    const changed = lastClipId.current !== clip.id;
    lastClipId.current = clip.id;
    v.playbackRate = clipSpeed;
    if (changed || Math.abs(v.currentTime - target) > DRIFT) v.currentTime = Math.max(0, target);
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [clip?.id, videoSrc, target, playing, clipSpeed]);

  // Playback loop.
  const timeRef = useRef(time);
  timeRef.current = time;
  const cbRef = useRef({ onTime, onEnded });
  cbRef.current = { onTime, onEnded };
  const duration = timelineDuration(plan);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let t = timeRef.current;
    let done = false;
    const tick = (now: number) => {
      if (done) return;
      t = Math.max(timeRef.current, 0) + (now - last) / 1000;
      last = now;
      timeRef.current = t;
      if (t >= duration) {
        done = true;
        cbRef.current.onTime(duration);
        cbRef.current.onEnded();
        return;
      }
      cbRef.current.onTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      done = true;
      cancelAnimationFrame(raf);
    };
  }, [playing, duration]);

  const fit = clip ? (clip.fit ?? plan.fit ?? "blur") : "blur";
  const filter = previewFilterCss(style);
  const frame: CSSProperties = { aspectRatio: `${plan.width} / ${plan.height}` };
  if (filter !== "none") frame.filter = filter;

  let media: ReactElement;
  if (!clip) {
    media = <div className="vs-preview__empty" />;
  } else if (clip.kind === "card") {
    media = (
      <div className="vs-preview__card" style={{ background: clip.color || "#222" }}>
        {clip.cardText}
      </div>
    );
  } else if (clip.asset && clip.kind === "video") {
    media = videoSrc ? <video key={clip.id} ref={videoRef} className={"vs-preview__media vs-fit-" + fit} src={videoSrc} muted playsInline /> : <div className="vs-preview__empty" />;
  } else if (clip.asset && clip.kind === "image") {
    const u = urls[clip.asset];
    media = u ? (
      <>
        {fit === "blur" ? <img key={clip.id + "-bg"} className="vs-preview__media vs-fit-cover vs-fit-bg" src={u} alt="" /> : null}
        <img key={clip.id} className={"vs-preview__media vs-fit-" + (fit === "blur" ? "contain" : fit)} src={u} alt="" style={motionStyle(clip.motion, clip.duration > 0 ? act.offset / clip.duration : 0)} />
      </>
    ) : <div className="vs-preview__empty" />;
  } else if (clip.prompt) {
    media = <div className="vs-preview__prompt">{clip.prompt}</div>;
  } else {
    // video/image clip without asset and without prompt: dark frame, no API call.
    media = <div className="vs-preview__empty" />;
  }

  return (
    <div className="vs-preview" style={frame} ref={frameRef}>
      {media}
      {(plan.showTexts === false ? [] : act.texts).map((t) => (
        <div
          key={t.id}
          className={"vs-preview__text" + (style?.textBox ? " vs-preview__text--box" : "")}
          onPointerDown={(e) => {
            if (!onTextMove) return;
            dragText.current = t.id;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* synthetic event */
            }
          }}
          onPointerMove={(e) => {
            const r = frameRef.current?.getBoundingClientRect();
            if (!onTextMove || dragText.current !== t.id || !r || r.width === 0 || r.height === 0) return;
            onTextMove(t.id, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
          }}
          onPointerUp={() => {
            dragText.current = null;
          }}
          style={{
            cursor: onTextMove ? "move" : undefined,
            touchAction: "none",
            left: `${(t.x ?? 0.5) * 100}%`,
            top: `${(t.y ?? 0.85) * 100}%`,
            // size = fraction of frame height (default 0.05 = 5%); cqh = 1% of frame height.
            fontSize: `${(t.size ?? 0.05) * 100}cqh`,
            color: t.color ?? style?.textColor,
            fontFamily: style?.font,
          }}
        >
          {t.text}
        </div>
      ))}
      {act.audio.map((a) => (
        <AudioTrack key={a.id} src={urls[a.asset]} offset={(time - a.start) * (a.speed ?? 1) + (a.srcIn ?? 0)} volume={a.volume} playing={playing} rate={a.speed ?? 1} />
      ))}
    </div>
  );
}
