import { createSim, lightColors, pedInFront, shade, tickSim } from "./city-sim";
import type { Car, CarKind, Geom, Ped, Sim } from "./city-sim";

/* DOM driver for the traffic simulation: draws into refs once, then only updates attributes inside rAF (never React state). */

const NS = "http://www.w3.org/2000/svg";
function el(tag: string, attrs: Record<string, string | number> = {}, kids: SVGElement[] = []): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  kids.forEach((c) => n.appendChild(c));
  return n;
}

const TIE: Record<string, string> = { analyst: "#8b5cf6", planner: "#ff9f43", critic: "#ff5c5c", implementer: "#5aa0ff", qa: "#2ed47a", debug: "#ffc542", searcher: "#ff9f43", analyzer: "#2ed47a", synthesizer: "#8b5cf6", writer: "#ff5c5c", editor: "#5aa0ff", seo: "#ffc542", coordinator: "#d9b26a" };

function drawPed(look: string, face: number, moving: boolean): SVGElement {
  const g = el("g", { class: moving ? "p walking" : "p idle" });
  g.appendChild(el("ellipse", { cx: 0, cy: 1, rx: 16, ry: 4.5, fill: "#000", opacity: 0.35 }));
  [-6, 6].forEach((x) => g.appendChild(el("rect", { x: x - 3.5, y: -10, width: 7, height: 10, rx: 3, fill: "#3a4360" })));
  g.appendChild(el("ellipse", { cx: 0, cy: -27, rx: 17, ry: 19, fill: "#1c2437" }));
  g.appendChild(el("path", { d: `M-2.2 -37 h4.4 l1.2 12 l-3.4 5 l-3.4 -5z`, fill: TIE[look] ?? "#5aa0ff" }));
  g.appendChild(el("circle", { cx: 0, cy: -59, r: 15, fill: "#f3cdb0" }));
  g.appendChild(el("path", { d: `M-15 -59 a15 15 0 0 1 30 0 q${-8 * face} -6 -30 0z`, fill: "#2b1d14" }));
  return g;
}

function drawVehicle(kind: CarKind, color: string, len: number): { g: SVGElement; brake: SVGElement; wheels: SVGElement[] } {
  const g = el("g");
  const b = el("g");
  g.appendChild(el("ellipse", { cx: 0, cy: 2, rx: len / 2 + 4, ry: 4, fill: "#000", opacity: 0.45 }));
  const L = -len / 2;
  const R = len / 2;
  const wheels: SVGElement[] = [];
  if (kind === "scooter") {
    b.appendChild(el("path", { d: "M-16 -6 q-3 -8 6 -9 h10 l6 -10 h8 l-2 10 h6 q6 0 6 6 l-2 3 z", fill: color }));
    b.appendChild(el("ellipse", { cx: 16, cy: -10, rx: 4, ry: 2.5, fill: "#fff7d6" }));
    [-12, 10].forEach((wx) => {
      const w = el("g", { "data-cx": wx }, [el("circle", { cx: wx, cy: 0, r: 4.5, fill: "#111" }), el("line", { x1: wx - 4, y1: 0, x2: wx + 4, y2: 0, stroke: "#999", "stroke-width": 1 })]);
      wheels.push(w);
      b.appendChild(w);
    });
    b.appendChild(el("circle", { cx: -4, cy: -30, r: 6, fill: "#e9eef8" }));
  } else {
    const dark = shade(color, 0.55);
    const bodies: Record<string, string> = {
      sedan: `M${L + 3} -3 q-3 0 -3 -3 v-6 q0 -4 5 -5 l13 -2 q7 -10 17 -10 h18 q10 0 16 10 l12 2 q5 1 5 5 v6 q0 3 -3 3z`,
      suv: `M${L + 3} -3 q-3 0 -3 -3 v-10 q0 -4 5 -5 l9 -2 q4 -10 14 -10 h32 q10 0 14 10 l8 2 q5 1 5 5 v10 q0 3 -3 3z`,
      taxi: `M${L + 3} -3 q-3 0 -3 -3 v-6 q0 -4 5 -5 l13 -2 q7 -10 17 -10 h18 q10 0 16 10 l12 2 q5 1 5 5 v6 q0 3 -3 3z`,
      van: `M${L + 3} -3 q-3 0 -3 -3 v-12 q0 -3 3 -3 h8 q3 -9 10 -9 h46 q7 0 7 7 v17 q0 3 -3 3z`,
    };
    b.appendChild(el("path", { d: bodies[kind] ?? "", fill: color }));
    b.appendChild(el("path", { d: bodies[kind] ?? "", fill: "url(#gCarShade)" }));
    b.appendChild(el("rect", { x: L + 2, y: -6, width: len - 4, height: 3.5, fill: dark, opacity: 0.9 }));
    b.appendChild(el("path", { d: `M${L + 19} -21 q4 -8 12 -8 h14 q9 0 14 8z`, fill: "#9fc3ff", opacity: 0.55 }));
    b.appendChild(el("rect", { x: R - 5, y: -14, width: 4, height: 5, rx: 1, fill: "#fff7d6" }));
    if (kind === "taxi") b.appendChild(el("rect", { x: L + 30, y: -33, width: 20, height: 6, rx: 2, fill: "#ffc542" }));
    [L + 16, L + 62].forEach((wx) => {
      const w = el("g", { "data-cx": wx }, [el("circle", { cx: wx, cy: 0, r: 6, fill: "#0f1116" }), el("circle", { cx: wx, cy: 0, r: 3.6, fill: "#b9c1cf" }), el("circle", { cx: wx, cy: 0, r: 1, fill: "#4a5263" })]);
      wheels.push(w);
      b.appendChild(w);
    });
  }
  const brake = el("rect", { x: kind === "scooter" ? -17 : L + 1, y: kind === "scooter" ? -9 : -14, width: 4, height: 4, rx: 1, fill: "#ff3b3b", opacity: 0.35 });
  b.appendChild(brake);
  g.appendChild(b);
  return { g, brake, wheels };
}

export type DriverNodes = { veh: SVGGElement; pedBack: SVGGElement; pedFront: SVGGElement; light: SVGGElement };

/** Starts the simulation; returns a stop function (cancels rAF and removes listeners and drawn nodes). */
export function startCitySim(nodes: DriverNodes, geom: Geom, rand: () => number = Math.random): () => void {
  const sim: Sim = createSim(geom, rand);
  const carNodes = new Map<number, { g: SVGElement; brake: SVGElement; wheels: SVGElement[] }>();
  const pedNodes = new Map<number, { g: SVGElement; key: string }>();

  // traffic light pole (left of the crossing, on the sidewalk)
  const lx = geom.crossX - 76;
  const base = geom.CURB - 2;
  const lampAt = (dy: number) => el("circle", { cx: lx, cy: base - 118 + dy, r: 5, fill: "#2a2f45" });
  const lRed = lampAt(0);
  const lYel = lampAt(13);
  const lGrn = lampAt(26);
  const pRed = el("rect", { x: lx - 5, y: base - 80, width: 10, height: 7, rx: 1.5, fill: "#2a2f45" });
  const pGrn = el("rect", { x: lx - 5, y: base - 70, width: 10, height: 7, rx: 1.5, fill: "#2a2f45" });
  nodes.light.append(
    el("rect", { x: lx - 2.5, y: base - 92, width: 5, height: 92, fill: "#3a4360" }),
    el("rect", { x: lx - 9, y: base - 128, width: 18, height: 40, rx: 3, fill: "#1b1f2e", stroke: "#3a4360" }),
    lRed,
    lYel,
    lGrn,
    el("rect", { x: lx - 9, y: base - 84, width: 18, height: 24, rx: 3, fill: "#1b1f2e", stroke: "#3a4360" }),
    pRed,
    pGrn,
  );

  sim.cars.forEach((c: Car) => {
    const d = drawVehicle(c.kind, c.color, c.len);
    nodes.veh.appendChild(d.g);
    carNodes.set(c.id, d);
  });
  sim.peds.forEach((p: Ped) => {
    const g = el("g");
    nodes.pedBack.appendChild(g);
    pedNodes.set(p.id, { g, key: "" });
  });

  const paint = () => {
    const lc = lightColors(sim);
    lRed.setAttribute("fill", lc.red);
    lYel.setAttribute("fill", lc.yellow);
    lGrn.setAttribute("fill", lc.green);
    pRed.setAttribute("fill", lc.pedRed);
    pGrn.setAttribute("fill", lc.pedGreen);
    sim.cars.forEach((c) => {
      const n = carNodes.get(c.id);
      if (!n) return;
      const dir = c.lane === "A" ? 1 : -1;
      n.g.setAttribute("transform", `translate(${c.x.toFixed(1)},${sim.laneY[c.lane]}) scale(${dir},1)`);
      n.brake.setAttribute("opacity", c.braking ? "1" : "0.35");
      n.wheels.forEach((w) => w.setAttribute("transform", `rotate(${(c.rot % 360).toFixed(0)} ${w.getAttribute("data-cx")} 0)`));
    });
    sim.peds.forEach((p) => {
      const n = pedNodes.get(p.id);
      if (!n) return;
      const moving = p.state === "walk" || p.state === "cross";
      const key = `${moving ? "w" : "i"}|${p.face}`;
      if (n.key !== key) {
        n.key = key;
        n.g.replaceChildren(drawPed(p.look, p.face, moving));
      }
      n.g.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) scale(.42)`);
      const parent = pedInFront(p, geom.CURB) ? nodes.pedFront : nodes.pedBack;
      if (n.g.parentNode !== parent) parent.appendChild(n.g);
    });
  };

  let raf = 0;
  let last = 0;
  const frame = (ts: number) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden) {
      last = 0;
      return;
    }
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (dt > 0) tickSim(sim, dt, rand);
    paint();
  };
  paint();
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    nodes.veh.replaceChildren();
    nodes.pedBack.replaceChildren();
    nodes.pedFront.replaceChildren();
    nodes.light.replaceChildren();
  };
}
