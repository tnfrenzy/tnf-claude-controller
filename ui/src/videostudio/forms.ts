import { VS_PROFILE_KEYS, VS_PROFILE_LIMITS, type VsProfile, type VsSettingsInput, type VsSettingsPublic, type VsStyle } from "../../../src/core/videostudio/plan-types";

/** Style payload without server-owned fields; id only present when editing a custom style. */
export type VsStyleInput = Omit<VsStyle, "id" | "builtin"> & { id?: string };

export interface VsStyleForm {
  id?: string;
  name: string;
  description: string;
  transition: "none" | "fade";
  transitionSec: string;
  shotSec: string;
  font: string;
  textColor: string;
  textBox: boolean;
  brightness: string;
  contrast: string;
  saturation: string;
  /** Kept from the original style so editing does not drop it (no input field). */
  gamma: string;
  visualPrompt: string;
}

export interface VsSettingsForm {
  ffmpegPath: string;
  voiceProvider: "none" | "windows" | "http";
  voiceName: string;
  voiceRate: string;
  voiceUrl: string;
  voiceToken: string;
  mediaProvider: "none" | "http";
  mediaUrl: string;
  mediaToken: string;
  /** Facts the AI may use (brand, products, figures, contact) and what it must never say. */
  profile: VsProfile;
}

export function emptyProfileForm(): VsProfile {
  return { brand: "", slogan: "", about: "", products: "", facts: "", contact: "", avoid: "" };
}

const numStr = (n: number | undefined): string => (typeof n === "number" && Number.isFinite(n) ? String(n) : "");

export function emptyStyleForm(): VsStyleForm {
  return {
    name: "",
    description: "",
    transition: "fade",
    transitionSec: "0.5",
    shotSec: "4",
    font: "Arial",
    textColor: "#ffffff",
    textBox: true,
    brightness: "",
    contrast: "",
    saturation: "",
    gamma: "",
    visualPrompt: "",
  };
}

export function styleToForm(s: VsStyle): VsStyleForm {
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    transition: s.transition,
    transitionSec: numStr(s.transitionSec),
    shotSec: numStr(s.shotSec),
    font: s.font,
    textColor: s.textColor,
    textBox: s.textBox,
    brightness: numStr(s.brightness),
    contrast: numStr(s.contrast),
    saturation: numStr(s.saturation),
    gamma: numStr(s.gamma),
    visualPrompt: s.visualPrompt,
  };
}

export function cloneToForm(s: VsStyle): VsStyleForm {
  const { id: _id, ...rest } = styleToForm(s);
  void _id;
  return { ...rest, name: `${s.name} (copy)`.slice(0, 40) };
}

function parseNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normColor(c: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(c.trim());
  if (m) return `#${(m[1] as string).toLowerCase()}`;
  const s = /^#?([0-9a-fA-F]{3})$/.exec(c.trim());
  if (s) {
    const h = (s[1] as string).toLowerCase();
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return "#ffffff";
}

export function styleFormToInput(form: VsStyleForm): VsStyleInput {
  const out: VsStyleInput = {
    name: form.name.trim().slice(0, 40),
    transition: form.transition,
    transitionSec: clamp(parseNum(form.transitionSec) ?? 0.5, 0, 2),
    shotSec: clamp(parseNum(form.shotSec) ?? 4, 0.5, 20),
    font: form.font.trim().slice(0, 60),
    textColor: normColor(form.textColor),
    textBox: form.textBox,
    visualPrompt: form.visualPrompt.slice(0, 400),
  };
  if (form.id) out.id = form.id;
  const desc = form.description.trim();
  if (desc) out.description = desc;
  const b = parseNum(form.brightness);
  if (b !== null) out.brightness = clamp(b, -1, 1);
  const c = parseNum(form.contrast);
  if (c !== null) out.contrast = clamp(c, 0, 3);
  const s = parseNum(form.saturation);
  if (s !== null) out.saturation = clamp(s, 0, 3);
  const g = parseNum(form.gamma);
  if (g !== null) out.gamma = g;
  return out;
}

export function settingsToForm(s: VsSettingsPublic | null): VsSettingsForm {
  return {
    ffmpegPath: s?.ffmpegPath ?? "",
    voiceProvider: s?.voice.provider ?? "none",
    voiceName: s?.voice.voiceName ?? "",
    voiceRate: String(s?.voice.rate ?? 0),
    voiceUrl: s?.voice.url ?? "",
    voiceToken: "",
    mediaProvider: s?.media.provider ?? "none",
    mediaUrl: s?.media.url ?? "",
    mediaToken: "",
    profile: { ...emptyProfileForm(), ...(s?.profile ?? {}) },
  };
}

export function settingsFormToInput(form: VsSettingsForm): VsSettingsInput {
  const rateRaw = Number(form.voiceRate);
  const rate = Number.isFinite(rateRaw) && form.voiceRate.trim() !== "" ? clamp(Math.round(rateRaw), -10, 10) : 0;
  const voice: NonNullable<VsSettingsInput["voice"]> = {
    provider: form.voiceProvider,
    voiceName: form.voiceName.trim().slice(0, 200),
    rate,
    url: form.voiceUrl.trim(),
  };
  if (form.voiceToken.trim() !== "") voice.token = form.voiceToken.trim();
  const media: NonNullable<VsSettingsInput["media"]> = {
    provider: form.mediaProvider,
    url: form.mediaUrl.trim(),
  };
  if (form.mediaToken.trim() !== "") media.token = form.mediaToken.trim();
  const ff = form.ffmpegPath.trim();
  const profile: Partial<VsProfile> = {};
  for (const k of VS_PROFILE_KEYS) profile[k] = form.profile[k].replace(/\r\n/g, "\n").trim().slice(0, VS_PROFILE_LIMITS[k]);
  return { ffmpegPath: ff === "" ? null : ff, voice, media, profile };
}
