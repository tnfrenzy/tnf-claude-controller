import { useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import type { VsPlan, VsVideoClip } from "../../../../src/core/videostudio/plan-types";
import { TimelineInspector } from "./TimelineInspector";
import type { VsAspect } from "../../../../src/core/videostudio/plan-types";
import { addCardAt, splitAudioAt, trimAudio, addText, aspectOf, clipStarts, duplicateClip, setAspect, setShowTexts, showTextsOf, deleteAudio, deleteClip, moveAudio, moveClip, pxToSec, removeText, secToPx, splitClipAt, timelineDuration, trimClip, updateText } from "../../videostudio/timeline";
import { useT } from "../../i18n";
import "./timeline.css";

export interface TimelineEditorProps {
  plan: VsPlan;
  time: number;
  busy: boolean;
  onSeek: (t: number) => void;
  onChange: (plan: VsPlan) => void;
  /** When set, the toolbar shows a button that picks image/video files to insert at the playhead. */
  onAddMedia?: ((files: File[]) => void) | undefined;
  uploading?: boolean | undefined;
  /** Picks audio files (music / sound) to put on the audio row at the playhead. */
  onAddAudio?: ((files: File[]) => void) | undefined;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  canUndo?: boolean | undefined;
  canRedo?: boolean | undefined;
  /** Renders a quick preview of only this part of the video. */
  onPreviewRange?: ((range: { start: number; end: number }) => void) | undefined;
  onToggleNarration?: (() => void) | undefined;
  narrationOpen?: boolean | undefined;
  onEditSegment: (seg: { start: number; end: number; instruction: string }) => void;
}

export function selectionFromClip(plan: VsPlan, index: number): { start: number; end: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= plan.video.length) return null;
  const start = clipStarts(plan)[index] as number;
  return { start, end: start + (plan.video[index] as VsVideoClip).duration };
}

/** Index a dragged clip lands on, given the dropped x (seconds) against the clip midpoints. */
export function dropIndexFromX(plan: VsPlan, from: number, dropSec: number): number {
  const n = plan.video.length;
  if (n === 0) return 0;
  const starts = clipStarts(plan);
  const others: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === from) continue;
    others.push((starts[i] as number) + (plan.video[i] as VsVideoClip).duration / 2);
  }
  let to = 0;
  for (const mid of others) if (dropSec > mid) to++;
  return Math.max(0, Math.min(n - 1, to));
}

/** Sorted, non-negative range from two drag positions in seconds. Null when degenerate. */
export function rangeFromDrag(a: number, b: number): { start: number; end: number } | null {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.max(0, Math.max(a, b));
  if (!(hi - lo > 0.05)) return null;
  return { start: lo, end: hi };
}

const DEFAULT_ZOOM = 40;
const MIN_ZOOM = 8;
const MAX_ZOOM = 240;

function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

type Sel = { kind: "clip" | "audio" | "text"; id: string };
type Drag =
  | { type: "seek" }
  | { type: "range"; anchor: number }
  | { type: "move"; index: number; startX: number; dx: number }
  | { type: "trim"; index: number; edge: "start" | "end"; startX: number; dx: number }
  | { type: "audio"; id: string; startX: number; dx: number }
  | { type: "atrim"; id: string; edge: "start" | "end"; startX: number; dx: number };

export function TimelineEditor(props: TimelineEditorProps) {
  const { plan, time, busy } = props;
  const { t } = useT();
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [instruction, setInstruction] = useState("");
  const [selected, setSelected] = useState<Sel | null>(
    plan.video[0] ? { kind: "clip", id: plan.video[0].id } : null,
  );
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);

  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const total = Math.max(timelineDuration(plan), ...plan.audio.map((a) => a.start + a.duration), ...plan.texts.map((x) => x.start + x.duration), 1);
  const width = Math.ceil(secToPx(total, zoom)) + 40;
  const starts = clipStarts(plan);
  const ticks: number[] = [];
  for (let s = 0; s <= total; s += 1) ticks.push(s);

  const clipLabel = (c: VsVideoClip): string => {
    if (c.asset) return baseName(c.asset);
    if (c.cardText) return c.cardText;
    if (c.prompt) return c.prompt;
    return c.kind === "image" ? t.vs_tl_clip_image : c.kind === "card" ? t.vs_tl_clip_card : t.vs_tl_clip_video;
  };

  const rulerSec = (e: RPointerEvent<HTMLElement>): number => {
    const r = (rulerRef.current ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    return Math.max(0, pxToSec(e.clientX - r.left, zoom));
  };

  const capture = (e: RPointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic event) */
    }
  };

  // ruler: seek or Shift+drag range
  const onRulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    capture(e);
    const sec = rulerSec(e);
    if (e.shiftKey) {
      setDragBoth({ type: "range", anchor: sec });
      setRange(null);
    } else {
      setDragBoth({ type: "seek" });
      props.onSeek(sec);
    }
  };
  const onRulerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    const d = dragRef.current;
    if (!d) return;
    const sec = rulerSec(e);
    if (d.type === "seek") props.onSeek(sec);
    else if (d.type === "range") setRange(rangeFromDrag(d.anchor, sec));
  };
  const onRulerUp = () => {
    if (busy) return;
    setDragBoth(null);
  };

  // clip body / handles / audio
  const onClipDown = (e: RPointerEvent<HTMLDivElement>, index: number, id: string) => {
    if (busy) return;
    e.stopPropagation();
    capture(e);
    setSelected({ kind: "clip", id });
    setRange(null);
    setDragBoth({ type: "move", index, startX: e.clientX, dx: 0 });
  };
  const onHandleDown = (e: RPointerEvent<HTMLSpanElement>, index: number, edge: "start" | "end") => {
    if (busy) return;
    e.stopPropagation();
    capture(e);
    const c = plan.video[index];
    if (c) setSelected({ kind: "clip", id: c.id });
    setRange(null);
    setDragBoth({ type: "trim", index, edge, startX: e.clientX, dx: 0 });
  };
  const onAudioDown = (e: RPointerEvent<HTMLDivElement>, id: string) => {
    if (busy) return;
    e.stopPropagation();
    capture(e);
    setSelected({ kind: "audio", id });
    setDragBoth({ type: "audio", id, startX: e.clientX, dx: 0 });
  };
  const onAudioHandleDown = (e: RPointerEvent<HTMLSpanElement>, id: string, edge: "start" | "end") => {
    if (busy) return;
    e.stopPropagation();
    capture(e);
    setSelected({ kind: "audio", id });
    setDragBoth({ type: "atrim", id, edge, startX: e.clientX, dx: 0 });
  };
  const onTextDown = (e: RPointerEvent<HTMLDivElement>, id: string) => {
    if (busy) return;
    e.stopPropagation();
    setSelected({ kind: "text", id });
    setRange(null);
  };
  const onDragMove = (e: RPointerEvent<HTMLElement>) => {
    if (busy) return;
    const d = dragRef.current;
    if (!d || d.type === "seek" || d.type === "range") return;
    setDragBoth({ ...d, dx: e.clientX - d.startX });
  };
  const onDragUp = (e: RPointerEvent<HTMLElement>) => {
    if (busy) return;
    const d = dragRef.current;
    if (!d || d.type === "seek" || d.type === "range") return;
    const dx = e.clientX - d.startX;
    setDragBoth(null);
    if (Math.abs(dx) < 3) return;
    const deltaSec = pxToSec(dx, zoom);
    let next = plan;
    if (d.type === "move") {
      const c = plan.video[d.index];
      if (!c) return;
      const dropSec = (starts[d.index] as number) + c.duration / 2 + deltaSec;
      next = moveClip(plan, d.index, dropIndexFromX(plan, d.index, dropSec));
    } else if (d.type === "trim") {
      next = trimClip(plan, d.index, d.edge, deltaSec);
    } else if (d.type === "audio") {
      const a = plan.audio.find((x) => x.id === d.id);
      if (!a) return;
      next = moveAudio(plan, d.id, Math.max(0, a.start + deltaSec));
    } else if (d.type === "atrim") {
      next = trimAudio(plan, d.id, d.edge, deltaSec);
    }
    if (next !== plan) props.onChange(next);
  };

  const rangeShown = range ?? (selected?.kind === "clip" ? selectionFromClip(plan, plan.video.findIndex((c) => c.id === selected.id)) : null);

  const emit = (next: VsPlan) => {
    if (next !== plan) props.onChange(next);
  };
  const onSplit = () => {
    if (busy) return;
    emit(splitClipAt(plan, time));
  };
  const onDelete = () => {
    if (busy || !selected) return;
    if (selected.kind === "clip") emit(deleteClip(plan, plan.video.findIndex((c) => c.id === selected.id)));
    else if (selected.kind === "text") emit(removeText(plan, selected.id));
    else emit(deleteAudio(plan, selected.id));
    setSelected(null);
  };
  const onAddText = () => {
    if (busy) return;
    emit(addText(plan, t.vs_tl_text_default, Math.max(0, time)));
  };
  const selectedText = selected?.kind === "text" ? plan.texts.find((x) => x.id === selected.id) : undefined;
  const onSegment = () => {
    if (busy || !rangeShown) return;
    const ins = instruction.trim();
    if (!ins) return;
    props.onEditSegment({ start: rangeShown.start, end: rangeShown.end, instruction: ins });
  };

  return (
    <div className={"vs-tl" + (busy ? " is-busy" : "")}>
      <div className="vs-tl-bar">
        <button type="button" className="vs-tl-btn-undo" disabled={busy || !props.canUndo} title={t.vs_tl_undo} onClick={() => props.onUndo?.()}>↶</button>
        <button type="button" className="vs-tl-btn-redo" disabled={busy || !props.canRedo} title={t.vs_tl_redo} onClick={() => props.onRedo?.()}>↷</button>
        <button type="button" className="vs-tl-btn-split" disabled={busy} onClick={onSplit}>{t.vs_tl_split}</button>
        <button type="button" className="vs-tl-btn-splitaudio" disabled={busy || selected?.kind !== "audio"} title={t.vs_tl_split_audio_tip} onClick={() => {
          if (selected?.kind === "audio") emit(splitAudioAt(plan, selected.id, time));
        }}>{t.vs_tl_split_audio}</button>
        <button type="button" className="vs-tl-btn-dup" disabled={busy || selected?.kind !== "clip"} onClick={() => {
          if (selected?.kind === "clip") emit(duplicateClip(plan, plan.video.findIndex((c) => c.id === selected.id)));
        }}>{t.vs_tl_duplicate}</button>
        <button type="button" className="vs-tl-btn-delete" disabled={busy || !selected} onClick={onDelete}>{t.vs_btn_delete}</button>
        {props.onAddMedia ? (
          <label className={"vs-tl-btn-addmedia" + (busy || props.uploading ? " is-disabled" : "")}>
            {props.uploading ? t.vs_tl_add_media_busy : t.vs_tl_add_media}
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              hidden
              disabled={busy || props.uploading === true}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) props.onAddMedia?.(files);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
        <button type="button" className="vs-tl-btn-addcard" disabled={busy} onClick={() => emit(addCardAt(plan, time, t.vs_tl_card_default))}>{t.vs_tl_add_card}</button>
        {props.onAddAudio ? (
          <label className={"vs-tl-btn-addmedia" + (busy || props.uploading ? " is-disabled" : "")}>
            {t.vs_tl_add_audio}
            <input
              type="file"
              multiple
              accept="audio/*"
              hidden
              disabled={busy || props.uploading === true}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) props.onAddAudio?.(files);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
        {props.onToggleNarration ? (
          <button type="button" className={"vs-tl-btn-narr" + (props.narrationOpen ? " is-on" : "")} disabled={busy} onClick={props.onToggleNarration}>🎙 {t.vs_narr_btn}</button>
        ) : null}
        <button type="button" className="vs-tl-btn-addtext" disabled={busy} onClick={onAddText}>{t.vs_tl_add_text}</button>
        <label className="vs-tl-toggle" title={t.vs_tl_show_texts_tip}>
          <input type="checkbox" disabled={busy} checked={showTextsOf(plan)} onChange={(e) => emit(setShowTexts(plan, e.target.checked))} />
          {t.vs_tl_show_texts}
        </label>
        <label className="vs-tl-toggle">
          {t.vs_tl_aspect}
          <select disabled={busy} value={aspectOf(plan) ?? ""} onChange={(e) => emit(setAspect(plan, e.target.value as VsAspect))}>
            {aspectOf(plan) === null ? <option value="">{plan.width}x{plan.height}</option> : null}
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
        </label>
        <button type="button" className="vs-tl-btn-zoom-out" disabled={busy} title={t.vs_tl_zoom_out} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5))}>-</button>
        <button type="button" className="vs-tl-btn-zoom-in" disabled={busy} title={t.vs_tl_zoom_in} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}>+</button>
        {busy ? <span className="vs-tl-busy">{t.vs_tl_busy}</span> : null}
      </div>
      <TimelineInspector plan={plan} selected={selected} busy={busy} onChange={emit} />
      {selectedText ? (
        <div className="vs-tl-segment">
          <input
            className="vs-tl-text-input"
            aria-label={t.vs_tl_text_edit}
            disabled={busy}
            value={selectedText.text}
            onChange={(e) => emit(updateText(plan, selectedText.id, { text: e.target.value }))}
          />
        </div>
      ) : null}
      <div className="vs-tl-scroll">
        <div className="vs-tl-inner" style={{ width }}>
          <div
            ref={rulerRef}
            className="vs-tl-ruler"
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            onPointerUp={onRulerUp}
            onPointerCancel={onRulerUp}
          >
            {ticks.map((s) => (
              <div key={s} className="vs-tl-tick" style={{ left: secToPx(s, zoom) }}>{s}s</div>
            ))}
          </div>
          {rangeShown ? (
            <div
              className="vs-tl-range"
              title={t.vs_tl_selection}
              style={{ left: secToPx(rangeShown.start, zoom), width: secToPx(rangeShown.end - rangeShown.start, zoom) }}
            />
          ) : null}
          <div className="vs-tl-playhead" title={t.vs_tl_playhead} style={{ left: secToPx(Math.max(0, time), zoom) }} />
          <div className="vs-tl-row vs-tl-row-video" aria-label={t.vs_tl_video}>
            {plan.video.map((c, i) => {
              const moving = drag?.type === "move" && drag.index === i ? drag.dx : 0;
              const trim = drag?.type === "trim" && drag.index === i ? drag : null;
              let left = secToPx(starts[i] as number, zoom) + moving;
              let w = secToPx(c.duration, zoom);
              if (trim) {
                if (trim.edge === "start") {
                  const d = Math.min(trim.dx, w - 4);
                  left += d;
                  w -= d;
                } else w = Math.max(4, w + trim.dx);
              }
              return (
                <div
                  key={c.id}
                  data-testid="vs-tl-clip"
                  className={"vs-tl-clip" + (selected?.kind === "clip" && selected.id === c.id ? " is-selected" : "")}
                  style={{ left, width: w }}
                  onPointerDown={(e) => onClipDown(e, i, c.id)}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragUp}
                  onPointerCancel={() => setDragBoth(null)}
                >
                  <span
                    className="vs-tl-handle-l"
                    onPointerDown={(e) => onHandleDown(e, i, "start")}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragUp}
                    onPointerCancel={() => setDragBoth(null)}
                  />
                  {clipLabel(c)}
                  <span
                    className="vs-tl-handle-r"
                    onPointerDown={(e) => onHandleDown(e, i, "end")}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragUp}
                    onPointerCancel={() => setDragBoth(null)}
                  />
                </div>
              );
            })}
          </div>
          <div className="vs-tl-row vs-tl-row-audio" aria-label={t.vs_tl_audio}>
            {plan.audio.map((a) => {
              const dx = drag?.type === "audio" && drag.id === a.id ? drag.dx : 0;
              const at = drag?.type === "atrim" && drag.id === a.id ? drag : null;
              let aLeft = Math.max(0, secToPx(a.start, zoom) + dx);
              let aW = secToPx(a.duration, zoom);
              if (at) {
                if (at.edge === "start") {
                  const d = Math.min(at.dx, aW - 4);
                  aLeft += d;
                  aW -= d;
                } else aW = Math.max(4, aW + at.dx);
              }
              return (
                <div
                  key={a.id}
                  data-testid="vs-tl-audio"
                  className={"vs-tl-audio" + (selected?.kind === "audio" && selected.id === a.id ? " is-selected" : "")}
                  style={{ left: aLeft, width: aW }}
                  onPointerDown={(e) => onAudioDown(e, a.id)}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragUp}
                  onPointerCancel={() => setDragBoth(null)}
                >
                  <span
                    className="vs-tl-handle-l"
                    onPointerDown={(e) => onAudioHandleDown(e, a.id, "start")}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragUp}
                    onPointerCancel={() => setDragBoth(null)}
                  />
                  {baseName(a.asset)}
                  <span
                    className="vs-tl-handle-r"
                    onPointerDown={(e) => onAudioHandleDown(e, a.id, "end")}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragUp}
                    onPointerCancel={() => setDragBoth(null)}
                  />
                </div>
              );
            })}
          </div>
          <div className="vs-tl-row vs-tl-row-text" aria-label={t.vs_tl_text}>
            {plan.texts.map((x) => (
              <div
                key={x.id}
                data-testid="vs-tl-text"
                className={"vs-tl-text" + (selected?.kind === "text" && selected.id === x.id ? " is-selected" : "")}
                style={{ left: secToPx(x.start, zoom), width: secToPx(x.duration, zoom) }}
                onPointerDown={(e) => onTextDown(e, x.id)}
              >
                {x.text}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="vs-tl-segment">
        {rangeShown ? (
          <span className="vs-tl-segment-range">{t.vs_tl_selection}: {rangeShown.start.toFixed(1)}s - {rangeShown.end.toFixed(1)}s</span>
        ) : null}
        <input
          className="vs-tl-segment-input"
          placeholder={t.vs_tl_instruction_ph}
          disabled={busy}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button type="button" className="vs-tl-btn-segment" disabled={busy || !rangeShown || !instruction.trim()} onClick={onSegment}>{t.vs_btn_edit_segment}</button>
        {props.onPreviewRange ? (
          <button type="button" className="vs-tl-btn-prange" disabled={busy || !rangeShown} title={t.vs_tl_prange_tip} onClick={() => {
            if (rangeShown) props.onPreviewRange?.({ start: rangeShown.start, end: rangeShown.end });
          }}>{t.vs_tl_prange}</button>
        ) : null}
      </div>
    </div>
  );
}
