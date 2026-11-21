import { copyFileSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeControllerConfig } from "./core/app/config-merge.js";

const USAGE = "Cách dùng: node dist/merge-config-cli.js <controller.json hiện có> <controller.json mặc định của bản phát hành>";

function stripBom(text: string): string {
  return text.replace(/^﻿/, "");
}

/** Reads and parses a JSON file. Never reports parse messages (V8 may quote file content). */
function readJson(file: string): { text: string; value: unknown } | null {
  try {
    const text = stripBom(readFileSync(file, "utf8"));
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    console.error(`Không đọc được JSON hợp lệ: ${file}. Giữ nguyên file.`);
    return null;
  }
}

/**
 * Merges release defaults into an existing controller.json. Returns the exit code.
 * Note: mergeControllerConfig also drops token/apiKey/secret keys present in the existing file;
 * the result may therefore lack them (accepted behaviour).
 */
export function runMergeConfig(existingPath: string, defaultsPath: string): number {
  const existing = readJson(existingPath);
  if (!existing) return 1;
  const defaults = readJson(defaultsPath);
  if (!defaults) return 1;

  let text: string;
  try {
    text = JSON.stringify(mergeControllerConfig(existing.value, defaults.value), null, 2) + "\n";
  } catch {
    console.error(`Không gộp được cấu hình: ${existingPath}. Giữ nguyên file.`);
    return 1;
  }

  if (text === existing.text) {
    console.log("Không có thay đổi");
    return 0;
  }

  const tmp = existingPath + ".tmp";
  try {
    copyFileSync(existingPath, existingPath + ".bak");
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, existingPath);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // ignore
    }
    console.error(`Không ghi được file: ${existingPath}. Giữ nguyên file.`);
    return 1;
  }
  console.log(`Đã cập nhật ${existingPath}`);
  return 0;
}

export function main(argv: string[]): number {
  if (argv.length < 2 || !argv[0] || !argv[1]) {
    console.error(USAGE);
    return 2;
  }
  return runMergeConfig(argv[0], argv[1]);
}

function real(p: string): string {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const a = real(fileURLToPath(import.meta.url));
  const b = real(entry);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isEntryPoint()) {
  process.exit(main(process.argv.slice(2)));
}
