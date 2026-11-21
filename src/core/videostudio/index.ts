// src/core/videostudio/index.ts
import { createVsCore, type VsCore, type VsCoreOptions } from "./core.js";
import { createVsJobs, type VsJobs } from "./jobs.js";
import { listWindowsVoices, type VsVoiceInfo } from "./gen.js";

export type VideoStudio = VsCore & VsJobs & { listVoices(): Promise<VsVoiceInfo[]> };

export function createVideoStudio(opts: VsCoreOptions): VideoStudio {
  const core = createVsCore(opts);
  const jobs = createVsJobs(core, { spawn: opts.spawn, gen: opts.gen, env: opts.env });
  return { ...core, listVoices: () => listWindowsVoices(opts.gen ?? {}), narrate: jobs.narrate, render: jobs.render, preview: jobs.preview, previewStyle: jobs.previewStyle };
}

export { VsError } from "./plan.js";
export { VIDEOSTUDIO_PROJECT } from "./agent.js";
