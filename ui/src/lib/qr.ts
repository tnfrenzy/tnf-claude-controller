// Minimal QR Code generator (byte mode, error correction L, versions 1-6, up to 134 bytes). No dependencies.
// Written from the QR spec (ISO/IEC 18004): GF(256) Reed-Solomon with 0x11D, finder/timing/alignment patterns, 8 masks,
// BCH(15,5) format information. Enough for a link with a token; longer text returns null (show the link instead).

const VERSIONS: Record<number, { data: number; ec: number; blocks: number }> = {
  1: { data: 19, ec: 7, blocks: 1 },
  2: { data: 34, ec: 10, blocks: 1 },
  3: { data: 55, ec: 15, blocks: 1 },
  4: { data: 80, ec: 20, blocks: 1 },
  5: { data: 108, ec: 26, blocks: 1 },
  6: { data: 136, ec: 18, blocks: 2 }, // 2 blocks of 68 data + 18 ec each
};
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

export const QR_MAX_BYTES = 134;

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const gmul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ gmul(poly[j]!, 1);
      next[j + 1] = next[j + 1]! ^ gmul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** Remainder of data(x) * x^degree divided by the generator: the error correction codewords. */
export function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem[0]!;
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] = rem[i]! ^ gmul(gen[i + 1]!, factor);
  }
  return rem;
}

/** 15-bit format information for ECC level L and the given mask (0-7). */
export function formatBits(mask: number): number {
  const data = (1 << 3) | mask; // L = 01
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function dataCodewords(bytes: number[], version: number): number[] {
  const total = VERSIONS[version]!.data;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; out.length < total; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Data blocks interleaved, then the error correction blocks interleaved. */
export function interleave(data: number[], version: number): number[] {
  const { blocks, ec } = VERSIONS[version]!;
  const per = data.length / blocks;
  const dataBlocks: number[][] = [];
  for (let i = 0; i < blocks; i++) dataBlocks.push(data.slice(i * per, (i + 1) * per));
  const ecBlocks = dataBlocks.map((b) => rsRemainder(b, ec));
  const out: number[] = [];
  for (let i = 0; i < per; i++) for (const b of dataBlocks) out.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]!);
  return out;
}

export interface QrLayout {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

/** Everything but the data and format bits: finders, separators, timing, alignment, dark module; format area reserved. */
export function baseLayout(version: number): QrLayout {
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = ALIGN[version]!;
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Reserve the format areas (written later) and the always-dark module.
  for (let i = 0; i < 9; i++) {
    isFunction[8]![i] = true;
    isFunction[i]![8] = true;
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8]![size - 1 - i] = true;
    isFunction[size - 1 - i]![8] = true;
  }
  set(8, size - 8, true);
  return { size, modules, isFunction };
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Walk the data modules in the QR zigzag order, calling `visit(x, y, index)` for each data bit position. */
export function forEachDataModule(layout: QrLayout, visit: (x: number, y: number, i: number) => void): void {
  const { size, isFunction } = layout;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y]![x]) visit(x, y, i++);
      }
    }
  }
}

function withFormat(modules: boolean[][], size: number, mask: number): boolean[][] {
  const m = modules.map((r) => r.slice());
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const put = (x: number, y: number, v: boolean) => {
    m[y]![x] = v;
  };
  for (let i = 0; i <= 5; i++) put(8, i, bit(i));
  put(8, 7, bit(6));
  put(8, 8, bit(7));
  put(7, 8, bit(8));
  for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
  put(8, size - 8, true);
  return m;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  const run = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < n; a++) {
      let len = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) len++;
        else {
          if (len >= 5) score += 3 + (len - 5);
          len = 1;
        }
      }
    }
  };
  run((a, b) => m[a]![b]!);
  run((a, b) => m[b]![a]!);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) score += 3;
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/** Module matrix (true = dark) for the text, or null when it does not fit in version 6 (134 bytes). */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = [1, 2, 3, 4, 5, 6].find((v) => bytes.length <= VERSIONS[v]!.data - 2);
  if (!version) return null;
  const codewords = interleave(dataCodewords(bytes, version), version);
  const layout = baseLayout(version);
  const bitAt = (i: number) => ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
  forEachDataModule(layout, (x, y, i) => {
    layout.modules[y]![x] = i < codewords.length * 8 ? bitAt(i) : false;
  });
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = layout.modules.map((r) => r.slice());
    for (let y = 0; y < layout.size; y++) for (let x = 0; x < layout.size; x++) if (!layout.isFunction[y]![x] && MASKS[mask]!(x, y)) m[y]![x] = !m[y]![x];
    const done = withFormat(m, layout.size, mask);
    const s = penalty(done);
    if (s < bestScore) {
      bestScore = s;
      best = done;
    }
  }
  return best;
}
