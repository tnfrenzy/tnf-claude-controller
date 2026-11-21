import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const d = dicts as unknown as Record<string, Record<string, unknown>>;

const KEYS = [
  "ss_tab_mcp", "ss_tab_grants", "mcp_title", "mcp_add_dc", "mcp_probe", "mcp_cli_title", "mcp_cli_refresh", "mcp_cli_login",
  "mcp_cli_login_hint", "mcp_cli_none", "mcp_status_connected", "mcp_status_needs_auth", "mcp_status_failed", "mcp_status_not_configured",
  "mcp_dc_warn", "grants_title", "grants_env", "grants_default_profile", "grants_file_write", "grants_web", "grants_cmd_node",
  "grants_cmd_python", "grants_cmd_native", "grants_cmd_basic", "grants_cmd_install", "grants_git_restore", "grants_any_process",
  "grants_any_process_warn", "grants_extra_dirs", "grants_add_dir", "grants_dir_write", "grants_mcp", "grants_mcp_off", "grants_mcp_read",
  "grants_mcp_full", "grants_locked_title", "grants_locked_list", "grants_saved", "out_title", "out_label", "out_default", "out_save",
  "out_note", "open_file", "open_output_dir", "out_remote_note",
];

describe("MCP / grants / output i18n keys", () => {
  for (const key of KEYS) {
    it(`${key} exists in vi and en and is non-empty`, () => {
      for (const lang of ["vi", "en"]) {
        const v = d[lang]![key];
        expect(typeof v).toBe("string");
        expect((v as string).trim().length).toBeGreaterThan(0);
      }
    });
  }
});
