import { useState } from "react";
import { useT } from "../../i18n";
import type { MergePrecheck } from "../../types";

export const MAX_FILES = 20;

export type MergePrecheckTone = "ok" | "err" | "muted";

/** Only "clean" is ever ok; unknown and unexpected statuses stay muted. */
export function mergePrecheckTone(status: string): MergePrecheckTone {
  if (status === "clean") return "ok";
  if (status === "conflict") return "err";
  return "muted";
}

export function MergePrecheckFiles({ files, open }: { files: string[]; open: boolean }) {
  const { t } = useT();
  if (!open) return null;
  const shown = files.slice(0, MAX_FILES);
  const extra = files.length - shown.length;
  return (
    <div>
      <div className="chips">
        {shown.map((f) => (
          <span key={f} className="chip">{f}</span>
        ))}
      </div>
      {extra > 0 ? <div className="muted">{t.mergePrecheck_moreFiles.split("{n}").join(String(extra))}</div> : null}
    </div>
  );
}

export function MergePrecheckBadge({
  precheck,
  onRecheck,
  compact,
}: {
  precheck?: MergePrecheck | null;
  onRecheck?: () => void;
  compact?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  if (compact) {
    if (!precheck) {
      return <span className="verdict muted">{t.mergePrecheck_none}</span>;
    }
    const cTone = mergePrecheckTone(precheck.status);
    const cFiles = Array.isArray(precheck.files) ? precheck.files : [];
    if (precheck.status === "clean") {
      return <span className={`verdict ${cTone}`}>✔ {t.mergePrecheck_clean}</span>;
    }
    if (precheck.status === "conflict") {
      const shown = cFiles.slice(0, MAX_FILES);
      const extra = cFiles.length - shown.length;
      let title: string;
      if (shown.length === 0) {
        title = precheck.reason || t.mergePrecheck_reasonEmpty;
      } else {
        title = shown.join(", ");
        if (extra > 0) title += ", " + t.mergePrecheck_moreFiles.split("{n}").join(String(extra));
      }
      return <span className={`verdict ${cTone}`} title={title}>✖ {t.mergePrecheck_conflict}</span>;
    }
    return (
      <span className={`verdict ${cTone}`} title={precheck.reason || t.mergePrecheck_reasonEmpty}>
        ? {t.mergePrecheck_unknown}
      </span>
    );
  }

  const recheck = onRecheck ? (
    <button type="button" onClick={onRecheck}>{t.mergePrecheck_recheck}</button>
  ) : null;

  if (!precheck) {
    return (
      <span>
        <span className="verdict muted">{t.mergePrecheck_none}</span> {recheck}
      </span>
    );
  }

  const tone = mergePrecheckTone(precheck.status);
  const files = Array.isArray(precheck.files) ? precheck.files : [];

  if (precheck.status === "clean") {
    return (
      <span>
        <span className={`verdict ${tone}`}>✔ {t.mergePrecheck_clean}</span> {recheck}
      </span>
    );
  }

  if (precheck.status === "conflict") {
    return (
      <div>
        <span className={`verdict ${tone}`}>✖ {t.mergePrecheck_conflict}</span>{" "}
        {files.length > 0 ? (
          <button type="button" onClick={() => setOpen((v) => !v)}>
            {open ? t.mergePrecheck_collapse : t.mergePrecheck_expand}
          </button>
        ) : null}{" "}
        {recheck}
        {files.length > 0 ? (
          <MergePrecheckFiles files={files} open={open} />
        ) : (
          <div className="muted">{precheck.reason || t.mergePrecheck_reasonEmpty}</div>
        )}
      </div>
    );
  }

  return (
    <div>
      <span className={`verdict ${tone}`}>? {t.mergePrecheck_unknown}</span> {recheck}
      <div className="muted">{precheck.reason || t.mergePrecheck_reasonEmpty}</div>
    </div>
  );
}
