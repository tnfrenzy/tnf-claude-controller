import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoStyleManager } from "../../ui/src/components/videostudio/VideoStyleManager";
import {
  cloneToForm,
  emptyStyleForm,
  settingsFormToInput,
  settingsToForm,
  styleFormToInput,
} from "../../ui/src/videostudio/forms";
import { VideoStudioSettings } from "../../ui/src/components/videostudio/VideoStudioSettings";
import type { VsSettingsPublic, VsStyle } from "../../src/core/videostudio/plan-types";

const builtin: VsStyle = {
  id: "clean",
  name: "Clean",
  builtin: true,
  transition: "fade",
  transitionSec: 0.5,
  shotSec: 4,
  font: "Arial",
  textColor: "#FFFFFF",
  textBox: true,
  gamma: 1.2,
  visualPrompt: "x",
};

describe("styleFormToInput / settingsFormToInput", () => {
  it("(a) new style has no id key", () => {
    const r = styleFormToInput({ ...emptyStyleForm(), name: "A" });
    expect("id" in r).toBe(false);
  });
  it("(b) empty brightness omits the key", () => {
    const r = styleFormToInput({ ...emptyStyleForm(), name: "A" });
    expect("brightness" in r).toBe(false);
  });
  it("(c) clamps transitionSec and truncates name", () => {
    const r = styleFormToInput({ ...emptyStyleForm(), name: "n".repeat(60), transitionSec: "5" });
    expect(r.transitionSec).toBe(2);
    expect(r.name.length).toBe(40);
  });
  it("(d) cloneToForm drops id and keeps gamma", () => {
    const f = cloneToForm(builtin);
    expect("id" in f).toBe(false);
    expect(styleFormToInput(f).gamma).toBe(1.2);
    expect(styleFormToInput(f).textColor).toBe("#ffffff");
  });
  it("(e) empty tokens omit token keys", () => {
    const i = settingsFormToInput(settingsToForm(null));
    expect("token" in (i.voice ?? {})).toBe(false);
    expect("token" in (i.media ?? {})).toBe(false);
  });
  it("(f) token abc is sent", () => {
    const i = settingsFormToInput({ ...settingsToForm(null), voiceToken: "abc" });
    expect(i.voice?.token).toBe("abc");
  });
  it("(g) rate 99 becomes 10, empty ffmpegPath is null", () => {
    const i = settingsFormToInput({ ...settingsToForm(null), voiceRate: "99" });
    expect(i.voice?.rate).toBe(10);
    expect(i.ffmpegPath).toBeNull();
  });
});

const baseSettings: VsSettingsPublic = {
  ffmpegPath: null,
  ffmpegFound: true,
  voice: { provider: "none", voiceName: "", rate: 0, url: "", hasToken: false },
  media: { provider: "none", url: "", hasToken: false },
};
const renderSettings = (s: VsSettingsPublic | null) =>
  renderToStaticMarkup(createElement(VideoStudioSettings, { settings: s, onChanged: () => {} }));

describe("VideoStudioSettings render", () => {
  const warn = "sẽ được gửi tới dịch vụ";
  it("(a) http voice shows external warning", () => {
    const html = renderSettings({ ...baseSettings, voice: { ...baseSettings.voice, provider: "http" } });
    expect(html).toContain(warn);
  });
  it("(b) none/none has no external warning", () => {
    expect(renderSettings(baseSettings)).not.toContain(warn);
  });
  it("(c) ffmpegFound false shows missing, true does not", () => {
    expect(renderSettings({ ...baseSettings, ffmpegFound: false })).toContain("Không tìm thấy ffmpeg");
    expect(renderSettings(baseSettings)).not.toContain("Không tìm thấy ffmpeg");
  });
  it("(d) hasToken shows saved note, absent otherwise", () => {
    const withTok = renderSettings({ ...baseSettings, voice: { ...baseSettings.voice, provider: "http", hasToken: true } });
    expect(withTok).toContain("Đã lưu mã");
    const noTok = renderSettings({ ...baseSettings, voice: { ...baseSettings.voice, provider: "http" } });
    expect(noTok).not.toContain("Đã lưu mã");
  });
  it("(e) null settings does not throw", () => {
    expect(() => renderSettings(null)).not.toThrow();
  });
  it("(f) token input is a password field", () => {
    const html = renderSettings({ ...baseSettings, voice: { ...baseSettings.voice, provider: "http" } });
    expect(html).toContain('type="password"');
  });
});

describe('VideoStyleManager render', () => {
  const custom = { ...builtin, id: 'mine', name: 'Mine', builtin: false };
  const html = renderToStaticMarkup(createElement(VideoStyleManager, { styles: [builtin, custom], onChanged: () => {} }));
  it('(a) shows builtin label', () => { expect(html).toContain('Có sẵn'); });
  it('(b) exactly one delete button', () => { expect(html.split('data-action="delete-style"').length - 1).toBe(1); });
  it('(c) builtin has clone button', () => { expect(html.split('data-action="clone-style"').length - 1).toBe(1); });
});
