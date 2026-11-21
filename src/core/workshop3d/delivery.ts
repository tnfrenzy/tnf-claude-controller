import fs from "node:fs";
import path from "node:path";

/**
 * Delivery folder of a workshop3d session: `<Settings output dir>/workshop3d/<slug>-<title>/`. The session folder (under the
 * app's data dir) keeps the working files; the deliverables are mirrored here so the user finds them where they set the
 * output folder: the model files (outputs/*.glb, .step, .usdz), the presentation page (trinh-bay/), the Blender images
 * (anh-blender/) and REPORT.md. Only newer/different files are copied; a locked file never stops the others.
 */

export const DELIVERY_SUBDIR = "workshop3d";
const SKIP_OUTPUT_DIRS = new Set(["parts", "trinh-bay"]);

/** ASCII folder name from the session title ("Cabin thang máy khách" -> "cabin-thang-may-khach"). */
export function titleSlug(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "mo-hinh";
}

export function deliveryDir(outputDir: string, slug: string, title: string): string {
  return path.join(outputDir, DELIVERY_SUBDIR, `${slug}-${titleSlug(title)}`);
}

function copyFile(src: string, dst: string): number {
  try {
    const s = fs.statSync(src);
    if (!s.isFile()) return 0;
    if (fs.existsSync(dst)) {
      const d = fs.statSync(dst);
      if (d.size === s.size && d.mtimeMs >= s.mtimeMs) return 0;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return 1;
  } catch {
    return 0;
  }
}

function copyTree(srcDir: string, dstDir: string, skipDirs: ReadonlySet<string> = new Set()): number {
  let n = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const s = path.join(srcDir, e.name);
    const d = path.join(dstDir, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) n += copyTree(s, d);
    } else if (e.isFile()) n += copyFile(s, d);
  }
  return n;
}

/** Mirrors the deliverables of `sessionDir` into `dest`; returns the number of files copied. */
export function syncDelivery(sessionDir: string, dest: string): number {
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  n += copyTree(path.join(sessionDir, "outputs"), dest, SKIP_OUTPUT_DIRS);
  n += copyTree(path.join(sessionDir, "outputs", "trinh-bay"), path.join(dest, "trinh-bay"));
  n += copyTree(path.join(sessionDir, "renders", "hq"), path.join(dest, "anh-blender"));
  n += copyFile(path.join(sessionDir, "REPORT.md"), path.join(dest, "REPORT.md"));
  return n;
}
