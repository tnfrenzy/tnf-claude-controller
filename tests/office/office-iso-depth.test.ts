import { describe, expect, it } from 'vitest';
import { ORIGIN, depthKey, diffPlacements, project, sortedDrawList, type Placement } from '../../ui/src/office/iso/depth';

describe('iso depth', () => {
  it('projects landmarks', () => {
    expect(project(0, 0)).toEqual({ x: ORIGIN.x, y: ORIGIN.y });
    const p = project(1, 0, 10);
    expect(p.x).toBeCloseTo(450 + 44 * 0.866, 5);
    expect(p.y).toBeCloseTo(118 + 22 - 10, 5);
    expect(project(0, 1).x).toBeCloseTo(450 - 44 * 0.866, 5);
  });

  it('draws far objects (small u+v) first', () => {
    const list = sortedDrawList([
      { id: 'near', depth: depthKey(5, 6) },
      { id: 'far', depth: depthKey(1, 1) },
    ]);
    expect(list.map((i) => i.id)).toEqual(['far', 'near']);
  });

  it('breaks ties by id and does not mutate input', () => {
    const input = [{ id: 'b', depth: 3 }, { id: 'a', depth: 3 }, { id: 'c', depth: 1 }];
    expect(sortedDrawList(input).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(input.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('diffPlacements is empty when nothing changed', () => {
    const m = new Map<string, Placement>([['a', { x: 1, y: 2, depth: 3 }]]);
    expect(diffPlacements(m, new Map(m))).toEqual([]);
    expect(diffPlacements(m, new Map([['a', { x: 1.001, y: 2, depth: 3 }]]))).toEqual([]);
  });

  it('diffPlacements lists only changed or new ids', () => {
    const prev = new Map<string, Placement>([
      ['a', { x: 1, y: 2, depth: 3 }],
      ['b', { x: 5, y: 5, depth: 5 }],
    ]);
    const next = new Map<string, Placement>([
      ['a', { x: 1, y: 2, depth: 3 }],
      ['b', { x: 5, y: 5, depth: 6 }],
      ['c', { x: 0, y: 0, depth: 0 }],
    ]);
    expect(diffPlacements(prev, next)).toEqual(['b', 'c']);
  });
});
