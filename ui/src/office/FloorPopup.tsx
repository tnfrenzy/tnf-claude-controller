import { roleLabel, useT, type Dict, type Lang } from "../i18n";
import { QueuePanel } from "../components/queue/QueuePanel";
import { buildQueueLabels } from "../queue/queue-labels";
import { showQueue } from "./floors";
import { SHARED_PROJECT } from "./iso/floors";
import { latestDoneCodingRun } from "./stage";
import { useProjectRun } from "./useProjectRun";

/** Modal title of a floor popup: "Tầng 1 · TNF". Single definition; empty name = default floor. Pure. */
export function floorTitle(n: number, name: string, t: Pick<Dict, "city_floor">): string {
  return `${t.city_floor} ${n} · ${name || SHARED_PROJECT}`;
}

/** Run id shown in the floor's isometric office; null = idle office. Pure. */
export function floorOfficeRunId(run: { id: string } | null): string | null {
  return run ? run.id : null;
}

/** "a → b → c" from role ids (labels via roleLabel); empty array gives "". Pure. */
export function flowText(roles: readonly string[], lang: Lang = "vi"): string {
  return roles.map((r) => roleLabel(r, lang)).join(" → ");
}

/** Content of the large floor popup: role flow, run link and the idea/queue panel. Polls only while mounted. */
export function FloorPopup(props: { projectName: string; floorNo: number; hasRepo?: boolean; onOpenRun: (runId: string) => void; onClose: () => void }) {
  const { t, lang } = useT();
  const { run, runs, roles } = useProjectRun(props.projectName, true);
  const runId = run ? run.id : null;
  const shown = runId ?? latestDoneCodingRun(runs);
  const flow = flowText(roles, lang);
  return (
    <div className="floor-popup" data-floor={props.floorNo}>
      <div className="floor-flow muted">
        <span>{t.floor_flow}</span> {flow}
        {shown ? (
          <button type="button" className="stage-tab release" onClick={() => props.onOpenRun(shown)}>{t.nav_runs} · {shown}</button>
        ) : null}
      </div>
      {props.hasRepo && showQueue(props.projectName, "repo") ? (
        <div className="floor-queue">
          <QueuePanel project={props.projectName} labels={buildQueueLabels(t)} />
          <p className="muted floor-queue-note">{t.queue_estimate_note}</p>
        </div>
      ) : null}
    </div>
  );
}
