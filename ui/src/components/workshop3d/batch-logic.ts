// Pure logic + strings of the "Tạo hàng loạt" tab (MaterialLibraryPanel). Own dictionary (vi + en) so the shared
// i18n.ts is not touched by this feature.
import type { Lang } from "../../i18n";

export interface SizeMm { w: number; d: number; h: number }
export interface BatchCategory { id: string; kind: "material" | "part"; ready: boolean; defaultSize: SizeMm }
export interface LibraryEntry {
  id: string;
  name: string;
  category: string;
  kind: "material" | "part";
  materialKind: string;
  size_mm: SizeMm;
  source: string;
  session: string | null;
  tile_cm: number;
  mapping: "tile" | "fit";
  created: string;
  files: string[];
}
export type ItemState = "queued" | "running" | "done" | "failed";
export interface BatchItem { index: number; source: string; name: string; state: ItemState; id?: string; error?: string; stats?: Record<string, unknown>; ms?: number }
export interface BatchStatus { id: string; category: string; size_mm: SizeMm; tile_cm: number; origin: "upload" | "dir"; created: string; done: boolean; costUsd: number; items: BatchItem[] }
export interface LibraryList { items: LibraryEntry[]; categories: BatchCategory[]; batches: BatchStatus[]; limits: { upload: number; dir: number; imageBytes: number }; localDir: boolean }
export type Mapping = "auto" | "tile" | "fit";

export const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

/** Client-side check before uploading: count, type by name, size. Returns a message key + values, or null. */
export function checkFiles(files: { name: string; size: number }[], limits: { upload: number; imageBytes: number }): { key: keyof typeof VI; vars?: Record<string, string> } | null {
  if (files.length === 0) return { key: "mb_err_none" };
  if (files.length > limits.upload) return { key: "mb_err_many", vars: { n: String(limits.upload) } };
  const badType = files.find((f) => !IMAGE_RE.test(f.name));
  if (badType) return { key: "mb_err_type", vars: { name: badType.name } };
  const big = files.find((f) => f.size > limits.imageBytes);
  if (big) return { key: "mb_err_big", vars: { name: big.name } };
  return null;
}

/** Entry name the server will give an image: its file name without the extension. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function batchSummary(b: BatchStatus): { done: number; failed: number; total: number; running: string | null } {
  const done = b.items.filter((i) => i.state === "done").length;
  const failed = b.items.filter((i) => i.state === "failed").length;
  const running = b.items.find((i) => i.state === "running")?.source ?? null;
  return { done, failed, total: b.items.length, running };
}

export function sizeLabel(s: SizeMm): string {
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${f(s.w)} × ${f(s.d)} × ${f(s.h)} mm`;
}

/** Parse the three size inputs; null when one is not a positive number in range. */
export function parseSizeInputs(w: string, d: string, h: string): SizeMm | null {
  const n = (v: string, lo: number, hi: number) => {
    const x = Number(v.replace(",", "."));
    return Number.isFinite(x) && x >= lo && x <= hi ? x : null;
  };
  const W = n(w, 10, 5000);
  const D = n(d, 10, 5000);
  const H = n(h, 1, 500);
  return W === null || D === null || H === null ? null : { w: W, d: D, h: H };
}

export function fill(s: string, vars: Record<string, string> = {}): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

const VI = {
  mb_tab: "Tạo hàng loạt",
  mb_intro: "Mỗi ảnh thành một mẫu; tên mẫu lấy từ tên tệp ảnh; mọi mẫu trong lô cùng một kích thước.",
  mb_category: "Loại",
  mb_cat_stone: "Đá sàn / vật liệu",
  mb_cat_handrail: "Tay vịn",
  mb_cat_ceiling: "Trần giả",
  mb_cat_button: "Nút bấm",
  mb_cat_panel_frame: "Khung bao bảng",
  mb_cat_control_cabinet: "Tủ điều khiển",
  mb_soon: "sắp có",
  mb_size: "Kích thước chung của lô (mm)",
  mb_w: "Rộng",
  mb_d: "Sâu",
  mb_h: "Dày",
  mb_tile: "Ô vân (cm)",
  mb_tile_hint: "Một ô vân lặp phủ bao nhiêu cm (chỉ dùng khi phủ kiểu lặp vân).",
  mb_mapping: "Cách phủ",
  mb_map_auto: "Tự chọn",
  mb_map_tile: "Lặp vân",
  mb_map_fit: "Trọn mẫu (một lần)",
  mb_cost: "Chi phí ước tính: 0 $ (đường nhanh bằng mã, không gọi AI, không tốn hạn mức)",
  mb_pick: "Chọn ảnh (PNG, JPG, WEBP)",
  mb_picked: "{n} ảnh đã chọn",
  mb_start: "Tạo {n} mẫu",
  mb_dir: "Nhập từ thư mục trên máy này",
  mb_dir_ph: "D:\\Anh\\Da San",
  mb_dir_start: "Nhập thư mục",
  mb_dir_remote: "Nhập từ thư mục chỉ dùng được trên máy chạy app.",
  mb_uploading: "Đang tải lên {i}/{n}…",
  mb_batch: "Lô {id}: {done}/{total} xong, {failed} lỗi",
  mb_batch_size: "Kích thước chung: {size} · {n} ảnh · chi phí 0 $",
  mb_state_queued: "Chờ",
  mb_state_running: "Đang dựng",
  mb_state_done: "Xong",
  mb_state_failed: "Lỗi",
  mb_empty: "Thư viện chưa có mẫu nào.",
  mb_library: "Thư viện ({n})",
  mb_view3d: "Xem 3D",
  mb_close3d: "Đóng bàn xem",
  mb_rename: "Đổi tên",
  mb_save: "Lưu",
  mb_cancel: "Hủy",
  mb_delete: "Xóa",
  mb_delete_confirm: "Xóa mẫu \"{name}\" khỏi thư viện? Không hoàn tác được.",
  mb_tile_apply: "Áp dụng",
  mb_map_label_tile: "lặp vân {cm} cm",
  mb_map_label_fit: "trọn mẫu",
  mb_source: "Ảnh gốc: {name}",
  mb_err_none: "Chưa chọn ảnh nào.",
  mb_err_many: "Tối đa {n} ảnh mỗi lô tải lên.",
  mb_err_type: "{name}: chỉ nhận PNG, JPG, WEBP.",
  mb_err_big: "{name}: ảnh quá 10 MB.",
  mb_err_size: "Kích thước không hợp lệ (Rộng, Sâu 10–5000 mm; Dày 1–500 mm).",
  mb_loading: "Đang tải thư viện…",
};
const EN: typeof VI = {
  mb_tab: "Batch create",
  mb_intro: "Each photo becomes one item; the item name is the file name; every item of a batch shares one size.",
  mb_category: "Type",
  mb_cat_stone: "Floor stone / material",
  mb_cat_handrail: "Handrail",
  mb_cat_ceiling: "False ceiling",
  mb_cat_button: "Push button",
  mb_cat_panel_frame: "Panel frame",
  mb_cat_control_cabinet: "Control cabinet",
  mb_soon: "coming soon",
  mb_size: "Shared batch size (mm)",
  mb_w: "Width",
  mb_d: "Depth",
  mb_h: "Thickness",
  mb_tile: "Tile (cm)",
  mb_tile_hint: "How many cm one repeated texture tile covers (tiled mapping only).",
  mb_mapping: "Mapping",
  mb_map_auto: "Automatic",
  mb_map_tile: "Repeat texture",
  mb_map_fit: "Whole design (once)",
  mb_cost: "Estimated cost: $0 (code-only fast path, no AI, no quota)",
  mb_pick: "Choose photos (PNG, JPG, WEBP)",
  mb_picked: "{n} photos selected",
  mb_start: "Create {n} items",
  mb_dir: "Import a folder on this PC",
  mb_dir_ph: "D:\\Photos\\Stone",
  mb_dir_start: "Import folder",
  mb_dir_remote: "Folder import only works on the PC running the app.",
  mb_uploading: "Uploading {i}/{n}…",
  mb_batch: "Batch {id}: {done}/{total} done, {failed} failed",
  mb_batch_size: "Shared size: {size} · {n} photos · cost $0",
  mb_state_queued: "Queued",
  mb_state_running: "Building",
  mb_state_done: "Done",
  mb_state_failed: "Failed",
  mb_empty: "The library is empty.",
  mb_library: "Library ({n})",
  mb_view3d: "View 3D",
  mb_close3d: "Close viewer",
  mb_rename: "Rename",
  mb_save: "Save",
  mb_cancel: "Cancel",
  mb_delete: "Delete",
  mb_delete_confirm: "Delete \"{name}\" from the library? This cannot be undone.",
  mb_tile_apply: "Apply",
  mb_map_label_tile: "tiled every {cm} cm",
  mb_map_label_fit: "whole design",
  mb_source: "Source photo: {name}",
  mb_err_none: "No photo selected.",
  mb_err_many: "At most {n} photos per uploaded batch.",
  mb_err_type: "{name}: only PNG, JPG, WEBP.",
  mb_err_big: "{name}: photo over 10 MB.",
  mb_err_size: "Invalid size (width, depth 10–5000 mm; thickness 1–500 mm).",
  mb_loading: "Loading the library…",
};
export type BatchDict = typeof VI;
export const BATCH_DICTS: Record<Lang, BatchDict> = { vi: VI, en: EN };

export function categoryLabel(d: BatchDict, id: string): string {
  const k = `mb_cat_${id.replace(/-/g, "_")}` as keyof BatchDict;
  return d[k] ?? id;
}
