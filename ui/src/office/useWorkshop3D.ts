import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Workshop3DListItem, Workshop3DSession } from "../types";
import { w3dTerminal } from "./workshop3d-session";

/** Pick the session of a floor: exact slug match, else the most recently updated one (pure). */
export function pickWorkshop3DSlug(list: readonly Workshop3DListItem[], prefer?: string): string | null {
  if (!list.length) return null;
  const exact = prefer ? list.find((s) => s.slug === prefer) : undefined;
  if (exact) return exact.slug;
  const time = (s: Workshop3DListItem): number => {
    const v = s.updatedAt;
    const n = typeof v === "number" ? v : v ? Date.parse(v) : 0;
    return Number.isFinite(n) ? n : 0;
  };
  return [...list].sort((a, b) => time(b) - time(a))[0]!.slug;
}

export interface Workshop3DData {
  slug: string | null;
  title: string;
  session: Workshop3DSession | null;
  /** false while the API answered an error and nothing was loaded yet: the room shows its friendly empty state. */
  available: boolean;
  loading: boolean;
  /** Last API error message (e.g. a 503 while the engine is unavailable); null after a good answer. */
  error: string | null;
}

/**
 * Polls GET /api/workshop3d/:slug every ~3 s (without a slug: the most recent session of GET /api/workshop3d).
 * Polling pauses in done / failed / stopped; `reload()` (after an action) fetches at once and wakes it up again.
 * Keeps the last good data and never throws.
 */
export function useWorkshop3D(prefer?: string, intervalMs = 3000, enabled = true): Workshop3DData & { reload: () => void } {
  const [data, setData] = useState<Workshop3DData>({ slug: null, title: "", session: null, available: false, loading: true, error: null });
  const terminal = useRef(false);
  const alive = useRef(true);
  const load = useCallback(async (): Promise<void> => {
    try {
      let slug = prefer ?? null;
      let listTitle: string | undefined;
      if (!slug) {
        const list = (await api.workshop3dList()).sessions ?? [];
        slug = pickWorkshop3DSlug(list);
        listTitle = list.find((s) => s.slug === slug)?.title;
      }
      if (!slug) {
        if (alive.current) setData({ slug: null, title: "", session: null, available: true, loading: false, error: null });
        return;
      }
      const session = await api.workshop3dGet(slug);
      terminal.current = w3dTerminal(session.snapshot?.state ?? "");
      const title = session.brief?.title ?? listTitle ?? slug;
      if (alive.current) setData({ slug, title, session, available: true, loading: false, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (alive.current) setData((d) => ({ ...d, available: d.session !== null, loading: false, error: msg }));
    }
  }, [prefer]);
  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    terminal.current = false;
    void load();
    const id = setInterval(() => {
      if (!document.hidden && !terminal.current) void load();
    }, intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load, intervalMs, enabled]);
  const reload = useCallback(() => {
    terminal.current = false;
    void load();
  }, [load]);
  return { ...data, reload };
}
