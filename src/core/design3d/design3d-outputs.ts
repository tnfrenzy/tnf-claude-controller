import path from 'node:path';
import type { ArtifactRecord, RunRecord } from '../run/run-store.js';
import { resolveInside } from '../app/outputs.js';

export type Design3dFormat = 'step' | 'stl' | 'glb' | 'gltf' | 'obj';

export interface Design3dFile {
  relPath: string;
  size: number;
  format: Design3dFormat;
}

export interface Design3dFloor {
  runId: string;
  title: string;
  status: RunRecord['status'];
  fileCount: number;
  primaryFormat: Design3dFormat;
}

export const EXT_FORMAT: Record<string, Design3dFormat> = {
  '.step': 'step',
  '.stp': 'step',
  '.stl': 'stl',
  '.glb': 'glb',
  '.gltf': 'gltf',
  '.obj': 'obj',
};

const FORMAT_PRIORITY: Design3dFormat[] = ['step', 'stl', 'glb', 'gltf', 'obj'];

const TITLE_MAX = 40;

/** 3D files among the artifacts (input order kept; duplicates by rel_path collapsed; paths escaping `base` dropped). */
export function listDesign3dFiles(artifacts: ArtifactRecord[], base: string): Design3dFile[] {
  const seen = new Set<string>();
  const out: Design3dFile[] = [];
  for (const a of artifacts) {
    if (seen.has(a.rel_path)) continue;
    const format = EXT_FORMAT[path.extname(a.rel_path).toLowerCase()];
    if (!format) continue;
    if (resolveInside(base, a.rel_path) === null) continue;
    seen.add(a.rel_path);
    out.push({ relPath: a.rel_path, size: a.size, format });
  }
  return out;
}

/** Short floor name from a prompt: whitespace collapsed, at most 40 chars, cut on a word boundary with an ellipsis. */
export function shortTitle(prompt: string, id: string): string {
  const t = (prompt ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return id;
  if (t.length <= TITLE_MAX) return t;
  const head = t.slice(0, TITLE_MAX - 1);
  // Cut at the nearest word boundary only when the next char starts a new word or head ends at a space.
  let cut = head.lastIndexOf(' ');
  if (t[TITLE_MAX - 1] === ' ') cut = TITLE_MAX - 1;
  const body = cut > 0 ? head.slice(0, cut) : head;
  return body.trimEnd() + '…';
}

function primaryFormat(files: Design3dFile[]): Design3dFormat {
  const counts = new Map<Design3dFormat, number>();
  for (const f of files) counts.set(f.format, (counts.get(f.format) ?? 0) + 1);
  let best: Design3dFormat = 'step';
  let bestN = -1;
  for (const fmt of FORMAT_PRIORITY) {
    const n = counts.get(fmt) ?? 0;
    if (n > bestN) {
      best = fmt;
      bestN = n;
    }
  }
  return best;
}

/** Runs that produced 3D files, newest first, at most `limit` (default 5). */
export function buildDesign3dFloors(
  entries: { run: RunRecord; artifacts: ArtifactRecord[] }[],
  limit = 5,
): Design3dFloor[] {
  const floors: { createdAt: number; floor: Design3dFloor }[] = [];
  for (const { run, artifacts } of entries) {
    const files = listDesign3dFiles(artifacts, run.run_dir);
    if (files.length === 0) continue;
    floors.push({
      createdAt: run.created_at,
      floor: {
        runId: run.id,
        title: shortTitle(run.prompt, run.id),
        status: run.status,
        fileCount: files.length,
        primaryFormat: primaryFormat(files),
      },
    });
  }
  floors.sort((a, b) => b.createdAt - a.createdAt || (a.floor.runId < b.floor.runId ? 1 : a.floor.runId > b.floor.runId ? -1 : 0));
  return floors.slice(0, Math.max(0, limit)).map((f) => f.floor);
}
