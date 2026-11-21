// src/core/workshop3d/types.ts
export const WORKSHOP3D_ROLES = [
  "tiep-nhan-3d", "art-director", "detail-planner", "cad-modeler", "material-artist",
  "render-director", "visual-reviewer", "ar-optimizer", "render-presenter",
] as const;
export type Workshop3DRole = (typeof WORKSHOP3D_ROLES)[number];

export const W3D_STATES = [
  "intake", "awaiting_user", "art", "planning", "modeling", "building", "materials", "rendering",
  "reviewing", "optimizing", "presenting", "done", "paused", "stopped", "failed", "waiting_quota",
  // Blender high-quality phase (two-phase review): render, final review, targeted material fix.
  "hqrender", "hqreview", "hqmaterials",
] as const;
export type W3DState = (typeof W3D_STATES)[number];
export const isW3DState = (v: unknown): v is W3DState => typeof v === "string" && (W3D_STATES as readonly string[]).includes(v);

/** Brief limits shared by the HTTP route, the CLI, the intake parser and the prompt (one source of truth, never cut silently). */
export const W3D_BRIEF_LIMITS = { title: 120, object: 4000, material: 200, purpose: 300 } as const;

/** Limits of the configurable slots of a brief (see docs/DESIGN-3D.md 6c). */
export const W3D_SLOT_LIMITS = { max: 8, name: 80, nodes: 12, pattern: 64, hint: 200 } as const;

/** A configurable part of the product: its variants are built by swapping materials or nodes of the master GLB. */
export interface W3DSlot {
  id: string;
  name: string;
  /** material = only the finish changes; part = the shape can be swapped too (finish options still work). */
  type: "material" | "part";
  /** Node-name patterns (exact or prefix*); empty = nodes named like the id or starting with id_. */
  nodes?: string[];
  hint?: string;
}

export interface W3DBrief {
  title: string;
  object: string;
  /** Free parameter table: name -> value (mm for sizes). */
  params: Record<string, string | number>;
  material?: string;
  purpose?: string;
  detail: "standard" | "high" | "ultra";
  /** File names staged in the session's `inbox/` (DXF/STEP summaries, images). */
  attachments: string[];
  /** Configurable parts asked at intake (variants / "Tạo hàng loạt"). */
  slots?: W3DSlot[];
}

export interface W3DIssue {
  target: "geometry" | "material" | "render";
  text: string;
  /** Final review only: high-quality views (renders/hq/<name>.png) that show the defect; only those are rendered again. */
  views?: string[];
}

/** off = no Blender (old single-phase flow); final = geometry review on fast renders, then Blender + final review; loop = Blender every round. */
export type W3DHqMode = "off" | "final" | "loop";
/** Review mode of visual-reviewer: full (one phase), geometry (phase 1, fast renders), final (phase 2, Blender renders). */
export type W3DReviewMode = "full" | "geometry" | "final";
export interface W3DScores { beauty: number; detail: number; proportion: number; likeness?: number | undefined }

export interface W3DSnapshot {
  state: W3DState;
  /** State to return to after paused / stopped / failed / waiting_quota. */
  resumeState: W3DState | null;
  round: number;
  fixRounds: number;
  maxFixRounds: number;
  buildRetries: number;
  stepFailures: number;
  costUsd: number;
  error: string | null;
  note: string | null;
  /** Epoch ms when waiting_quota ends. */
  waitUntil: number | null;
  questions: string[];
  /** Open defects the next modeling/materials step must fix. */
  issues: W3DIssue[];
  /** Why the session waits in waiting_quota: the subscription limit or an automatic retry after an interruption. */
  waitReason?: "quota" | "retry" | null;
  /** Automatic resumes after interruptions since the last successful step (see MAX_AUTO_RESUMES). */
  autoResumes?: number;
  /** Automatic resumes allowed for this session (capped by MAX_AUTO_RESUMES). */
  maxAutoResumes?: number;
  /** Highest review total so far (beauty + detail + proportion [+ likeness]) and the round that reached it. */
  bestScore?: number | null;
  bestRound?: number | null;
  /** Consecutive reviews whose total did not beat bestScore. */
  noImprove?: number;
  /** Stop the fix loop after this many consecutive reviews without improvement (0 = never). */
  maxNoImprove?: number;
  /** Blender high-quality mode of this session (decided at creation; missing = off, sessions made before it). */
  hqMode?: W3DHqMode;
  /** Final review: scores, best total and the final fix round that reached it. */
  finalScores?: W3DScores | null;
  bestFinalScore?: number | null;
  bestFinalRound?: number | null;
  /** Final fix rounds used / allowed (workshop3d.blender.finalFixRounds). */
  hqFixRounds?: number;
  maxHqFixRounds?: number;
  /** High-quality views to render again after a targeted material fix (null = every missing view). */
  hqRedo?: string[] | null;
  /** Issues of the final review left unfixed (reported, never looped on). */
  backlog?: W3DIssue[];
}
