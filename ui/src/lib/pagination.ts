export const HISTORY_PAGE_SIZE = 10;

/** Number of pages for `total` items; always at least 1. */
export function pageCount(total: number, size: number): number {
  if (!(size > 0) || !(total > 0)) return 1;
  return Math.max(1, Math.ceil(total / size));
}

/** Zero-based row offset of a 1-based page. */
export function pageOffset(page: number, size: number): number {
  return Math.max(0, Math.floor(page) - 1) * size;
}

/** Keep a 1-based page inside [1, pageCount]. */
export function clampPage(page: number, total: number, size: number): number {
  const n = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, n), pageCount(total, size));
}
