/**
 * Minimal PNG reader/writer (8-bit grey/RGB/RGBA, non-interlaced: what Chrome's canvas.toBlob writes) and the
 * "blank render" rule shared with tools/workshop3d/render/camera.js (pixelStats / isBlank, same thresholds).
 */
import zlib from "node:zlib";

export interface RawImage { width: number; height: number; /** RGBA, 4 bytes per pixel */ data: Uint8Array }
export interface PixelStats { std: number; dominant: number }

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const BLANK_STD = 3;
export const BLANK_DOMINANT = 0.975;

/** Decode a PNG; null when it is not one this reader supports (callers then skip the blank check). */
export function decodePng(buf: Uint8Array): RawImage | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 33 || !b.subarray(0, 8).equals(SIG)) return null;
  let o = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (o + 8 <= b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString("latin1", o + 4, o + 8);
    const body = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colour = body[9]!;
      interlace = body[12]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const channels = colour === 6 ? 4 : colour === 2 ? 3 : colour === 0 ? 1 : 0;
  if (!width || !height || depth !== 8 || interlace !== 0 || channels === 0 || width * height > 64_000_000) return null;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const up = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let p: number;
      if (f === 0) p = 0;
      else if (f === 1) p = a;
      else if (f === 2) p = up;
      else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      } else return null;
      line[x] = (line[x]! + p) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (channels === 1) out[i] = out[i + 1] = out[i + 2] = line[x]!;
      else for (let k = 0; k < 3; k++) out[i + k] = line[x * channels + k]!;
      out[i + 3] = channels === 4 ? line[x * 4 + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const v of b) c = CRC_TABLE[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

/** Encode RGBA pixels as a PNG (filter 0). Used by tests and fakes. */
export function encodePng(img: RawImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) Buffer.from(img.data.buffer, img.data.byteOffset + y * img.width * 4, img.width * 4).copy(raw, y * (img.width * 4 + 1) + 1);
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Luminance std (0..255) and share of the most common colour (8 levels per channel), sampling every `step` pixel. */
export function pixelStats(rgba: Uint8Array, step = 7): PixelStats {
  let n = 0, s = 0, s2 = 0;
  const bins = new Map<number, number>();
  for (let i = 0; i + 3 < rgba.length; i += 4 * step) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    s += l;
    s2 += l * l;
    n++;
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }
  if (n === 0) return { std: 0, dominant: 1 };
  const mean = s / n;
  let top = 0;
  for (const v of bins.values()) top = Math.max(top, v);
  return { std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), dominant: top / n };
}

export const isBlank = (st: PixelStats): boolean => st.std < BLANK_STD || st.dominant > BLANK_DOMINANT;

/** Stats of a PNG file's pixels, or null when the PNG cannot be read. */
export function pngStats(buf: Uint8Array): PixelStats | null {
  const img = decodePng(buf);
  return img ? pixelStats(img.data) : null;
}
