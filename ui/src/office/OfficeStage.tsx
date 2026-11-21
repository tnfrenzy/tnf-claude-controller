import { useMemo } from "react";
import { useT } from "../i18n";
import { OfficeRooms } from "../components/office/OfficeRooms";
import { canAddFloor, type Floor } from "./floors";
import { latestDoneCodingRun, pickStageFloor } from "./stage";
import { useProjectRun } from "./useProjectRun";

/**
 * Main screen: floor tabs on top, the four-room 2.5D office of the selected floor below.
 * Root is main.scene (grid cell itself, never wrapped in another .scene: 0.3.1 lesson).
 * Follows the newest running run of the project (polled every 3 s).
 */
export function OfficeStage(props: {
  floors: Floor[];
  total: number;
  selected: string;
  onSelect: (name: string) => void;
  onAddFloor: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const { t } = useT();
  const { floors, total, onSelect, onAddFloor, onOpenRun } = props;
  const project = pickStageFloor(floors, props.selected);
  const { run, runs } = useProjectRun(project, true);
  const runId = run ? run.id : null;
  const doneRun = useMemo(() => (runId ? null : latestDoneCodingRun(runs)), [runs, runId]);

  return (
    <main className="scene office-stage">
      <div className="stage-tabs" role="tablist">
        {floors.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={f.id === project} className={`stage-tab${f.id === project ? " on" : ""}`} onClick={() => onSelect(f.id)}>
            <span className={`dot${f.running ? "" : " idle"}`} /> {f.name}
          </button>
        ))}
        {canAddFloor(total) ? <button type="button" className="stage-tab add" onClick={onAddFloor}>＋ {t.ss_add_floor}</button> : null}
        {doneRun ? <button type="button" className="stage-tab release" onClick={() => onOpenRun(doneRun)}>{t.nav_runs} · {doneRun}</button> : null}
      </div>
      <div className="stage-office">
        {floors.length === 0 ? <div className="hint">{t.office_popup_empty}</div> : null}
        <OfficeRooms runs={run ? [{ id: run.id, project: run.project }] : []} running={!!run} />
      </div>
      <div className="floor-legend muted stage-legend">
        <span>{t.legend_idle}</span> · <span>{t.legend_working}</span> · <span>{t.legend_done}</span>
      </div>
    </main>
  );
}
