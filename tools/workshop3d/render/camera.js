// Camera framing of the render page (index.html imports it from /camera.js; tests/workshop3d-render.test.ts imports it directly).
// Pure: no three.js. Boxes are {min:{x,y,z}, max:{x,y,z}} in metres, Y up, the model front (door side) faces +Z.
//
// Rules (docs/DESIGN-3D.md, render):
// - Exterior: the camera looks at the target (model centre or a part), stands OUTSIDE the outer box (at least 5 % of the
//   diagonal beyond it) and never further than 8 diagonals; default cameras (fit) also frame the whole model.
// - Interior (hollow models): a camera that would stand inside the free interior box is clamped into it (never inside a
//   wall), gets a wide lens and a small near plane. A camera in the wall band is moved to the nearer side.
// - Cutaway: camera outside, the near plane cuts the near wall away so the inside shows with a normal lens (the retry of
//   a failed interior view, and the interior overview).
export const FOV = 40;
export const INSIDE_FOV = 72;
export const CUTAWAY_FOV = 45;
/** Close-up of a part from inside a hollow model. */
export const CLOSE_FOV = 55;
/** Interior views keep this distance (m) from the free interior box. */
export const WALL_MARGIN = 0.04;

const v3 = (x, y, z) => ({ x, y, z });
const add = (a, b, s = 1) => v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => { const l = len(a) || 1; return v3(a.x / l, a.y / l, a.z / l); };
export const boxCenter = (b) => v3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
export const boxSize = (b) => v3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
export const boxDiag = (b) => len(boxSize(b));
const inside = (p, b, m = 0) => p.x > b.min.x + m && p.x < b.max.x - m && p.y > b.min.y + m && p.y < b.max.y - m && p.z > b.min.z + m && p.z < b.max.z - m;
const shrink = (b, m) => ({ min: add(b.min, v3(m, m, m)), max: add(b.max, v3(m, m, m), -1) });

/** Unit direction from the target towards the camera for (azimuth, elevation) in degrees; az 0 = +Z (front). */
export function direction(az, el) {
  const a = az * Math.PI / 180;
  const e = el * Math.PI / 180;
  return v3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/** Distance along dir from p (inside the box) to where the ray leaves the box; 0 when p is outside. */
export function rayExit(b, p, dir) {
  let t = Infinity;
  for (const k of ["x", "y", "z"]) {
    if (dir[k] > 1e-9) t = Math.min(t, (b.max[k] - p[k]) / dir[k]);
    else if (dir[k] < -1e-9) t = Math.min(t, (b.min[k] - p[k]) / dir[k]);
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Distance that frames a sphere around the whole box with the normal lens. */
export function fitDistance(b) {
  return (boxDiag(b) / 2 / Math.sin((FOV / 2) * Math.PI / 180)) * 1.05;
}

function exterior(o, target, dir) {
  const diag = boxDiag(o.box);
  const tOut = inside(target, o.box) ? rayExit(o.box, target, dir) : 0;
  let d = Math.min(Math.max(o.dist, 0.1), 100);
  if (o.fit) d = Math.max(d, fitDistance(o.box));
  d = Math.min(Math.max(d, tOut + 0.05 * diag), Math.max(8 * diag, tOut + 0.05 * diag));
  const gap = Math.max(d - tOut, 0.01);
  return { mode: "exterior", position: add(target, dir, d), lookAt: target, fov: FOV, near: Math.max(0.005, Math.min(gap * 0.5, d / 50)), far: d + diag * 3 };
}

/** Camera outside the box, near plane just inside the near wall: the wall is cut away and the interior shows. */
export function cutaway(o, dir) {
  const box = o.box;
  const inner = o.interior;
  const c = inner ? boxCenter(inner) : boxCenter(box);
  const diag = boxDiag(box);
  const tOut = rayExit(box, c, dir);
  const tIn = inner ? rayExit(inner, c, dir) : tOut * 0.8;
  const d = tOut + Math.max(fitDistance(inner ?? box) * 0.75, tOut * 1.2);
  const position = add(c, dir, d);
  // near plane: past every point of the near wall's inner face, so the whole wall is cut (not a slanted strip of it)
  let near = d - tIn + 0.01;
  if (inner) {
    const k = ["x", "y", "z"].reduce((a, b) => (Math.abs(dir[b]) > Math.abs(dir[a]) ? b : a), "x");
    const face = dir[k] > 0 ? inner.max[k] : inner.min[k];
    const [p, q] = ["x", "y", "z"].filter((a) => a !== k);
    for (const vp of [inner.min[p], inner.max[p]]) {
      for (const vq of [inner.min[q], inner.max[q]]) {
        const corner = { x: 0, y: 0, z: 0, [k]: face, [p]: vp, [q]: vq };
        const depth = -((corner.x - position.x) * dir.x + (corner.y - position.y) * dir.y + (corner.z - position.z) * dir.z);
        near = Math.max(near, depth + 0.01);
      }
    }
  }
  return { mode: "cutaway", position, lookAt: c, fov: CUTAWAY_FOV, near: Math.max(0.01, near), far: d + diag * 3 };
}

/**
 * Frame one camera.
 * @param {{az:number, el:number, dist:number, fit?:boolean, box:object, interior?:object|null, target?:{x,y,z}|null}} o
 *   box = outer box of the model; interior = free box inside a hollow model (null when not hollow);
 *   target = centre of the part the camera looks at (default: model centre).
 */
export function frameView(o) {
  const dir = direction(o.az, o.el);
  const target = o.target ?? boxCenter(o.box);
  // fit cameras, and every camera of a solid/open model: never inside the outer box (that would be inside material)
  if (o.fit || !o.interior) return exterior(o, target, dir);
  const inner = shrink(o.interior, WALL_MARGIN);
  const d = Math.min(Math.max(o.dist, 0.1), 100);
  const pos = add(target, dir, d);
  if (o.target) {
    // close-up of a part: a part on the inside of a hollow model (COP, handrail, lamp) is shot from inside, with the
    // camera clamped into the free interior; a part outside is shot from outside
    const clampIn = (p) => v3(...["x", "y", "z"].map((k) => Math.min(Math.max(p[k], inner.min[k]), inner.max[k])));
    if (inside(target, o.interior) || inside(pos, inner)) {
      return { mode: "interior", position: clampIn(pos), lookAt: target, fov: CLOSE_FOV, near: 0.01, far: boxDiag(o.box) * 3 };
    }
    return exterior(o, target, dir);
  }
  const targetInside = inside(target, inner);
  const tOut = inside(target, o.box) ? rayExit(o.box, target, dir) : 0;
  const tIn = targetInside ? rayExit(inner, target, dir) : 0;
  const wantsInside = targetInside && (inside(pos, inner) || (inside(pos, o.box) && d <= (tIn + tOut) / 2));
  if (!wantsInside) return exterior(o, target, dir);
  // interior: stay inside the free box; a camera very close to the target backs off to see more than a patch of wall
  const dIn = Math.min(Math.max(d, 0.55 * tIn), 0.95 * tIn);
  return { mode: "interior", position: add(target, dir, dIn), lookAt: target, fov: INSIDE_FOV, near: 0.01, far: boxDiag(o.box) * 3 };
}

/** Coarse view group, used to see which interior groups a plan already covers. */
export function classify(frame) {
  if (frame.mode === "exterior") return "exterior";
  if (frame.mode === "cutaway") return "overview";
  const look = norm(sub(frame.lookAt, frame.position));
  if (look.y > 0.55) return "ceiling";
  if (look.y < -0.55) return "floor";
  if (Math.abs(look.x) > Math.abs(look.z)) return look.x < 0 ? "wall_left" : "wall_right";
  return look.z < 0 ? "wall_back" : "wall_front";
}

/** Vietnamese label of a group (camera names stay ASCII). */
export const GROUP_LABEL = {
  overview: "toàn cảnh nội thất (cắt vách trước)",
  ceiling: "nhìn lên trần",
  floor: "nhìn xuống sàn",
  wall_left: "vách trái",
  wall_right: "vách phải",
  wall_back: "vách hậu",
  wall_front: "vách cửa",
  cop: "cận bảng gọi tầng (COP)",
  exterior: "bên ngoài",
};
/** Interior groups a hollow model must show, in render order; cop only when a COP part exists. */
export const INTERIOR_GROUPS = ["overview", "ceiling", "floor", "wall_back", "wall_left", "wall_right", "cop"];

/** Auto camera for an interior group. interior = free interior box; cop = box of the COP part (or null). */
export function interiorPreset(group, box, interior, cop) {
  const inner = shrink(interior, WALL_MARGIN);
  const c = boxCenter(inner);
  const s = boxSize(inner);
  const eye = inner.min.y + Math.min(1.55, s.y * 0.62);
  const base = { mode: "interior", fov: INSIDE_FOV, near: 0.01, far: boxDiag(box) * 3 };
  switch (group) {
    case "overview":
      return cutaway({ box, interior }, direction(12, 9));
    case "ceiling":
      return { ...base, fov: 80, position: v3(c.x, inner.min.y + s.y * 0.42, c.z + s.z * 0.38), lookAt: v3(c.x, inner.max.y, c.z - s.z * 0.12) };
    case "floor":
      return { ...base, fov: 76, position: v3(c.x, inner.max.y - s.y * 0.12, c.z + s.z * 0.42), lookAt: v3(c.x, inner.min.y, c.z - s.z * 0.1) };
    case "wall_back":
      return { ...base, position: v3(c.x, eye, inner.max.z - 0.02), lookAt: v3(c.x, eye - s.y * 0.12, inner.min.z) };
    case "wall_front":
      return { ...base, position: v3(c.x, eye, inner.min.z + 0.02), lookAt: v3(c.x, eye - s.y * 0.12, inner.max.z) };
    case "wall_left":
      return { ...base, position: v3(inner.max.x - 0.02, eye, c.z), lookAt: v3(inner.min.x, eye - s.y * 0.12, c.z) };
    case "wall_right":
      return { ...base, position: v3(inner.min.x + 0.02, eye, c.z), lookAt: v3(inner.max.x, eye - s.y * 0.12, c.z) };
    case "cop": {
      if (!cop) return null;
      const t = boxCenter(cop);
      const away = norm(v3(c.x - t.x, 0, c.z - t.z)); // towards the middle of the cabin, in front of the panel
      const reach = Math.max(0.35, Math.min(1.6 * boxDiag(cop), 0.9));
      const p = add(t, away, reach);
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
      return { ...base, fov: 50, position: v3(clamp(p.x, inner.min.x, inner.max.x), clamp(t.y + 0.1, inner.min.y + 0.2, inner.max.y - 0.1), clamp(p.z, inner.min.z, inner.max.z)), lookAt: t };
    }
    default:
      return null;
  }
}

/** Retry cameras for a blank view, most specific first (at most two are used). */
export function retryFrames(o, frame) {
  const out = [];
  const dir = direction(o.az, o.el);
  if (o.interior && frame.mode === "interior") out.push(cutaway(o, dir));
  out.push(exterior({ ...o, fit: true }, boxCenter(o.box), dir));
  out.push(exterior({ ...o, fit: true }, boxCenter(o.box), direction(35, 25)));
  return out;
}

/**
 * Pixel statistics of an RGBA buffer (sampled): luminance standard deviation (0..255) and the share of the most common
 * colour (quantised to 8 levels per channel). A render is blank when it is (nearly) one flat colour.
 * Same rule as src/core/workshop3d/png.ts (the controller checks the PNG again).
 */
export function pixelStats(rgba, step = 7) {
  let n = 0, s = 0, s2 = 0;
  const bins = new Map();
  for (let i = 0; i + 3 < rgba.length; i += 4 * step) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    s += l; s2 += l * l; n++;
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  if (n === 0) return { std: 0, dominant: 1 };
  const mean = s / n;
  let top = 0;
  for (const v of bins.values()) top = Math.max(top, v);
  return { std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), dominant: top / n };
}
export const BLANK_STD = 3;
export const BLANK_DOMINANT = 0.975;
export const isBlank = (st) => st.std < BLANK_STD || st.dominant > BLANK_DOMINANT;
