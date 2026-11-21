/** Mirror of the part-1 engine API (docs/superpowers/plans/2026-11-10-workshop3d-engine.md, Task 11). */
export type W3DState =
  | "intake" | "awaiting_user" | "art" | "planning" | "modeling" | "building" | "materials" | "rendering"
  | "reviewing" | "optimizing" | "presenting" | "done" | "paused" | "stopped" | "failed" | "waiting_quota"
  | "hqrender" | "hqreview" | "hqmaterials";

export type W3DParams = Record<string, string | number>;

export interface W3DBriefView {
  title: string;
  object: string;
  params: W3DParams;
  material?: string;
  purpose?: string;
  detail?: string;
  attachments?: string[];
}

export interface W3DSnapshotView {
  state: W3DState;
  round: number;
  fixRounds: number;
  costUsd: number;
  note: string | null;
  error: string | null;
  questions: string[];
  issues: { target: string; text: string }[];
  bestScore?: number | null;
  bestRound?: number | null;
  finalScores?: { beauty: number; detail: number; proportion: number; likeness?: number } | null;
  hqMode?: string;
}

export interface W3DDetail {
  brief: W3DBriefView;
  snapshot: W3DSnapshotView;
  files: string[];
  renders: string[];
  report: string | null;
}

export interface W3DApi {
  detail(): Promise<W3DDetail>;
  /** `path` as listed in `files`/`renders` (e.g. `outputs/model.glb`, `renders/front.png`). */
  file(path: string): Promise<Blob>;
  rebuild(params?: W3DParams): Promise<void>;
}
