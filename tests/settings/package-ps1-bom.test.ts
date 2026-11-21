import { afterAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// package.ts copies installer/tray.ps1, installer/stop.ps1 and tnf.ico with copyFileSync;
// this test simulates the same copy for every .ps1 source and only reads the sources.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const files: string[] = [];
for (const dir of ["installer", "scripts"]) {
  for (const name of readdirSync(join(repoRoot, dir)).sort()) {
    if (name.toLowerCase().endsWith(".ps1")) files.push(`${dir}/${name}`);
  }
}

const tmp = mkdtempSync(join(tmpdir(), "tnf-ps1-bom-"));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function hasBom(rel: string): boolean {
  return readFileSync(join(repoRoot, rel)).subarray(0, 3).equals(BOM);
}

describe("ps1 BOM survives copyFileSync", () => {
  it("finds ps1 files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  files.forEach((rel, i) => {
    it.skipIf(!hasBom(rel))(`keeps BOM and bytes: ${rel}`, () => {
      const src = join(repoRoot, rel);
      const dest = join(tmp, `${i}-${rel.replace(/[\\/]/g, "_")}`);
      copyFileSync(src, dest);
      const out = readFileSync(dest);
      expect(out.subarray(0, 3).equals(BOM)).toBe(true);
      expect(out.equals(readFileSync(src))).toBe(true);
    });
  });
});
