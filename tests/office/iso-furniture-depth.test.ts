import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { kitchenItems, Sofa, CoffeeTable, loungeItems, BEACON_COLOR, Beacon, CoordDesk, Desk, coordDeskItems, DropShadow, IsoBox, beaconKind, deskChairItems, shade } from '../../ui/src/components/office/IsoFurniture';
import { FURN } from '../../ui/src/office/iso/grid';
import {
  CHAIR_BACK_BIAS, CHAIR_BASE_BIAS, CHAIR_SEATED_BIAS, furnitureDepth, personDepth, sortedDrawList,
} from '../../ui/src/office/iso/depth';

describe('shade and isoBox', () => {
  const ch = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);
  it('shade brightens, darkens and clamps', () => {
    expect(ch(shade('#808080', 1.18))[0]).toBeGreaterThan(128);
    expect(ch(shade('#808080', 0.62))[0]).toBeLessThan(128);
    expect(ch(shade('#ffffff', 1.18))).toEqual([255, 255, 255]);
    expect(ch(shade('#000000', 0.62))).toEqual([0, 0, 0]);
  });
  it('IsoBox renders 3 polygons, 1 light edge and no text', () => {
    const html = renderToStaticMarkup(createElement(IsoBox, { r: { u: 1, v: 1, w: 2, d: 1 }, h: 22, color: '#5e4a38' }));
    expect(html.match(/<polygon/g)?.length).toBe(3);
    expect(html.match(/<polyline/g)?.length).toBe(1);
    expect(html).not.toContain('<text');
  });
  it('DropShadow renders one polygon', () => {
    const html = renderToStaticMarkup(createElement('svg', null, createElement(DropShadow, { r: { u: 1, v: 1, w: 2, d: 1 } })));
    expect(html.match(/<polygon/g)?.length).toBe(1);
  });
});

describe('furnitureDepth', () => {
  it('is u + v + d and ignores w', () => {
    expect(furnitureDepth({ u: 2, v: 3, d: 1.5 })).toBeCloseTo(6.5);
    expect(furnitureDepth({ u: 2, v: 3, d: 1.5, w: 9 } as { u: number; v: number; d: number })).toBeCloseTo(6.5);
  });
});

describe('personDepth', () => {
  it('lying on the sofa is the sofa key + 0.05', () => {
    const key = furnitureDepth({ u: 10, v: 8, d: 2 });
    expect(personDepth('lie', { u: 11, v: 9 }, key) - key).toBeCloseTo(0.05);
  });
  it('chair base < seated person < chair back when keyed on the same chair position', () => {
    const k = 7;
    expect(CHAIR_BASE_BIAS).toBeLessThan(CHAIR_SEATED_BIAS);
    expect(CHAIR_SEATED_BIAS).toBeLessThan(CHAIR_BACK_BIAS);
    const list = sortedDrawList([
      { id: 'a-back', depth: k + CHAIR_BACK_BIAS },
      { id: 'b-person', depth: personDepth('sit', { u: 3, v: 4 }) },
      { id: 'c-base', depth: k + CHAIR_BASE_BIAS },
    ]);
    expect(list.map((i) => i.id)).toEqual(['c-base', 'b-person', 'a-back']);
  });
  it('sofa pose uses the sofa key + 0.05, or position + 0.02 without a key; lie keeps 0.05', () => {
    const pos = { u: 7.5, v: 12.3 };
    expect(personDepth('sofa', pos, 16)).toBeCloseTo(16.05, 5);
    expect(personDepth('sofa', pos)).toBeCloseTo(pos.u + pos.v + 0.02, 5);
    expect(personDepth('lie', pos, 16)).toBeCloseTo(16.05, 5);
    expect(personDepth('sit', pos)).toBeCloseTo(pos.u + pos.v + CHAIR_SEATED_BIAS, 5);
  });
  it('sofa draws before the person on it, which draws before a later item', () => {
    const list = sortedDrawList([
      { id: 'a-next', depth: 16.5 },
      { id: 'b-person', depth: personDepth('lie', { u: 8, v: 8 }, 16) },
      { id: 'c-sofa', depth: 16 },
    ]);
    expect(list.map((i) => i.id)).toEqual(['c-sofa', 'b-person', 'a-next']);
  });
  it('a standing person in front of a desk draws after it', () => {
    const desk = { u: 3, v: 2, d: 1 };
    const front = personDepth('stand', { u: 3.5, v: 3.4 });
    expect(front).toBeGreaterThan(furnitureDepth(desk));
  });
});

describe('coordinator desk', () => {
  it('has two monitors, a lamp and no text', () => {
    const html = renderToStaticMarkup(createElement(CoordDesk, { r: FURN.coordDesk, on: true, kind: 'working' }));
    expect(html.match(/data-screen=/g)?.length).toBe(2);
    expect(html).toContain('data-lamp');
    expect(html).not.toContain('<text');
  });
  it('splits the chair around the seated coordinator', () => {
    const items = coordDeskItems(FURN.coordDesk, FURN.coordSeat, true, 'idle');
    const person = { id: 'p:c', depth: personDepth('sit', FURN.coordSeat) };
    const ids = sortedDrawList([...items, person]).map((i) => i.id).filter((i) => i === 'p:c' || i.startsWith('coordDesk:'));
    expect(ids).toEqual(['coordDesk:chair', 'p:c', 'coordDesk:chairback']);
  });
});

describe('desk, chair and beacon', () => {
  const desk = FURN.desk(0);
  const items = deskChairItems(0, desk, true, 'working');
  it('orders chair base, seated person, chair back', () => {
    const person = { id: 'p:x', depth: personDepth('sit', desk.seat) };
    const ids = sortedDrawList([...items, person]).map((i) => i.id).filter((i) => i === 'p:x' || i.startsWith('desk0:'));
    expect(ids.indexOf('desk0:chair')).toBeLessThan(ids.indexOf('p:x'));
    expect(ids.indexOf('p:x')).toBeLessThan(ids.indexOf('desk0:chairback'));
  });
  it('desk uses furnitureDepth', () => {
    expect(items.find((i) => i.id === 'desk0')!.depth).toBe(furnitureDepth(desk));
  });
  it('monitor is lit when on and dark when off, with no text', () => {
    const on = renderToStaticMarkup(createElement(Desk, { r: desk, on: true, kind: 'working', idx: 0 }));
    const off = renderToStaticMarkup(createElement(Desk, { r: desk, on: false, kind: 'idle', idx: 0 }));
    expect(on).toContain('data-monitor="on"');
    expect(off).toContain('data-monitor="off"');
    expect(on).not.toContain('<text');
  });
  it('beacon colour follows state', () => {
    expect(beaconKind('idle')).toBe('idle');
    expect(beaconKind('working')).toBe('working');
    expect(beaconKind('reporting')).toBe('working');
    expect(beaconKind('done')).toBe('done');
    const c = (k: 'idle' | 'working' | 'done') => renderToStaticMarkup(createElement(Beacon, { r: desk, kind: k }));
    expect(new Set([c('idle'), c('working'), c('done')]).size).toBe(3);
    expect(c('done')).toContain(BEACON_COLOR.done);
  });
});

describe('lounge', () => {
  it('sofa has 3 cushions and no text', () => {
    const m = renderToStaticMarkup(createElement(Sofa, { r: FURN.sofa }));
    expect(m.match(/data-cushion=/g)).toHaveLength(3);
    expect(m).not.toContain('<text');
    expect(renderToStaticMarkup(createElement(CoffeeTable, { r: FURN.table }))).not.toContain('<text');
  });
  it('person lying draws 0.05 after the sofa', () => {
    const sofa = loungeItems().find((i) => i.id === 'sofa')!;
    expect(sofa.depth).toBe(furnitureDepth(FURN.sofa));
    expect(personDepth('lie' as never, FURN.sofaLie, sofa.depth)).toBeCloseTo(sofa.depth + 0.05, 5);
  });
});

describe('kitchen', () => {
  it('has counter, fridge, cooler, 3 plants keyed by furnitureDepth, no text', () => {
    const items = kitchenItems();
    const want: Array<[string, any]> = [['counter', FURN.counter], ['fridge', FURN.fridge], ['cooler', FURN.cooler], ['plant0', FURN.plants[0]], ['plant1', FURN.plants[1]], ['plant2', FURN.plants[2]]];
    for (const [id, r] of want) {
      const it = items.find((i) => i.id === id)!;
      expect(it.depth).toBe(furnitureDepth(r));
      expect(renderToStaticMarkup(it.node())).not.toContain('<text');
    }
  });
});
