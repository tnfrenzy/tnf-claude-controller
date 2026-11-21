// src/core/videostudio/plan-types.ts
// Pure types for Video Studio (no imports). Fields marked "self-defined" are
// not fixed by the spec and were chosen reasonably.

export type VsClipKind = "video" | "image" | "card";
export type VsAspect = "16:9" | "9:16" | "1:1";
/** How a picture/video that does not match the frame ratio is placed: whole picture with bars, cropped to fill, or whole picture over a blurred copy. */
export type VsFit = "contain" | "cover" | "blur";
/** Transition from a clip into the next one. */
export type VsTransition = "none" | "fade" | "dissolve" | "wipeleft" | "slideleft" | "zoomin" | "circleopen";
/** Slow camera move over a picture (Ken Burns). */
export type VsMotion = "none" | "zoomin" | "zoomout" | "panleft" | "panright";
export type VsState =
  | "draft"
  | "planning"
  | "generating"
  | "ready"
  | "editing"
  | "rendering"
  | "done"
  | "failed";

export interface VsVideoClip {
  id: string;
  kind: VsClipKind;
  asset?: string | undefined;
  srcIn: number;
  duration: number;
  color?: string | undefined;
  cardText?: string | undefined;
  prompt?: string | undefined;
  /** Frame fit of this clip; missing = the plan's fit. */
  fit?: VsFit | undefined;
  /** Transition into the next clip; missing = the style's. */
  transition?: VsTransition | undefined;
  transitionSec?: number | undefined;
  /** Pictures only: slow zoom / pan. */
  motion?: VsMotion | undefined;
  /** Video clips only: playback speed 0.25 to 4. */
  speed?: number | undefined;
  /** Video clips only: keep the clip's own sound (when the file has audio). */
  keepAudio?: boolean | undefined;
}

export interface VsAudioClip {
  id: string;
  asset: string;
  start: number;
  duration: number;
  volume: number;
  // self-defined: kind of audio
  kind?: "music" | "narration" | "sfx" | undefined;
  /** Seconds of fade at the start / end of the clip. */
  fadeIn?: number | undefined;
  fadeOut?: number | undefined;
  /** Playback speed 0.5 to 2 (pitch is kept). */
  speed?: number | undefined;
  /** Seconds into the source file where the clip starts (trim). */
  srcIn?: number | undefined;
}

export interface VsTextItem {
  id: string;
  text: string;
  start: number;
  duration: number;
  // self-defined: optional placement
  x?: number | undefined;
  y?: number | undefined;
  size?: number | undefined;
  /** #rrggbb; missing = the style's text colour. */
  color?: string | undefined;
  /** Made from the narration (replaced when captions are generated again). */
  caption?: boolean | undefined;
}

export interface VsPlan {
  version: 1;
  width: number;
  height: number;
  fps: number;
  video: VsVideoClip[];
  audio: VsAudioClip[];
  texts: VsTextItem[];
  narration?: string | undefined;
  styleId?: string | undefined;
  /** false hides every caption (the text row stays in the plan). Missing = shown. */
  showTexts?: boolean | undefined;
  /** Default frame fit for clips without their own; missing = "blur". */
  fit?: VsFit | undefined;
  /** Lower the music while the narration plays. Missing = on. */
  duck?: boolean | undefined;
  /** Voice for the AI narration of this project; missing fields use the settings voice. */
  voice?: { name?: string | undefined; rate?: number | undefined } | undefined;
}

export interface VsStyle {
  id: string;
  name: string;
  builtin: boolean;
  description?: string | undefined;
  transition: "none" | "fade";
  transitionSec: number;
  shotSec: number;
  font: string;
  textColor: string;
  textBox: boolean;
  // colour adjustments (eq filter), optional
  brightness?: number | undefined;
  contrast?: number | undefined;
  saturation?: number | undefined;
  gamma?: number | undefined;
  visualPrompt: string;
}

export interface VsProject {
  slug: string;
  title: string;
  brief: string;
  styleId: string;
  aspect: VsAspect;
  state: VsState;
  error?: string | null | undefined;
  costUsd?: number | undefined;
  lastRender?: string | null | undefined;
  /** Quick low-resolution draft (renders/preview.mp4) the user can watch before the final render. */
  lastPreview?: string | null | undefined;
  createdAt: string; // self-defined: ISO timestamp
  updatedAt: string; // self-defined: ISO timestamp
}

export interface VsListItem {
  slug: string;
  title: string;
  state: VsState;
  aspect: VsAspect;
  updatedAt: string;
}

export interface VsAsset {
  rel: string;
  // same value as rel, written to assets.json as "path" ("assets/<name>")
  path?: string | undefined;
  kind: "video" | "image" | "audio" | "other";
  size: number;
  duration?: number | null | undefined;
  generated?: boolean | undefined;
}

export interface VsProjectDetail {
  project: VsProject;
  plan: VsPlan | null;
  assets: VsAsset[];
}

/** Facts the user gives the AI once, so it does not invent names, numbers or claims. */
export interface VsProfile {
  /** Company / brand name. */
  brand: string;
  slogan: string;
  /** What the company or field is about. */
  about: string;
  /** Products / services, one per line. */
  products: string;
  /** Facts that are safe to use: figures, prices, policies, certificates. */
  facts: string;
  /** Phone, website, address. */
  contact: string;
  /** Things that must never be said or shown. */
  avoid: string;
}

export const VS_PROFILE_KEYS = ["brand", "slogan", "about", "products", "facts", "contact", "avoid"] as const;
export const VS_PROFILE_LIMITS: Record<(typeof VS_PROFILE_KEYS)[number], number> = { brand: 80, slogan: 120, about: 1500, products: 2000, facts: 2000, contact: 300, avoid: 1000 };

export interface VsLibraryItem {
  name: string;
  kind: "image" | "video" | "audio";
  size: number;
}

export interface VsSettingsPublic {
  ffmpegPath: string | null;
  ffmpegFound: boolean;
  voice: {
    provider: "none" | "windows" | "http";
    voiceName: string;
    rate: number;
    url: string;
    hasToken: boolean;
  };
  media: {
    provider: "none" | "http";
    url: string;
    hasToken: boolean;
  };
  model: string | null;
  profile: VsProfile;
  /** Style pre-selected when creating a video. */
  defaultStyleId: string | null;
}

// token: empty/missing = keep, null = delete
export interface VsSettingsInput {
  ffmpegPath?: string | null | undefined;
  voice?:
    | {
        provider?: "none" | "windows" | "http" | undefined;
        voiceName?: string | undefined;
        rate?: number | undefined;
        url?: string | undefined;
        token?: string | null | undefined;
      }
    | undefined;
  media?:
    | {
        provider?: "none" | "http" | undefined;
        url?: string | undefined;
        token?: string | null | undefined;
      }
    | undefined;
  model?: string | null | undefined;
  profile?: Partial<VsProfile> | undefined;
  defaultStyleId?: string | null | undefined;
}
