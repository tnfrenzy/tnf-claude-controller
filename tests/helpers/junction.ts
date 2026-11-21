import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * True when files can be read through a directory junction/symlink.
 * Some sandboxes fail with `UNKNOWN -4094` on junctions; tests that depend on
 * them are skipped there (known environment limitation) and still run elsewhere.
 */
export function canReadThroughJunction(): boolean {
  let dir: string | undefined;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-junc-"));
    const target = path.join(dir, "target");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "f.txt"), "ok");
    const link = path.join(dir, "link");
    fs.symlinkSync(target, link, "junction");
    return fs.readFileSync(path.join(link, "f.txt"), "utf8") === "ok";
  } catch {
    return false;
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

export const canRead = canReadThroughJunction();
