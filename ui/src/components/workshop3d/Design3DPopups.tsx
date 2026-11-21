import { useEffect, useState } from "react";
import { api } from "../../api";
import type { ArtifactRecord, Design3DKit } from "../../types";
import { Design3DPanel } from "./Design3DPanel";
import { Design3DFloorPanel } from "./Design3DFloorPanel";

/** "Tạo mẫu mới" popup: the request sheet; creating a session hands its slug back (App opens the room). */
export function Design3DPopup(props: { kit: Design3DKit | null; onCreated: (slug: string) => void; onClose: () => void }) {
  return <Design3DPanel kit={props.kit} onCreated={props.onCreated} onClose={props.onClose} />;
}

/** Floor popup of an old 3D design run: lists its 3D model files. */
export function Design3DFloorPopup(props: { runId: string; title?: string | undefined; onOpenRun: (runId: string) => void; onClose: () => void }) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .getRun(props.runId)
      .then((m) => {
        if (alive) setArtifacts(m.artifacts);
      })
      .catch(() => {
        if (alive) setArtifacts([]);
      });
    return () => {
      alive = false;
    };
  }, [props.runId]);
  return (
    <Design3DFloorPanel
      runId={props.runId}
      {...(props.title ? { title: props.title } : {})}
      artifacts={artifacts}
      onOpenRun={props.onOpenRun}
      onOpenFile={(id, rel) => void api.openOutput(id, rel).catch(() => undefined)}
      onClose={props.onClose}
    />
  );
}
