import type { VsStyle } from "../../../../src/core/videostudio/plan-types";

// Mapping: style.brightness is an offset (0 = neutral) -> CSS brightness = 1 + b.
// contrast and saturation are multipliers (1 = neutral) -> CSS contrast / saturate.
function num(v: number | undefined, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}
function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function previewFilterCss(style: VsStyle | null | undefined): string {
  if (!style) return "none";
  const b = r3(1 + num(style.brightness, 0));
  const c = r3(num(style.contrast, 1));
  const s = r3(num(style.saturation, 1));
  if (b === 1 && c === 1 && s === 1) return "none";
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}
