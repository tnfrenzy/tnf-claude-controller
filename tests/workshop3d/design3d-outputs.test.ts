import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { listDesign3dFiles, shortTitle, buildDesign3dFloors } from '../../src/core/design3d/design3d-outputs.js';
import type { ArtifactRecord, RunRecord } from '../../src/core/run/run-store.js';

const base = path.join(os.tmpdir(), 'tnf-d3d-test', 'run-x');

function art(rel: string, size = 10, runId = 'r'): ArtifactRecord {
  return { run_id: runId, rel_path: rel, size, mtime: 0 };
}

function run(id: string, created: number, over: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    created_at: created,
    status: 'done',
    prompt: `prompt ${id}`,
    run_dir: path.join(os.tmpdir(), 'tnf-d3d-test', id),
    ...over,
  } as RunRecord;
}

describe('listDesign3dFiles', () => {
  it('keeps the six 3D extensions case-insensitively and maps .stp to step', () => {
    const files = listDesign3dFiles(
      [art('A.STEP'), art('b.stp'), art('c.stl'), art('d.glb'), art('e.gltf'), art('f.obj'), art('n.txt'), art('p.png')],
      base,
    );
    expect(files.map((f) => f.format)).toEqual(['step', 'step', 'stl', 'glb', 'gltf', 'obj']);
    expect(files.map((f) => f.relPath)).toEqual(['A.STEP', 'b.stp', 'c.stl', 'd.glb', 'e.gltf', 'f.obj']);
  });

  it('drops paths escaping the run dir and keeps nested ones', () => {
    const outside = path.join(os.tmpdir(), 'tnf-d3d-elsewhere', 'z.step');
    const files = listDesign3dFiles([art('../x.step'), art(outside), art('sub/a.glb', 7)], base);
    expect(files).toEqual([{ relPath: 'sub/a.glb', size: 7, format: 'glb' }]);
  });

  it('collapses duplicate rel_path entries', () => {
    const files = listDesign3dFiles([art('a.stl', 1), art('a.stl', 2)], base);
    expect(files).toHaveLength(1);
  });
});

describe('shortTitle', () => {
  it('keeps short prompts, collapsing whitespace', () => {
    expect(shortTitle('  thiết  kế   thang  ', 'id1')).toBe('thiết kế thang');
  });
  it('cuts long prompts on a word boundary with an ellipsis, max 40', () => {
    const t = shortTitle('thiet ke mo hinh thang may tai trong 1000kg cho toa nha van phong', 'id1');
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.endsWith('…')).toBe(true);
    expect(t).toBe('thiet ke mo hinh thang may tai trong…');
  });
  it('hard-cuts a single long word to 39 chars plus ellipsis', () => {
    const t = shortTitle('x'.repeat(100), 'id1');
    expect(t).toBe('x'.repeat(39) + '…');
    expect(t.length).toBe(40);
  });
  it('falls back to the id for an empty prompt', () => {
    expect(shortTitle('   ', 'id1')).toBe('id1');
  });
});

describe('buildDesign3dFloors', () => {
  it('picks the most frequent format, ties by step>stl>glb>gltf>obj', () => {
    const [a, b, c] = buildDesign3dFloors([
      { run: run('a', 3), artifacts: [art('1.stl'), art('2.stl'), art('3.step')] },
      { run: run('b', 2), artifacts: [art('1.obj'), art('2.glb')] },
      { run: run('c', 1), artifacts: [art('1.gltf'), art('2.obj')] },
    ]);
    expect(a.primaryFormat).toBe('stl');
    expect(b.primaryFormat).toBe('glb');
    expect(c.primaryFormat).toBe('gltf');
  });

  it('drops runs without 3D files, counts only 3D files and copies status', () => {
    const floors = buildDesign3dFloors([
      { run: run('a', 2, { status: 'failed' }), artifacts: [art('m.step'), art('n.stl'), art('readme.txt')] },
      { run: run('b', 1), artifacts: [art('readme.txt')] },
    ]);
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ runId: 'a', fileCount: 2, status: 'failed', title: 'prompt a' });
  });

  it('sorts newest first, ties by id descending, and limits to 5', () => {
    const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({
      run: run(id, i < 2 ? 100 : i),
      artifacts: [art('m.step')],
    }));
    const floors = buildDesign3dFloors(entries);
    expect(floors).toHaveLength(5);
    expect(floors.map((f) => f.runId)).toEqual(['b', 'a', 'g', 'f', 'e']);
  });

  it('honours a custom limit', () => {
    const entries = ['a', 'b', 'c'].map((id, i) => ({ run: run(id, i), artifacts: [art('m.step')] }));
    expect(buildDesign3dFloors(entries, 2).map((f) => f.runId)).toEqual(['c', 'b']);
  });

  it('returns an empty list for empty input', () => {
    expect(buildDesign3dFloors([])).toEqual([]);
  });
});
