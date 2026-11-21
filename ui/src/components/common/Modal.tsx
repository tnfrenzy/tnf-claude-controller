import { useEffect } from "react";
import type { ReactNode } from "react";
import { useT } from "../../i18n";

export function Modal(props: { title: string; sub?: string; size?: "normal" | "large"; onClose: () => void; children: ReactNode }) {
  const { t } = useT();
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ss-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={props.size === "large" ? "ss-modal ss-modal-lg" : "ss-modal"} role="dialog" aria-modal="true" aria-label={props.title}>
        <header>
          <h3>{props.title}</h3>
          {props.sub ? <span className="fine">{props.sub}</span> : null}
          <button type="button" className="icon-btn" title={t.modal_close} aria-label={t.modal_close} onClick={onClose} style={{ marginLeft: "auto" }}>✕</button>
        </header>
        <div className="ss-body">{props.children}</div>
      </div>
    </div>
  );
}
