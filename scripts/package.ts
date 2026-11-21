/**
 * Build the portable runtime folder `build/app/` used by the installer (Phase 5.6).
 *
 *   npm run package            # tsc + vite build, then assemble build/app
 *   npm run package -- --skip-build
 *
 * Layout of build/app (runs without Node/npm in PATH):
 *   node.exe            copy of the Node that ran this script (process.execPath)
 *   dist/               compiled server + CLI (tsc)
 *   ui/dist/            built UI (vite)
 *   config/             controller.json rewritten for the installed layout (for fresh installs; the installer
 *                       keeps an existing one) + controller.default.json (same content: the merge template,
 *                       always overwritten on upgrade)
 *   fixtures/           fake CLI + recorded streams (demo mode only)
 *   node_modules/ws, node_modules/gltf-validator   runtime dependencies (RUNTIME_NODE_MODULES, no transitive deps)
 *   node_modules/three  only the files the workshop3d render page imports (THREE_RUNTIME_FILES) + LICENSE
 *   tools/workshop3d/   Python tools + render page (no __pycache__)
 *                       incl. tools/workshop3d/blender/*.py (Blender high-quality render) and config/polyhaven-assets.json;
 *                       Blender itself (GPL, installed separately) and the Poly Haven files (fetched by the user with
 *                       `tnf w3d fetch-assets --yes` into <dataDir>/library/polyhaven) are never shipped
 *   package.json        name/version only (read by `tnf version`)
 *   tray.ps1, stop.ps1, tnf.ico   launcher files from installer/
 *
 * The installed tree is  <root>/app  + <root>/data + <root>/workspace + <root>/logs, so the packaged
 * controller.json points dataDir/workspaceDir at ../data and ../workspace (relative to app/).
 * controller.json is for new installs; controller.default.json is the merge template, always overwritten on upgrade.
 * Neither contains a token, and allowedOrigins is [].
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "build", "app");
const skipBuild = process.argv.includes("--skip-build");

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} thất bại (mã ${res.status})`);
}

function copyDir(src: string, dst: string): void {
  fs.cpSync(src, dst, { recursive: true, dereference: true });
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

/**
 * node_modules packages the compiled server/CLI imports at runtime, copied whole into build/app (neither has
 * transitive dependencies; tests/package-config.test.ts checks package.json `dependencies` and the imports of src/).
 */
export const RUNTIME_NODE_MODULES: readonly string[] = ["ws", "gltf-validator"];
/** `dependencies` used only by the UI: vite bundles them into ui/dist, so they are not shipped in node_modules. */
export const UI_BUNDLED_DEPENDENCIES: readonly string[] = ["@google/model-viewer"];

/** Minimal `three` files the render page (tools/workshop3d/render/index.html) loads, paths relative to node_modules/three. */
export const THREE_RUNTIME_FILES: readonly string[] = [
  "build/three.module.js",
  "build/three.core.js",
  "examples/jsm/loaders/GLTFLoader.js",
  "examples/jsm/utils/BufferGeometryUtils.js",
  "examples/jsm/utils/SkeletonUtils.js",
  "examples/jsm/environments/RoomEnvironment.js",
  "examples/jsm/objects/Reflector.js",
  "LICENSE",
];

/** Filter for copying tools/workshop3d: skip Python bytecode caches. */
export function shouldShipTool(src: string): boolean {
  return !src.split(/[\\/]/).includes("__pycache__");
}

/** Rewrite controller.json for the installed layout; keep everything else as in the repo. */
export function packagedConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const server = { ...(raw["server"] as Record<string, unknown> | undefined) };
  delete server["$allowedOrigins_hint"];
  return {
    ...raw,
    $comment: "Cau hinh ban cai dat: %LOCALAPPDATA% duoc mo rong khi doc; duong dan tuong doi tinh tu thu muc app/. data va workspace giu lai khi go cai dat neu chon. Khong gia dinh o dia.",
    claudePath: null,
    workspaceDir: "%LOCALAPPDATA%\\TNF\\Controller\\workspace",
    worktreesDir: "%LOCALAPPDATA%\\TNF\\Controller\\workspace\\worktrees",
    dataDir: "%LOCALAPPDATA%\\TNF\\Controller\\data",
    server: { ...server, allowedOrigins: [] },
  };
}

function main(): void {
  if (!skipBuild) {
    run("npx", ["tsc", "-p", "tsconfig.json"]);
    run("npm", ["run", "build:ui"]);
  }
  for (const must of ["dist/cli.js", "ui/dist/index.html"]) {
    if (!fs.existsSync(path.join(ROOT, must))) throw new Error(`Thiếu ${must} — chạy npm run package không có --skip-build.`);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  fs.copyFileSync(process.execPath, path.join(OUT, "node.exe"));
  copyDir(path.join(ROOT, "dist"), path.join(OUT, "dist"));
  copyDir(path.join(ROOT, "ui", "dist"), path.join(OUT, "ui", "dist"));
  copyDir(path.join(ROOT, "fixtures"), path.join(OUT, "fixtures"));
  copyDir(path.join(ROOT, "tools", "cad"), path.join(OUT, "tools", "cad")); // Python scripts that summarise DXF/STEP (cad-tools.ts)
  fs.copyFileSync(path.join(ROOT, "tools", "preview-capture.cs"), path.join(OUT, "tools", "preview-capture.cs")); // desktop preview helper, compiled at runtime by csc (preview-desktop.ts)
  fs.cpSync(path.join(ROOT, "tools", "workshop3d"), path.join(OUT, "tools", "workshop3d"), { recursive: true, filter: shouldShipTool }); // python tools + render page (workshop3d)
  for (const m of RUNTIME_NODE_MODULES) copyDir(path.join(ROOT, "node_modules", m), path.join(OUT, "node_modules", m)); // ws (server), gltf-validator (workshop3d build)
  for (const f of THREE_RUNTIME_FILES) {
    const dst = path.join(OUT, "node_modules", "three", f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "node_modules", "three", f), dst); // render page imports (render.ts resolves <app>/node_modules/three)
  }
  // The offline presentation page copies this one file next to its index.html (presentation.ts looks in <app>/node_modules/@google/model-viewer).
  for (const f of ["package.json", "LICENSE", path.join("dist", "model-viewer-umd.min.js")]) {
    const dst = path.join(OUT, "node_modules", "@google", "model-viewer", f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "node_modules", "@google", "model-viewer", f), dst);
  }

  fs.mkdirSync(path.join(OUT, "config"));
  for (const f of fs.readdirSync(path.join(ROOT, "config"))) {
    const src = path.join(ROOT, "config", f);
    if (f === "controller.default.json") {
      continue; // always regenerated below from controller.json
    } else if (f === "controller.json") {
      const raw = JSON.parse(fs.readFileSync(src, "utf8")) as Record<string, unknown>;
      const text = JSON.stringify(packagedConfig(raw), null, 2) + "\n";
      fs.writeFileSync(path.join(OUT, "config", "controller.json"), text); // fresh installs
      fs.writeFileSync(path.join(OUT, "config", "controller.default.json"), text); // merge template
    } else if (fs.statSync(src).isDirectory()) {
      copyDir(src, path.join(OUT, "config", f));
    } else {
      fs.copyFileSync(src, path.join(OUT, "config", f));
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
  fs.writeFileSync(
    path.join(OUT, "package.json"),
    JSON.stringify({ name: pkg["name"], version: pkg["version"], private: true, type: "module", bin: { tnf: "./dist/cli.js" } }, null, 2) + "\n",
  );

  for (const f of ["tray.ps1", "stop.ps1", "tnf.ico"]) {
    const src = path.join(ROOT, "installer", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
    else console.warn(`(bỏ qua) installer/${f} chưa có`);
  }

  const mb = (dirSize(OUT) / 1024 / 1024).toFixed(1);
  console.log(`build/app sẵn sàng: ${OUT} (${mb} MB, node ${process.version})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
