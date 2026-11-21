export type RunTab = "timeline" | "result" | "changes" | "preview" | "details";

/** Tabs in display order. "changes" and "preview" only apply to coding runs. */
export function runTabIds(coding: boolean): RunTab[] {
  return coding ? ["timeline", "result", "changes", "preview", "details"] : ["timeline", "result", "details"];
}

/** Map an old tab id (report/diff/test/env/files) to its new home. Unknown ids fall back to the timeline. */
export function normalizeTab(id: string | null | undefined): RunTab {
  switch (id) {
    case "timeline": case "result": case "changes": case "preview": case "details": return id;
    case "report": return "result";
    case "diff": case "test": return "changes";
    case "env": case "files": return "details";
    default: return "timeline";
  }
}
