// src/core/workshop3d/attachments.ts — reference images of a 3D session, staged with POST /api/inbox before the session exists.
// Same name rule as every inbox file (validateInboxName); only PNG/JPEG/WebP, checked by extension AND magic bytes.
import fs from "node:fs";
import path from "node:path";
import { INBOX_MAX_BYTES, validateInboxName } from "../run/inbox.js";

export const W3D_IMAGE_LIMITS = {
  /** Images per session (the roles get all of them). */
  files: 5,
  /** Per image: the inbox upload limit. */
  fileBytes: INBOX_MAX_BYTES,
  /** All images together. */
  totalBytes: 15 * 1024 * 1024,
} as const;

export class W3DAttachmentError extends Error {}

const EXT_RE = /\.(png|jpe?g|webp)$/i;

/** Kind of image from its first bytes, or null. */
export function imageKind(data: Buffer): "png" | "jpeg" | "webp" | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Validate one image (name, type, size). Throws W3DAttachmentError with a Vietnamese message. */
export function checkW3DImage(name: string, data: Buffer): void {
  const bad = validateInboxName(name);
  if (bad) throw new W3DAttachmentError(`Tên ảnh "${name.slice(0, 80)}" không hợp lệ: ${bad}`);
  const m = EXT_RE.exec(name);
  if (!m) throw new W3DAttachmentError(`Ảnh "${name}" phải là PNG, JPG hoặc WebP.`);
  if (data.length === 0) throw new W3DAttachmentError(`Ảnh "${name}" rỗng.`);
  if (data.length > W3D_IMAGE_LIMITS.fileBytes) throw new W3DAttachmentError(`Ảnh "${name}" quá lớn (tối đa ${W3D_IMAGE_LIMITS.fileBytes / 1024 / 1024} MB mỗi ảnh).`);
  const kind = imageKind(data);
  const ext = m[1]!.toLowerCase() === "jpg" ? "jpeg" : m[1]!.toLowerCase();
  if (kind !== ext) throw new W3DAttachmentError(`Nội dung tệp "${name}" không phải ảnh ${ext.toUpperCase()} hợp lệ.`);
}

/** Validate a set of images: count, each image, total size. Returns them unchanged (bytes). */
export function checkW3DImages(files: Record<string, Buffer>): Record<string, Buffer> {
  const names = Object.keys(files);
  if (names.length > W3D_IMAGE_LIMITS.files) throw new W3DAttachmentError(`Tối đa ${W3D_IMAGE_LIMITS.files} ảnh mẫu cho một phiên dựng 3D.`);
  let total = 0;
  for (const n of names) {
    checkW3DImage(n, files[n]!);
    total += files[n]!.length;
  }
  if (total > W3D_IMAGE_LIMITS.totalBytes) throw new W3DAttachmentError(`Tổng dung lượng ảnh mẫu tối đa ${W3D_IMAGE_LIMITS.totalBytes / 1024 / 1024} MB.`);
  return files;
}

/** Read and validate the images of a staging dir (`<stageDir>/inbox/*`, written by POST /api/inbox). */
export function readStagedW3DImages(stageDir: string): Record<string, Buffer> {
  const dir = path.join(stageDir, "inbox");
  if (!fs.existsSync(stageDir)) throw new W3DAttachmentError("Không tìm thấy ảnh đã tải lên (mã đính kèm không tồn tại hoặc đã dùng).");
  const out: Record<string, Buffer> = {};
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.length > W3D_IMAGE_LIMITS.files) throw new W3DAttachmentError(`Tối đa ${W3D_IMAGE_LIMITS.files} ảnh mẫu cho một phiên dựng 3D.`);
  for (const e of entries) {
    if (!e.isFile()) throw new W3DAttachmentError(`"${e.name}" không phải tệp.`);
    const file = path.join(dir, e.name);
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) throw new W3DAttachmentError(`"${e.name}" không hợp lệ.`);
    if (st.size > W3D_IMAGE_LIMITS.fileBytes) throw new W3DAttachmentError(`Ảnh "${e.name}" quá lớn (tối đa ${W3D_IMAGE_LIMITS.fileBytes / 1024 / 1024} MB mỗi ảnh).`);
    out[e.name] = fs.readFileSync(file);
  }
  return checkW3DImages(out);
}
