import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import type { Workshop3DSession } from "../../types";
import { createWorkshop3DApi } from "./api";
import { hqImages, hqViewLabel } from "./logic";
import type { W3DApi } from "./types";

/** Object URLs of session images (token header), revoked on change / unmount. Missing files simply stay absent. */
function useImageUrls(api: W3DApi, paths: string[], rev: number): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    let dead = false;
    const made: string[] = [];
    setUrls({});
    for (const p of paths) {
      api.file(p).then((b) => {
        const u = URL.createObjectURL(b);
        if (dead) { URL.revokeObjectURL(u); return; }
        made.push(u);
        setUrls((prev) => ({ ...prev, [p]: u }));
      }).catch(() => undefined);
    }
    return () => { dead = true; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, rev]);
  return urls;
}

/** Popup tab "Ảnh render": the Blender images (zoomable, Vietnamese view names) and the geometry / final review scores. */
export function Workshop3DRenders(props: { slug: string; session: Workshop3DSession; onChanged: () => void; api?: W3DApi }) {
  const { t, lang } = useT();
  const api = useMemo(() => props.api ?? createWorkshop3DApi(props.slug), [props.api, props.slug]);
  const s = props.session.snapshot as Workshop3DSession["snapshot"] & {
    bestScore?: number | null; bestRound?: number | null; finalScores?: { beauty: number; detail: number; proportion: number; likeness?: number } | null;
  };
  const renders = Array.isArray(props.session.renders) ? props.session.renders.filter((x): x is string => typeof x === "string") : [];
  const hq = hqImages(renders);
  const [rev] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const urls = useImageUrls(api, hq, rev);
  const fs = s.finalScores;

  return (
    <div className="w3x" data-w3x="root">
      <section className="w3x-card" data-w3x="scores">
        <h4>{t.w3x_scores}</h4>
        <div className="w3x-scores">
          <div>
            <div className="fine">{t.w3x_geometry}</div>
            <strong>{typeof s.bestScore === "number" ? t.w3x_total.replace("{n}", String(s.bestScore)) : "—"}</strong>
            {typeof s.bestRound === "number" ? <span className="fine"> · {t.w3x_round.replace("{n}", String(s.bestRound))}</span> : null}
          </div>
          <div>
            <div className="fine">{t.w3x_final}</div>
            {fs ? (
              <strong>{`${t.w3x_beauty} ${fs.beauty} · ${t.w3x_detail} ${fs.detail} · ${t.w3x_proportion} ${fs.proportion}${typeof fs.likeness === "number" ? ` · ${t.w3x_likeness} ${fs.likeness}` : ""}`}</strong>
            ) : <strong>—</strong>}
          </div>
        </div>
      </section>

      <section className="w3x-card" data-w3x="gallery">
        <h4>{t.w3x_blender_images}</h4>
        {hq.length === 0 ? <div className="fine">{t.w3x_no_hq}</div> : (
          <div className="w3v-gallery">
            {hq.map((p) => (
              <figure key={p}>
                {urls[p] ? (
                  <button type="button" className="w3v-thumb" onClick={() => setOpen(p)} aria-label={hqViewLabel(p, lang)}>
                    <img src={urls[p]} alt={hqViewLabel(p, lang)} />
                  </button>
                ) : <div className="w3v-thumb w3v-thumb-wait fine">{t.w3v_loading}</div>}
                <figcaption className="fine">{hqViewLabel(p, lang)}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {open && urls[open] && (
        <div className="w3v-lightbox" role="dialog" onClick={() => setOpen(null)}>
          <img src={urls[open]} alt={hqViewLabel(open, lang)} />
          <button type="button" onClick={() => setOpen(null)}>{t.w3v_close}</button>
        </div>
      )}
    </div>
  );
}
