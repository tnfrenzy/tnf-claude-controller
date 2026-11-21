import { useEffect } from "react";
import { api } from "../api";
import { getToken } from "../api";
import { getNotify } from "../lib/prefs";
import { buildTitle, classifyFinish, diffFinished } from "./runWatch";

const POLL_MS = 4000;

/** App-level watcher: when a running run disappears, set the tab title and (if allowed) show a Notification. Works only while the page is open. */
export function useRunWatch(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const baseTitle = document.title;
    let prev: string[] | null = null;
    let stopped = false;
    const restore = () => {
      document.title = baseTitle;
    };
    const tick = async () => {
      if (stopped || !getNotify() || !getToken()) return;
      try {
        const { runs } = await api.listRuns({ status: "running" });
        const ids = runs.map((r) => r.id);
        if (prev !== null) {
          for (const id of diffFinished(prev, ids)) {
            try {
              const { run } = await api.getRun(id);
              const kind = classifyFinish(run);
              if (!kind) continue;
              const title = buildTitle(kind, run.project || "default");
              document.title = title;
              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                new Notification(title);
              }
            } catch {
              /* ignore a single failed lookup */
            }
          }
        }
        prev = ids;
      } catch {
        /* network blip: keep previous snapshot */
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    addEventListener("focus", restore);
    return () => {
      stopped = true;
      clearInterval(timer);
      removeEventListener("focus", restore);
      restore();
    };
  }, [enabled]);
}
