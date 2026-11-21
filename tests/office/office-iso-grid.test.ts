import { describe, expect, it } from 'vitest';
import { FURN, buildGrid, cellOf, centerOf, findPath, isFree, cellKey } from '../../ui/src/office/iso/grid';

const g = buildGrid(6);

describe('iso grid', () => {
  it('finds a path between two free points ending exactly at the target', () => {
    const to = { u: 8, v: 3.7 };
    const p = findPath(g, { u: 5, v: 3.7 }, to);
    expect(p).not.toBeNull();
    expect(p![p!.length - 1]).toEqual(to);
  });

  it('never steps through blocked cells except the goal', () => {
    const p = findPath(g, { u: 5, v: 3.7 }, FURN.desk(4).seat)!;
    expect(p).not.toBeNull();
    for (const pt of p.slice(0, -1)) expect(g.blocked.has(cellKey(pt.u, pt.v))).toBe(false);
  });

  it('allows entering a blocked goal cell (seat) but not other blocked cells', () => {
    const seat = FURN.desk(0).seat;
    expect(isFree(g, seat.u, seat.v)).toBe(false);
    expect(findPath(g, { u: 5, v: 3.7 }, seat)).not.toBeNull();
  });

  it('does not cut diagonal corners', () => {
    const start = { u: 5, v: 3.7 };
    const to = FURN.desk(4).seat;
    const p = findPath(g, start, to)!;
    let [pu, pv] = cellOf(start);
    for (const pt of p) {
      const [cu, cv] = cellOf(pt);
      if (cu !== pu && cv !== pv) {
        expect(g.blocked.has(`${cu},${pv}`)).toBe(false);
        expect(g.blocked.has(`${pu},${cv}`)).toBe(false);
      }
      [pu, pv] = [cu, cv];
    }
  });

  it('returns null when the goal is enclosed by blocked cells', () => {
    const closed = buildGrid(0);
    // plant at (0.3,0.3): cell (0,0) is inside its footprint, neighbours of a fully walled pocket
    for (let cu = 0; cu < 24; cu++) closed.blocked.add(`${cu},10`);
    expect(findPath(closed, { u: 1, v: 1 }, { u: 1, v: 8 })).toBeNull();
  });

  it('from a cell to itself returns just the target', () => {
    const to = { u: 5.1, v: 3.6 };
    expect(findPath(g, { u: 5.2, v: 3.7 }, to)).toEqual([to]);
  });

  it('centerOf is the middle of a cell and inverse of cellOf', () => {
    expect(centerOf(2, 3)).toEqual({ u: 1.25, v: 1.75 });
    expect(cellOf(centerOf(5, 7))).toEqual([5, 7]);
  });

  it('only builds desks for the roles given', () => {
    const d = FURN.desk(5);
    expect(buildGrid(5).blocked.has(cellKey(d.u + 0.1, d.v + 0.1))).toBe(false);
    expect(buildGrid(6).blocked.has(cellKey(d.u + 0.1, d.v + 0.1))).toBe(true);
  });
});
