import { Suspense, lazy, useState } from "react";
import { useT } from "../../i18n";
import type { ArtifactRecord } from "../../types";
import { Modal } from "../common/Modal";

const Model3DViewer = lazy(() => import("./Model3DViewer"));

const MODEL_EXT = /\.(step|stp|stl|glb|gltf|obj)$/i;

/** Keep only 3D model files (by rel_path extension, case-insensitive). */
export function filter3DFiles(artifacts: ArtifactRecord[]): ArtifactRecord[] {
  return artifacts.filter((a) => MODEL_EXT.test(a.rel_path));
}

function baseName(relPath: string): string {
  const parts = relPath.split(/[\\/]/);
  return parts[parts.length - 1] || relPath;
}

/** File list + viewer of one run's 3D model files (the body of the floor popup, also the "Tệp" tab of the workshop popup). */
export function Design3DFilesBody(props: {
  runId: string;
  artifacts: ArtifactRecord[];
  onOpenRun: (runId: string) => void;
  onOpenFile: (runId: string, relPath: string) => void;
}) {
  const { t } = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const files = filter3DFiles(props.artifacts);
  return (
    <>
      <button type="button" onClick={() => props.onOpenRun(props.runId)}>{t.d3p_open_run}</button>
      {files.length === 0 ? (
        <div className="fine">{t.d3p_no_files}</div>
      ) : (
        <ul className="d3p-files">
          {files.map((a) => (
            <li key={a.rel_path} data-file={a.rel_path}>
              <span>{baseName(a.rel_path)}</span>{" "}
              <button type="button" data-view={a.rel_path} onClick={() => setSelected(selected === a.rel_path ? null : a.rel_path)}>
                {selected === a.rel_path ? t.d3p_viewer_close_viewer : t.d3p_viewer_view}
              </button>{" "}
              <button type="button" onClick={() => props.onOpenFile(props.runId, a.rel_path)}>{t.d3p_open_file}</button>
            </li>
          ))}
        </ul>
      )}
      {selected !== null && files.some((a) => a.rel_path === selected) && (
        <Suspense fallback={<div className="fine">{t.d3p_viewer_loading}</div>}>
          <Model3DViewer key={`${props.runId}:${selected}`} runId={props.runId} relPath={selected} onOpenFile={props.onOpenFile} />
        </Suspense>
      )}
    </>
  );
}

export function Design3DFloorPanel(props: {
  runId: string;
  title?: string;
  artifacts: ArtifactRecord[];
  onOpenRun: (runId: string) => void;
  onOpenFile: (runId: string, relPath: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Modal title={props.title ?? t.d3p_floor_title} sub={t.d3p_floor_desc} onClose={props.onClose}>
      <Design3DFilesBody runId={props.runId} artifacts={props.artifacts} onOpenRun={props.onOpenRun} onOpenFile={props.onOpenFile} />
    </Modal>
  );
}
