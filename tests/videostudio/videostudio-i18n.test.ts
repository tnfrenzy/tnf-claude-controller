import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const REQUIRED = [
  "vs_building_name", "vs_new_project", "vs_empty_projects", "vs_title", "vs_brief", "vs_style", "vs_aspect", "vs_progress", "vs_error",
  "vs_status_running", "vs_status_done", "vs_status_failed", "vs_status_idle",
  "vs_state_draft", "vs_state_planning", "vs_state_generating", "vs_state_ready", "vs_state_editing", "vs_state_rendering", "vs_state_done", "vs_state_failed",
  "vs_external_warning", "vs_cost_estimate", "vs_ffmpeg_missing",
  "vs_tab_brief", "vs_tab_plan", "vs_tab_timeline", "vs_tab_preview", "vs_tab_assets", "vs_tab_export", "vs_tab_settings",
  "vs_btn_create", "vs_btn_delete", "vs_btn_save", "vs_btn_upload", "vs_btn_generate_plan", "vs_btn_generate_media", "vs_btn_narrate", "vs_btn_edit_segment", "vs_btn_render", "vs_btn_download", "vs_btn_cancel",
  "vs_style_builtin", "vs_style_custom", "vs_style_add", "vs_style_transition", "vs_style_shot_sec", "vs_style_font", "vs_style_text_color",
  "vs_style_clone", "vs_style_edit", "vs_style_name", "vs_style_visual_prompt", "vs_style_text_box", "vs_style_brightness", "vs_style_contrast", "vs_style_saturation", "vs_style_transition_sec", "vs_style_delete_confirm",
  "vs_set_ffmpeg_path", "vs_set_voice_provider", "vs_set_voice_name", "vs_set_voice_rate", "vs_set_voice_url", "vs_set_media_provider", "vs_set_media_url", "vs_set_token", "vs_set_token_saved", "vs_set_model",
  "vs_tl_video", "vs_tl_audio", "vs_tl_text", "vs_tl_duration", "vs_tl_clip_video", "vs_tl_clip_image", "vs_tl_clip_card",
  "vs_tl_split", "vs_tl_add_text", "vs_tl_zoom_in", "vs_tl_zoom_out", "vs_tl_playhead", "vs_tl_selection", "vs_tl_instruction_ph", "vs_tl_text_edit", "vs_tl_text_default", "vs_tl_busy",
  "vs_preview_empty", "vs_export_ready", "vs_export_empty",
  "vs_create_tab_new", "vs_create_tab_styles", "vs_create_tab_settings", "vs_create_title_ph", "vs_create_brief_ph", "vs_create_styles_empty",
  "vs_f_templates", "vs_f_goal", "vs_f_goal_ph", "vs_f_audience", "vs_f_audience_ph", "vs_f_tone", "vs_tone_friendly", "vs_tone_professional", "vs_tone_energetic", "vs_tone_emotional", "vs_f_seconds", "vs_f_seconds_unit", "vs_f_lang", "vs_lang_vi", "vs_lang_en", "vs_f_points", "vs_f_points_ph", "vs_f_cta", "vs_f_cta_ph", "vs_f_tips", "vs_f_placeholders", "vs_f_preview",
  "vs_pv_title", "vs_tl_add_media", "vs_tl_split_audio", "vs_tl_split_audio_tip", "vs_tl_prange", "vs_tl_prange_tip", "vs_tl_transition", "vs_tr_style", "vs_tr_sec", "vs_tr_all", "vs_tr_none", "vs_tr_fade", "vs_tr_dissolve", "vs_tr_wipeleft", "vs_tr_slideleft", "vs_tr_zoomin", "vs_tr_circleopen", "vs_tl_motion", "vs_mo_none", "vs_mo_zoomin", "vs_mo_zoomout", "vs_mo_panleft", "vs_mo_panright", "vs_tl_keep_audio", "vs_tx_size", "vs_tx_color", "vs_tx_reset_pos", "vs_tx_drag_hint", "vs_narr_caps", "vs_narr_caps_tip", "vs_narr_duck", "vs_tl_undo", "vs_tl_redo", "vs_tl_duplicate", "vs_tl_add_card", "vs_tl_card_default", "vs_tl_add_audio", "vs_narr_btn", "vs_tl_show_texts", "vs_tl_show_texts_tip", "vs_tl_aspect", "vs_tl_len", "vs_tl_fit", "vs_tl_fit_all", "vs_fit_blur", "vs_fit_cover", "vs_fit_contain", "vs_tl_volume", "vs_tl_fade_in", "vs_tl_fade_out", "vs_tl_speed", "vs_narr_title", "vs_narr_text", "vs_narr_voice", "vs_narr_voice_default", "vs_narr_rate", "vs_narr_no_voices", "vs_narr_generate", "vs_narr_upload", "vs_narr_have", "vs_narr_none", "vs_up_only_audio", "vs_tl_add_media_busy", "vs_up_only_media", "vs_pv_btn", "vs_pv_note", "vs_pv_empty", "vs_pv_final", "vs_pv_watch", "vs_pv_loading", "vs_pv_load_error", "vs_p_title", "vs_p_intro", "vs_p_brand", "vs_p_slogan", "vs_p_about", "vs_p_products", "vs_p_facts", "vs_p_contact", "vs_p_avoid", "vs_lib_title", "vs_lib_intro", "vs_lib_upload", "vs_lib_uploading", "vs_lib_empty", "vs_lib_delete", "vs_lib_kind_image", "vs_lib_kind_video", "vs_lib_kind_audio", "vs_media_title", "vs_media_from_library", "vs_media_upload", "vs_media_none", "vs_media_hint", "vs_st_sample_l1", "vs_st_sample_l2", "vs_st_intro", "vs_st_shot", "vs_st_fade", "vs_st_cut", "vs_st_sample", "vs_st_sample_form", "vs_st_sampling", "vs_st_default", "vs_st_make_default", "vs_st_room_note",
];
const keys = (lang: "vi" | "en") => Object.keys(dicts[lang]).filter((k) => k.startsWith("vs_")).sort();
const get = (lang: "vi" | "en", k: string) => (dicts[lang] as Record<string, string>)[k] ?? "";

describe("vs_ i18n keys", () => {
  it("vi and en have the same vs_ keys", () => {
    expect(keys("vi")).toEqual(keys("en"));
    expect(keys("vi")).toEqual([...REQUIRED].sort());
  });
  it("every required key is non-empty in both languages", () => {
    for (const lang of ["vi", "en"] as const) for (const k of REQUIRED) expect(get(lang, k).trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("key texts carry the required content", () => {
    expect(get("vi", "vs_building_name")).toBe("Xưởng video");
    expect(get("en", "vs_building_name")).toBe("Video Studio");
    expect(get("vi", "vs_cost_estimate")).toContain("ước tính");
    expect(get("en", "vs_cost_estimate")).toContain("estimate");
    expect(get("vi", "vs_external_warning").length).toBeGreaterThan(0);
    expect(get("vi", "vs_external_warning")).toContain("dịch vụ");
    expect(get("en", "vs_external_warning")).toContain("service");
    for (const lang of ["vi", "en"] as const) {
      expect(get(lang, "vs_ffmpeg_missing")).toContain("ffmpeg");
      expect(get(lang, "vs_ffmpeg_missing")).toContain("PATH");
    }
  });
});
