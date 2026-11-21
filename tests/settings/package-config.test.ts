import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { packagedConfig, RUNTIME_NODE_MODULES, THREE_RUNTIME_FILES, UI_BUNDLED_DEPENDENCIES, shouldShipTool } from "../../scripts/package.js";

function sample(): Record<string, unknown> {
  return {
    claudePath: "C:\\x\\claude.exe",
    dataDir: "D:\\data",
    workspaceDir: "D:\\ws",
    worktreesDir: "D:\\ws\\wt",
    defaults: { coding: { maxRoleCalls: 14 } },
    ui: { towers: [] },
    server: { port: 4800, allowedOrigins: ["https://x.example.com"], $allowedOrigins_hint: "hint" },
  };
}

describe("packagedConfig", () => {
  it("forces allowedOrigins to [] and drops the hint", () => {
    const out = packagedConfig(sample());
    const server = out["server"] as Record<string, unknown>;
    expect(server["allowedOrigins"]).toEqual([]);
    expect("$allowedOrigins_hint" in server).toBe(false);
  });

  it("rewrites claudePath and dirs for the installed layout", () => {
    const out = packagedConfig(sample());
    expect(out["claudePath"]).toBeNull();
    for (const k of ["dataDir", "workspaceDir", "worktreesDir"]) {
      expect(String(out[k]).startsWith("%LOCALAPPDATA%\\TNF\\Controller")).toBe(true);
    }
  });

  it("keeps other keys", () => {
    const out = packagedConfig(sample());
    expect(out["defaults"]).toEqual({ coding: { maxRoleCalls: 14 } });
    expect(out["ui"]).toEqual({ towers: [] });
    expect((out["server"] as Record<string, unknown>)["port"]).toBe(4800);
  });

  it("does not mutate input and leaks no token key", () => {
    const input = sample();
    const copy = JSON.parse(JSON.stringify(input));
    const out = packagedConfig(input);
    expect(input).toEqual(copy);
    expect(JSON.stringify(out).toLowerCase()).not.toContain("token");
  });

  it("has a string $comment", () => {
    expect(typeof packagedConfig(sample())["$comment"]).toBe("string");
  });
});

describe("workshop3d packaging", () => {
  it("ships the minimal three files the render page imports (transitive closure)", () => {
    const root = path.resolve("node_modules/three");
    const seen = new Set<string>();
    const walk = (f: string): void => {
      if (seen.has(f)) return;
      seen.add(f);
      const t = fs.readFileSync(path.join(root, f), "utf8");
      for (const m of t.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) walk(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])));
    };
    for (const f of ["build/three.module.js", "examples/jsm/loaders/GLTFLoader.js", "examples/jsm/environments/RoomEnvironment.js"]) walk(f);
    for (const f of seen) expect(THREE_RUNTIME_FILES).toContain(f);
    const html = fs.readFileSync("tools/workshop3d/render/index.html", "utf8");
    for (const m of html.matchAll(/from "three\/addons\/([^"]+)"/g)) expect(THREE_RUNTIME_FILES).toContain(`examples/jsm/${m[1]}`);
  });

  it("ships every runtime dependency: each package.json dependency is copied or bundled into the UI by vite", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      expect(RUNTIME_NODE_MODULES.includes(dep) || UI_BUNDLED_DEPENDENCIES.includes(dep), `${dep} is neither shipped nor UI-bundled`).toBe(true);
    }
    expect(RUNTIME_NODE_MODULES).toEqual(expect.arrayContaining(["ws", "gltf-validator"]));
    // a shipped module must not pull in transitive dependencies that are not shipped too
    for (const m of RUNTIME_NODE_MODULES) {
      const p = JSON.parse(fs.readFileSync(path.join("node_modules", m, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      for (const d of Object.keys(p.dependencies ?? {})) expect(RUNTIME_NODE_MODULES, `${m} needs ${d}`).toContain(d);
    }
  });

  it("every bare import of the shipped server code (src/) is a shipped runtime module; UI-bundled deps are never imported there", () => {
    const bare = new Set<string>();
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !e.name.endsWith(".d.ts")) {
          const t = fs.readFileSync(p, "utf8");
          for (const m of t.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"'.][^"']*)["']|import\(\s*["']([^"'.][^"']*)["']\s*\)/gm)) {
            const spec = (m[1] ?? m[2])!;
            if (spec.startsWith("node:")) continue;
            bare.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
          }
        }
      }
    };
    walk("src");
    expect(bare.size).toBeGreaterThan(0);
    for (const b of bare) expect(RUNTIME_NODE_MODULES, `src imports ${b} at runtime`).toContain(b);
    for (const u of UI_BUNDLED_DEPENDENCIES) expect(bare.has(u), `${u} must stay UI-only`).toBe(false);
    expect(UI_BUNDLED_DEPENDENCIES).toContain("@google/model-viewer");
    expect(RUNTIME_NODE_MODULES).not.toContain("@google/model-viewer");
  });

  it("ships the Blender scripts and the Poly Haven list, never Blender or downloaded assets", () => {
    for (const f of ["render_view.py", "export_glb.py", "w3d_bscene.py"]) {
      expect(fs.existsSync(path.join("tools", "workshop3d", "blender", f))).toBe(true);
      expect(shouldShipTool(path.join("tools", "workshop3d", "blender", f))).toBe(true);
    }
    expect(fs.existsSync(path.join("config", "polyhaven-assets.json"))).toBe(true);
    const heavy = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? heavy(path.join(dir, e.name)) : /\.(exe|dll|hdr|exr|blend|jpg)$/i.test(e.name) ? [path.join(dir, e.name)] : []);
    expect([...heavy(path.join("tools", "workshop3d")), ...heavy("config")]).toEqual([]);
  });
  it("skips Python caches when shipping tools/workshop3d", () => {
    expect(shouldShipTool(path.join("tools", "workshop3d", "check_script.py"))).toBe(true);
    expect(shouldShipTool(path.join("tools", "workshop3d", "render", "index.html"))).toBe(true);
    expect(shouldShipTool(path.join("tools", "workshop3d", "__pycache__"))).toBe(false);
    expect(shouldShipTool(path.join("tools", "workshop3d", "__pycache__", "x.pyc"))).toBe(false);
  });
});
