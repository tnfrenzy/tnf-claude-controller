import type { VsPlan, VsProjectDetail, VsStyle } from "../../../../src/core/videostudio/plan-types";
import { useT } from "../../i18n";
import { timelineDuration } from "../../videostudio/timeline";
import { VideoPreview } from "./VideoPreview";
import { TimelineEditor } from "./TimelineEditor";
import { VideoPlayerBox } from "./VideoPlayerBox";
import { NarrationPanel } from "./NarrationPanel";
import { useState } from "react";
import { formatClock, hasNarration, readCostUsd, readLastPreview, readLastRender, stateIsBusy } from "./studio-room-logic";
import "./studio-room.css";

export interface VideoStudioRoomBodyProps {
  detail: VsProjectDetail;
  styles: VsStyle[];
  time: number;
  playing: boolean;
  busy: boolean;
  uploading: boolean;
  onUpload(files: File[]): void;
  onUploadAudio(files: File[]): void;
  onUploadNarration(files: File[]): void;
  onPreviewRange(range: { start: number; end: number }): void;
  onTextMove(id: string, x: number, y: number): void;
  onUndo(): void;
  onRedo(): void;
  canUndo: boolean;
  canRedo: boolean;
  onPlayToggle(): void;
  onTime(t: number): void;
  onEnded(): void;
  onSeek(t: number): void;
  onPlanChange(plan: VsPlan): void;
  onEditSegment(seg: { start: number; end: number; instruction: string }): void;
  onGeneratePlan(): void;
  onNarrate(): void;
  onRender(): void;
  onPreview(): void;
  onStyleChange(styleId: string): void;
  /** null = not known yet. */
  ffmpegFound: boolean | null;
  onDownload(): void;
  onDelete(): void;
}

export function VideoStudioRoomBody(p: VideoStudioRoomBodyProps) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const { project, plan } = p.detail;
  const [narrOpen, setNarrOpen] = useState(false);
  const lastRender = readLastRender(project);
  const lastPreview = readLastPreview(project);
  const cost = readCostUsd(project);
  const style = p.styles.find((s) => s.id === project.styleId) ?? null;
  const locked = p.busy || stateIsBusy(project.state);
  const badgeCls =
    "vs-room-badge" +
    (stateIsBusy(project.state) ? " vs-room-badge--busy" : project.state === "failed" ? " vs-room-badge--failed" : project.state === "done" ? " vs-room-badge--done" : "");
  const duration = plan ? timelineDuration(plan) : 0;

  return (
    <div className="vs-room">
      <div className="vs-room-head">
        <span className="vs-room-title">{project.title}</span>
        <span className={badgeCls}>{t[`vs_state_${project.state}`] ?? project.state}</span>
        {cost !== null && (
          <span className="vs-room-cost">
            ${cost.toFixed(2)} - {t.vs_cost_estimate}
          </span>
        )}
      </div>
      {p.styles.length > 0 ? (
        <label className="vs-room-style">
          {t.vs_style}
          <select value={project.styleId} disabled={locked} onChange={(e) => p.onStyleChange(e.target.value)}>
            {p.styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="muted">{t.vs_st_room_note}</span>
        </label>
      ) : null}
      {project.error && (
        <div className="vs-room-error">
          {t.vs_error}: {project.error}
        </div>
      )}
      <div className="vs-room-grid">
        <div className="vs-room-main">
          {plan && (
            <>
              <VideoPreview slug={project.slug} plan={plan} style={style} time={p.time} playing={p.playing} onTime={p.onTime} onEnded={p.onEnded} onTextMove={locked ? undefined : p.onTextMove} />
              <div className="vs-room-controls">
                <button type="button" aria-label={p.playing ? "⏸" : "▶"} onClick={p.onPlayToggle}>
                  {p.playing ? "⏸" : "▶"}
                </button>
                <span className="vs-room-clock">
                  {formatClock(p.time)}/{formatClock(duration)}
                </span>
              </div>
            </>
          )}
          <div className="vs-room-videos">
            <h4>{t.vs_pv_title}</h4>
            {p.ffmpegFound === false ? <p className="warning">{t.vs_ffmpeg_missing}</p> : null}
            <div className="vs-room-actions">
              <button type="button" disabled={locked || !plan || plan.video.length === 0} onClick={p.onPreview}>
                {t.vs_pv_btn}
              </button>
              <span className="muted">{t.vs_pv_note}</span>
            </div>
            {lastPreview !== null ? <VideoPlayerBox slug={project.slug} rel={lastPreview} stamp={project.updatedAt} /> : <p className="muted">{t.vs_pv_empty}</p>}
            {lastRender !== null ? (
              <div className="vs-pv-final">
                <h4>{t.vs_pv_final}</h4>
                <VideoPlayerBox slug={project.slug} rel={lastRender} autoLoad={false} />
              </div>
            ) : null}
          </div>
          {plan && <TimelineEditor plan={plan} time={p.time} busy={locked} onSeek={p.onSeek} onChange={p.onPlanChange} onEditSegment={p.onEditSegment} onAddMedia={p.onUpload} uploading={p.uploading} onAddAudio={p.onUploadAudio} onPreviewRange={p.onPreviewRange} onUndo={p.onUndo} onRedo={p.onRedo} canUndo={p.canUndo} canRedo={p.canRedo} onToggleNarration={() => setNarrOpen((v) => !v)} narrationOpen={narrOpen} />}
          {plan && narrOpen ? (
            <NarrationPanel plan={plan} busy={locked} uploading={p.uploading} hasNarrationClip={plan.audio.some((a) => a.kind === "narration")} onChange={p.onPlanChange} onGenerate={p.onNarrate} onUpload={p.onUploadNarration} />
          ) : null}
          <div className="vs-room-actions">
            <button type="button" disabled={locked} onClick={p.onGeneratePlan}>
              {t.vs_btn_generate_plan}
            </button>
            {hasNarration(plan) && (
              <button type="button" disabled={locked} onClick={p.onNarrate}>
                {t.vs_btn_narrate}
              </button>
            )}
            <button type="button" disabled={locked} onClick={p.onRender}>
              {t.vs_btn_render}
            </button>
            {lastRender !== null && (
              <button type="button" disabled={locked} onClick={p.onDownload}>
                {t.vs_btn_download}
              </button>
            )}
            <button type="button" disabled={locked} onClick={p.onDelete}>
              {t.vs_btn_delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
