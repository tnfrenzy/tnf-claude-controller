import path from "node:path";
import type http from "node:http";
import { loadConfig, type ControllerConfig } from "../core/app/config.js";
import { RunManager } from "../core/run/run-manager.js";
import type { PreviewDeps } from "../core/preview/preview.js";
import { RunStore } from "../core/run/run-store.js";
import { loadOrCreateToken, writeTokenFile, type AuthPolicy } from "./auth.js";
import { createServer, type ReleaseDeps } from "./http.js";
import { createWorkshop3D, tryCreateWorkshop3D, type Workshop3DEngine } from "../core/workshop3d/index.js";
import type { scanUsage } from "../core/usage/usage-blocks.js";
import {
  AUTOMATION_DEFAULT_INTERVAL_MS,
  AutomationProcessor,
  readLastRunAt,
  writeLastRunAt,
} from "../core/queue/automation-processor.js";

export interface StartedServer {
  server: http.Server;
  manager: RunManager;
  policy: AuthPolicy;
  automation: AutomationProcessor;
  url: string;
  close: () => Promise<void>;
}

export interface StartOptions {
  config?: ControllerConfig;
  port?: number;
  token?: string;
  staticDir?: string;
  /** Test hooks forwarded to RunManager. */
  claudePath?: string;
  claudeArgsPrefix?: string[];
  agyPath?: string;
  agyArgsPrefix?: string[];
  codexPath?: string;
  codexArgsPrefix?: string[];
  env?: NodeJS.ProcessEnv;
  openDirectory?: (dir: string) => void;
  openPath?: (a: { dir: string; select?: string }) => void;
  previewDeps?: PreviewDeps;
  /** Test hooks for the release pipeline. */
  releaseDeps?: ReleaseDeps;
  /** Test hook: replaces the usage log scanner. */
  usageScan?: typeof scanUsage;
  /** Test hook: replaces the 3D workshop engine. */
  workshop3d?: Workshop3DEngine;
  /** Test hook: builds the engine instead of createWorkshop3D; a throw leaves the 3D workshop unavailable (503), the server starts anyway. */
  workshop3dFactory?: () => Workshop3DEngine;
  /** Automation processor tick interval (default 60000 ms); 0 = do not start the timer. */
  automationIntervalMs?: number;
}

export async function startServer(opts: StartOptions = {}): Promise<StartedServer> {
  const config = opts.config ?? loadConfig();
  const store = new RunStore(path.join(config.dataDir, "controller.db"));
  const mgrOpts: ConstructorParameters<typeof RunManager>[0] = { config, store };
  if (opts.claudePath) mgrOpts.claudePath = opts.claudePath;
  if (opts.claudeArgsPrefix) mgrOpts.claudeArgsPrefix = opts.claudeArgsPrefix;
  if (opts.agyPath) mgrOpts.agyPath = opts.agyPath;
  if (opts.agyArgsPrefix) mgrOpts.agyArgsPrefix = opts.agyArgsPrefix;
  if (opts.codexPath) mgrOpts.codexPath = opts.codexPath;
  if (opts.codexArgsPrefix) mgrOpts.codexArgsPrefix = opts.codexArgsPrefix;
  if (opts.env) mgrOpts.env = opts.env;
  if (opts.openDirectory) mgrOpts.openDirectory = opts.openDirectory;
  if (opts.openPath) mgrOpts.openPath = opts.openPath;
  if (opts.previewDeps) mgrOpts.previewDeps = opts.previewDeps;
  const manager = new RunManager(mgrOpts);

  const port = opts.port ?? config.server.port;
  const token = opts.token ?? loadOrCreateToken(config.dataDir);
  const policy: AuthPolicy = { token, host: config.server.host, port, extraOrigins: config.server.allowedOrigins ?? [] };
  const staticDir = opts.staticDir ?? path.join(config.repoRoot, "ui", "dist");
  // A broken 3D workshop (bad config/roles-design3d.json...) must not stop the app: null = its routes answer 503.
  const w3d = opts.workshop3d
    ? { engine: opts.workshop3d, error: null }
    : tryCreateWorkshop3D(opts.workshop3dFactory ?? (() => createWorkshop3D({ manager, dataDir: config.dataDir, config, log: (m) => console.warn(m) })));
  const workshop3d = w3d.engine;
  const server = createServer({ manager, policy, staticDir, releaseDeps: opts.releaseDeps, usageScan: opts.usageScan, workshop3d, workshop3dError: w3d.error });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, config.server.host, () => resolve());
  });
  const addr = server.address();
  const realPort = typeof addr === "object" && addr ? addr.port : port;
  policy.port = realPort;
  writeTokenFile(config.dataDir, token);

  // Resume 3D sessions that were running when the app stopped; fire-and-forget so a bad session never blocks startup.
  setImmediate(() => {
    try {
      workshop3d?.runner.recover();
    } catch (e) {
      console.warn(`Khôi phục phiên dựng 3D lỗi: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const automation = new AutomationProcessor({
    now: () => Date.now(),
    utcOffsetMinutes: (ms) => -new Date(ms).getTimezoneOffset(),
    snapshot: () => {
      const s = manager.autopilot.snapshot();
      return { enabled: s.enabled, scheduleSpec: s.scheduleSpec };
    },
    projects: () => store.listProjects().filter((p) => !!p.repo_path).map((p) => p.name),
    hasApproved: (p) => manager.queue.list(p).some((c) => c.status === "đã duyệt"),
    isActive: (p) => manager.queueRunAll.isActive(p),
    startRunAll: (p) => manager.queueRunAll.start(p),
    loadLastRunAt: () => readLastRunAt(config.dataDir),
    saveLastRunAt: (ms) => writeLastRunAt(config.dataDir, ms),
    log: (msg) => console.warn(msg),
  });
  const interval = opts.automationIntervalMs ?? AUTOMATION_DEFAULT_INTERVAL_MS;
  if (interval > 0) automation.start(interval);

  return {
    server,
    manager,
    policy,
    automation,
    url: `http://${config.server.host}:${realPort}/#token=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        automation.stop();
        server.close(() => {
          store.close();
          resolve();
        });
        server.closeAllConnections?.();
      }),
  };
}
