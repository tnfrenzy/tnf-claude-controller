import { useT } from "../../i18n";
import { canAddSkillFloor } from "../../office/floors";
import type { SkillFloor } from "../../office/floors";
import { Modal } from "../common/Modal";

export function SkillOverviewPopup(props: {
  skills: SkillFloor[];
  onOpenSkill: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Modal title={t.skill_overview_title} onClose={props.onClose}>
      {props.skills.length === 0 ? (
        <p className="fine">{t.skill_overview_empty}</p>
      ) : (
        <table className="skill-overview">
          <thead>
            <tr>
              <th>{t.skill_overview_col_name}</th>
              <th>{t.skill_overview_col_state}</th>
              <th>{t.skill_overview_col_best}</th>
            </tr>
          </thead>
          <tbody>
            {props.skills.map((s) => (
              <tr key={s.id}>
                <td><button type="button" className="link-btn" onClick={() => props.onOpenSkill(s.id)}>{s.name}</button></td>
                <td>{t[`skill_badge_${s.badge}` as const]}</td>
                <td>{s.score ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAddSkillFloor(props.skills.length) ? (
        <p><button type="button" onClick={props.onAdd}>{t.city_skill_add}</button></p>
      ) : null}
    </Modal>
  );
}
