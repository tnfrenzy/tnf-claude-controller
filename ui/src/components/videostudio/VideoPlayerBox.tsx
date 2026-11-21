import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";

/**
 * Plays a rendered file of a Video Studio project. The file route needs the token header, so the file is fetched as a
 * blob and played from an object URL (released on unmount or when the file changes).
 * `stamp` changes when the file was rewritten (same name, new content) so it is fetched again.
 */
export function VideoPlayerBox(props: { slug: string; rel: string; stamp?: string; autoLoad?: boolean; label?: string }) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">(props.autoLoad === false ? "idle" : "loading");
  const [wanted, setWanted] = useState(props.autoLoad !== false);
  const current = useRef<string | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    setState("loading");
    api
      .videoStudioFile(props.slug, props.rel)
      .then((blob) => {
        if (!alive) return;
        const next = URL.createObjectURL(blob);
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
        setState("idle");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [props.slug, props.rel, props.stamp, wanted]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = null;
    },
    [],
  );

  if (!wanted) {
    return (
      <button type="button" className="vs-pv-watch" onClick={() => setWanted(true)}>
        {props.label ?? t["vs_pv_watch"]}
      </button>
    );
  }
  if (state === "error") return <p className="vs-room-error">{t["vs_pv_load_error"]}</p>;
  if (!url) return <p className="muted">{t["vs_pv_loading"]}</p>;
  return <video className="vs-pv-player" src={url} controls preload="metadata" />;
}
