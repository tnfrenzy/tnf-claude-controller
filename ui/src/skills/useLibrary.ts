import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { LibraryData } from "../types";

/** Loads /api/library once and exposes `reload` for after-edit refreshes. */
export function useLibrary(): { lib: LibraryData | null; error: string | null; reload: () => Promise<void> } {
  const [lib, setLib] = useState<LibraryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setLib(await api.library());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { lib, error, reload };
}
