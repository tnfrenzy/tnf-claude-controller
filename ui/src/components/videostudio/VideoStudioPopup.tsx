import { useCallback, useEffect, useRef, useState } from "react";
import { addAudioClip, insertMedia, mediaKindOf } from "../../videostudio/timeline";
import type { VsPlan, VsProjectDetail, VsStyle } from "../../../../src/core/videostudio/plan-types";
import { api } from "../../api";
import { useT } from "../../i18n";
import { timelineDuration } from "../../videostudio/timeline";
import { VideoStudioRoomBody } from "./VideoStudioRoomBody";
import { readLastRender, stateIsBusy } from "./studio-room-logic";

export interface VideoStudioPopupProps {
  slug: string;
  onDeleted(): void;
}

const POLL_MS = 2000;
const SAVE_MS = 800;

const IMAGE_SECONDS = 3;

/** Length of a video file in seconds (read from its metadata in the browser); 5 s when it cannot be read. */
function videoSeconds(file: File, tag: "video" | "audio" = "video"): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement(tag);
    const done = (s: number) => {
      URL.revokeObjectURL(url);
      resolve(s);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration * 10) / 10 : 5);
    v.onerror = () => done(5);
    v.src = url;
  });
}

export function VideoStudioPopup({ slug, onDeleted }: VideoStudioPopupProps) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const [detail, setDetail] = useState<VsProjectDetail | null>(null);
  const [styles, setStyles] = useState<VsStyle[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [ffmpegFound, setFfmpegFound] = useState<boolean | null>(null);

  const mounted = useRef(true);
  const planRef = useRef<VsPlan | null>(null);
  const timeRef = useRef(0);
  const fetching = useRef(false);
  const dirtyPlan = useRef<VsPlan | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const d = await api.videoStudioGet(slug);
      if (!mounted.current) return;
      setDetail((prev) => {
        if (dirtyPlan.current && prev) return { ...d, plan: prev.plan };
        return d;
      });
    } catch (e) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      fetching.current = false;
    }
  }, [slug]);

  const flush = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const plan = dirtyPlan.current;
    if (!plan) return;
    dirtyPlan.current = null;
    try {
      await api.videoStudioSavePlan(slug, plan);
    } catch (e) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    }
  }, [slug]);

  useEffect(() => {
    mounted.current = true;
    void refetch();
    api
      .videoStudioStyles()
      .then((r) => {
        if (mounted.current) setStyles(r.styles);
      })
      .catch(() => {});
    api
      .videoStudioSettings()
      .then((r) => {
        if (mounted.current) setFfmpegFound(r.settings.ffmpegFound === true);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      void flush();
    };
  }, [refetch, flush]);

  const state = detail?.project.state;
  const busyState = state ? stateIsBusy(state) : false;
  const polling = busyState || pollTick > 0;
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(id);
  }, [polling, refetch]);

  // After an action, keep polling a few cycles even if the state still reads "ready".
  useEffect(() => {
    if (pollTick === 0) return;
    const id = setTimeout(() => {
      if (mounted.current) setPollTick(0);
    }, POLL_MS * 3);
    return () => clearTimeout(id);
  }, [pollTick]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await flush();
      await fn();
    } catch (e) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
    await refetch();
    if (mounted.current) setPollTick(1);
  };

  // Undo / redo of plan edits. Edits within 700 ms of each other (typing, dragging a slider) count as one step.
  const undoStack = useRef<VsPlan[]>([]);
  const redoStack = useRef<VsPlan[]>([]);
  const lastPush = useRef(0);
  const [, setHistoryTick] = useState(0);
  const applyPlan = (plan: VsPlan) => {
    dirtyPlan.current = plan;
    setDetail((d) => (d ? { ...d, plan } : d));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_MS);
  };
  const onUndo = () => {
    const prev = undoStack.current.pop();
    const cur = planRef.current;
    if (!prev || !cur) return;
    redoStack.current.push(cur);
    applyPlan(prev);
    setHistoryTick((n) => n + 1);
  };
  const onRedo = () => {
    const next = redoStack.current.pop();
    const cur = planRef.current;
    if (!next || !cur) return;
    undoStack.current.push(cur);
    applyPlan(next);
    setHistoryTick((n) => n + 1);
  };
  const onPlanChange = (plan: VsPlan) => {
    const cur = planRef.current;
    const now = Date.now();
    if (cur && now - lastPush.current > 700) {
      undoStack.current.push(cur);
      if (undoStack.current.length > 60) undoStack.current.shift();
    }
    lastPush.current = now;
    redoStack.current = [];
    setHistoryTick((n) => n + 1);
    dirtyPlan.current = plan;
    setDetail((d) => (d ? { ...d, plan } : d));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_MS);
  };

  // Uploads images/videos and inserts them into the timeline at the playhead.
  const onUpload = async (files: File[]) => {
    setUploading(true);
    setErr(null);
    const items: { asset: string; kind: "image" | "video"; duration: number }[] = [];
    for (const f of files) {
      const kind = mediaKindOf(f.name);
      if (!kind) {
        setErr(`${f.name}: ${t["vs_up_only_media"]}`);
        continue;
      }
      try {
        const up = await api.videoStudioUpload(slug, f);
        items.push({ asset: up.rel, kind, duration: kind === "video" ? await videoSeconds(f) : IMAGE_SECONDS });
      } catch (e) {
        if (mounted.current) setErr(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (mounted.current) {
      const base = planRef.current;
      if (base && items.length) onPlanChange(insertMedia(base, timeRef.current, items));
      setUploading(false);
    }
  };

  planRef.current = detail?.plan ?? null;
  timeRef.current = time;
  // Uploads audio files and puts them on the audio row (music at the playhead, narration at 0).
  const onUploadAudio = async (files: File[], kind: "music" | "narration") => {
    setUploading(true);
    setErr(null);
    let plan = planRef.current;
    for (const f of files) {
      if (!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) {
        setErr(`${f.name}: ${t["vs_up_only_audio"]}`);
        continue;
      }
      try {
        const up = await api.videoStudioUpload(slug, f);
        const dur = await videoSeconds(f, "audio");
        if (plan) plan = addAudioClip(plan, up.rel, kind === "narration" ? 0 : timeRef.current, dur, kind);
      } catch (e) {
        if (mounted.current) setErr(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (mounted.current) {
      if (plan && plan !== planRef.current) onPlanChange(plan);
      setUploading(false);
    }
  };

  if (!detail) {
    return <div className="vs-room">{err ?? "..."}</div>;
  }

  const plan = detail.plan;
  return (
    <>
      {err && <div className="vs-room-error">{err}</div>}
      <VideoStudioRoomBody
        detail={detail}
        styles={styles}
        time={time}
        playing={playing}
        busy={busy}
        uploading={uploading}
        onUpload={(files) => void onUpload(files)}
        onUploadAudio={(files) => void onUploadAudio(files, "music")}
        onUploadNarration={(files) => void onUploadAudio(files, "narration")}
        onPreviewRange={(r) => void act(() => api.videoStudioPreview(slug, r))}
        onTextMove={(id, x, y) => {
          const base = planRef.current;
          if (base) onPlanChange({ ...base, texts: base.texts.map((q) => (q.id === id ? { ...q, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } : q)) });
        }}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onPlayToggle={() => setPlaying((p) => !p)}
        onTime={setTime}
        onEnded={() => setPlaying(false)}
        onSeek={(s) => {
          setTime(Math.max(0, Math.min(s, plan ? timelineDuration(plan) : 0)));
        }}
        onPlanChange={onPlanChange}
        onEditSegment={(seg) => void act(() => api.videoStudioEditSegment(slug, { start: seg.start, end: seg.end, instruction: seg.instruction }))}
        onGeneratePlan={() => void act(() => api.videoStudioGeneratePlan(slug))}
        onNarrate={() => void act(() => api.videoStudioNarrate(slug))}
        onRender={() => void act(() => api.videoStudioRender(slug))}
        onPreview={() => void act(() => api.videoStudioPreview(slug))}
        onStyleChange={(id) => void act(() => api.videoStudioSetStyle(slug, id))}
        ffmpegFound={ffmpegFound}
        onDownload={() => {
          const rel = readLastRender(detail.project);
          if (rel) void api.videoStudioDownload(slug, rel, `${detail.project.title || slug}.mp4`).catch((e) => setErr(String(e)));
        }}
        onDelete={() => {
          if (!window.confirm(`${t.vs_btn_delete}?`)) return;
          void (async () => {
            try {
              await api.videoStudioDelete(slug);
              if (mounted.current) onDeleted();
            } catch (e) {
              if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
            }
          })();
        }}
      />
    </>
  );
}
