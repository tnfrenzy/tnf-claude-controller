import { describe, expect, it } from "vitest";
import { baseLayout, forEachDataModule, formatBits, qrMatrix, rsRemainder } from "../../ui/src/lib/qr";

const bin = (n: number) => n.toString(2).padStart(15, "0");

describe("qr primitives against known values", () => {
  it("format information for ECC L matches the QR spec table", () => {
    const spec = ["111011111000100", "111001011110011", "111110110101010", "111100010011101", "110011000101111", "110001100011000", "110110001000001", "110100101110110"];
    for (let m = 0; m < 8; m++) expect(bin(formatBits(m)), `mask ${m}`).toBe(spec[m]);
  });
  it("Reed-Solomon matches the well-known HELLO WORLD 1-M example", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

/** Independent reader: format bits -> mask -> unmask -> zigzag -> de-interleave -> byte mode text. */
function decode(m: boolean[][], version: number, blocks: number, ecLen: number): string {
  const size = m.length;
  const bits = (xs: Array<[number, number]>) => xs.reduce((acc, [x, y], i) => acc | ((m[y]![x] ? 1 : 0) << i), 0);
  const first: Array<[number, number]> = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const read = bits(first);
  const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => formatBits(k) === read);
  expect(mask, "format bits readable").toBeDefined();
  const masks = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const layout = baseLayout(version);
  expect(layout.size).toBe(size);
  const stream: number[] = [];
  forEachDataModule(layout, (x, y, i) => {
    const v = m[y]![x]! !== masks[mask!]!(x, y);
    if (i % 8 === 0) stream.push(0);
    stream[stream.length - 1] = (stream[stream.length - 1]! << 1) | (v ? 1 : 0);
  });
  // Versions 2-6 end with 7 remainder bits that carry no codeword.
  const total = Math.floor(stream.length - (m.flat().length > 0 && version >= 2 ? 1 : 0));
  const dataLen = total - ecLen * blocks;
  const per = dataLen / blocks;
  const dataBlocks: number[][] = Array.from({ length: blocks }, () => []);
  for (let i = 0; i < per; i++) for (let b = 0; b < blocks; b++) dataBlocks[b]!.push(stream[i * blocks + b]!);
  const ecBlocks: number[][] = Array.from({ length: blocks }, () => []);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < blocks; b++) ecBlocks[b]!.push(stream[dataLen + i * blocks + b]!);
  for (let b = 0; b < blocks; b++) expect(rsRemainder(dataBlocks[b]!, ecLen), `block ${b} error correction`).toEqual(ecBlocks[b]);
  const data = dataBlocks.flat();
  const all = data.map((c) => c.toString(2).padStart(8, "0")).join("");
  expect(all.slice(0, 4)).toBe("0100");
  const len = parseInt(all.slice(4, 12), 2);
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(parseInt(all.slice(12 + i * 8, 20 + i * 8), 2));
  return new TextDecoder().decode(new Uint8Array(out));
}

describe("qrMatrix", () => {
  const cases: Array<[string, number, number, number]> = [
    ["http://a", 1, 1, 7],
    ["https://example.com/#token=0123456789abcdef", 3, 1, 15],
    ["https://<machine>.<tailnet>.ts.net/#token=13c5699ee999e49afaa6e44d727fb9e1b8b5cf3396f21d68", 5, 1, 26],
    ["x".repeat(134), 6, 2, 18],
  ];
  for (const [text, version, blocks, ec] of cases) {
    it(`encodes ${text.length} bytes in version ${version} and reads back`, () => {
      const m = qrMatrix(text);
      expect(m).not.toBeNull();
      expect(m!.length).toBe(17 + 4 * version);
      expect(decode(m!, version, blocks, ec)).toBe(text);
    });
  }
  it("returns null when the text does not fit", () => {
    expect(qrMatrix("x".repeat(135))).toBeNull();
  });
  it("has the three finder patterns and the dark module", () => {
    const m = qrMatrix("hello")!;
    const n = m.length;
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]] as const) {
      expect(m[cy]![cx]).toBe(true);
      expect(m[cy - 2]![cx]).toBe(false);
      expect(m[cy - 3]![cx]).toBe(true);
    }
    expect(m[n - 8]![8]).toBe(true);
  });
});
