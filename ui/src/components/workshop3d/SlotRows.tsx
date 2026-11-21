import { useT } from "../../i18n";
import { W3D_SLOT_MAX, type W3DSlotRow } from "../../office/workshop3d-session";

/** Rows (name + type) of the configurable slots; used by the request sheet and by the batch tab for old sessions. */
export function SlotRows(props: { rows: W3DSlotRow[]; onChange: (rows: W3DSlotRow[]) => void }) {
  const { t } = useT();
  const { rows, onChange } = props;
  const set = (i: number, patch: Partial<W3DSlotRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="w3i-slots" data-w3i-slots>
      {rows.map((r, i) => (
        <div key={i} className="w3i-param-row" data-slot-row={i}>
          <input type="text" aria-label={t.w3i_slot_name} placeholder={t.w3i_slot_name} maxLength={80} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <select aria-label={t.w3i_slot_name} value={r.type} onChange={(e) => set(i, { type: e.target.value === "part" ? "part" : "material" })}>
            <option value="material">{t.w3i_slot_type_material}</option>
            <option value="part">{t.w3i_slot_type_part}</option>
          </select>
          <button type="button" aria-label={t.w3i_slot_remove} onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" disabled={rows.length >= W3D_SLOT_MAX} onClick={() => onChange([...rows, { name: "", type: "material" }])}>{t.w3i_slot_add}</button>
    </div>
  );
}
