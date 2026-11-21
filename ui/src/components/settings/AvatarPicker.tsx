import { useId, useRef, type KeyboardEvent, type ReactElement } from "react";
import { AVATARS, AVATAR_CATEGORIES, type AvatarCategory, type AvatarPreset, type AvatarStyle } from "../../skills/avatars";
import { dicts, type Dict, type Lang } from "../../i18n";
import { AvatarPreview } from "./AvatarPreview";

const CATEGORY_KEYS: Record<AvatarCategory, keyof Dict> = {
  office: "ss_avatars_cat_office",
  tech: "ss_avatars_cat_tech",
  creative: "ss_avatars_cat_creative",
  special: "ss_avatars_cat_special",
};

export type PickerItem = { id: string; label: string; category: AvatarCategory | null };
export type PickerGroup = { category: AvatarCategory; titleKey: keyof Dict; items: PickerItem[] };

/** Chỉ số kế tiếp theo phím điều hướng (vòng); phím khác giữ nguyên. */
export function nextAvatarIndex(current: number, key: string, count: number): number {
  if (count <= 0) return 0;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

export function buildPickerItems(lang: Lang): { items: PickerItem[]; groups: PickerGroup[] } {
  const d = dicts[lang];
  const label = (a: AvatarPreset): string => (lang === "en" ? a.labelEn : a.labelVi);
  const def: PickerItem = { id: "", label: d.ss_avatar_default, category: null };
  const groups: PickerGroup[] = [];
  for (const category of AVATAR_CATEGORIES) {
    const items = AVATARS.filter((a) => a.category === category).map((a) => ({ id: a.id, label: label(a), category }));
    if (items.length) groups.push({ category, titleKey: CATEGORY_KEYS[category], items });
  }
  return { items: [def, ...groups.flatMap((g) => g.items)], groups };
}

export type AvatarPickerProps = { value: string; onChange: (id: string) => void; style: AvatarStyle; lang: Lang };

export function AvatarPicker({ value, onChange, style, lang }: AvatarPickerProps): ReactElement {
  const uid = useId();
  const d = dicts[lang];
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const { items, groups } = buildPickerItems(lang);
  const found = items.findIndex((i) => i.id === value);
  const selected = found < 0 ? -1 : found;
  const tabIndexAt = (idx: number): number => (idx === (selected < 0 ? 0 : selected) ? 0 : -1);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number): void => {
    const next = nextAvatarIndex(idx, e.key, items.length);
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    refs.current[next]?.focus();
    const target = items[next];
    if (target && next !== idx) onChange(target.id);
  };

  const card = (item: PickerItem, idx: number): ReactElement => {
    const checked = idx === selected;
    return (
      <button
        key={item.id || "__default"}
        ref={(el) => {
          refs.current[idx] = el;
        }}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={item.label}
        tabIndex={tabIndexAt(idx)}
        className={`avatar-picker__card${checked ? " avatar-picker__card--selected" : ""}`}
        onClick={() => onChange(item.id)}
        onKeyDown={(e) => onKeyDown(e, idx)}
      >
        <AvatarPreview mode={style} motion="idle" size={64} {...(item.id ? { avatarId: item.id } : { role: "analyst" })} />
        <span className="avatar-picker__label">{item.label}</span>
        {checked ? <span className="avatar-picker__check" aria-hidden="true">✓</span> : null}
      </button>
    );
  };

  let offset = 1;
  return (
    <div className="avatar-picker" role="radiogroup" aria-label={d.ss_avatars}>
      <div className="avatar-picker__grid">{items[0] ? card(items[0], 0) : null}</div>
      {groups.map((g) => {
        const titleId = `${uid}-${g.category}`;
        const start = offset;
        offset += g.items.length;
        return (
          <div key={g.category} className="avatar-picker__group" role="group" aria-labelledby={titleId}>
            <div id={titleId} className="avatar-picker__title">{d[g.titleKey]}</div>
            <div className="avatar-picker__grid">{g.items.map((it, i) => card(it, start + i))}</div>
          </div>
        );
      })}
    </div>
  );
}

export default AvatarPicker;
