/**
 * Compile installer/setup.iss with Inno Setup 6 (ISCC.exe) into build/TNF-CLI-Setup-<version>.exe.
 *
 *   npm run package            # first: assemble build/app
 *   npm run installer          # then: build the Setup.exe
 *
 * ISCC is looked up in %LOCALAPPDATA%\Programs\Inno Setup 6 and %ProgramFiles(x86)%\Inno Setup 6, or TNF_ISCC.
 * Inno Setup is a dev-machine build tool only; nothing from it ships inside the installer besides the stub.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function findIscc(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env["TNF_ISCC"],
    env["LOCALAPPDATA"] && path.join(env["LOCALAPPDATA"], "Programs", "Inno Setup 6", "ISCC.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe"),
    env["ProgramFiles"] && path.join(env["ProgramFiles"], "Inno Setup 6", "ISCC.exe"),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

function main(): number {
  if (!fs.existsSync(path.join(ROOT, "build", "app", "node.exe"))) {
    console.error("Chưa có build/app — chạy `npm run package` trước.");
    return 2;
  }
  const iscc = findIscc();
  if (!iscc) {
    console.error("Không tìm thấy ISCC.exe (Inno Setup 6). Cài Inno Setup (https://jrsoftware.org/isinfo.php) hoặc đặt TNF_ISCC=<đường dẫn ISCC.exe>.");
    return 2;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };
  const res = spawnSync(iscc, [`/DMyAppVersion=${pkg.version}`, path.join(ROOT, "installer", "setup.iss")], { stdio: "inherit", windowsHide: true });
  if (res.status !== 0) {
    console.error(`ISCC thất bại (mã ${res.status}).`);
    return 1;
  }
  const out = path.join(ROOT, "build", `TNF-CLI-Setup-${pkg.version}.exe`);
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(`Setup.exe: ${out} (${mb} MB)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
