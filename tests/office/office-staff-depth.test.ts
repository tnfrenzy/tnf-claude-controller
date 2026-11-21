import { describe, expect, it } from 'vitest';
import { staffDepth, staffDepthBias } from '../../ui/src/office/iso/depth';
import { isoDepth } from '../../ui/src/office/iso4';
import { layoutFor } from '../../ui/src/office/layout';

describe('staffDepthBias', () => {
  it('stand 0.2, sit 0.5', () => {
    expect(staffDepthBias('stand')).toBe(0.2);
    expect(staffDepthBias('sit')).toBe(0.5);
  });
  it('sofa and lie exceed standing', () => {
    expect(staffDepthBias('sofa')).toBeGreaterThan(0.2);
    expect(staffDepthBias('lie')).toBeGreaterThan(0.2);
  });
});

describe('staffDepth on real layout', () => {
  const L = layoutFor(1280);
  const sofas = Object.values(L.furniture).flatMap((f) => f.sofas);

  it('person at sofa centre or either end draws after the sofa', () => {
    const s = sofas[0];
    const cy = s.y + s.h / 2;
    const sofaDepth = isoDepth(s.x + s.w / 2, cy);
    for (const x of [s.x + 2, s.x + s.w / 2, s.x + s.w - 2]) {
      const pos = { x, y: cy };
      for (const pose of ['sofa', 'lie']) {
        const items = [
          { id: 'sofa', depth: sofaDepth },
          { id: 'p', depth: staffDepth(pose, pos, sofas) },
        ].sort((a, b) => a.depth - b.depth);
        expect(items.map((i) => i.id)).toEqual(['sofa', 'p']);
      }
    }
  });

  it('every sofa: far-end person is still after the sofa', () => {
    for (const s of sofas) {
      const d = staffDepth('sofa', { x: s.x + s.w - 1, y: s.y + s.h - 1 }, sofas);
      expect(d).toBeGreaterThan(isoDepth(s.x + s.w / 2, s.y + s.h / 2));
    }
  });

  it('seated person is after the chair at the same point', () => {
    const p = { x: 300, y: 200 };
    expect(staffDepth('sit', p, sofas)).toBeGreaterThan(isoDepth(p.x, p.y));
  });
});
